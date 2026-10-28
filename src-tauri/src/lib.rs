use serde::{Deserialize, Serialize};
use reqwest::multipart;
use tokio::fs;
use mime_guess;
use std::path::Path;

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

    token_resp["access_token"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or("Failed to get token".to_string())
}

#[tauri::command]
async fn ask_gigachat(api_key: String, messages: Vec<Message>, model: String, attachments: Option<Vec<String>>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![ask_gigachat, upload_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
