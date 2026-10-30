import React from 'react';
import './Sidebar.css';

export const Sidebar = ({ 
  onProfileClick, 
  onSettingsClick,
  chatHistory,
  onChatSelect,
  onNewChat,
  onTabChange,
  activeChatId
}: { 
  onProfileClick: () => void, 
  onSettingsClick: () => void,
  chatHistory: { id: number, title: string, messages: any[] }[],
  onChatSelect: (id: number) => void,
  onNewChat: () => void,
  onTabChange: (tab: string) => void,
  activeChatId: number | null
}) => {
  const [activeTab, setActiveTab] = React.useState(() => localStorage.getItem('sidebarActiveTab') || 'Home');
  const [activeNavItem, setActiveNavItem] = React.useState('New');
  const [isHistoryOpen, setIsHistoryOpen] = React.useState(true);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    localStorage.setItem('sidebarActiveTab', tab);
    onTabChange(tab);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header" style={{ display: 'flex', flexDirection: 'column', gap: '15px', padding: '0 15px' }}>
        <div className="sidebar-tabs">
          <div className="tab-indicator" style={{ transform: activeTab === 'Code' ? 'translateX(100%)' : 'translateX(0)' }}></div>
          <button 
            className={`tab ${activeTab === 'Home' ? 'active' : ''}`} 
            onClick={() => handleTabChange('Home')}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                Home
            </div>
          </button>
          <button 
            className={`tab ${activeTab === 'Code' ? 'active' : ''}`} 
            onClick={() => handleTabChange('Code')}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                Code
            </div>
          </button>
        </div>
      </div>

      <div className="sidebar-content" style={{ padding: '0 15px', marginBottom: '15px' }}>
        <div key={activeTab} className="tab-content-anim">
        {activeTab === 'Code' ? (
        <nav className="sidebar-nav">
          <button className={`sidebar-nav-item ${activeNavItem === 'NewSession' ? 'active' : ''}`} onClick={() => { setActiveNavItem('NewSession'); onNewChat(); }}>
            <div className="icon-circle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg></div>
            New Session
            <span className="shortcut-hint" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', color: '#777', fontSize: '11px' }}>
              <kbd style={{ fontFamily: 'inherit', background: '#2a2a2a', border: '1px solid #444', borderRadius: '4px', padding: '1px 5px' }}>Ctrl</kbd>
              <kbd style={{ fontFamily: 'inherit', background: '#2a2a2a', border: '1px solid #444', borderRadius: '4px', padding: '1px 5px' }}>N</kbd>
            </span>
          </button>
          <button className={`sidebar-nav-item ${activeNavItem === 'Search' ? 'active' : ''}`} onClick={() => setActiveNavItem('Search')}>
            <div className="icon-circle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div>
            Search
            <span className="shortcut-hint" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', color: '#777', fontSize: '11px' }}>
              <kbd style={{ fontFamily: 'inherit', background: '#2a2a2a', border: '1px solid #444', borderRadius: '4px', padding: '1px 5px' }}>Ctrl</kbd>
              <kbd style={{ fontFamily: 'inherit', background: '#2a2a2a', border: '1px solid #444', borderRadius: '4px', padding: '1px 5px' }}>K</kbd>
            </span>
          </button>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '15px', padding: '0 10px', color: '#666', fontSize: '11px', letterSpacing: '1px' }}>
            SESSIONS
            <span style={{ display: 'flex', gap: '8px' }}>
              <button className="sidebar-btn" onClick={() => console.log('Expand sessions')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg></button>
              <button className="sidebar-btn" onClick={() => console.log('Sessions options')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg></button>
            </span>
          </div>
        </nav>
        ) : (
        <nav className="sidebar-nav">
          <button className={`sidebar-nav-item ${activeNavItem === 'New' ? 'active' : ''}`} onClick={() => { setActiveNavItem('New'); onNewChat(); }}><div className="icon-circle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></div> New</button>
          <button className={`sidebar-nav-item ${activeNavItem === 'Projects' ? 'active' : ''}`} onClick={() => setActiveNavItem('Projects')}><div className="icon-circle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></div> Projects</button>
          <button className={`sidebar-nav-item ${activeNavItem === 'Artifacts' ? 'active' : ''}`} onClick={() => setActiveNavItem('Artifacts')}><div className="icon-circle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg></div> Artifacts</button>
          <button className={`sidebar-nav-item ${activeNavItem === 'Scheduled' ? 'active' : ''}`} onClick={() => setActiveNavItem('Scheduled')}><div className="icon-circle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div> Scheduled</button>
          <button className={`sidebar-nav-item ${activeNavItem === 'Dispatch' ? 'active' : ''}`} onClick={() => setActiveNavItem('Dispatch')}><div className="icon-circle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg></div> Dispatch</button>
          <button className={`sidebar-nav-item ${activeNavItem === 'Customize' ? 'active' : ''}`} onClick={() => setActiveNavItem('Customize')}><div className="icon-circle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg></div> Customize</button>
        </nav>
        )}

        {activeTab === 'Home' && (
          <div className="history-section" style={{ marginTop: '20px' }}>
            <div className="history-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', color: '#888', fontSize: '0.85rem', letterSpacing: '0.5px' }} onClick={() => setIsHistoryOpen(!isHistoryOpen)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ transform: isHistoryOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>❯</span>
                Chats and tasks
              </span>
              <button className="sidebar-btn" style={{ padding: '2px' }} title="Новый чат" onClick={(e) => { e.stopPropagation(); onNewChat(); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20"></path><circle cx="12" cy="12" r="10"></circle></svg>
              </button>
            </div>
            {isHistoryOpen && (
              chatHistory.length > 0 ? (
                <div className="history-list" style={{ marginTop: '8px' }}>
                  {[...chatHistory].reverse().map(chat => (
                    <div key={chat.id} className={`history-item ${activeChatId === chat.id ? 'active' : ''}`} onClick={() => onChatSelect(chat.id)} data-title={chat.title}>
                      {chat.title === 'Файл(ы)' ? (
                        <svg className="history-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                      ) : (
                        <svg className="history-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                      )}
                      <span className="history-item-title">{chat.title}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="placeholder" style={{ marginTop: '10px' }}>Пока нет чатов</div>
              )
            )}
          </div>
        )}
        </div>
      </div>

      <div className="sidebar-footer">
        {activeTab === 'Home' && (
          <>
            <div style={{ borderTop: '1px solid #333' }}></div>
            <div className="footer-item" style={{ padding: '10px 15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div className="icon-circle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg></div>
              <span>Design</span>
            </div>
          </>
        )}
        <div style={{ borderTop: '1px solid #333' }}></div>
        <div className="footer-item" style={{ padding: '10px 15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={onProfileClick}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a0a0a0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            </div>
            <span style={{ fontWeight: 500 }}>User Name</span>
            <span style={{ background: '#2a2a2a', border: '1px solid #444', borderRadius: '10px', padding: '2px 8px', fontSize: '11px', color: '#d0d0d0' }}>Plus</span>
          </div>
          <button className="sidebar-btn" style={{ padding: '4px' }} onClick={onSettingsClick}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
        </div>
      </div>
    </aside>
  );
};
