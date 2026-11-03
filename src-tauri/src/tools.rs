// tools.rs — Tool Executor для AI-агента (Фаза 1)
//
// Все инструменты принимают параметр `workspace: String` — абсолютный путь к
// рабочей папке. Любой доступ за её пределы блокируется.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::fs;
use tokio::process::Command as TokioCommand;
use tokio::time::{timeout, Duration};

// ─── Константы ────────────────────────────────────────────────────────────────

const MAX_READ_LINES: usize = 2000;
const DEFAULT_READ_LINES: usize = 1000;
const MAX_OUTPUT_BYTES: usize = 8192;
const MAX_GREP_RESULTS: usize = 200;
const DEFAULT_GREP_RESULTS: usize = 50;
const MAX_FILE_SIZE_FOR_GREP: u64 = 1024 * 1024; // 1 MB
const MAX_COMMAND_TIMEOUT_SECS: u64 = 120;
const DEFAULT_COMMAND_TIMEOUT_SECS: u64 = 30;

/// Директории, которые пропускаются при обходе дерева файлов
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    ".next",
    "__pycache__",
    ".cache",
    "build",
    ".turbo",
    "coverage",
    ".nyc_output",
    ".venv",
    "venv",
    ".tox",
];

// ─── Инструмент: read_file ────────────────────────────────────────────────────

/// Читает файл (или его часть) внутри рабочей папки.
///
/// * `path`      — путь относительно `workspace` или абсолютный
/// * `workspace` — корень рабочей папки (sandboxing)
/// * `offset`    — с какой строки начинать (0-based, по умолчанию 0)
/// * `length`    — сколько строк вернуть (по умолчанию 200, максимум 500)
#[tauri::command]
pub async fn tool_read_file(
    path: String,
    workspace: String,
    offset: Option<usize>,
    length: Option<usize>,
) -> Result<String, String> {
    let abs_path = resolve_and_validate(&path, &workspace)?;
    let content = fs::read_to_string(&abs_path)
        .await
        .map_err(|e| format!("Cannot read '{}': {}", path, e))?;

    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();
    let start = offset.unwrap_or(0).min(total);
    let max_lines = length.unwrap_or(DEFAULT_READ_LINES).min(MAX_READ_LINES);
    let end = (start + max_lines).min(total);

    let slice = lines[start..end].join("\n");
    let footer = if end < total {
        format!(
            "\n\n[{} lines remaining — call read_file with offset={}]",
            total - end,
            end
        )
    } else {
        String::new()
    };

    Ok(format!(
        "File: {} (lines {}-{} of {})\n```\n{}\n```{}",
        path,
        start + 1,
        end,
        total,
        slice,
        footer
    ))
}

// ─── Инструмент: write_file ───────────────────────────────────────────────────

/// Создаёт или полностью перезаписывает файл.
/// Промежуточные директории создаются автоматически.
///
/// Используй `tool_edit_file` когда нужно изменить только часть файла —
/// это в разы дешевле по токенам.
#[tauri::command]
pub async fn tool_write_file(
    path: String,
    content: String,
    workspace: String,
) -> Result<String, String> {
    let abs_path = resolve_and_validate_new(&path, &workspace)?;

    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Cannot create dirs for '{}': {}", path, e))?;
    }

    fs::write(&abs_path, content.as_bytes())
        .await
        .map_err(|e| format!("Cannot write '{}': {}", path, e))?;

    let line_count = content.lines().count();
    let byte_count = content.len();
    Ok(format!(
        "Written {} ({} lines, {} bytes)",
        path, line_count, byte_count
    ))
}

// ─── Инструмент: edit_file ────────────────────────────────────────────────────

/// Точечная замена строки в файле — самый экономный способ правки.
///
/// * `old_string` — точный текст для замены (включая пробелы/отступы)
/// * `new_string` — текст на замену
///
/// Возвращает ошибку если:
/// - строка не найдена (безопасно — файл не изменится)
/// - строка встречается больше одного раза (нужно уточнить контекст)
#[tauri::command]
pub async fn tool_edit_file(
    path: String,
    old_string: String,
    new_string: String,
    workspace: String,
) -> Result<String, String> {
    if old_string.trim().is_empty() {
        return Err("old_string cannot be empty. Specify the exact lines you want to replace.".to_string());
    }

    let abs_path = resolve_and_validate(&path, &workspace)?;
    let content = fs::read_to_string(&abs_path)
        .await
        .map_err(|e| format!("Cannot read '{}': {}", path, e))?;

    let has_crlf = content.contains("\r\n");

    // 1. Прямой поиск точного совпадения
    if content.contains(&old_string) {
        let occurrences = content.matches(&old_string as &str).count();
        if occurrences > 1 {
            return Err(format!(
                "Pattern found {} times in '{}' — add more context lines to make it unique.",
                occurrences, path
            ));
        }

        let new_content = content.replace(&old_string as &str, &new_string);
        fs::write(&abs_path, new_content.as_bytes())
            .await
            .map_err(|e| format!("Cannot write '{}': {}", path, e))?;

        let old_lines = old_string.lines().count();
        let new_lines = new_string.lines().count();
        return Ok(format!(
            "Edited '{}': {} line(s) → {} line(s)",
            path, old_lines, new_lines
        ));
    }

    // 2. Поиск с нормализацией перевода строк (\r\n <-> \n)
    let norm_content = content.replace("\r\n", "\n");
    let norm_old = old_string.replace("\r\n", "\n");
    let norm_new = new_string.replace("\r\n", "\n");

    if norm_content.contains(&norm_old) {
        let occurrences = norm_content.matches(&norm_old as &str).count();
        if occurrences > 1 {
            return Err(format!(
                "Pattern found {} times in '{}' — add more context lines to make it unique.",
                occurrences, path
            ));
        }

        let replaced = norm_content.replace(&norm_old as &str, &norm_new);
        let final_content = if has_crlf {
            replaced.replace("\n", "\r\n")
        } else {
            replaced
        };

        fs::write(&abs_path, final_content.as_bytes())
            .await
            .map_err(|e| format!("Cannot write '{}': {}", path, e))?;

        let old_lines = old_string.lines().count();
        let new_lines = new_string.lines().count();
        return Ok(format!(
            "Edited '{}' (normalized line endings): {} line(s) → {} line(s)",
            path, old_lines, new_lines
        ));
    }

    // 3. Нечёткий построчный поиск (если модель пропустила отступы/пробелы по краям)
    let lines_content: Vec<&str> = norm_content.lines().collect();
    let lines_old: Vec<&str> = norm_old.lines().collect();

    if !lines_old.is_empty() && lines_content.len() >= lines_old.len() {
        let mut match_start: Option<usize> = None;
        let mut match_count = 0;

        for i in 0..=(lines_content.len() - lines_old.len()) {
            let matches = lines_old.iter().enumerate().all(|(j, old_line)| {
                lines_content[i + j].trim() == old_line.trim()
            });
            if matches {
                match_count += 1;
                match_start = Some(i);
            }
        }

        if match_count == 1 {
            if let Some(start_idx) = match_start {
                let end_idx = start_idx + lines_old.len();
                let mut new_lines = Vec::new();
                for (idx, line) in lines_content.iter().enumerate() {
                    if idx == start_idx {
                        new_lines.extend(norm_new.lines());
                    } else if idx > start_idx && idx < end_idx {
                        continue;
                    } else {
                        new_lines.push(line);
                    }
                }

                let mut replaced = new_lines.join(if has_crlf { "\r\n" } else { "\n" });
                if norm_content.ends_with('\n') && !replaced.ends_with(if has_crlf { "\r\n" } else { "\n" }) {
                    replaced.push_str(if has_crlf { "\r\n" } else { "\n" });
                }

                fs::write(&abs_path, replaced.as_bytes())
                    .await
                    .map_err(|e| format!("Cannot write '{}': {}", path, e))?;

                return Ok(format!(
                    "Edited '{}' (fuzzy trimmed match): replaced lines {}-{}",
                    path, start_idx + 1, end_idx
                ));
            }
        } else if match_count > 1 {
            return Err(format!(
                "Pattern found {} times in '{}' (with trimmed spaces) — add more surrounding lines for unique context.",
                match_count, path
            ));
        }
    }

    Err(format!(
        "Pattern not found in '{}'. Make sure the text is exact (spaces, indentation).",
        path
    ))
}

// ─── Инструмент: run_command ──────────────────────────────────────────────────

/// Выполняет shell-команду в рабочей папке и возвращает stdout + stderr.
///
/// * `command`       — команда (PowerShell на Windows, sh на Unix)
/// * `workspace`     — рабочая директория
/// * `timeout_secs`  — таймаут в секундах (макс. 120, по умолчанию 30)
///
/// Вывод обрезается до 8 KB. Для интерактивного терминала используй PTY.
#[tauri::command]
pub async fn tool_run_command(
    command: String,
    workspace: String,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    let work_dir = PathBuf::from(&workspace);
    if !work_dir.exists() {
        return Err(format!("Workspace not found: {}", workspace));
    }

    let secs = timeout_secs
        .unwrap_or(DEFAULT_COMMAND_TIMEOUT_SECS)
        .min(MAX_COMMAND_TIMEOUT_SECS);

    let (shell, flag) = if cfg!(target_os = "windows") {
        ("powershell.exe", "-Command")
    } else {
        ("sh", "-c")
    };

    let child = TokioCommand::new(shell)
        .arg(flag)
        .arg(&command)
        .current_dir(&work_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    let result = timeout(Duration::from_secs(secs), child.wait_with_output())
        .await
        .map_err(|_| format!("Command timed out after {}s: {}", secs, command))?
        .map_err(|e| format!("Command error: {}", e))?;

    let stdout = String::from_utf8_lossy(&result.stdout);
    let stderr = String::from_utf8_lossy(&result.stderr);

    let mut output = String::new();

    if !stdout.is_empty() {
        let truncated = safe_truncate(&stdout, MAX_OUTPUT_BYTES);
        output.push_str(truncated);
        if stdout.len() > MAX_OUTPUT_BYTES {
            output.push_str(&format!(
                "\n... [stdout truncated, {} bytes total]",
                stdout.len()
            ));
        }
    }

    if !stderr.is_empty() {
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str("[stderr]:\n");
        let truncated = safe_truncate(&stderr, MAX_OUTPUT_BYTES);
        output.push_str(truncated);
        if stderr.len() > MAX_OUTPUT_BYTES {
            output.push_str(&format!(
                "\n... [stderr truncated, {} bytes total]",
                stderr.len()
            ));
        }
    }

    if output.is_empty() {
        output.push_str("[no output]");
    }

    let exit_code = result.status.code().unwrap_or(-1);
    let status_str = if result.status.success() {
        "exit 0 ✓".to_string()
    } else {
        format!("exit {} ✗", exit_code)
    };

    Ok(format!("[{}] $ {}\n{}", status_str, command, output))
}

// ─── Инструмент: list_dir ─────────────────────────────────────────────────────

/// Показывает содержимое директории (файлы + папки) с размерами.
/// Директории из SKIP_DIRS помечаются как [skipped].
#[tauri::command]
pub async fn tool_list_dir(
    path: String,
    workspace: String,
) -> Result<String, String> {
    let abs_path = resolve_and_validate(&path, &workspace)?;

    let mut entries_raw = fs::read_dir(&abs_path)
        .await
        .map_err(|e| format!("Cannot list '{}': {}", path, e))?;

    let mut dirs: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();

    while let Some(entry) = entries_raw
        .next_entry()
        .await
        .map_err(|e| e.to_string())?
    {
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = entry
            .metadata()
            .await
            .map_err(|e| e.to_string())?;

        if meta.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) {
                dirs.push(format!("  📁 {}/ [skipped]", name));
            } else {
                dirs.push(format!("  📁 {}/", name));
            }
        } else {
            let size = format_size(meta.len());
            files.push(format!("  📄 {} ({})", name, size));
        }
    }

    dirs.sort();
    files.sort();

    let mut output = format!("Directory: {}\n", path);
    output.push_str(&dirs.join("\n"));
    if !dirs.is_empty() && !files.is_empty() {
        output.push('\n');
    }
    output.push_str(&files.join("\n"));

    if dirs.is_empty() && files.is_empty() {
        output.push_str("  [empty]");
    }

    Ok(output)
}

// ─── Инструмент: grep_files ───────────────────────────────────────────────────

/// Рекурсивный поиск паттерна в файлах рабочей папки.
///
/// * `pattern`      — строка для поиска (регистронезависимо)
/// * `dir`          — директория для поиска (относительно workspace)
/// * `workspace`    — корень рабочей папки
/// * `file_glob`    — фильтр по расширению: "*.rs", "*.tsx", "rs", "tsx"
/// * `max_results`  — максимум совпадений (по умолчанию 50, макс 200)
#[tauri::command]
pub async fn tool_grep_files(
    pattern: String,
    dir: String,
    workspace: String,
    file_glob: Option<String>,
    max_results: Option<usize>,
) -> Result<String, String> {
    let abs_dir = resolve_and_validate(&dir, &workspace)?;
    let max = max_results
        .unwrap_or(DEFAULT_GREP_RESULTS)
        .min(MAX_GREP_RESULTS);

    // Нормализуем расширение: "*.tsx" или "tsx" → "tsx"
    let ext_filter: Option<String> = file_glob.map(|g| {
        g.trim_start_matches('*')
            .trim_start_matches('.')
            .to_lowercase()
    });

    let pattern_lower = pattern.to_lowercase();
    let mut results: Vec<String> = Vec::new();

    grep_recursive(&abs_dir, &pattern_lower, &ext_filter, &mut results, max).await?;

    if results.is_empty() {
        Ok(format!(
            "No matches found for '{}' in '{}'{}",
            pattern,
            dir,
            ext_filter
                .map(|e| format!(" (filter: *.{})", e))
                .unwrap_or_default()
        ))
    } else {
        Ok(format!(
            "Found {} match(es) for '{}':\n{}",
            results.len(),
            pattern,
            results.join("\n")
        ))
    }
}

// ─── Рекурсивный обход для grep ───────────────────────────────────────────────

fn grep_recursive<'a>(
    dir: &'a PathBuf,
    pattern: &'a str,
    ext_filter: &'a Option<String>,
    results: &'a mut Vec<String>,
    max: usize,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        if results.len() >= max {
            return Ok(());
        }

        let mut entries = match fs::read_dir(dir).await {
            Ok(e) => e,
            Err(_) => return Ok(()), // пропускаем недоступные директории
        };

        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            if results.len() >= max {
                break;
            }

            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let meta = match entry.metadata().await {
                Ok(m) => m,
                Err(_) => continue,
            };

            if meta.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) {
                    grep_recursive(&path, pattern, ext_filter, results, max).await?;
                }
            } else if meta.is_file() {
                // Фильтр по расширению
                if let Some(ext) = ext_filter {
                    let file_ext = path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    if file_ext != *ext {
                        continue;
                    }
                }

                // Пропускаем большие файлы
                if meta.len() > MAX_FILE_SIZE_FOR_GREP {
                    continue;
                }

                // Читаем и ищем
                if let Ok(content) = fs::read_to_string(&path).await {
                    for (line_num, line) in content.lines().enumerate() {
                        if results.len() >= max {
                            break;
                        }
                        if line.to_lowercase().contains(pattern) {
                            results.push(format!(
                                "{}:{}: {}",
                                path.display(),
                                line_num + 1,
                                line.trim()
                            ));
                        }
                    }
                }
            }
        }

        Ok(())
    })
}

// ─── Вспомогательные функции ──────────────────────────────────────────────────

/// Разрешает путь (абсолютный или относительно workspace) и проверяет,
/// что он находится внутри workspace. Файл должен существовать.
fn resolve_and_validate(path: &str, workspace: &str) -> Result<PathBuf, String> {
    let workspace_path = PathBuf::from(workspace)
        .canonicalize()
        .map_err(|_| format!("Workspace not found: {}", workspace))?;

    let abs_path = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        workspace_path.join(path)
    };

    let canon = abs_path
        .canonicalize()
        .map_err(|_| format!("Path not found: {}", path))?;

    if !canon.starts_with(&workspace_path) {
        return Err(format!(
            "Security: '{}' is outside workspace '{}'",
            path, workspace
        ));
    }

    Ok(canon)
}

/// Как `resolve_and_validate`, но разрешает несуществующие файлы
/// (для write_file — файл может ещё не существовать).
fn resolve_and_validate_new(path: &str, workspace: &str) -> Result<PathBuf, String> {
    let workspace_path = PathBuf::from(workspace)
        .canonicalize()
        .map_err(|_| format!("Workspace not found: {}", workspace))?;

    let abs_path = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        workspace_path.join(path)
    };

    // Нормализуем без canonicalize (файл может не существовать)
    let normalized = normalize_path(&abs_path);

    if !normalized.starts_with(&workspace_path) {
        return Err(format!(
            "Security: '{}' is outside workspace '{}'",
            path, workspace
        ));
    }

    Ok(abs_path)
}

/// Нормализует путь без обращения к ФС (разворачивает `.` и `..`).
fn normalize_path(path: &Path) -> PathBuf {
    let mut components = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                components.pop();
            }
            std::path::Component::CurDir => {}
            other => components.push(other),
        }
    }
    components.iter().collect()
}

/// Безопасно обрезает строку по границе UTF-8 символа.
fn safe_truncate(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut boundary = max_bytes;
    while boundary > 0 && !s.is_char_boundary(boundary) {
        boundary -= 1;
    }
    &s[..boundary]
}

/// Форматирует размер файла в читаемый вид.
fn format_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / 1024.0 / 1024.0)
    } else if bytes >= 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

