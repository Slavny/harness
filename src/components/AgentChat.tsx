/**
 * AgentChat.tsx — UI для AI-агентного цикла (Фаза 3, обновлено в Фазе 5)
 *
 * Отображает:
 *  - Сообщения пользователя и текст от LLM
 *  - Tool-блоки: tool_use (имя + аргументы) + tool_result (результат/ошибка)
 *  - Диалог разрешений (Allow / Deny) для опасных операций
 *  - Статус "Thinking..." во время ожидания LLM
 *  - Кнопку Stop + счётчик токенов в футере
 *  - Поддержка провайдеров: Claude, Gemini, GigaChat
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./AgentChat.css";
import { DiffView } from "./DiffView";

// ─── Типы событий от Rust backend ─────────────────────────────────────────────

interface AgentThinkingEvent { iteration: number }
interface AgentTextEvent    { text: string; iteration: number }
interface AgentToolUseEvent {
  id: string; name: string; input: Record<string, unknown>;
  iteration: number; auto_approved: boolean;
}
interface AgentPermissionRequestEvent {
  id: string; name: string; input: Record<string, unknown>; description: string;
}
interface AgentToolResultEvent {
  id: string; name: string; result: string; is_error: boolean; iteration: number;
}
interface AgentDoneEvent  { iterations: number; input_tokens: number; output_tokens: number }
interface AgentErrorEvent { error: string }

// ─── Типы сообщений в чате ────────────────────────────────────────────────────

type ChatItemKind =
  | "user"          // сообщение пользователя
  | "assistant"     // текст от LLM
  | "tool_use"      // LLM запрашивает инструмент
  | "tool_result"   // результат инструмента
  | "thinking"      // спиннер ожидания
  | "done"          // финальная строка со статистикой
  | "error";        // ошибка агента

interface ChatItem {
  id: string;
  kind: ChatItemKind;
  // user / assistant / error
  text?: string;
  // tool_use
  toolName?: string;
  toolInput?: Record<string, unknown>;
  autoApproved?: boolean;
  toolId?: string;         // id для связки tool_use ↔ tool_result
  // tool_result
  result?: string;
  isError?: boolean;
  // done
  iterations?: number;
  inputTokens?: number;
  outputTokens?: number;
  // thinking
  iteration?: number;
}

// ─── Вспомогательные функции ──────────────────────────────────────────────────

/** Красивое имя инструмента */
function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    read_file:   "Read File",
    write_file:  "Write File",
    edit_file:   "Edit File",
    run_command: "Run Command",
    list_dir:    "List Directory",
    grep_files:  "Search Files",
  };
  return labels[name] ?? name;
}

/** Иконка инструмента (emoji для простоты) */
function toolEmoji(name: string): string {
  const icons: Record<string, string> = {
    read_file:   "📄",
    write_file:  "✏️",
    edit_file:   "🔧",
    run_command: "⚡",
    list_dir:    "📁",
    grep_files:  "🔍",
  };
  return icons[name] ?? "🛠️";
}

/** Краткое превью аргументов tool_use */
function toolPreview(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "read_file":
      return `${input.path}${input.offset != null ? ` (line ${(input.offset as number) + 1})` : ""}`;
    case "write_file":
      return `${input.path}`;
    case "edit_file":
      return `${input.path}`;
    case "run_command":
      return `${input.command}`;
    case "list_dir":
      return `${input.path}`;
    case "grep_files":
      return `"${input.pattern}" in ${input.dir}${input.file_glob ? ` (*.${input.file_glob})` : ""}`;
    default:
      return JSON.stringify(input).slice(0, 80);
  }
}

function uid(): string {
  return Math.random().toString(36).slice(2);
}

// ─── Вспомогательные: copy ────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="tool-copy-btn"
      type="button"
      title="Copy to clipboard"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "✓" : "⎘"}
    </button>
  );
}

// ─── Компонент: ToolBlock ─────────────────────────────────────────────────────

interface ToolBlockProps {
  item: ChatItem;
  result?: ChatItem;
  pendingPermission?: AgentPermissionRequestEvent;
  onApprove?: (id: string, approved: boolean) => void;
}

function ToolBlock({ item, result, pendingPermission, onApprove }: ToolBlockProps) {
  const name = item.toolName ?? "";
  const input = item.toolInput ?? {};

  // edit_file / write_file показывают diff => авто-раскрываем при успехе
  const isDiffTool   = name === "edit_file" || name === "write_file";
  const isErrorResult = result?.isError ?? false;

  // Авто-раскрываем: при ошибке, при diff-инструментах (чтобы сразу виден diff)
  const [expanded, setExpanded] = useState(() => isErrorResult || isDiffTool);

  // Если пришёл результат с ошибкой — авто-раскрываем
  useEffect(() => {
    if (isErrorResult) setExpanded(true);
  }, [isErrorResult]);

  const isPending = !result && !pendingPermission;
  const isDenied  = isErrorResult && (result?.result ?? "").startsWith("Action denied");

  let statusClass = "tool-status-running";
  let statusDot   = "🔵";
  if (pendingPermission)  { statusClass = "tool-status-waiting"; statusDot = "🟡"; }
  else if (isDenied)      { statusClass = "tool-status-denied";  statusDot = "⛔"; }
  else if (isErrorResult) { statusClass = "tool-status-error";   statusDot = "🔴"; }
  else if (result)        { statusClass = "tool-status-done";    statusDot = "✅"; }

  // Краткая однострочная аннотация результата для свёрнутого вида
  const resultHint = (() => {
    if (!result || expanded) return null;
    const r = result.result ?? "";
    // Первая непустая строка (макс 60 символов)
    const first = r.split("\n").find(l => l.trim()) ?? "";
    if (!first) return null;
    return first.length > 60 ? first.slice(0, 57) + "…" : first;
  })();

  // Данные для DiffView
  const diffOld = name === "edit_file" ? String(input.old_string ?? "") : "";
  const diffNew = name === "edit_file"
    ? String(input.new_string ?? "")
    : name === "write_file"
    ? String(input.content ?? "")
    : "";
  const diffFile = String(input.path ?? "");

  return (
    <div className={`tool-block ${statusClass}`}>
      {/* ── Заголовок ── */}
      <button className="tool-block-header" onClick={() => setExpanded(e => !e)} type="button">
        <span className="tool-emoji">{toolEmoji(name)}</span>
        <span className="tool-label">{toolLabel(name)}</span>
        <span className="tool-preview">{toolPreview(name, input)}</span>
        {resultHint && <span className="tool-result-hint">{resultHint}</span>}
        <span className="tool-status-dot">{statusDot}</span>
        {isPending && <span className="tool-spinner" />}
        <span className="tool-expand-icon">{expanded ? "▴" : "▾"}</span>
      </button>

      {/* ── Диалог разрешения (сразу под шапкой, всегда на виду) ── */}
      {pendingPermission && (
        <div className="permission-row">
          <span className="permission-desc" title={pendingPermission.description}>
            ⚠️ {pendingPermission.description}
          </span>
          <div className="permission-buttons">
            <button
              className="perm-btn allow"
              type="button"
              onClick={() => onApprove?.(pendingPermission.id, true)}
            >
              ✓ Allow
            </button>
            <button
              className="perm-btn deny"
              type="button"
              onClick={() => onApprove?.(pendingPermission.id, false)}
            >
              ✕ Deny
            </button>
          </div>
        </div>
      )}

      {/* ── Тело (раскрытое) ── */}
      {expanded && (
        <div className="tool-block-body">

          {/* edit_file / write_file → DiffView */}
          {isDiffTool ? (
            <DiffView
              oldText={diffOld}
              newText={diffNew}
              filename={diffFile}
              allAdded={name === "write_file"}
            />
          ) : (
            /* Остальные инструменты → raw JSON input */
            <div className="tool-section-row">
              <div className="tool-section-label">Input</div>
              <CopyButton text={JSON.stringify(input, null, 2)} />
            </div>
          )}

          {/* Результат */}
          {result && !isDiffTool && (
            <div className="tool-output-wrap">
              <div className="tool-section-row">
                <div className={`tool-section-label ${isErrorResult ? "error" : ""}`}>
                  {isErrorResult ? "⚠ Error" : "Output"}
                </div>
                <CopyButton text={result.result ?? ""} />
              </div>
              <pre className={`tool-output ${isErrorResult ? "error" : ""}`}>
                {result.result}
              </pre>
            </div>
          )}

          {/* Для edit/write — показываем результат только если ошибка */}
          {result && isDiffTool && isErrorResult && (
            <div className="tool-output-wrap">
              <div className="tool-section-row">
                <div className="tool-section-label error">⚠ Error</div>
              </div>
              <pre className="tool-output error">{result.result}</pre>
            </div>
          )}

          {/* Для edit/write — показываем raw input JSON если нужно (скрытый) */}
          {!isDiffTool && (
            <pre className="tool-json">{JSON.stringify(input, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}
// ─── Компонент: AgentChat ─────────────────────────────────────────────────────

interface AgentChatProps {
  apiKey: string;
  workspace: string;
  workspaceName: string;
  permissionMode: string;
}

export function AgentChat({ apiKey, workspace, workspaceName, permissionMode }: AgentChatProps) {
  const [input, setInput]       = useState("");
  const [items, setItems]       = useState<ChatItem[]>([]);
  const [running, setRunning]   = useState(false);
  const [model, setModel]       = useState("claude-3-5-haiku-20241022");
  const [provider, setProvider] = useState("claude");
  const [showModelDrop, setShowModelDrop] = useState(false);
  const [pendingPermissions, setPendingPermissions] = useState<
    Record<string, AgentPermissionRequestEvent>
  >({});
  const [tokenStats, setTokenStats] = useState<
    { input: number; output: number; iterations: number } | null
  >(null);

  const scrollRef   = useRef<HTMLDivElement>(null);
  const sessionRef  = useRef<string>("");
  const unlisteners = useRef<UnlistenFn[]>([]);

  // Автоскролл при новых сообщениях
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items]);

  // Очистка слушателей при размонтировании
  useEffect(() => {
    return () => {
      unlisteners.current.forEach(fn => fn());
    };
  }, []);

  const appendItem = useCallback((item: ChatItem) => {
    setItems(prev => [...prev, item]);
  }, []);

  // Подтверждение/отклонение разрешения
  const handleApprove = useCallback(async (id: string, approved: boolean) => {
    setPendingPermissions(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await invoke("agent_approve", { id, approved });
  }, []);

  // Запуск агента
  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || running) return;
    if (!apiKey) {
      appendItem({ id: uid(), kind: "error", text: "API key is not set. Go to Settings." });
      return;
    }
    if (!workspace) {
      appendItem({ id: uid(), kind: "error", text: "No workspace folder selected." });
      return;
    }

    setInput("");
    setRunning(true);
    setTokenStats(null);

    const sessionId = uid();
    sessionRef.current = sessionId;

    appendItem({ id: uid(), kind: "user", text: msg });

    // Подписываемся на события этой сессии
    const fns: UnlistenFn[] = [];

    const addListener = async <T,>(event: string, cb: (payload: T) => void) => {
      const fn = await listen<T>(event, e => {
        // Игнорируем события от других сессий (на будущее)
        cb(e.payload);
      });
      fns.push(fn);
    };

    await addListener<AgentThinkingEvent>("agent-thinking", ({ iteration }) => {
      // Убираем предыдущий thinking блок
      setItems(prev => prev.filter(it => it.kind !== "thinking"));
      appendItem({ id: uid(), kind: "thinking", iteration });
    });

    await addListener<AgentTextEvent>("agent-text", ({ text }) => {
      setItems(prev => {
        // Если последнее сообщение assistant — дополняем
        const last = prev[prev.length - 1];
        if (last?.kind === "assistant") {
          return [...prev.slice(0, -1), { ...last, text: (last.text ?? "") + text }];
        }
        // Иначе убираем thinking и добавляем новый assistant блок
        return [
          ...prev.filter(it => it.kind !== "thinking"),
          { id: uid(), kind: "assistant", text },
        ];
      });
    });

    await addListener<AgentToolUseEvent>("agent-tool-use", e => {
      setItems(prev => prev.filter(it => it.kind !== "thinking"));
      appendItem({
        id: uid(),
        kind: "tool_use",
        toolName: e.name,
        toolInput: e.input as Record<string, unknown>,
        toolId: e.id,
        autoApproved: e.auto_approved,
      });
    });

    await addListener<AgentPermissionRequestEvent>("agent-permission-request", e => {
      setPendingPermissions(prev => ({ ...prev, [e.id]: e }));
    });

    await addListener<AgentToolResultEvent>("agent-tool-result", e => {
      appendItem({
        id: uid(),
        kind: "tool_result",
        toolId: e.id,
        toolName: e.name,
        result: e.result,
        isError: e.is_error,
      });
    });

    await addListener<AgentDoneEvent>("agent-done", e => {
      setItems(prev => prev.filter(it => it.kind !== "thinking"));
      setTokenStats({ input: e.input_tokens, output: e.output_tokens, iterations: e.iterations });
      setRunning(false);
    });

    await addListener<AgentErrorEvent>("agent-error", e => {
      setItems(prev => prev.filter(it => it.kind !== "thinking"));
      appendItem({ id: uid(), kind: "error", text: e.error });
      setRunning(false);
    });

    unlisteners.current.forEach(fn => fn());
    unlisteners.current = fns;

    // Собираем историю текстовых сообщений диалога (до 6 последних),
    // чтобы модель помнила контекст при продолжении разговора
    const history = items
      .filter(it => (it.kind === "user" || it.kind === "assistant") && Boolean(it.text))
      .slice(-6)
      .map(it => ({ role: it.kind, text: it.text ?? "" }));

    try {
      await invoke("agent_run", {
        apiKey,
        provider,
        model,
        userMessage: msg,
        workspace,
        permissionMode,
        sessionId,
        history,
      });
    } catch (err) {
      setItems(prev => prev.filter(it => it.kind !== "thinking"));
      appendItem({ id: uid(), kind: "error", text: String(err) });
      setRunning(false);
    }
  }, [input, running, apiKey, workspace, permissionMode, model, provider, items, appendItem]);

  // Остановить агента
  const handleStop = useCallback(async () => {
    await invoke("agent_cancel");
  }, []);

  // Новый чат
  const handleNew = useCallback(() => {
    if (running) return;
    setItems([]);
    setTokenStats(null);
    setPendingPermissions({});
  }, [running]);

  const isEmpty = items.length === 0;

  // ─── Модели, сгруппированные по провайдерам ──────────────────────────────
  type ModelEntry = { id: string; name: string; desc: string; provider: string };
  const MODEL_GROUPS: { provider: string; label: string; icon: string; models: ModelEntry[] }[] = [
    {
      provider: "claude",
      label: "Claude",
      icon: "🔶",
      models: [
        { id: "claude-3-5-haiku-20241022",  name: "Claude 3.5 Haiku",  desc: "Быстрый и дешёвый",       provider: "claude" },
        { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", desc: "Лучшее качество кода",    provider: "claude" },
        { id: "claude-3-opus-20240229",     name: "Claude 3 Opus",     desc: "Максимум возможностей",   provider: "claude" },
      ],
    },
    {
      provider: "gemini",
      label: "Gemini",
      icon: "💎",
      models: [
        { id: "gemini-2.0-flash",   name: "Gemini 2.0 Flash", desc: "Быстрый, дешёвый",    provider: "gemini" },
        { id: "gemini-1.5-flash",   name: "Gemini 1.5 Flash", desc: "Сбалансированный",    provider: "gemini" },
        { id: "gemini-1.5-pro",     name: "Gemini 1.5 Pro",   desc: "Максимум контекста",  provider: "gemini" },
      ],
    },
    {
      provider: "gigachat",
      label: "GigaChat",
      icon: "🐻",
      models: [
        { id: "GigaChat-3-Ultra",   name: "GigaChat-3-Ultra", desc: "Максимальные возможности", provider: "gigachat" },
        { id: "GigaChat-2-Max",     name: "GigaChat-2-Max",   desc: "Сбалансированный",          provider: "gigachat" },
      ],
    },
  ];

  const allModels: ModelEntry[] = MODEL_GROUPS.flatMap(g => g.models);
  const currentModel = allModels.find(m => m.id === model);
  const currentGroup = MODEL_GROUPS.find(g => g.provider === provider);

  const handleSelectModel = (m: ModelEntry) => {
    setModel(m.id);
    setProvider(m.provider);
    setShowModelDrop(false);
  };

  return (
    <div className="agent-chat">
      {/* ── Шапка ─────────────────────────────────────────────────────── */}
      <div className="agent-header">
        <span className="agent-header-title">Agent</span>
        <span className="agent-workspace-badge" title={workspace}>
          <span className="agent-workspace-dot" />
          {workspaceName || "No folder"}
        </span>
        {!isEmpty && !running && (
          <button className="agent-new-btn" onClick={handleNew} type="button" title="New session">
            +
          </button>
        )}
      </div>

      {/* ── Область сообщений ─────────────────────────────────────────── */}
      <div className="agent-messages" ref={scrollRef}>
        {isEmpty ? (
          <div className="agent-empty">
            <div className="agent-empty-icon">🤖</div>
            <div className="agent-empty-title">AI Agent</div>
            <div className="agent-empty-sub">
              Опиши задачу — агент сам прочитает файлы, напишет код и запустит команды
            </div>
            <div className="agent-example-chips">
              {[
                "Добавь dark mode в приложение",
                "Проанализируй структуру проекта",
                "Напиши тесты для компонентов",
                "Исправь все TypeScript ошибки",
              ].map(ex => (
                <button
                  key={ex}
                  className="agent-example-chip"
                  type="button"
                  onClick={() => setInput(ex)}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="agent-items">
            {items.map(item => {
              if (item.kind === "user") {
                return (
                  <div key={item.id} className="agent-user-msg">
                    <div className="agent-user-text">{item.text}</div>
                  </div>
                );
              }

              if (item.kind === "assistant") {
                return (
                  <div key={item.id} className="agent-assistant-msg">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {item.text ?? ""}
                    </ReactMarkdown>
                  </div>
                );
              }

              if (item.kind === "tool_use") {
                const result = items.find(
                  it => it.kind === "tool_result" && it.toolId === item.toolId
                );
                const perm = item.toolId ? pendingPermissions[item.toolId] : undefined;
                return (
                  <ToolBlock
                    key={item.id}
                    item={item}
                    result={result}
                    pendingPermission={perm}
                    onApprove={handleApprove}
                  />
                );
              }

              // tool_result отрисовывается внутри ToolBlock — здесь пропускаем
              if (item.kind === "tool_result") return null;

              if (item.kind === "thinking") {
                return (
                  <div key={item.id} className="agent-thinking">
                    <span className="agent-thinking-dots">
                      <span /><span /><span />
                    </span>
                    <span className="agent-thinking-text">
                      Thinking… <span className="agent-iter">#{(item.iteration ?? 0) + 1}</span>
                    </span>
                  </div>
                );
              }

              if (item.kind === "error") {
                return (
                  <div key={item.id} className="agent-error-msg">
                    <span className="agent-error-icon">⚠️</span>
                    {item.text}
                  </div>
                );
              }

              return null;
            })}

            {/* Статистика после завершения */}
            {tokenStats && !running && (
              <div className="agent-stats">
                ✓ Done · {tokenStats.iterations} iteration{tokenStats.iterations !== 1 ? "s" : ""}
                {" · "}↑ {tokenStats.input.toLocaleString()} tokens
                {" · "}↓ {tokenStats.output.toLocaleString()} tokens
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Инпут ─────────────────────────────────────────────────────── */}
      <div className="agent-input-area">
        <textarea
          className="agent-textarea"
          placeholder="Опиши задачу для агента… (Enter — отправить, Shift+Enter — перенос)"
          value={input}
          disabled={running}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={3}
        />
        <div className="agent-controls">
          {/* Модель */}
          <div className="agent-model-wrap" style={{ position: "relative" }}>
            <button
              className="agent-model-btn"
              type="button"
              onClick={() => setShowModelDrop(v => !v)}
              disabled={running}
            >
              <span style={{ marginRight: 4 }}>{currentGroup?.icon ?? "🤖"}</span>
              {currentModel?.name ?? model}
              <span style={{ marginLeft: 4 }}>{showModelDrop ? "▴" : "▾"}</span>
            </button>
            {showModelDrop && (
              <div className="agent-model-dropdown">
                {MODEL_GROUPS.map(group => (
                  <div key={group.provider}>
                    <div className="agent-model-group-label">
                      {group.icon} {group.label}
                    </div>
                    {group.models.map(m => (
                      <button
                        key={m.id}
                        className={`agent-model-option ${model === m.id ? "active" : ""}`}
                        type="button"
                        onClick={() => handleSelectModel(m)}
                      >
                        <span className="agent-model-name">{m.name}</span>
                        <span className="agent-model-desc">{m.desc}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stop / Send */}
          {running ? (
            <button className="agent-stop-btn" type="button" onClick={handleStop} title="Stop agent">
              ■ Stop
            </button>
          ) : (
            <button
              className={`agent-send-btn ${input.trim() ? "active" : ""}`}
              type="button"
              onClick={handleSend}
              disabled={!input.trim()}
              title="Send (Enter)"
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

