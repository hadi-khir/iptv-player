import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';

const navItems = [
  { to: '/', icon: 'home', label: 'Home' },
  { to: '/favorites', icon: 'heart', label: 'Favorites' },
  { to: '/settings', icon: 'settings', label: 'Settings' },
];

const icons = {
  home: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
    </svg>
  ),
  heart: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
    </svg>
  ),
  settings: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  tv: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  film: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
    </svg>
  ),
  list: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  search: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [connections, setConnections] = useState([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    api.getConnections().then(setConnections).catch(() => {});
  }, []);

  return (
    <div className="flex h-screen bg-surface-900">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-16' : 'w-60'} flex-shrink-0 bg-surface-800 flex flex-col border-r border-surface-600/30 transition-all duration-200`}>
        <div className="p-4 flex items-center gap-3 border-b border-surface-600/30">
          {!collapsed && <h1 className="text-lg font-semibold text-white tracking-tight">IPTV Player</h1>}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="ml-auto text-gray-400 hover:text-white p-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={collapsed ? "M9 5l7 7-7 7" : "M15 19l-7-7 7-7"} />
            </svg>
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-accent/15 text-accent'
                    : 'text-gray-400 hover:text-white hover:bg-surface-700'
                }`
              }
            >
              {icons[item.icon]}
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}

          {connections.length > 0 && (
            <>
              <div className={`pt-4 pb-1 ${collapsed ? 'px-2' : 'px-3'}`}>
                {!collapsed && <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Connections</p>}
                {collapsed && <hr className="border-surface-600/30" />}
              </div>
              {connections.map(conn => (
                <div key={conn.id} className="space-y-0.5">
                  {!collapsed && (
                    <p className="px-3 pt-2 pb-1 text-xs font-medium text-gray-500 truncate">{conn.name}</p>
                  )}
                  <NavLink
                    to={`/live/${conn.id}`}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        isActive ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:text-white hover:bg-surface-700'
                      }`
                    }
                  >
                    {icons.tv}
                    {!collapsed && <span>Live TV</span>}
                  </NavLink>
                  <NavLink
                    to={`/vod/${conn.id}`}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        isActive ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:text-white hover:bg-surface-700'
                      }`
                    }
                  >
                    {icons.film}
                    {!collapsed && <span>Movies</span>}
                  </NavLink>
                  <NavLink
                    to={`/series/${conn.id}`}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        isActive ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:text-white hover:bg-surface-700'
                      }`
                    }
                  >
                    {icons.list}
                    {!collapsed && <span>Series</span>}
                  </NavLink>
                  <NavLink
                    to={`/search/${conn.id}`}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        isActive ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:text-white hover:bg-surface-700'
                      }`
                    }
                  >
                    {icons.search}
                    {!collapsed && <span>Search</span>}
                  </NavLink>
                </div>
              ))}
            </>
          )}
        </nav>

        <div className="p-3 border-t border-surface-600/30">
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-medium flex-shrink-0">
              {user?.username?.[0]?.toUpperCase()}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{user?.username}</p>
                <button onClick={() => { logout(); navigate('/login'); }} className="text-xs text-gray-500 hover:text-red-400 transition-colors">
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet context={{ connections, refreshConnections: () => api.getConnections().then(setConnections) }} />
      </main>
    </div>
  );
}
