import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./TitleBar.css";

const appWindow = () => getCurrentWindow();

interface MenuItem {
  label: string;
  action?: () => void;
  shortcut?: string;
  separator?: boolean;
}

interface Menu {
  label: string;
  items: MenuItem[];
}

interface TitleBarProps {
  onOpenSettings?: () => void;
  onNewChat?: () => void;
  onOpenFolder?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function TitleBar({ onOpenSettings, onNewChat, onOpenFolder, sidebarCollapsed, onToggleSidebar }: TitleBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  async function pasteText() {
    try {
      if (!document.execCommand("paste")) {
        const text = await navigator.clipboard.readText();
        document.execCommand("insertText", false, text);
      }
    } catch (error) {
      console.error("Failed to paste text:", error);
    }
  }

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "New Terminal Tab" },
        { label: "New Browser Tab", shortcut: "Ctrl+T" },
        { label: "New Session", shortcut: "Ctrl+N", action: onNewChat },
        { separator: true, label: "" },
        { label: "Open Folder...", shortcut: "Ctrl+O", action: onOpenFolder },
        { separator: true, label: "" },
        { label: "Close Window", shortcut: "Ctrl+W", action: () => appWindow().close() },
        { separator: true, label: "" },
        { label: "Settings...", shortcut: "Ctrl+,", action: onOpenSettings },
        { separator: true, label: "" },
        { label: "Quit ХАРНЕСС", action: () => appWindow().close() },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl+Z", action: () => document.execCommand("undo") },
        { label: "Redo", shortcut: "Ctrl+Y", action: () => document.execCommand("redo") },
        { separator: true, label: "" },
        { label: "Cut", shortcut: "Ctrl+X", action: () => document.execCommand("cut") },
        { label: "Copy", shortcut: "Ctrl+C", action: () => document.execCommand("copy") },
        { label: "Paste", shortcut: "Ctrl+V", action: () => { void pasteText(); } },
        { label: "Delete", action: () => document.execCommand("delete") },
        { separator: true, label: "" },
        { label: "Select All", shortcut: "Ctrl+A", action: () => document.execCommand("selectAll") },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Reload Page", shortcut: "Ctrl+R", action: () => window.location.reload() },
        { label: "Focus Browser Address", shortcut: "Ctrl+L", action: () => document.querySelector<HTMLTextAreaElement>(".chat-textarea")?.focus() },
        { separator: true, label: "" },
        { label: "Actual Size", shortcut: "Ctrl+0", action: () => (document.body.style.zoom = "1") },
        { label: "Zoom In", shortcut: "Ctrl++", action: () => (document.body.style.zoom = String((parseFloat(document.body.style.zoom || "1") + 0.1).toFixed(1))) },
        { label: "Zoom Out", shortcut: "Ctrl+-", action: () => (document.body.style.zoom = String(Math.max(0.5, parseFloat(document.body.style.zoom || "1") - 0.1).toFixed(1))) },
        { separator: true, label: "" },
        { label: "Toggle Terminal", shortcut: "Ctrl+`", action: onToggleSidebar },
        { separator: true, label: "" },
        { label: "Toggle Full Screen", shortcut: "F11", action: () => { void appWindow().isFullscreen().then((fullscreen) => appWindow().setFullscreen(!fullscreen)); } },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Check for Updates...", action: () => console.log("Checking for updates...") },
        { label: "Retry Connection", action: () => window.dispatchEvent(new Event("retry-connection")) },
        { separator: true, label: "" },
        { label: "Documentation", action: () => window.open("https://developers.sber.ru/docs", "_blank") },
        { label: "Console", action: () => console.log("Harness console opened") },
        { separator: true, label: "" },
        { label: "Performance Trace", action: () => performance.mark("harness-performance-trace") },
        { separator: true, label: "" },
        { label: "About ХАРНЕСС Code", action: onOpenSettings },
      ],
    },
  ];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
      if (event.key === "F11") {
        event.preventDefault();
        void appWindow().isFullscreen().then((fullscreen) => appWindow().setFullscreen(!fullscreen)).catch(console.error);
        return;
      }
      if (!event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.code === "KeyR") {
        event.preventDefault();
        window.location.reload();
      } else if (event.code === "KeyL") {
        event.preventDefault();
        document.querySelector<HTMLTextAreaElement>(".chat-textarea")?.focus();
      } else if (event.code === "Digit0") {
        event.preventDefault();
        document.body.style.zoom = "1";
      } else if (event.code === "Equal") {
        event.preventDefault();
        document.body.style.zoom = String((parseFloat(document.body.style.zoom || "1") + 0.1).toFixed(1));
      } else if (event.code === "Minus") {
        event.preventDefault();
        document.body.style.zoom = String(Math.max(0.5, parseFloat(document.body.style.zoom || "1") - 0.1).toFixed(1));
      } else if (event.code === "KeyO") {
        event.preventDefault();
        onOpenFolder?.();
      } else if (event.code === "KeyW") {
        event.preventDefault();
        void appWindow().close().catch(console.error);
      } else if (event.code === "Comma") {
        event.preventDefault();
        onOpenSettings?.();
      } else if (event.code === "Backquote") {
        event.preventDefault();
        onToggleSidebar?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenFolder, onOpenSettings, onToggleSidebar]);

  useEffect(() => {
    const closeOnOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, []);

  return (
    <div className="titlebar" ref={barRef} data-tauri-drag-region>
      <div className="titlebar-left">
        <span className="titlebar-title" data-tauri-drag-region>XAPHECC</span>
        <span className="titlebar-icon" onClick={onToggleSidebar}>
          <span className="titlebar-icon-box">
            <span className={`titlebar-icon-bar ${sidebarCollapsed ? "collapsed" : ""}`}></span>
          </span>
          <span className="titlebar-tooltip">
            {sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} <kbd>Ctrl B</kbd>
          </span>
        </span>
        <nav className="titlebar-menus">
          {menus.map((menu) => (
            <div key={menu.label} className="titlebar-menu-wrapper">
              <button
                className={`titlebar-menu-btn ${openMenu === menu.label ? "active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
                onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
              >
                {menu.label}
              </button>
              {openMenu === menu.label && (
                <div className="titlebar-dropdown">
                  {menu.items.map((item, index) => item.separator ? (
                    <div key={`separator-${index}`} className="titlebar-dropdown-separator" />
                  ) : (
                    <button
                      key={item.label}
                      className="titlebar-dropdown-item"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setOpenMenu(null);
                        item.action?.();
                      }}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span className="titlebar-dropdown-shortcut" aria-label={`Shortcut ${item.shortcut}`}>
                          {(item.shortcut.endsWith("+")
                            ? [...item.shortcut.slice(0, -1).split("+").filter(Boolean), "+"]
                            : item.shortcut.split("+")
                          ).map((key, keyIndex, keys) => (
                            <span key={`${key}-${keyIndex}`} className="titlebar-key-group">
                              <kbd>{key}</kbd>
                              {keyIndex < keys.length - 1 && <span className="titlebar-key-plus">+</span>}
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>
      <div className="titlebar-controls">
        <button className="titlebar-control-btn" onClick={() => appWindow().minimize()} aria-label="Minimize">
          <svg width="12" height="12" viewBox="0 0 12 12"><line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button className="titlebar-control-btn" onClick={() => appWindow().toggleMaximize()} aria-label="Maximize">
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button className="titlebar-control-btn close" onClick={() => appWindow().close()} aria-label="Close">
          <svg width="12" height="12" viewBox="0 0 12 12"><line x1="1.5" y1="1.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" /><line x1="10.5" y1="1.5" x2="1.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      </div>
    </div>
  );
}
