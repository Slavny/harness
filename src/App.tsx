import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import "./App.css";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

function TerminalWorkspace() {
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!terminalRef.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "Consolas, 'Cascadia Code', monospace",
      fontSize: 13,
      theme: { background: "#0b0b0b", foreground: "#d8d8d8", cursor: "#ffffff" },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalRef.current);
    fitAddon.fit();
    const resizeTerminal = () => {
      fitAddon.fit();
      void invoke("resize_terminal", { rows: terminal.rows, cols: terminal.cols });
    };

    let disposed = false;
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    void Promise.all([
      listen<string>("terminal-output", event => terminal.write(event.payload)),
      listen("terminal-exited", () => terminal.write("\r\n[Process exited]\r\n")),
    ]).then(([output, exit]) => {
      if (disposed) {
        output();
        exit();
      } else {
        unlistenOutput = output;
        unlistenExit = exit;
        void invoke("start_terminal")
          .then(() => resizeTerminal())
          .catch(error => terminal.write(`\r\n[Failed to start terminal: ${error}]\r\n`));
      }
    });

    terminal.onData(data => {
      void invoke("write_terminal", { input: data });
    });
    const resizeObserver = new ResizeObserver(resizeTerminal);
    resizeObserver.observe(terminalRef.current);
    return () => {
      disposed = true;
      unlistenOutput?.();
      unlistenExit?.();
      resizeObserver.disconnect();
      void invoke("close_terminal");
      terminal.dispose();
    };
  }, []);

  return <div ref={terminalRef} className="terminal-xterm" aria-label="PowerShell terminal" />;
}

function RobotIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V3" />
      <circle cx="12" cy="3" r="1" />
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <circle cx="9" cy="13" r="1" fill="currentColor" />
      <circle cx="15" cy="13" r="1" fill="currentColor" />
      <path d="M9 17h6" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function HandIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
      <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v6" />
      <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}

function ShieldQuestionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2 2-2 3" />
      <circle cx="12" cy="16.5" r="0.8" fill="currentColor" />
    </svg>
  );
}

function ShieldAlertIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <circle cx="12" cy="16" r="0.8" fill="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function TerminalSquareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" />
      <path d="M4.5 5.5L7.5 8L4.5 10.5" />
      <line x1="8.5" y1="10.5" x2="11.5" y2="10.5" />
    </svg>
  );
}

function GitBranchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function BrowserIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="18" rx="3" />
      <line x1="2" y1="9" x2="22" y2="9" />
      <circle cx="6" cy="6" r="1" fill="currentColor" />
      <circle cx="9" cy="6" r="1" fill="currentColor" />
    </svg>
  );
}

function TerminalPromptIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function MessageDotsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <circle cx="9" cy="10" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  );
}

const PERMISSION_MODES = [
  {
    id: 'Always Ask',
    title: 'Always Ask',
    desc: 'Auto-read only; everything else needs your approval first',
    color: '#e5e5e5',
    iconColor: '#a0a0a0',
    chipColor: '#cccccc',
    icon: HandIcon,
  },
  {
    id: 'Ask When Needed',
    title: 'Ask When Needed',
    desc: 'Routine edits and commands run automatically; risky actions, questions, and plans still ask',
    color: '#d9a04a',
    iconColor: '#d9a04a',
    chipColor: '#d9a04a',
    icon: ShieldQuestionIcon,
  },
  {
    id: 'Never Ask',
    title: 'Never Ask',
    desc: 'Everything runs and is decided automatically; only plans in Plan mode wait for your review',
    color: '#e05252',
    iconColor: '#e05252',
    chipColor: '#e05252',
    icon: ShieldAlertIcon,
  },
];

function App() {
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant', text: string }[]>([]);
  const [currentChatId, setCurrentChatId] = useState<number | null>(null);
  const [chatHistory, setChatHistory] = useState<{ id: number, title: string, messages: any[] }[]>([]);
  const [selectedModel, setSelectedModel] = useState('GigaChat-3-Ultra');
  const [store, setStore] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('appTheme') as 'dark' | 'light') || 'dark');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(() => localStorage.getItem('showRightPanel') === 'true');
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const saved = localStorage.getItem('rightPanelWidth');
    return saved ? Math.max(300, Math.min(800, parseInt(saved, 10))) : 440;
  });
  const isResizingRightPanel = useRef(false);

  useEffect(() => {
    localStorage.setItem('showRightPanel', String(showRightPanel));
  }, [showRightPanel]);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRightPanel.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRightPanel.current) return;
      const newWidth = window.innerWidth - moveEvent.clientX - 10;
      if (newWidth >= 300 && newWidth <= Math.min(850, window.innerWidth * 0.7)) {
        setRightPanelWidth(newWidth);
      }
    };

    const onMouseUp = () => {
      isResizingRightPanel.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setRightPanelWidth(w => {
        localStorage.setItem('rightPanelWidth', String(w));
        return w;
      });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const [terminalHeight, setTerminalHeight] = useState(() => {
    const saved = localStorage.getItem('terminalHeight');
    return saved ? Math.max(120, Math.min(800, parseInt(saved, 10))) : 290;
  });
  const isResizingTerminal = useRef(false);

  const handleTerminalResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingTerminal.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const startY = e.clientY;
    const startH = terminalHeight;
    let currentH = startH;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingTerminal.current) return;
      const deltaY = startY - moveEvent.clientY;
      const minH = 120;
      const maxH = Math.min(window.innerHeight - 150, Math.floor(window.innerHeight * 0.75));
      currentH = Math.max(minH, Math.min(maxH, startH + deltaY));
      setTerminalHeight(currentH);
    };

    const onMouseUp = () => {
      isResizingTerminal.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      localStorage.setItem('terminalHeight', String(currentH));
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };
  const [sidebarTab, setSidebarTab] = useState(() => localStorage.getItem('sidebarActiveTab') || 'Home');
  const [showTerminal, setShowTerminal] = useState(false);
  const [sidebarStateReady, setSidebarStateReady] = useState(false);
  const sidebarStateLoaded = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.shiftKey && e.code === 'KeyB') || (e.ctrlKey && e.altKey && e.code === 'KeyB')) {
        e.preventDefault();
        setShowRightPanel(v => !v);
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyB') {
        e.preventDefault();
        setSidebarCollapsed(v => !v);
      }
      if (e.key === 'Escape') {
        setShowNewTabMenu(false);
      }
      if (e.ctrlKey && e.code === 'KeyN') {
        e.preventDefault();
        handleNewChat();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (store && sidebarStateLoaded.current) {
      store.set("sidebarCollapsed", sidebarCollapsed);
      store.save();
    }
  }, [sidebarCollapsed, store]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [permissionMode, setPermissionMode] = useState('Ask When Needed');
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [showNewTabMenu, setShowNewTabMenu] = useState(false);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const newTabMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(event.target as Node)) {
        setShowModeDropdown(false);
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setShowModelDropdown(false);
      }
      if (newTabMenuRef.current && !newTabMenuRef.current.contains(event.target as Node)) {
        setShowNewTabMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const currentPermissionMode = PERMISSION_MODES.find(m => m.id === permissionMode) || PERMISSION_MODES[1];
  const [attachments, setAttachments] = useState<{ id: string, name: string, status: 'uploading' | 'success' | 'error' }[]>([]);

  useEffect(() => {
    async function initStore() {
      try {
        console.log("Loading store...");
        const s = await load("store.json");
        setStore(s);
        const savedKey = await s.get<string>("apiKey");
        console.log("Store loaded, savedKey:", savedKey);
        if (savedKey) setApiKey(savedKey);

        const savedHistory = await s.get<any[]>("chatHistory");
        console.log("Store loaded, savedHistory:", savedHistory);
        if (savedHistory) setChatHistory(savedHistory);

        const savedSidebarCollapsed = await s.get<boolean>("sidebarCollapsed");
        if (savedSidebarCollapsed !== null && savedSidebarCollapsed !== undefined) {
          setSidebarCollapsed(savedSidebarCollapsed);
        }
        sidebarStateLoaded.current = true;
        setSidebarStateReady(true);
      } catch (e) {
        console.error("Store init error:", e);
        setSidebarStateReady(true);
      }
    }
    initStore();
  }, []);

  async function updateApiKey(key: string) {
    setApiKey(key);
    console.log("Updating API key...", key);
    if (store) {
      try {
        await store.set("apiKey", key);
        console.log("Store set called");
        await store.save();
        console.log("Store saved");
      } catch (e) {
        console.error("Error saving to store:", e);
      }
    } else {
      console.error("Store is not initialized");
    }
  }

  async function handleSend() {
    if (!prompt.trim() && attachments.filter(a => a.status === 'success').length === 0) return;
    const attachmentIds = attachments.filter(a => a.status === 'success').map(a => a.id);

    const userMessage = { role: 'user' as const, text: attachmentIds.length > 0 ? `Прочитай приложенный файл и ответь на вопрос: ${prompt}` : prompt };
    const chatTitle = prompt.trim() || (attachmentIds.length > 0 ? 'Файл(ы)' : 'Новый чат');
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setPrompt("");
    setAttachments([]); // Clear attachments after send

    setMessages(prev => [...prev, { role: 'assistant', text: "Thinking..." }]);
    try {
      const backendMessages = newMessages.map(msg => ({ role: msg.role, content: msg.text }));
      const result = await invoke("ask_gigachat", { apiKey, messages: backendMessages, model: selectedModel, attachments: attachmentIds.length > 0 ? attachmentIds : null });
      const assistantMessage = { role: 'assistant' as const, text: result as string };
      const updatedMessages = [...newMessages, assistantMessage];
      setMessages(updatedMessages);
      saveHistory(chatTitle, updatedMessages);
    } catch (e) {
      const errorMessage = { role: 'assistant' as const, text: "Error: " + e };
      setMessages(prev => [...prev.slice(0, -1), errorMessage]);
      saveHistory(chatTitle, [...newMessages, errorMessage]);
    }
  }

  async function handleFileSelect() {
    const selected = await open({
      multiple: false,
    });

    if (selected && !Array.isArray(selected)) {
      const fileName = selected.split(/[\\/]/).pop() || "unknown";
      const newAttachment = { id: '', name: fileName, status: 'uploading' as const };
      setAttachments(prev => [...prev, newAttachment]);

      try {
        const fileId = await invoke("upload_file", { apiKey: apiKey, filePath: selected });
        setAttachments(prev => prev.map(a => a.name === fileName ? { ...a, id: fileId as string, status: 'success' } : a));
      } catch (e) {
        console.error("Upload error:", e);
        setAttachments(prev => prev.map(a => a.name === fileName ? { ...a, status: 'error' } : a));
      }
    }
  }

  async function handleOpenFolder() {
    try {
      const selectedFolder = await open({ directory: true, multiple: false });
      if (selectedFolder) {
        setPrompt(selectedFolder);
      }
    } catch (error) {
      console.error("Failed to open folder:", error);
    }
  }

  function handleNewChat() {
    setMessages([]);
    setPrompt("");
    setAttachments([]);
    setCurrentChatId(null);
  }

  function toggleTerminal() {
    if (sidebarTab === 'Code') {
      setShowTerminal(value => !value);
    }
  }

  function handleSidebarTabChange(tab: string) {
    setSidebarTab(tab);
    if (tab !== 'Code') {
      setShowTerminal(false);
    }
  }

  function handleChatSelect(id: number) {
    const chat = chatHistory.find(c => c.id === id);
    if (chat) {
      console.log("Selecting chat:", chat);
      setMessages(chat.messages);
      setCurrentChatId(id);
    }
  }

  async function saveHistory(title: string, messages: any[]) {
    if (!store) return;
    if (currentChatId) {
      const history = ((await store.get("chatHistory")) || []) as any[];
      const updated = history.map((c: any) => c.id === currentChatId ? { ...c, messages } : c);
      console.log("Updating chat:", currentChatId);
      await store.set("chatHistory", updated);
      await store.save();
      setChatHistory(updated);
      return;
    }
    const newChat = { id: Date.now(), title, messages };
    const history = ((await store.get("chatHistory")) || []) as any[];
    console.log("Saving new chat:", newChat);
    await store.set("chatHistory", [...history, newChat]);
    await store.save();
    setChatHistory(prev => [...prev, newChat]);
    setCurrentChatId(newChat.id);
  }

  const chatInput = (
    <div className="chat-input-container">
      <textarea
        className="chat-textarea"
        placeholder="Type a message..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      {attachments.length > 0 && (
        <div style={{ display: 'flex', gap: '5px', padding: '5px', background: '#222', borderRadius: '5px', marginBottom: '5px' }}>
          {attachments.map((a, i) => (
            <div key={i} style={{ padding: '2px 5px', border: '1px solid #444', borderRadius: '3px', fontSize: '10px' }}>
              {a.name} ({a.status})
            </div>
          ))}
        </div>
      )}
      <div className="chat-controls">
        <div className="left-controls">
          <button className="plus-btn" onClick={handleFileSelect} type="button">+</button>
          <div className="mode-dropdown-container" ref={modeDropdownRef}>
            <button
              className="mode-chip"
              style={{ color: currentPermissionMode.chipColor }}
              onClick={() => setShowModeDropdown(!showModeDropdown)}
              type="button"
            >
              <span className="mode-chip-icon" style={{ color: currentPermissionMode.iconColor }}>
                <currentPermissionMode.icon />
              </span>
              <span>{currentPermissionMode.title}</span>
              <span className="dropdown-icon" style={{ color: currentPermissionMode.chipColor }}>
                {showModeDropdown ? '▴' : '▾'}
              </span>
            </button>
            {showModeDropdown && (
              <div className="mode-dropdown-menu">
                {PERMISSION_MODES.map(mode => {
                  const Icon = mode.icon;
                  const isSelected = permissionMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      className={`mode-option-item ${isSelected ? 'selected' : ''}`}
                      type="button"
                      onClick={() => {
                        setPermissionMode(mode.id);
                        setShowModeDropdown(false);
                      }}
                    >
                      <span className="mode-option-icon" style={{ color: mode.iconColor }}>
                        <Icon />
                      </span>
                      <div className="mode-option-content">
                        <div className="mode-option-title" style={{ color: mode.color }}>
                          {mode.title}
                        </div>
                        <div className="mode-option-desc">
                          {mode.desc}
                        </div>
                      </div>
                      {isSelected && (
                        <span className="mode-option-check">
                          <CheckIcon />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="model-controls-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto' }}>
          <div className="model-dropdown-container" ref={modelDropdownRef}>
            <button className="model-name-trigger" onClick={() => setShowModelDropdown(!showModelDropdown)}>
              <span className="model-name">
                {[
                  { id: 'GigaChat-3-Ultra', name: 'GigaChat 3 Ultra' },
                  { id: 'GigaChat-2-Max', name: 'GigaChat 2 Max' },
                  { id: 'GigaChat-2-Pro', name: 'GigaChat 2 Pro' },
                  { id: 'GigaChat-2', name: 'GigaChat 2' }
                ].find(m => m.id === selectedModel)?.name}
              </span>
              <span className="model-level">· High</span>
              <span className="dropdown-icon">{showModelDropdown ? '▴' : '▾'}</span>
            </button>
            {showModelDropdown && (
              <div className="model-dropdown-menu">
                {[
                  { id: 'GigaChat-3-Ultra', name: 'GigaChat 3 Ultra', desc: 'Новая модель для физлиц (freemium)' },
                  { id: 'GigaChat-2-Max', name: 'GigaChat 2 Max', desc: 'Для сложных и масштабных задач' },
                  { id: 'GigaChat-2-Pro', name: 'GigaChat 2 Pro', desc: 'Для ресурсоемких задач и инструкций' },
                  { id: 'GigaChat-2', name: 'GigaChat 2', desc: 'Для быстрых и простых задач' }
                ].map(model => (
                  <div key={model.id} className="model-option">
                    <button onClick={() => {
                      setSelectedModel(model.id);
                      setShowModelDropdown(false);
                    }}>
                      {model.name}
                    </button>
                    <div className="tooltip-wrapper">
                      <span className="info-icon">ℹ️</span>
                      <span className="tooltip-text">{model.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="send-btn-round" onClick={handleSend}>↑</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <TitleBar
        onOpenSettings={() => setShowModal(true)}
        onNewChat={handleNewChat}
        onOpenFolder={handleOpenFolder}
        onToggleTerminal={toggleTerminal}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(v => !v)}
      />
      <div className="app-container" style={{ padding: '10px', display: 'flex', gap: '10px', flex: 1, minHeight: 0, minWidth: 0, boxSizing: 'border-box', overflow: 'hidden' }}>
        {sidebarStateReady && !sidebarCollapsed && (
          <Sidebar
            onProfileClick={() => setShowModal(true)}
            onSettingsClick={() => setShowModal(true)}
            chatHistory={chatHistory}
            onChatSelect={handleChatSelect}
            onNewChat={handleNewChat}
            onTabChange={handleSidebarTabChange}
            activeChatId={currentChatId}
          />
        )}

        <div className="main-content" style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          background: '#0f0f0f',
          borderRadius: '12px',
          position: 'relative',
          padding: '10px',
          border: '1px solid #333',
          minWidth: 0,
          minHeight: 0,
          boxSizing: 'border-box'
        }}>
          <div className="top-right-actions">
            <div className="btn-tooltip-wrapper">
              <button
                className={`top-action-btn ${sidebarTab === 'Code' && showTerminal ? 'active' : ''}`}
                onClick={() => {
                  if (!showTerminal && sidebarTab !== 'Code') {
                    setSidebarTab('Code');
                    localStorage.setItem('sidebarActiveTab', 'Code');
                  }
                  setShowTerminal(v => !v);
                }}
                type="button"
              >
                <TerminalSquareIcon />
              </button>
              <span className="custom-tooltip align-right">
                {(sidebarTab === 'Code' && showTerminal) ? 'Close terminal' : 'Open terminal'}
                <span className="tooltip-keys">
                  <kbd>Ctrl</kbd>
                  <span>+</span>
                  <kbd>`</kbd>
                </span>
              </span>
            </div>
            {!showRightPanel && (
              <div className="btn-tooltip-wrapper">
                <button
                  className="top-action-btn"
                  onClick={() => setShowRightPanel(true)}
                  type="button"
                >
                  <span className="right-panel-icon-box">
                    <span className="right-panel-icon-bar collapsed" />
                  </span>
                </button>
                <span className="custom-tooltip align-right">
                  Expand right panel
                  <span className="tooltip-keys">
                    <kbd>Shift</kbd>
                    <span>+</span>
                    <kbd>Ctrl</kbd>
                    <span>+</span>
                    <kbd>B</kbd>
                  </span>
                </span>
              </div>
            )}
          </div>

          {messages.length === 0 ? (
            <div className="welcome-block">
              <div className="brand-header">
                <h1 className="brand-title">
                  ХАРНЕСС
                  {sidebarTab === 'Code' && <span className="brand-code">&lt;Code&gt;</span>}
                </h1>
              </div>
              <div className="chat-input-wrapper">
                {chatInput}
              </div>
            </div>
          ) : (
            <div className="chat-view">
              <div className="response-area">
                <div className="messages-container">
                  {messages.map((msg, index) => (
                    <div key={index} className={`message-row ${msg.role}`}>
                      {msg.role === 'assistant' && (
                        <div className="message-avatar assistant-avatar" title="Бот">
                          <RobotIcon />
                        </div>
                      )}
                      <div className={`message ${msg.role}`}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                        >
                          {msg.text}
                        </ReactMarkdown>
                      </div>
                      {msg.role === 'user' && (
                        <div className="message-avatar user-avatar" title="Пользователь">
                          <UserIcon />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="chat-input-wrapper">
                {chatInput}
              </div>
            </div>
          )}

          {sidebarTab === 'Code' && showTerminal && (
            <section
              className="terminal-panel"
              aria-label="Terminal"
              style={{ height: `${terminalHeight}px`, flex: `0 0 ${terminalHeight}px` }}
            >
              <div
                className="terminal-resizer"
                onMouseDown={handleTerminalResizeMouseDown}
                title="Перетащите для изменения высоты"
              />
              <div className="terminal-tabs">
                <button className="terminal-tab active" type="button">〉_ PowerShell</button>
                <button className="terminal-new-tab" type="button" aria-label="New terminal">+</button>
                <button className="terminal-close" type="button" onClick={() => setShowTerminal(false)} aria-label="Close terminal">×</button>
              </div>
              <div className="terminal-output">
                <TerminalWorkspace />
              </div>
            </section>
          )}
        </div>

        {showRightPanel && (
          <aside className="right-sidebar" style={{ width: `${rightPanelWidth}px` }}>
            <div
              className="right-sidebar-resizer"
              onMouseDown={handleResizeMouseDown}
              title="Перетащите для изменения ширины"
            />
            <div className="right-sidebar-header">
              <div className="btn-tooltip-wrapper new-tab-menu-wrapper" ref={newTabMenuRef}>
                <button
                  className={`top-action-btn ${showNewTabMenu ? 'active' : ''}`}
                  onClick={() => setShowNewTabMenu(v => !v)}
                  type="button"
                >
                  <PlusIcon />
                </button>
                {!showNewTabMenu && (
                  <span className="custom-tooltip">
                    New tab
                  </span>
                )}
                {showNewTabMenu && (
                  <div className="new-tab-dropdown-menu">
                    <button
                      className="new-tab-dropdown-item"
                      type="button"
                      onClick={() => {
                        setShowNewTabMenu(false);
                        if (sidebarTab !== 'Code') setSidebarTab('Code');
                      }}
                    >
                      <div className="menu-item-left">
                        <GitBranchIcon />
                        <span>Changes</span>
                      </div>
                      <div className="menu-item-keys">
                        <kbd>Ctrl</kbd>
                        <kbd>Shift</kbd>
                        <kbd>G</kbd>
                      </div>
                    </button>

                    <button
                      className="new-tab-dropdown-item"
                      type="button"
                      onClick={() => {
                        setShowNewTabMenu(false);
                        handleNewChat();
                      }}
                    >
                      <div className="menu-item-left">
                        <BrowserIcon />
                        <span>Browser</span>
                      </div>
                      <div className="menu-item-keys">
                        <kbd>Ctrl</kbd>
                        <kbd>T</kbd>
                      </div>
                    </button>

                    <button
                      className="new-tab-dropdown-item"
                      type="button"
                      onClick={() => {
                        setShowNewTabMenu(false);
                        if (!showTerminal && sidebarTab !== 'Code') {
                          setSidebarTab('Code');
                          localStorage.setItem('sidebarActiveTab', 'Code');
                        }
                        setShowTerminal(v => !v);
                      }}
                    >
                      <div className="menu-item-left">
                        <TerminalSquareIcon />
                        <span>Terminal</span>
                      </div>
                      <div className="menu-item-keys">
                        <kbd>Ctrl</kbd>
                        <kbd>`</kbd>
                      </div>
                    </button>

                    <button
                      className="new-tab-dropdown-item"
                      type="button"
                      onClick={() => {
                        setShowNewTabMenu(false);
                        handleOpenFolder();
                      }}
                    >
                      <div className="menu-item-left">
                        <FolderIcon />
                        <span>Files</span>
                      </div>
                      <div className="menu-item-keys">
                        <kbd>Shift</kbd>
                        <kbd>Ctrl</kbd>
                        <kbd>E</kbd>
                      </div>
                    </button>

                    <button
                      className="new-tab-dropdown-item"
                      type="button"
                      onClick={() => {
                        setShowNewTabMenu(false);
                        document.querySelector<HTMLTextAreaElement>('.chat-textarea')?.focus();
                      }}
                    >
                      <div className="menu-item-left">
                        <MessageDotsIcon />
                        <span>Side Chat</span>
                      </div>
                      <div className="menu-item-keys">
                        <kbd>Alt</kbd>
                        <kbd>Ctrl</kbd>
                        <kbd>B</kbd>
                      </div>
                    </button>
                  </div>
                )}
              </div>
              <div className="btn-tooltip-wrapper">
                <button
                  className="top-action-btn active"
                  onClick={() => setShowRightPanel(false)}
                  type="button"
                >
                  <span className="right-panel-icon-box">
                    <span className="right-panel-icon-bar" />
                  </span>
                </button>
                <span className="custom-tooltip align-right">
                  Collapse right panel
                  <span className="tooltip-keys">
                    <kbd>Shift</kbd>
                    <span>+</span>
                    <kbd>Ctrl</kbd>
                    <span>+</span>
                    <kbd>B</kbd>
                  </span>
                </span>
              </div>
            </div>

            <div className="right-sidebar-body">
              <div className="right-sidebar-shortcuts">
                <div className="right-shortcut-row" onClick={() => { if (sidebarTab !== 'Code') setSidebarTab('Code'); }}>
                  <div className="shortcut-label-group">
                    <GitBranchIcon />
                    <span>Changes</span>
                  </div>
                  <div className="shortcut-keys-group">
                    <kbd>Ctrl</kbd>
                    <kbd>Shift</kbd>
                    <kbd>G</kbd>
                  </div>
                </div>

                <div className="right-shortcut-row" onClick={() => handleNewChat()}>
                  <div className="shortcut-label-group">
                    <BrowserIcon />
                    <span>Browser</span>
                  </div>
                  <div className="shortcut-keys-group">
                    <kbd>Ctrl</kbd>
                    <kbd>T</kbd>
                  </div>
                </div>

                <div className="right-shortcut-row" onClick={() => {
                  if (!showTerminal && sidebarTab !== 'Code') {
                    setSidebarTab('Code');
                    localStorage.setItem('sidebarActiveTab', 'Code');
                  }
                  setShowTerminal(v => !v);
                }}>
                  <div className="shortcut-label-group">
                    <TerminalPromptIcon />
                    <span>Terminal</span>
                  </div>
                  <div className="shortcut-keys-group">
                    <kbd>Ctrl</kbd>
                    <kbd>`</kbd>
                  </div>
                </div>

                <div className="right-shortcut-row" onClick={handleOpenFolder}>
                  <div className="shortcut-label-group">
                    <FolderIcon />
                    <span>Files</span>
                  </div>
                  <div className="shortcut-keys-group">
                    <kbd>Shift</kbd>
                    <kbd>Ctrl</kbd>
                    <kbd>E</kbd>
                  </div>
                </div>

                <div className="right-shortcut-row" onClick={() => {
                  document.querySelector<HTMLTextAreaElement>('.chat-textarea')?.focus();
                }}>
                  <div className="shortcut-label-group">
                    <MessageDotsIcon />
                    <span>Side Chat</span>
                  </div>
                  <div className="shortcut-keys-group">
                    <kbd>Shift</kbd>
                    <kbd>Ctrl</kbd>
                    <kbd>B</kbd>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        )}
        </div>

        {showModal && (
          <div className="modal-overlay" onClick={() => setShowModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', paddingBottom: '14px', borderBottom: '1px solid #2e2e2e' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#252525', border: '1px solid #3a3a3a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <UserIcon />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 600, fontSize: '14px', color: '#ffffff' }}>User Name</span>
                      <span style={{ background: '#2a2a2a', border: '1px solid #444', borderRadius: '8px', padding: '1px 6px', fontSize: '10px', color: '#d0d0d0', lineHeight: 1.2 }}>Plus</span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#888888', marginTop: '2px' }}>Профиль и настройки</div>
                  </div>
                </div>

                <button
                  type="button"
                  className="modal-theme-btn"
                  onClick={() => {
                    const next = theme === 'dark' ? 'light' : 'dark';
                    setTheme(next);
                    localStorage.setItem('appTheme', next);
                  }}
                  title="Переключить тему оформления"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 12px',
                    background: '#222222',
                    border: '1px solid #3a3a3a',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    color: '#e0e0e0',
                    fontSize: '13px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span style={{ fontSize: '15px' }}>{theme === 'dark' ? '🌙' : '☀️'}</span>
                  <span>{theme === 'dark' ? 'Тёмная тема' : 'Светлая тема'}</span>
                </button>
              </div>

              <h3 style={{ marginBottom: '15px' }}>Настройки GigaChat API</h3>
              <ol style={{ fontSize: '0.9rem', marginBottom: '20px', color: '#a0a0a0', paddingLeft: '20px' }}>
                <li style={{ marginBottom: '10px' }}>Перейдите на сайт <a href="https://developers.sber.ru" target="_blank" style={{ color: '#00ff9d' }}>developers.sber.ru</a></li>
                <li style={{ marginBottom: '10px' }}>Зарегистрируйтесь или войдите через <span style={{ color: 'white', fontWeight: 'bold' }}>Sber ID</span>.</li>
                <li style={{ marginBottom: '10px' }}>Нажмите "Создать проект" в GigaChat API.</li>
                <li style={{ marginBottom: '10px' }}>Укажите любое название проекта, можно оставить стандартное, дополнительные настройки можно не трогать.</li>
                <li style={{ marginBottom: '10px' }}>Перейдите в раздел "Настроить API".</li>
                <li style={{ marginBottom: '10px' }}>В ключах авторизации нажмите "Получить новый ключ" и скопируйте его.</li>
                <li style={{ marginBottom: '10px' }}>Вставьте ключ в поле ниже.</li>
              </ol>
              <input
                type="password"
                placeholder="Введите API ключ"
                value={apiKey}
                onChange={(e) => updateApiKey(e.target.value)}
                style={{ width: '100%', padding: '10px', marginBottom: '20px', background: '#202020', color: 'white', border: '1px solid #333', boxSizing: 'border-box' }}
              />
              <button onClick={() => setShowModal(false)} style={{ width: '100%', padding: '10px', background: '#333', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Закрыть</button>
            </div>
          </div>
        )}
      </div>
  );
}

export default App;

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error: error.toString() };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'red', background: '#333', height: '100vh' }}>
          <h2>Something went wrong.</h2>
          <pre>{this.state.error}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
export { ErrorBoundary };
