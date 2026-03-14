import { useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import * as api from '../api';

export default function Dashboard() {
  const { connections, refreshConnections } = useOutletContext();
  const navigate = useNavigate();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', server_url: '', username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);

  useEffect(() => {
    api.getWatchHistory().then(setHistory).catch(() => {});
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.addConnection(form);
      setForm({ name: '', server_url: '', username: '', password: '' });
      setShowAdd(false);
      await refreshConnections();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this connection?')) return;
    try {
      await api.deleteConnection(id);
      await refreshConnections();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Manage your IPTV connections</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {showAdd ? 'Cancel' : '+ Add Connection'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-surface-800 rounded-xl p-5 mb-6 border border-surface-600/30 space-y-4">
          <h2 className="text-lg font-semibold text-white">Add Xtream Codes Connection</h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">{error}</div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Connection Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-surface-700 border border-surface-600/50 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-accent/50 transition-colors text-sm"
                placeholder="e.g. My IPTV"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Server URL</label>
              <input
                type="url"
                value={form.server_url}
                onChange={(e) => setForm({ ...form, server_url: e.target.value })}
                className="w-full bg-surface-700 border border-surface-600/50 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-accent/50 transition-colors text-sm"
                placeholder="http://example.com:8080"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Username</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="w-full bg-surface-700 border border-surface-600/50 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-accent/50 transition-colors text-sm"
                placeholder="Xtream username"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full bg-surface-700 border border-surface-600/50 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:border-accent/50 transition-colors text-sm"
                placeholder="Xtream password"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="bg-accent hover:bg-accent-hover text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? 'Connecting...' : 'Add Connection'}
          </button>
        </form>
      )}

      {/* Recently Watched */}
      {history.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Recently Watched</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {history.map((item) => {
              const progress = item.duration > 0 ? Math.min((item.position / item.duration) * 100, 100) : 0;
              return (
                <button
                  key={item.id}
                  onClick={() =>
                    navigate(`/player/${item.connection_id}/${item.stream_type}/${item.stream_id}`, {
                      state: { title: item.name, streamIcon: item.stream_icon },
                    })
                  }
                  className="bg-surface-800 rounded-lg border border-surface-600/30 hover:border-accent/40 transition-colors text-left group overflow-hidden"
                >
                  <div className="aspect-video bg-surface-700 flex items-center justify-center relative overflow-hidden">
                    {item.stream_icon ? (
                      <img
                        src={item.stream_icon}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                      </svg>
                    )}
                    {/* Play overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <svg className="w-10 h-10 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                    {/* Progress bar */}
                    {progress > 0 && item.stream_type !== 'live' && (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                        <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-sm text-white truncate font-medium">{item.name}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        item.stream_type === 'live' ? 'bg-red-500/15 text-red-400' :
                        item.stream_type === 'movie' ? 'bg-blue-500/15 text-blue-400' :
                        'bg-purple-500/15 text-purple-400'
                      }`}>
                        {item.stream_type === 'live' ? 'Live' : item.stream_type === 'movie' ? 'Movie' : 'Series'}
                      </span>
                      <span className="text-xs text-gray-500 truncate">{item.connection_name}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {connections.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-700 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-white mb-1">No connections yet</h3>
          <p className="text-gray-500 text-sm">Add an Xtream Codes connection to get started</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className="bg-surface-800 rounded-xl p-5 border border-surface-600/30 hover:border-surface-500/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">{conn.name}</h3>
                  <p className="text-gray-500 text-sm mt-0.5">{conn.server_url}</p>
                  <p className="text-gray-600 text-xs mt-1">User: {conn.username}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/live/${conn.id}`)}
                    className="bg-accent/10 hover:bg-accent/20 text-accent px-3 py-1.5 rounded-lg text-sm transition-colors"
                  >
                    Live TV
                  </button>
                  <button
                    onClick={() => navigate(`/vod/${conn.id}`)}
                    className="bg-surface-700 hover:bg-surface-600 text-gray-300 px-3 py-1.5 rounded-lg text-sm transition-colors"
                  >
                    Movies
                  </button>
                  <button
                    onClick={() => navigate(`/series/${conn.id}`)}
                    className="bg-surface-700 hover:bg-surface-600 text-gray-300 px-3 py-1.5 rounded-lg text-sm transition-colors"
                  >
                    Series
                  </button>
                  <button
                    onClick={() => handleDelete(conn.id)}
                    className="text-gray-500 hover:text-red-400 p-1.5 transition-colors"
                    title="Delete connection"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
