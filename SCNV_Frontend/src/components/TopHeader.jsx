import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Search, LogOut, ChevronDown, User,
  LayoutDashboard, Bell, Menu, X,
  Network, Activity, Globe, Home
} from 'lucide-react';
import OfiLogo from './OfiLogo';
import { AGENTS } from '../config/agents.jsx';
import '../styles/topheader.css';

function TopHeader({ authData, onLogout, onSelectAgent }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [agentsDropdownOpen, setAgentsDropdownOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const agentsRef = useRef(null);
  const sidebarRef = useRef(null);

  const activePage =
    location.pathname === '/dashboard' || location.pathname === '/'
      ? 'dashboard'
      : location.pathname === '/decisions'
      ? 'decisions'
      : 'chat';

  /* ── Close on outside click ── */
  useEffect(() => {
    const handle = (e) => {
      if (agentsRef.current && !agentsRef.current.contains(e.target)) {
        setAgentsDropdownOpen(false);
      }
      if (
        sidebarRef.current &&
        !sidebarRef.current.contains(e.target) &&
        !e.target.closest('.fc-hamburger-btn')
      ) {
        setSidebarOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const handleAgentClick = (agent) => {
    onSelectAgent(agent);
    setAgentsDropdownOpen(false);
    navigate('/chat');
  };

  const handleNav = (path) => {
    navigate(path);
    setSidebarOpen(false);
  };

  const handleLogoutClick = () => {
    setSidebarOpen(false);
    onLogout();
  };

  const userInitial = authData?.email
    ? authData.email.charAt(0).toUpperCase()
    : 'U';

  return (
    <>
      {/* ════════════════════════════════════════════════════
          Single top navigation bar
      ════════════════════════════════════════════════════ */}
      <header className="fc-header">
        <div className="fc-main-nav">
          <div className="fc-main-nav__inner">

            {/* Logo */}
            <OfiLogo
              size="default"
              showTagline
              onClick={() => navigate('/dashboard')}
            />

            {/* Nav Links */}
            <nav className="fc-nav">
              <button
                className={`fc-nav__item ${activePage === 'dashboard' ? 'fc-nav__item--active' : ''}`}
                onClick={() => navigate('/dashboard')}
              >
                Dashboard
              </button>

              {/* AI Agents dropdown */}
              <div className="fc-nav__dropdown-wrapper" ref={agentsRef}>
                <button
                  className={`fc-nav__item ${activePage === 'chat' ? 'fc-nav__item--active' : ''}`}
                  onClick={() => setAgentsDropdownOpen(!agentsDropdownOpen)}
                >
                  AI Agents
                  <ChevronDown
                    size={14}
                    className={`fc-nav__chevron ${agentsDropdownOpen ? 'fc-nav__chevron--open' : ''}`}
                  />
                </button>

                {agentsDropdownOpen && (
                  <div className="fc-dropdown fc-dropdown--agents">
                    <div className="fc-dropdown__label">Select an AI Agent</div>
                    {AGENTS.map((agent) => (
                      <button
                        key={agent.id}
                        className="fc-dropdown__agent-item"
                        onClick={() => handleAgentClick(agent)}
                      >
                        <div
                          className="fc-dropdown__agent-icon"
                          style={{ background: agent.gradient }}
                        >
                          {agent.icon}
                        </div>
                        <div className="fc-dropdown__agent-info">
                          <div className="fc-dropdown__agent-name">{agent.title}</div>
                          <div className="fc-dropdown__agent-desc">{agent.subtitle}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                className={`fc-nav__item ${activePage === 'decisions' ? 'fc-nav__item--active' : ''}`}
                onClick={() => navigate('/decisions')}
              >
                Decisions
              </button>

              <button
                className="fc-nav__item"
                onClick={() => navigate('/chat')}
              >
                Network Insights
              </button>
            </nav>

            {/* Right actions: search + hamburger */}
            <div className="fc-nav__right">
              <button className="fc-nav__search-btn" title="Search">
                <Search size={18} />
              </button>

              {/* Hamburger */}
              <button
                className="fc-hamburger-btn"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                title="Menu"
                aria-label="Open sidebar menu"
              >
                {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>

          {/* Rainbow wave line */}
          <div className="fc-header__wave" />
        </div>
      </header>

      {/* ════════════════════════════════════════════════════
          Overlay backdrop
      ════════════════════════════════════════════════════ */}
      {sidebarOpen && (
        <div
          className="fc-sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ════════════════════════════════════════════════════
          Slide-in Sidebar
      ════════════════════════════════════════════════════ */}
      <aside
        ref={sidebarRef}
        className={`fc-sidebar ${sidebarOpen ? 'fc-sidebar--open' : ''}`}
      >
        {/* Sidebar header */}
        <div className="fc-sidebar__header">
          <OfiLogo size="small" showTagline={false} />
          <button
            className="fc-sidebar__close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* User card */}
        <div className="fc-sidebar__user-card">
          <div className="fc-sidebar__user-avatar">{userInitial}</div>
          <div className="fc-sidebar__user-info">
            <div className="fc-sidebar__user-email">
              {authData?.email || 'User'}
            </div>
            <div className="fc-sidebar__user-role">
              {authData?.role || 'Guest'}
            </div>
          </div>
        </div>

        <div className="fc-sidebar__divider" />

        {/* Navigation items */}
        <div className="fc-sidebar__section-label">Navigation</div>
        <nav className="fc-sidebar__nav">
          <button
            className={`fc-sidebar__item ${activePage === 'dashboard' ? 'fc-sidebar__item--active' : ''}`}
            onClick={() => handleNav('/dashboard')}
          >
            <div className="fc-sidebar__item-icon">
              <LayoutDashboard size={18} />
            </div>
            <span>Dashboard</span>
          </button>

          <button
            className={`fc-sidebar__item ${activePage === 'decisions' ? 'fc-sidebar__item--active' : ''}`}
            onClick={() => handleNav('/decisions')}
          >
            <div className="fc-sidebar__item-icon">
              <Bell size={18} />
            </div>
            <span>Decisions</span>
          </button>

          <button
            className={`fc-sidebar__item ${activePage === 'chat' ? 'fc-sidebar__item--active' : ''}`}
            onClick={() => handleNav('/chat')}
          >
            <div className="fc-sidebar__item-icon">
              <Network size={18} />
            </div>
            <span>AI Agents</span>
          </button>

          <button
            className="fc-sidebar__item"
            onClick={() => handleNav('/chat')}
          >
            <div className="fc-sidebar__item-icon">
              <Activity size={18} />
            </div>
            <span>Network Insights</span>
          </button>
        </nav>

        <div className="fc-sidebar__divider" />

        {/* Footer: logout */}
        <div className="fc-sidebar__footer">
          <button className="fc-sidebar__logout" onClick={handleLogoutClick}>
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}

export default TopHeader;
