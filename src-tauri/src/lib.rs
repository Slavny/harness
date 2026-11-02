use serde::{Deserialize, Serialize};
use reqwest::multipart;
use tokio::fs;
use mime_guess;
use std::path::Path;
use std::io::Write;
use std::sync::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};

struct TerminalState {
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    child: Mutex<Option<Box<dyn Child + Send>>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self { writer: Mutex::new(None), child: Mutex::new(None), master: Mutex::new(None) }
    }
}

#[derive(Serialize, Deserialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attachments: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    function_call: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Message {
    role: String,
    content: String,
}

#[derive(Deserialize, Debug)]
struct FileUploadResponse {
    id: String,
}

async fn get_access_token(client: &reqwest::Client, api_key: &str) -> Result<String, String> {
    let token_resp = client
        .post("https://ngw.devices.sberbank.ru:9443/api/v2/oauth")
        .header("Authorization", format!("Basic {}", api_key))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("RqUID", "a1d3f570-3498-4c8d-87d4-8d9e325608b4")
        .body("scope=GIGACHAT_API_PERS")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(token) = token_resp["access_token"].as_str() {
        Ok(token.to_string())
    } else if let Some(msg) = token_resp["message"].as_str() {
        Err(format!("GigaChat OAuth error: {}", msg))
    } else {
        Err(format!("Failed to get token: {:?}", token_resp))
    }
}

#[tauri::command]
async fn ask_gigachat(api_key: String, messages: Vec<Message>, model: String, attachments: Option<Vec<String>>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;

    // 1. Get OAuth Token
    let token = get_access_token(&client, &api_key).await?;

    // 2. Ask GigaChat
    let chat_resp = client
        .post("https://api.giga.chat/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", token))
        .header("RqUID", "9f6ba4bb-7f0e-4c15-b276-d9a1d6400eaf")
        .json(&ChatRequest {
            model: model,
            messages: messages,
            attachments: attachments,
            function_call: Some("auto".to_string()),
        })
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    Ok(chat_resp["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or(&format!("Raw response: {:?}", chat_resp))
        .to_string())
}

#[tauri::command]
async fn upload_file(api_key: String, file_path: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;

    let token = get_access_token(&client, &api_key).await?;
    
    // Читаем файл
    let file_content = fs::read(&file_path).await.map_err(|e| e.to_string())?;
    let file_name = Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid file name")?;

    // Создаем multipart часть
    let mime = mime_guess::from_path(&file_path).first_or_octet_stream();
    let part = multipart::Part::bytes(file_content)
        .mime_str(mime.as_ref())
        .map_err(|e| e.to_string())?
        .file_name(file_name.to_string());

    let form = multipart::Form::new()
        .part("file", part)
        .text("purpose", "general");

    // Отправляем
    let resp = client
        .post("https://api.giga.chat/v1/files")
        .header("Authorization", format!("Bearer {}", token))
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        let upload_resp = resp.json::<FileUploadResponse>().await.map_err(|e| e.to_string())?;
        Ok(upload_resp.id)
    } else {
        Err(format!("Upload failed: {:?}", resp.text().await.unwrap_or_default()))
    }
}

/// Starts an interactive PowerShell process and streams its output to the frontend.
#[tauri::command]
fn start_terminal(app: AppHandle, state: State<'_, TerminalState>) -> Result<(), String> {
    close_terminal_inner(&state)?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 30, cols: 120, pixel_width: 0, pixel_height: 0 })
        .map_err(|error| error.to_string())?;

    let mut command;
    if cfg!(target_os = "windows") {
        command = CommandBuilder::new("powershell.exe");
        command.arg("-NoLogo");
        command.arg("-NoProfile");
        command.arg("-ExecutionPolicy");
        command.arg("Bypass");
    } else {
        command = CommandBuilder::new("bash");
    }

    let child = pair.slave.spawn_command(command).map_err(|error| error.to_string())?;
    *state.child.lock().map_err(|error| error.to_string())? = Some(child);
    let mut reader = pair.master.try_clone_reader().map_err(|error| error.to_string())?;
    let writer = pair.master.take_writer().map_err(|error| error.to_string())?;
    *state.writer.lock().map_err(|error| error.to_string())? = Some(writer);
    *state.master.lock().map_err(|error| error.to_string())? = Some(pair.master);

    std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match std::io::Read::read(&mut reader, &mut buffer) {
                Ok(0) => break,
                Err(error) => {
                    let _ = app.emit("terminal-output", format!("\r\n[PTY read error: {error}]\r\n"));
                    break;
                }
                Ok(size) => {
                    let output = String::from_utf8_lossy(&buffer[..size]).to_string();
                    let _ = app.emit("terminal-output", output);
                }
            }
        }
        let _ = app.emit("terminal-exited", ());
    });

    Ok(())
}

#[tauri::command]
fn write_terminal(input: String, state: State<'_, TerminalState>) -> Result<(), String> {
    let mut writer = state.writer.lock().map_err(|error| error.to_string())?;
    let writer = writer.as_mut().ok_or("Terminal is not running")?;
    writer.write_all(input.as_bytes()).map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}

fn close_terminal_inner(state: &State<'_, TerminalState>) -> Result<(), String> {
    let mut writer = state.writer.lock().map_err(|error| error.to_string())?;
    *writer = None;
    if let Some(mut child) = state.child.lock().map_err(|error| error.to_string())?.take() {
        let _ = child.kill();
    }
    *state.master.lock().map_err(|error| error.to_string())? = None;
    Ok(())
}

#[tauri::command]
fn close_terminal(state: State<'_, TerminalState>) -> Result<(), String> {
    close_terminal_inner(&state)
}

/// Updates the shell's terminal dimensions after the frontend is resized.
#[tauri::command]
fn resize_terminal(rows: u16, cols: u16, state: State<'_, TerminalState>) -> Result<(), String> {
    let master = state.master.lock().map_err(|error| error.to_string())?;
    if let Some(master) = master.as_ref() {
        master.resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_user_home_dir() -> Result<String, String> {
    std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]

pub fn run() {
    tauri::Builder::default()
        .manage(TerminalState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![ask_gigachat, upload_file, start_terminal, write_terminal, close_terminal, resize_terminal, get_user_home_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
