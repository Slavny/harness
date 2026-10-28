import React, { useState, useEffect } from "react";
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

function App() {
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant', text: string }[]>([]);
  const [chatHistory, setChatHistory] = useState<{ id: number, title: string, messages: any[] }[]>([]);
  const [selectedModel, setSelectedModel] = useState('GigaChat-3-Ultra');
  const [store, setStore] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
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
      } catch (e) {
        console.error("Store init error:", e);
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
    
    const userMessage = { role: 'user' as const, text: `Прочитай приложенный файл и ответь на вопрос: ${prompt}` };
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
      saveHistory(prompt.slice(0, 20) + "...", updatedMessages);
    } catch (e) {
      const errorMessage = { role: 'assistant' as const, text: "Error: " + e };
      setMessages(prev => [...prev.slice(0, -1), errorMessage]);
      saveHistory(prompt.slice(0, 20) + "...", [...newMessages, errorMessage]);
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

  function handleChatSelect(id: number) {
    const chat = chatHistory.find(c => c.id === id);
    if (chat) {
      console.log("Selecting chat:", chat);
      setMessages(chat.messages);
    }
  }

  async function saveHistory(title: string, messages: any[]) {
    if (store) {
      const newChat = { id: Date.now(), title, messages };
      const history = await store.get("chatHistory") || [];
      console.log("Saving new chat:", newChat);
      await store.set("chatHistory", [...history, newChat]);
      await store.save();
      setChatHistory(prev => [...prev, newChat]);
    }
  }

  return (
    <div className="app-container" style={{ padding: '10px', display: 'flex', gap: '10px', height: '100vh', boxSizing: 'border-box' }}>
      <Sidebar 
        onProfileClick={() => setShowModal(true)} 
        onSettingsClick={() => setShowModal(true)} 
        chatHistory={chatHistory}
        onChatSelect={handleChatSelect}
      />

      <div className="main-content" style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          flex: 1,
          background: '#0f0f0f',
          borderRadius: '12px',
          position: 'relative',
          padding: '10px',
          border: '1px solid #333'
        }}>
        <button 
          className="theme-toggle" 
          onClick={() => console.log('Toggle theme')}
          style={{ position: 'absolute', top: '10px', right: '10px' }}
        >
          🌙
        </button>
        <div className="response-area" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '20px', alignItems: 'center' }}>
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.role}`}>
              <ReactMarkdown 
                remarkPlugins={[remarkGfm, remarkMath]} 
                rehypePlugins={[rehypeKatex]}
              >
                {msg.text}
              </ReactMarkdown>
            </div>
          ))}
        </div>
        <div className="chat-input-container">
          <textarea 
            className="chat-textarea"
            placeholder="Write a message..." 
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="chat-controls">
            <button className="plus-btn" onClick={handleFileSelect}>+</button>
            {attachments.length > 0 && (
                <div style={{ display: 'flex', gap: '5px', padding: '5px', background: '#222', borderRadius: '5px', marginBottom: '5px' }}>
                    {attachments.map((a, i) => (
                        <div key={i} style={{ padding: '2px 5px', border: '1px solid #444', borderRadius: '3px', fontSize: '10px' }}>
                            {a.name} ({a.status})
                        </div>
                    ))}
                </div>
            )}
            <div className="model-controls-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto' }}>
              <div className="model-dropdown-container">
                <button className="model-name-trigger" onClick={() => setShowModelDropdown(!showModelDropdown)}>
                  <span className="model-name">
                    {[
                      { id: 'GigaChat-3-Ultra', name: 'GigaChat 3 Ultra' },
                      { id: 'GigaChat-2-Max', name: 'GigaChat 2 Max' },
                      { id: 'GigaChat-2-Pro', name: 'GigaChat 2 Pro' },
                      { id: 'GigaChat-2', name: 'GigaChat 2' }
                    ].find(m => m.id === selectedModel)?.name}
                  </span>
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
              <div className="voice-controls">
                <span className="mic-icon">🎤</span>
                <span className="bars-icon">||||</span>
              </div>
            </div>
            <button className="send-btn-round" onClick={handleSend}>→</button>
          </div>
        </div>
      </div>
      
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
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

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: string}> {
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
