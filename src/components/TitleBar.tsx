import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./TitleBar.css";

const appWindow = () => getCurrentWindow();

interface MenuItem {
  label: string;
  action?: () => void;
}

interface Menu {
  label: string;
  items: MenuItem[];
}

interface TitleBarProps {
  onOpenSettings?: () => void;
  onNewChat?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export function TitleBar({ onOpenSettings, onNewChat, sidebarCollapsed, onToggleSidebar }: TitleBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "New chat", action: onNewChat },
        { label: "Settings", action: onOpenSettings },
        { label: "Exit", action: () => appWindow().close() },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Copy", action: () => document.execCommand("copy") },
        { label: "Paste", action: () => document.execCommand("paste") },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Zoom in", action: () => (document.body.style.zoom = String((parseFloat(document.body.style.zoom || "1") + 0.1).toFixed(1))) },
        { label: "Zoom out", action: () => (document.body.style.zoom = String((parseFloat(document.body.style.zoom || "1") - 0.1).toFixed(1))) },
        { label: "Reset zoom", action: () => (document.body.style.zoom = "1") },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "About", action: onOpenSettings },
      ],
    },
  ];

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
                onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
                onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
              >
                {menu.label}
              </button>
              {openMenu === menu.label && (
                <div className="titlebar-dropdown">
                  {menu.items.map((item) => (
                    <button
                      key={item.label}
                      className="titlebar-dropdown-item"
                      onClick={() => {
                        setOpenMenu(null);
                        item.action?.();
                      }}
                    >
                      {item.label}
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
