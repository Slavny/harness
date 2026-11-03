/**
 * DiffView.tsx — визуализация изменений файлов (unified diff)
 *
 * Используется в ToolBlock для edit_file и write_file.
 * Вычисляет построчный LCS-diff между старым и новым текстом.
 */

import { useState, useCallback } from "react";
import "./DiffView.css";

// ─── Типы ─────────────────────────────────────────────────────────────────────

type DiffKind = "equal" | "added" | "removed";

interface DiffLine {
  kind: DiffKind;
  text: string;
  oldNum?: number;
  newNum?: number;
}

interface DiffViewProps {
  /** Исходный текст (старая версия). Пустая строка — файл новый (write_file). */
  oldText: string;
  /** Новый текст (новая версия). */
  newText: string;
  /** Имя файла для заголовка. */
  filename?: string;
  /** Контекст: сколько строк "equal" показывать вокруг изменений (default 3). */
  context?: number;
  /** Если true — весь newText показывается как "added" (write_file). */
  allAdded?: boolean;
}

// ─── LCS-based diff ───────────────────────────────────────────────────────────

const MAX_LINES_FOR_LCS = 300; // при больших файлах используем упрощённый diff

function computeDiff(oldText: string, newText: string, allAdded = false): DiffLine[] {
  const oldLines = oldText === "" ? [] : oldText.split("\n");
  const newLines = newText === "" ? [] : newText.split("\n");

  // Режим write_file: весь текст — новый
  if (allAdded || oldLines.length === 0) {
    return newLines.map((text, i) => ({
      kind: "added" as DiffKind,
      text,
      newNum: i + 1,
    }));
  }

  // Упрощённый diff для больших файлов: показываем весь old как removed, new как added
  if (oldLines.length > MAX_LINES_FOR_LCS || newLines.length > MAX_LINES_FOR_LCS) {
    return [
      ...oldLines.map((text, i) => ({ kind: "removed" as DiffKind, text, oldNum: i + 1 })),
      ...newLines.map((text, i) => ({ kind: "added"   as DiffKind, text, newNum: i + 1 })),
    ];
  }

  // LCS DP
  const m = oldLines.length;
  const n = newLines.length;
  const dp: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const result: DiffLine[] = [];
  let i = m, j = n;
  let oldCount = m, newCount = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ kind: "equal", text: oldLines[i - 1], oldNum: i, newNum: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ kind: "added", text: newLines[j - 1], newNum: j });
      j--;
    } else {
      result.unshift({ kind: "removed", text: oldLines[i - 1], oldNum: i });
      i--;
    }
  }

  void oldCount; void newCount;
  return result;
}

// ─── Применяем контекст (скрываем далёкие "equal" строки) ────────────────────

function applyContext(lines: DiffLine[], context: number): (DiffLine | "fold")[] {
  const changed = new Set<number>();
  lines.forEach((l, idx) => {
    if (l.kind !== "equal") {
      for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) {
        changed.add(k);
      }
    }
  });

  const result: (DiffLine | "fold")[] = [];
  let lastWasFold = false;

  lines.forEach((line, idx) => {
    if (changed.has(idx)) {
      result.push(line);
      lastWasFold = false;
    } else {
      if (!lastWasFold) result.push("fold");
      lastWasFold = true;
    }
  });

  return result;
}

// ─── Компонент DiffView ───────────────────────────────────────────────────────

export function DiffView({ oldText, newText, filename, context = 3, allAdded = false }: DiffViewProps) {
  const [copied, setCopied]     = useState(false);
  const [expanded, setExpanded] = useState(false);

  const diffLines   = computeDiff(oldText, newText, allAdded);
  const hasChanges  = diffLines.some(l => l.kind !== "equal");
  const addedCount  = diffLines.filter(l => l.kind === "added").length;
  const removedCount = diffLines.filter(l => l.kind === "removed").length;

  const displayLines = expanded || allAdded
    ? diffLines.map(l => l as DiffLine | "fold")
    : applyContext(diffLines, context);

  const handleCopy = useCallback(async () => {
    const text = newText || oldText;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [newText, oldText]);

  return (
    <div className="diff-view">
      {/* Заголовок */}
      <div className="diff-header">
        <span className="diff-filename">{filename ?? "file"}</span>
        <div className="diff-stats">
          {removedCount > 0 && <span className="diff-stat removed">−{removedCount}</span>}
          {addedCount   > 0 && <span className="diff-stat added">+{addedCount}</span>}
        </div>
        <div className="diff-header-actions">
          {hasChanges && !allAdded && (
            <button
              className="diff-toggle-btn"
              type="button"
              onClick={() => setExpanded(v => !v)}
              title={expanded ? "Show context only" : "Show full file"}
            >
              {expanded ? "⤡ Collapse" : "⤢ Expand"}
            </button>
          )}
          <button
            className={`diff-copy-btn ${copied ? "copied" : ""}`}
            type="button"
            onClick={handleCopy}
            title="Copy new content"
          >
            {copied ? "✓ Copied" : "⎘ Copy"}
          </button>
        </div>
      </div>

      {/* Строки diff */}
      <div className="diff-body">
        {displayLines.map((item, idx) => {
          if (item === "fold") {
            return (
              <div key={`fold-${idx}`} className="diff-fold" onClick={() => setExpanded(true)}>
                ··· click to expand ···
              </div>
            );
          }

          const line = item as DiffLine;
          return (
            <div key={idx} className={`diff-line diff-line-${line.kind}`}>
              <span className="diff-gutter diff-gutter-old">
                {line.kind !== "added" ? line.oldNum : ""}
              </span>
              <span className="diff-gutter diff-gutter-new">
                {line.kind !== "removed" ? line.newNum : ""}
              </span>
              <span className="diff-sign">
                {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
              </span>
              <span className="diff-text">{line.text || "\u00a0"}</span>
            </div>
          );
        })}

        {displayLines.length === 0 && (
          <div className="diff-empty">No changes</div>
        )}
      </div>
    </div>
  );
}

