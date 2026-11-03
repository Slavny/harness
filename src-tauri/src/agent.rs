// agent.rs — Агентный цикл для AI-кодинга (Фаза 2, обновлено в Фазе 5)
//
// Поток выполнения:
//   user_message → LLM → [tool_use → execute → tool_result] × N → финальный ответ
//
// Поддерживаемые провайдеры: claude, gemini, gigachat (через crate::llm)
//
// События, эмитируемые во frontend:
//   agent-start              — агент запущен
//   agent-thinking           — ожидаем ответ LLM (итерация N)
//   agent-text               — кусок текста от LLM
//   agent-tool-use           — LLM запрашивает инструмент
//   agent-permission-request — нужно подтверждение пользователя
//   agent-tool-result        — результат выполнения инструмента
//   agent-done               — агент завершил работу (статистика токенов)
//   agent-error              — ошибка или отмена

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::oneshot;

use crate::llm;
use crate::tools;

// ─── Константы ────────────────────────────────────────────────────────────────

const MAX_ITERATIONS: usize = 100; // Лимит итераций расширен до 100
const PERMISSION_TIMEOUT_SECS: u64 = 300; // 5 минут

const SYSTEM_PROMPT: &str = "\
You are an expert coding assistant with direct access to the user's workspace files and terminal.

## Tools workflow (follow this order for efficiency):
1. **list_dir** — explore structure before reading files
2. **grep_files** — find definitions/usages without reading whole files
3. **read_file** — read only what you need, use offset+length for large files
4. **edit_file** — most token-efficient: replaces exact string, not the whole file
5. **write_file** — only for new files or full rewrites
6. **run_command** — build, test, verify after every change

## Token efficiency rules:
- Never read a whole file when you only need a function — use grep first, then read with offset
- Always use edit_file instead of write_file when modifying existing code
- Read in chunks of 200 lines; the tool tells you how many lines remain
- Truncate run_command output is expected for long builds — check exit code

## Working style:
- Systematic: explore → locate → implement → verify (build/test)
- Make minimal targeted changes
- Explain briefly what you're about to do, then do it
- Always verify changes compile/run correctly";

// ─── Управляемое состояние агента ────────────────────────────────────────────

/// Глобальное состояние агента, управляемое Tauri.
pub struct AgentState {
    /// Флаг для отмены текущего цикла.
    pub cancelled: Mutex<bool>,
    /// Ожидающие ответа пользователя каналы разрешений (id → sender).
    pub pending_permissions: Mutex<HashMap<String, oneshot::Sender<bool>>>,
}

impl Default for AgentState {
    fn default() -> Self {
        Self {
            cancelled: Mutex::new(false),
            pending_permissions: Mutex::new(HashMap::new()),
        }
    }
}

// ─── Структуры событий (сериализуются в JSON для frontend) ───────────────────

#[derive(Serialize, Clone)]
struct AgentStartEvent {
    session_id: String,
}

#[derive(Serialize, Clone)]
struct AgentThinkingEvent {
    iteration: usize,
}

#[derive(Serialize, Clone)]
struct AgentTextEvent {
    text: String,
    iteration: usize,
}

#[derive(Serialize, Clone)]
struct AgentToolUseEvent {
    id: String,
    name: String,
    input: Value,
    iteration: usize,
    auto_approved: bool,
}

#[derive(Serialize, Clone)]
struct AgentPermissionRequestEvent {
    id: String,
    name: String,
    input: Value,
    description: String,
}

#[derive(Serialize, Clone)]
struct AgentToolResultEvent {
    id: String,
    name: String,
    result: String,
    is_error: bool,
    iteration: usize,
}

#[derive(Serialize, Clone)]
pub struct AgentDoneEvent {
    pub iterations: usize,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Serialize, Clone)]
pub struct AgentTokensEvent {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub iteration: usize,
}

#[derive(Serialize, Clone)]
struct AgentErrorEvent {
    error: String,
}

// ─── Выполнение инструментов ──────────────────────────────────────────────────

/// Вызывает нужный tool из модуля tools по имени и аргументам.
async fn execute_tool(name: &str, input: &Value, workspace: &str) -> Result<String, String> {
    match name {
        "read_file" => {
            let path = input["path"].as_str()
                .ok_or("read_file: 'path' is required")?.to_string();
            let offset = input["offset"].as_u64().map(|v| v as usize);
            let length = input["length"].as_u64().map(|v| v as usize);
            tools::tool_read_file(path, workspace.to_string(), offset, length).await
        }
        "write_file" => {
            let path = input["path"].as_str()
                .ok_or("write_file: 'path' is required")?.to_string();
            let content = input["content"].as_str()
                .ok_or("write_file: 'content' is required")?.to_string();
            tools::tool_write_file(path, content, workspace.to_string()).await
        }
        "edit_file" => {
            let path = input["path"].as_str()
                .ok_or("edit_file: 'path' is required")?.to_string();
            let old_string = input["old_string"].as_str()
                .ok_or("edit_file: 'old_string' is required")?.to_string();
            let new_string = input["new_string"].as_str()
                .unwrap_or("").to_string();
            tools::tool_edit_file(path, old_string, new_string, workspace.to_string()).await
        }
        "run_command" => {
            let command = input["command"].as_str()
                .ok_or("run_command: 'command' is required")?.to_string();
            let timeout_secs = input["timeout_secs"].as_u64();
            tools::tool_run_command(command, workspace.to_string(), timeout_secs).await
        }
        "list_dir" => {
            let path = input["path"].as_str()
                .ok_or("list_dir: 'path' is required")?.to_string();
            tools::tool_list_dir(path, workspace.to_string()).await
        }
        "grep_files" => {
            let pattern = input["pattern"].as_str()
                .ok_or("grep_files: 'pattern' is required")?.to_string();
            let dir = input["dir"].as_str()
                .ok_or("grep_files: 'dir' is required")?.to_string();
            let file_glob = input["file_glob"].as_str().map(|s| s.to_string());
            let max_results = input["max_results"].as_u64().map(|v| v as usize);
            tools::tool_grep_files(pattern, dir, workspace.to_string(), file_glob, max_results).await
        }
        unknown => Err(format!("Unknown tool: '{}'", unknown)),
    }
}

// ─── Логика разрешений ────────────────────────────────────────────────────────

/// Возвращает true если инструмент требует явного разрешения пользователя.
fn needs_permission(tool_name: &str, permission_mode: &str) -> bool {
    let mode = permission_mode.trim().to_lowercase();
    match mode.as_str() {
        "never ask" | "never" | "never_ask" => false,
        "always ask" | "always" | "always_ask" => true,
        "ask when needed" | "ask_when_needed" => {
            // Только деструктивные/выполняющие операции
            matches!(tool_name, "write_file" | "edit_file" | "run_command")
        }
        _ => false, // по умолчанию не блокируем
    }
}

/// Читаемое описание действия инструмента для диалога подтверждения.
fn describe_tool_action(name: &str, input: &Value) -> String {
    match name {
        "read_file" => format!(
            "Read file: {}{}",
            input["path"].as_str().unwrap_or("?"),
            input["offset"].as_u64().map(|o| format!(" (from line {})", o + 1)).unwrap_or_default()
        ),
        "write_file" => format!(
            "Write {} bytes to: {}",
            input["content"].as_str().unwrap_or("").len(),
            input["path"].as_str().unwrap_or("?")
        ),
        "edit_file" => format!(
            "Edit file: {} (replace {} chars)",
            input["path"].as_str().unwrap_or("?"),
            input["old_string"].as_str().unwrap_or("").len()
        ),
        "run_command" => format!("Run: {}", input["command"].as_str().unwrap_or("?")),
        "list_dir" => format!("List directory: {}", input["path"].as_str().unwrap_or("?")),
        "grep_files" => format!(
            "Search '{}' in {}{}",
            input["pattern"].as_str().unwrap_or("?"),
            input["dir"].as_str().unwrap_or("?"),
            input["file_glob"].as_str().map(|e| format!(" (*.{})", e)).unwrap_or_default()
        ),
        _ => format!("{}({})", name, input),
    }
}

#[derive(serde::Deserialize, Clone, Debug)]
pub struct ChatHistoryItem {
    pub role: String,
    pub text: String,
}

// ─── Главная команда: agent_run ───────────────────────────────────────────────

/// Запускает агентный цикл: вызывает LLM, выполняет инструменты, стримит события.
///
/// Параметры:
/// - `api_key`         — API-ключ провайдера
/// - `provider`        — "claude" | "gemini" | "gigachat"
/// - `model`           — название модели
/// - `user_message`    — Начальный запрос
/// - `workspace`       — Абсолютный путь к рабочей папке (sandbox)
/// - `permission_mode` — "Never Ask" | "Ask When Needed" | "Always Ask"
/// - `session_id`      — Уникальный ID сессии для различия событий на фронте
/// - `history`         — История предыдущих сообщений (для продолжения диалога)
#[tauri::command]
pub async fn agent_run(
    app: AppHandle,
    api_key: String,
    provider: String,
    model: String,
    user_message: String,
    workspace: String,
    permission_mode: String,
    session_id: String,
    history: Option<Vec<ChatHistoryItem>>,
    agent_state: State<'_, AgentState>,
) -> Result<(), String> {
    // Сбрасываем флаг отмены
    *agent_state.cancelled.lock().map_err(|e| e.to_string())? = false;

    // HTTP-клиент с увеличенным таймаутом для долгих LLM-запросов
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let _ = app.emit("agent-start", AgentStartEvent { session_id: session_id.clone() });

    // История сообщений: восстанавливаем предыдущий контекст диалога если есть
    let mut messages: Vec<Value> = Vec::new();
    if let Some(hist) = history {
        for item in hist {
            if item.role == "user" {
                messages.push(llm::user_message(&provider, &item.text));
            } else if item.role == "assistant" {
                messages.push(llm::assistant_text_message(&provider, &item.text));
            }
        }
    }
    messages.push(llm::user_message(&provider, &user_message));

    let mut total_input_tokens: u64 = 0;
    let mut total_output_tokens: u64 = 0;
    let mut has_executed_any_tool: bool = false;
    let mut nudge_count: usize = 0;
    const MAX_NUDGES: usize = 1;

    // Анти-зацикливание: отслеживание повторных одинаковых вызовов
    let mut last_tool_call_signature: Option<(String, String)> = None;
    let mut duplicate_tool_count: usize = 0;

    for iteration in 0..MAX_ITERATIONS {
        // ── Проверяем отмену ──────────────────────────────────────────────────
        if *agent_state.cancelled.lock().map_err(|e| e.to_string())? {
            let _ = app.emit("agent-error", AgentErrorEvent {
                error: "Cancelled by user".to_string(),
            });
            return Ok(());
        }

        let _ = app.emit("agent-thinking", AgentThinkingEvent { iteration });

        // ── Вызываем LLM (единая точка входа для всех провайдеров) ────────────
        let response = match llm::call_llm(
            &client,
            &provider,
            &api_key,
            &model,
            &messages,
            SYSTEM_PROMPT,
        ).await {
            Ok(r) => r,
            Err(e) => {
                let _ = app.emit("agent-error", AgentErrorEvent { error: e.clone() });
                return Err(e);
            }
        };

        total_input_tokens += response.input_tokens;
        total_output_tokens += response.output_tokens;

        // Эмитируем текущий расход токенов в реальном времени
        let _ = app.emit("agent-tokens", AgentTokensEvent {
            input_tokens: total_input_tokens,
            output_tokens: total_output_tokens,
            total_tokens: total_input_tokens + total_output_tokens,
            iteration: iteration + 1,
        });

        // ── Эмитируем текстовые блоки ─────────────────────────────────────────
        for text in &response.texts {
            let _ = app.emit("agent-text", AgentTextEvent {
                text: text.clone(),
                iteration,
            });
        }

        let tool_calls = response.tool_calls;

        // Добавляем assistant-сообщение в историю (нативный формат провайдера)
        messages.push(response.assistant_message);

        // ── Если LLM закончил — выходим ───────────────────────────────────────
        if matches!(response.stop_reason, llm::StopReason::EndTurn) || tool_calls.is_empty() {
            // Nudge делаем ТОЛЬКО на первом шаге, если модель ничего не вызвала и ответила текстом.
            // Если инструменты уже выполнялись — модель имеет полное право завершить работу текстом!
            if provider == "gigachat"
                && !has_executed_any_tool
                && !response.texts.is_empty()
                && tool_calls.is_empty()
                && nudge_count < MAX_NUDGES
            {
                nudge_count += 1;
                messages.push(json!({
                    "role": "user",
                    "content": "Не пиши план текстом. Сразу начни с вызова инструмента (например, list_dir, read_file или write_file)."
                }));
                continue; // следующая итерация цикла
            }

            let _ = app.emit("agent-done", AgentDoneEvent {
                iterations: iteration + 1,
                input_tokens: total_input_tokens,
                output_tokens: total_output_tokens,
            });
            return Ok(());
        }

        // ── Выполняем tool_use блоки ──────────────────────────────────────────
        // (id, name, content, is_error)
        let mut tool_results_data: Vec<(String, String, String, bool)> = Vec::new();

        for tool_call in &tool_calls {
            let tool_id = &tool_call.id;
            let tool_name = &tool_call.name;
            let tool_input = &tool_call.input;

            // Проверяем отмену перед каждым инструментом
            if *agent_state.cancelled.lock().map_err(|e| e.to_string())? {
                let _ = app.emit("agent-error", AgentErrorEvent {
                    error: "Cancelled by user".to_string(),
                });
                return Ok(());
            }

            // ── Проверка на зацикливание (одинаковый вызов подряд) ───────────
            let sig = (tool_name.clone(), tool_input.to_string());
            if let Some(ref prev_sig) = last_tool_call_signature {
                if prev_sig == &sig {
                    duplicate_tool_count += 1;
                } else {
                    duplicate_tool_count = 0;
                }
            } else {
                duplicate_tool_count = 0;
            }
            last_tool_call_signature = Some(sig);

            // Первый повтор: перехватываем и возвращаем модели ошибку, не читая файл заново
            if duplicate_tool_count == 1 {
                let warn_msg = format!(
                    "Внимание: инструмент '{}' уже был вызван с теми же параметрами! Результат уже есть выше. НЕ вызывай read_file повторно — примени изменения через edit_file или write_file, либо ответь пользователю.",
                    tool_name
                );

                let _ = app.emit("agent-tool-use", AgentToolUseEvent {
                    id: tool_id.clone(),
                    name: tool_name.clone(),
                    input: tool_input.clone(),
                    iteration,
                    auto_approved: true,
                });

                let _ = app.emit("agent-tool-result", AgentToolResultEvent {
                    id: tool_id.clone(),
                    name: tool_name.clone(),
                    result: warn_msg.clone(),
                    is_error: true,
                    iteration,
                });

                tool_results_data.push((
                    tool_id.clone(),
                    tool_name.clone(),
                    warn_msg,
                    true,
                ));
                continue;
            }

            // Второй повтор (3-й раз подряд): аварийная остановка
            if duplicate_tool_count >= 2 {
                let _ = app.emit("agent-error", AgentErrorEvent {
                    error: format!(
                        "Сессия остановлена: инструмент '{}' вызван повторно 3 раза подряд с теми же параметрами.",
                        tool_name
                    ),
                });
                return Ok(());
            }

            has_executed_any_tool = true;

            let requires_perm = needs_permission(tool_name, &permission_mode);

            // ── СНАЧАЛА показываем tool-блок в UI ────────────────────────────
            // agent-tool-use эмитируется ДО запроса разрешения, чтобы блок
            // появился в интерфейсе и внутри него показался диалог Allow/Deny.
            let _ = app.emit("agent-tool-use", AgentToolUseEvent {
                id: tool_id.clone(),
                name: tool_name.clone(),
                input: tool_input.clone(),
                iteration,
                auto_approved: !requires_perm,
            });

            // ── Запрашиваем разрешение если нужно ────────────────────────────
            let approved = if requires_perm {
                let (tx, rx) = oneshot::channel::<bool>();
                {
                    let mut pending = agent_state.pending_permissions
                        .lock()
                        .map_err(|e| e.to_string())?;
                    pending.insert(tool_id.clone(), tx);
                }

                let _ = app.emit("agent-permission-request", AgentPermissionRequestEvent {
                    id: tool_id.clone(),
                    name: tool_name.clone(),
                    input: tool_input.clone(),
                    description: describe_tool_action(tool_name, tool_input),
                });

                // Ждём решения пользователя (таймаут 5 минут)
                match tokio::time::timeout(
                    std::time::Duration::from_secs(PERMISSION_TIMEOUT_SECS),
                    rx,
                ).await {
                    Ok(Ok(decision)) => decision,
                    _ => {
                        // Таймаут или канал закрылся → отклоняем
                        agent_state.pending_permissions
                            .lock()
                            .map_err(|e| e.to_string())?
                            .remove(tool_id);
                        false
                    }
                }
            } else {
                true
            };

            // ── Выполняем инструмент ──────────────────────────────────────────
            let (result_text, is_error) = if !approved {
                (
                    format!(
                        "Action denied by user: {}",
                        describe_tool_action(tool_name, tool_input)
                    ),
                    true,
                )
            } else {
                match execute_tool(tool_name, tool_input, &workspace).await {
                    Ok(output) => (output, false),
                    Err(err) => (format!("Tool error: {}", err), true),
                }
            };

            let _ = app.emit("agent-tool-result", AgentToolResultEvent {
                id: tool_id.clone(),
                name: tool_name.clone(),
                result: result_text.clone(),
                is_error,
                iteration,
            });

            tool_results_data.push((
                tool_id.clone(),
                tool_name.clone(),
                result_text,
                is_error,
            ));
        }

        // Добавляем результаты инструментов в историю (нативный формат провайдера)
        let result_messages = llm::format_tool_results_messages(&provider, &tool_results_data);
        messages.extend(result_messages);
    }

    // Превышен лимит итераций
    let _ = app.emit("agent-error", AgentErrorEvent {
        error: format!(
            "Reached maximum iterations limit ({}). The task may be too complex.",
            MAX_ITERATIONS
        ),
    });

    Ok(())
}

// ─── Управляющие команды ──────────────────────────────────────────────────────

/// Подтверждает или отклоняет запрос на выполнение инструмента.
/// Вызывается из фронтенда после показа диалога `agent-permission-request`.
#[tauri::command]
pub fn agent_approve(
    id: String,
    approved: bool,
    agent_state: State<'_, AgentState>,
) -> Result<(), String> {
    let mut pending = agent_state.pending_permissions
        .lock()
        .map_err(|e| e.to_string())?;
    if let Some(sender) = pending.remove(&id) {
        let _ = sender.send(approved);
        Ok(())
    } else {
        Err(format!("No pending permission request with id: {}", id))
    }
}

/// Отменяет текущий агентный цикл после следующей итерации.
#[tauri::command]
pub fn agent_cancel(agent_state: State<'_, AgentState>) -> Result<(), String> {
    *agent_state.cancelled.lock().map_err(|e| e.to_string())? = true;
    Ok(())
}

