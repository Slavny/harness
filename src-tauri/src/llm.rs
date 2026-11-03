// llm.rs — Абстракция LLM-провайдеров для агентного цикла (Фаза 5)
//
// Поддерживаемые провайдеры:
//   "claude"   — Anthropic Claude (tool_use / tool_result)
//   "gemini"   — Google Gemini (functionCall / functionResponse)
//   "gigachat" — SberBank GigaChat (function / function role)

use serde::Deserialize;
use serde_json::{json, Value};

// ─── Константы ────────────────────────────────────────────────────────────────

const MAX_TOKENS: u32 = 8192;

// ─── Общие типы ───────────────────────────────────────────────────────────────

/// Единый вызов инструмента от LLM.
pub struct LlmToolCall {
    /// Уникальный ID вызова (для Claude — toolu_..., для Gemini — gemini-{name}-{idx}).
    pub id: String,
    pub name: String,
    pub input: Value,
}

/// Причина остановки генерации.
pub enum StopReason {
    EndTurn,
    ToolUse,
}

/// Унифицированный ответ от LLM.
pub struct LlmResponse {
    /// Текстовые блоки из ответа.
    pub texts: Vec<String>,
    /// Запрошенные инструменты.
    pub tool_calls: Vec<LlmToolCall>,
    /// Причина остановки.
    pub stop_reason: StopReason,
    /// Токены запроса.
    pub input_tokens: u64,
    /// Токены ответа.
    pub output_tokens: u64,
    /// Сообщение ассистента в нативном формате провайдера (для истории).
    pub assistant_message: Value,
}

// ─── Определения инструментов ─────────────────────────────────────────────────

/// Описания параметров инструментов (единый источник истины).
fn tool_specs() -> Vec<(&'static str, &'static str, Value)> {
    vec![
        (
            "read_file",
            "Read file content within the workspace. Use offset/length for large files to save tokens.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path relative to workspace root" },
                    "offset": { "type": "integer", "description": "Start line, 0-based (default: 0)" },
                    "length": { "type": "integer", "description": "Max lines to return (default: 1000, max: 2000)" }
                },
                "required": ["path"]
            }),
        ),
        (
            "write_file",
            "Create or completely overwrite a file. For existing files prefer edit_file.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path relative to workspace" },
                    "content": { "type": "string", "description": "Full file content" }
                },
                "required": ["path", "content"]
            }),
        ),
        (
            "edit_file",
            "Replace an exact string in a file. Most token-efficient edit. old_string must be unique in the file.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path relative to workspace" },
                    "old_string": { "type": "string", "description": "Exact text to replace" },
                    "new_string": { "type": "string", "description": "Replacement text (can be empty to delete)" }
                },
                "required": ["path", "old_string", "new_string"]
            }),
        ),
        (
            "run_command",
            "Execute a shell command in the workspace directory. Returns stdout+stderr (max 8KB).",
            json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Shell command (PowerShell on Windows)" },
                    "timeout_secs": { "type": "integer", "description": "Timeout seconds (default: 30, max: 120)" }
                },
                "required": ["command"]
            }),
        ),
        (
            "list_dir",
            "List directory contents with file sizes. Skips node_modules, .git, target automatically.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Directory path relative to workspace (use '.' for root)" }
                },
                "required": ["path"]
            }),
        ),
        (
            "grep_files",
            "Recursively search for a pattern in files. Much more token-efficient than reading files.",
            json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Search string (case-insensitive substring)" },
                    "dir": { "type": "string", "description": "Directory to search (relative to workspace, '.' for all)" },
                    "file_glob": { "type": "string", "description": "Extension filter: 'rs', 'tsx', 'ts', 'py' (without dot)" },
                    "max_results": { "type": "integer", "description": "Max matches (default: 50, max: 200)" }
                },
                "required": ["pattern", "dir"]
            }),
        ),
    ]
}

/// Определения для Claude (input_schema).
pub fn tool_definitions_claude() -> Value {
    let specs = tool_specs();
    let tools: Vec<Value> = specs
        .into_iter()
        .map(|(name, desc, params)| {
            json!({
                "name": name,
                "description": desc,
                "input_schema": params
            })
        })
        .collect();
    json!(tools)
}

/// Определения для Gemini (function_declarations + parameters).
pub fn tool_definitions_gemini() -> Value {
    let specs = tool_specs();
    let decls: Vec<Value> = specs
        .into_iter()
        .map(|(name, desc, params)| {
            json!({
                "name": name,
                "description": desc,
                "parameters": params
            })
        })
        .collect();
    json!([{ "function_declarations": decls }])
}

/// Определения для GigaChat (OpenAI-style functions array).
pub fn tool_definitions_gigachat() -> Value {
    let specs = tool_specs();
    let functions: Vec<Value> = specs
        .into_iter()
        .map(|(name, desc, params)| {
            json!({
                "name": name,
                "description": desc,
                "parameters": params
            })
        })
        .collect();
    json!(functions)
}

// ─── Формирование сообщений ───────────────────────────────────────────────────

/// Создаёт начальное user-сообщение в нативном формате провайдера.
pub fn user_message(provider: &str, text: &str) -> Value {
    match provider {
        "gemini" => json!({
            "role": "user",
            "parts": [{ "text": text }]
        }),
        _ => json!({
            "role": "user",
            "content": text
        }),
    }
}

/// Создаёт assistant-сообщение (для передачи истории предыдущих шагов).
pub fn assistant_text_message(provider: &str, text: &str) -> Value {
    match provider {
        "gemini" => json!({
            "role": "model",
            "parts": [{ "text": text }]
        }),
        _ => json!({
            "role": "assistant",
            "content": text
        }),
    }
}

/// Формирует сообщения с результатами инструментов.
///
/// tool_results: &[(id, name, content, is_error)]
pub fn format_tool_results_messages(
    provider: &str,
    tool_results: &[(String, String, String, bool)],
) -> Vec<Value> {
    match provider {
        "gemini" => {
            // Gemini: одно user-сообщение с несколькими parts типа functionResponse
            let parts: Vec<Value> = tool_results
                .iter()
                .map(|(_id, name, content, is_error)| {
                    let output = if *is_error {
                        json!({ "error": content })
                    } else {
                        json!({ "output": content })
                    };
                    json!({
                        "functionResponse": {
                            "name": name,
                            "response": output
                        }
                    })
                })
                .collect();
            vec![json!({ "role": "user", "parts": parts })]
        }
        "gigachat" => {
            // GigaChat: одно сообщение на каждый результат с role: "function"
            // ВАЖНО: content должен быть валидным JSON-объектом (сериализованным в строку)
            tool_results
                .iter()
                .map(|(_id, name, content, is_error)| {
                    let json_content = if *is_error {
                        serde_json::to_string(&json!({ "error": content }))
                            .unwrap_or_else(|_| format!("{{\"error\":{:?}}}", content))
                    } else {
                        serde_json::to_string(&json!({ "result": content }))
                            .unwrap_or_else(|_| format!("{{\"result\":{:?}}}", content))
                    };
                    json!({
                        "role": "function",
                        "name": name,
                        "content": json_content
                    })
                })
                .collect()
        }
        _ => {
            // Claude: одно user-сообщение с массивом tool_result блоков
            let content: Vec<Value> = tool_results
                .iter()
                .map(|(id, _name, content, is_error)| {
                    json!({
                        "type": "tool_result",
                        "tool_use_id": id,
                        "content": content,
                        "is_error": is_error
                    })
                })
                .collect();
            vec![json!({ "role": "user", "content": content })]
        }
    }
}

// ─── Claude API ───────────────────────────────────────────────────────────────

#[derive(Deserialize, Debug)]
struct ClaudeResponse {
    content: Vec<ClaudeContentBlock>,
    stop_reason: Option<String>,
    usage: Option<ClaudeUsage>,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum ClaudeContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse { id: String, name: String, input: Value },
}

#[derive(Deserialize, Debug, Default)]
struct ClaudeUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

async fn call_claude(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    messages: &[Value],
    system_prompt: &str,
) -> Result<LlmResponse, String> {
    let body = json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": system_prompt,
        "tools": tool_definitions_claude(),
        "messages": messages
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Claude API request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Claude API error {}: {}", status, text));
    }

    let raw: ClaudeResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Claude response: {}", e))?;

    let input_tokens = raw.usage.as_ref().and_then(|u| u.input_tokens).unwrap_or(0);
    let output_tokens = raw.usage.as_ref().and_then(|u| u.output_tokens).unwrap_or(0);
    let stop_reason_str = raw.stop_reason.as_deref().unwrap_or("end_turn");

    let mut texts = Vec::new();
    let mut tool_calls = Vec::new();
    let mut assistant_content: Vec<Value> = Vec::new();

    for block in raw.content {
        match block {
            ClaudeContentBlock::Text { text } if !text.is_empty() => {
                assistant_content.push(json!({ "type": "text", "text": text }));
                texts.push(text);
            }
            ClaudeContentBlock::Text { .. } => {}
            ClaudeContentBlock::ToolUse { id, name, input } => {
                assistant_content.push(json!({
                    "type": "tool_use",
                    "id": id,
                    "name": name,
                    "input": input
                }));
                tool_calls.push(LlmToolCall { id, name, input });
            }
        }
    }

    let stop_reason = if stop_reason_str == "tool_use" || !tool_calls.is_empty() {
        StopReason::ToolUse
    } else {
        StopReason::EndTurn
    };

    Ok(LlmResponse {
        texts,
        tool_calls,
        stop_reason,
        input_tokens,
        output_tokens,
        assistant_message: json!({ "role": "assistant", "content": assistant_content }),
    })
}

// ─── Gemini API ───────────────────────────────────────────────────────────────

async fn call_gemini(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    messages: &[Value],
    system_prompt: &str,
) -> Result<LlmResponse, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );

    let body = json!({
        "system_instruction": {
            "parts": [{ "text": system_prompt }]
        },
        "tools": tool_definitions_gemini(),
        "contents": messages,
        "generationConfig": {
            "maxOutputTokens": MAX_TOKENS
        }
    });

    let resp = client
        .post(&url)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Gemini API request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Gemini API error {}: {}", status, text));
    }

    let raw: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

    let input_tokens = raw["usageMetadata"]["promptTokenCount"]
        .as_u64()
        .unwrap_or(0);
    let output_tokens = raw["usageMetadata"]["candidatesTokenCount"]
        .as_u64()
        .unwrap_or(0);

    let parts = raw["candidates"][0]["content"]["parts"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    let finish_reason = raw["candidates"][0]["finishReason"]
        .as_str()
        .unwrap_or("STOP");

    let mut texts = Vec::new();
    let mut tool_calls = Vec::new();
    let mut assistant_parts: Vec<Value> = Vec::new();

    for (idx, part) in parts.iter().enumerate() {
        if let Some(text) = part["text"].as_str() {
            if !text.is_empty() {
                texts.push(text.to_string());
                assistant_parts.push(json!({ "text": text }));
            }
        } else if part["functionCall"].is_object() {
            let fc = &part["functionCall"];
            let name = fc["name"].as_str().unwrap_or("unknown").to_string();
            // Gemini не возвращает ID — генерируем сами
            let id = format!("gemini-{}-{}", name, idx);
            let input = fc["args"].clone();
            assistant_parts.push(json!({ "functionCall": { "name": name, "args": input } }));
            tool_calls.push(LlmToolCall {
                id,
                name,
                input,
            });
        }
    }

    let stop_reason = if finish_reason == "STOP" && tool_calls.is_empty() {
        StopReason::EndTurn
    } else {
        StopReason::ToolUse
    };

    Ok(LlmResponse {
        texts,
        tool_calls,
        stop_reason,
        input_tokens,
        output_tokens,
        assistant_message: json!({ "role": "model", "parts": assistant_parts }),
    })
}

// ─── GigaChat API (агентный режим) ───────────────────────────────────────────

async fn get_gigachat_token(client: &reqwest::Client, api_key: &str) -> Result<String, String> {
    let resp = client
        .post("https://ngw.devices.sberbank.ru:9443/api/v2/oauth")
        .header("Authorization", format!("Basic {}", api_key))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("RqUID", "a1d3f570-3498-4c8d-87d4-8d9e325608b4")
        .body("scope=GIGACHAT_API_PERS")
        .send()
        .await
        .map_err(|e| format!("GigaChat OAuth request failed (проверь интернет/VPN): {}", e))?
        .json::<Value>()
        .await
        .map_err(|e| format!("GigaChat OAuth: не удалось прочитать ответ: {}", e))?;

    if let Some(token) = resp["access_token"].as_str() {
        Ok(token.to_string())
    } else if let Some(msg) = resp["message"].as_str() {
        Err(format!("GigaChat OAuth ошибка: {} (проверь API-ключ)", msg))
    } else {
        Err(format!("GigaChat OAuth: неожиданный ответ: {}", 
            serde_json::to_string(&resp).unwrap_or_default().chars().take(200).collect::<String>()))
    }
}

async fn call_gigachat(
    _client: &reqwest::Client,
    api_key: &str,
    model: &str,
    messages: &[Value],
    _system_prompt: &str,  // GigaChat получает короткий русский промпт ниже
) -> Result<LlmResponse, String> {
    // GigaChat требует отдельный клиент с отключённой проверкой сертификатов
    let gc_client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .no_proxy()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Failed to build GigaChat client: {}", e))?;

    let token = get_gigachat_token(&gc_client, api_key).await?;

    // Системный промпт для GigaChat: чёткие правила и условие завершения
    let gc_system = "Ты — AI-программист, работающий с файлами в рабочей папке пользователя. \
Доступные инструменты: write_file, edit_file, read_file, run_command, list_dir, grep_files. \
ПРАВИЛА: \
1. Чтобы создать или перезаписать файл — вызывай write_file. \
2. Чтобы изменить фрагмент — вызывай edit_file. \
3. Если ты уже прочитал файл через read_file — НЕ читай его повторно! Сразу переходи к edit_file или write_file. \
4. ЗАПРЕЩЕНО вызывать один и тот же инструмент с одинаковыми параметрами. \
5. Когда работа выполнена — НЕ вызывай инструменты! Напиши пользователю понятный текстовый ответ: что сделано и как это проверить.";

    // Добавляем system prompt как первое сообщение
    let mut all_messages: Vec<Value> = vec![
        json!({ "role": "system", "content": gc_system })
    ];
    all_messages.extend_from_slice(messages);

    let body = json!({
        "model": model,
        "messages": all_messages,
        "functions": tool_definitions_gigachat(),
        "function_call": "auto"
    });

    let resp = gc_client
        .post("https://api.giga.chat/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", token))
        .header("RqUID", "9f6ba4bb-7f0e-4c15-b276-d9a1d6400eaf")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("GigaChat API request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("GigaChat API error {}: {}", status, text));
    }

    let raw: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse GigaChat response: {}", e))?;

    // Диагностика: если choices пустые или отсутствуют — возвращаем понятную ошибку с телом ответа
    let choices = match raw["choices"].as_array() {
        Some(arr) if !arr.is_empty() => arr,
        _ => {
            let body = serde_json::to_string(&raw).unwrap_or_default();
            let preview = body.chars().take(400).collect::<String>();
            return Err(format!(
                "GigaChat: пустой или неожиданный ответ. Тело ответа: {}",
                preview
            ));
        }
    };

    let input_tokens = raw["usage"]["prompt_tokens"].as_u64().unwrap_or(0);
    let output_tokens = raw["usage"]["completion_tokens"].as_u64().unwrap_or(0);

    let message = &choices[0]["message"];
    let finish_reason = choices[0]["finish_reason"].as_str().unwrap_or("stop");

    let mut texts = Vec::new();
    let mut tool_calls = Vec::new();

    // Текстовый ответ
    if let Some(text) = message["content"].as_str() {
        if !text.is_empty() {
            texts.push(text.to_string());
        }
    }

    // Function call
    if message["function_call"].is_object() {
        let fc = &message["function_call"];
        let name = fc["name"].as_str().unwrap_or("unknown").to_string();
        let id = fc["id"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("gc-{}", name));
        // arguments может быть строкой (JSON) или объектом
        let input = if let Some(args_str) = fc["arguments"].as_str() {
            serde_json::from_str(args_str).unwrap_or(json!({}))
        } else {
            fc["arguments"].clone()
        };
        tool_calls.push(LlmToolCall { id, name, input });
    }

    // GigaChat возвращает одну function_call за раз
    let stop_reason = if finish_reason == "function_call" || !tool_calls.is_empty() {
        StopReason::ToolUse
    } else {
        StopReason::EndTurn
    };

    // Защита: если нет ни текста ни function_call — возвращаем ошибку с диагностикой
    if texts.is_empty() && tool_calls.is_empty() {
        let raw_msg = serde_json::to_string(message).unwrap_or_default();
        let preview = raw_msg.chars().take(300).collect::<String>();
        return Err(format!(
            "GigaChat: пустой ответ (нет текста и function_call). finish_reason={}, message={}",
            finish_reason, preview
        ));
    }

    // ВАЖНО: message уже содержит { "role": "assistant", "content": "...", "function_call": {...} }
    // НЕ оборачиваем повторно — берём как есть для истории
    Ok(LlmResponse {
        texts,
        tool_calls,
        stop_reason,
        input_tokens,
        output_tokens,
        assistant_message: message.clone(),
    })
}

// ─── Единая точка входа ───────────────────────────────────────────────────────

/// Вызывает нужный LLM-провайдер по имени.
///
/// provider: "claude" | "gemini" | "gigachat"
pub async fn call_llm(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[Value],
    system_prompt: &str,
) -> Result<LlmResponse, String> {
    match provider {
        "gemini" => call_gemini(client, api_key, model, messages, system_prompt).await,
        "gigachat" => call_gigachat(client, api_key, model, messages, system_prompt).await,
        _ => call_claude(client, api_key, model, messages, system_prompt).await,
    }
}
