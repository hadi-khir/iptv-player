import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';

export default function Settings() {
  const { user } = useAuth();
  const { connections, refreshConnections } = useOutletContext();
  const [connInfos, setConnInfos] = useState({});
  const [loadingInfo, setLoadingInfo] = useState({});

  const loadInfo = async (connId) => {
    setLoadingInfo(prev => ({ ...prev, [connId]: true }));
    try {
      const info = await api.getConnectionInfo(connId);
      setConnInfos(prev => ({ ...prev, [connId]: info }));
    } catch (err) {
      setConnInfos(prev => ({ ...prev, [connId]: { error: err.message } }));
    }
    setLoadingInfo(prev => ({ ...prev, [connId]: false }));
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this connection? This will also remove all favorites for this connection.')) return;
    try {
      await api.deleteConnection(id);
      await refreshConnections();
    } catch (err) {
      alert(err.message);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    return new Date(parseInt(timestamp) * 1000).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Settings</h1>

      {/* Account */}
      <section className="mb-8">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">Account</h2>
        <div className="bg-surface-800 rounded-xl p-5 border border-surface-600/30">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center text-accent text-lg font-semibold">
              {user?.username?.[0]?.toUpperCase()}
            </div>
            <div>
              <p className="text-white font-medium">{user?.username}</p>
              <p className="text-gray-500 text-sm">User ID: {user?.id}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Connections */}
      <section>
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">Connections</h2>
        <div className="space-y-3">
          {connections.map(conn => {
            const info = connInfos[conn.id];
            return (
              <div key={conn.id} className="bg-surface-800 rounded-xl p-5 border border-surface-600/30">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-white font-medium">{conn.name}</h3>
                    <p className="text-gray-500 text-sm">{conn.server_url}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => loadInfo(conn.id)}
                      disabled={loadingInfo[conn.id]}
                      className="bg-surface-700 hover:bg-surface-600 text-gray-300 px-3 py-1 rounded-lg text-sm transition-colors disabled:opacity-50"
                    >
                      {loadingInfo[conn.id] ? 'Loading...' : 'Check Status'}
                    </button>
                    <button
                      onClick={() => handleDelete(conn.id)}
                      className="text-gray-500 hover:text-red-400 px-3 py-1 rounded-lg text-sm transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {info && !info.error && info.user_info && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-surface-600/30">
                    <div>
                      <p className="text-xs text-gray-500">Status</p>
                      <p className={`text-sm font-medium ${info.user_info.status === 'Active' ? 'text-green-400' : 'text-red-400'}`}>
                        {info.user_info.status}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Expires</p>
                      <p className="text-sm text-gray-300">{formatDate(info.user_info.exp_date)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Active Connections</p>
                      <p className="text-sm text-gray-300">{info.user_info.active_cons}/{info.user_info.max_connections}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Created</p>
                      <p className="text-sm text-gray-300">{formatDate(info.user_info.created_at)}</p>
                    </div>
                  </div>
                )}

                {info?.error && (
                  <p className="text-red-400 text-sm mt-2">{info.error}</p>
                )}
              </div>
            );
          })}

          {connections.length === 0 && (
            <div className="text-center py-10 text-gray-500 text-sm">
              No connections configured. Add one from the Dashboard.
            </div>
          )}
        </div>
      </section>

      {/* About */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">About</h2>
        <div className="bg-surface-800 rounded-xl p-5 border border-surface-600/30">
          <p className="text-gray-400 text-sm">IPTV Player v1.0.0</p>
          <p className="text-gray-500 text-xs mt-1">Web-based IPTV player with Xtream Codes support</p>
          <div className="mt-3 text-xs text-gray-600 space-y-1">
            <p>Keyboard shortcuts (in player):</p>
            <p>Space/K - Play/Pause | F - Fullscreen | M - Mute</p>
            <p>Arrow Left/Right - Seek | Arrow Up/Down - Volume</p>
          </div>
        </div>
      </section>
    </div>
  );
}
