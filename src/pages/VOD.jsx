import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as api from '../api';

export default function VOD() {
  const { connId } = useParams();
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [streams, setStreams] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [favorites, setFavorites] = useState(new Set());
  const [error, setError] = useState(null);

  const debounceTimer = useRef(null);
  const activeRequest = useRef(0);

  useEffect(() => {
    api.getVodCategories(connId).then(data => {
      setCategories(data || []);
    }).catch(() => {});

    api.getFavorites(connId).then(favs => {
      setFavorites(new Set(favs.filter(f => f.stream_type === 'movie').map(f => f.stream_id)));
    }).catch(() => {});
  }, [connId]);

  useEffect(() => {
    if (!selectedCategory) {
      setStreams([]);
      return;
    }
    setLoading(true);
    setSearchTerm('');
    setError(null);
    api.getVodStreams(connId, selectedCategory).then(data => {
      setStreams(data || []);
      setLoading(false);
    }).catch(err => { setError(err.message); setLoading(false); });
  }, [connId, selectedCategory]);

  const doSearch = useCallback((q) => {
    if (q.length < 2) {
      setStreams([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const requestId = ++activeRequest.current;
    api.searchStreams(connId, q, 'movie').then(data => {
      if (requestId !== activeRequest.current) return;
      setStreams(data || []);
      setLoading(false);
    }).catch(err => {
      if (requestId === activeRequest.current) { setError(err.message); setLoading(false); }
    });
  }, [connId]);

  const handleSearch = (e) => {
    const val = e.target.value;
    setSearchTerm(val);
    if (!selectedCategory) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => doSearch(val), 200);
    }
  };

  const toggleFavorite = async (stream) => {
    const id = stream.stream_id;
    if (favorites.has(id)) {
      await api.removeFavoriteByStream(connId, id, 'movie').catch(() => {});
      setFavorites(prev => { const s = new Set(prev); s.delete(id); return s; });
    } else {
      await api.addFavorite({
        connection_id: parseInt(connId),
        stream_id: id,
        stream_type: 'movie',
        name: stream.name,
        stream_icon: stream.stream_icon,
      }).catch(() => {});
      setFavorites(prev => new Set(prev).add(id));
    }
  };

  const filtered = selectedCategory && searchTerm
    ? streams.filter(s => s.name?.toLowerCase().includes(searchTerm.toLowerCase()))
    : streams;

  const showPrompt = !selectedCategory && !searchTerm && streams.length === 0 && !loading;

  return (
    <div className="flex h-full">
      <div className="w-56 flex-shrink-0 bg-surface-800/50 border-r border-surface-600/30 flex flex-col">
        <div className="p-3 border-b border-surface-600/30">
          <h2 className="text-sm font-semibold text-white">Categories</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
              !selectedCategory ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:text-white hover:bg-surface-700'
            }`}
          >
            All Movies
          </button>
          {categories.map(cat => (
            <button
              key={cat.category_id}
              onClick={() => setSelectedCategory(cat.category_id)}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors truncate ${
                selectedCategory === cat.category_id ? 'bg-accent/15 text-accent' : 'text-gray-400 hover:text-white hover:bg-surface-700'
              }`}
            >
              {cat.category_name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-4 border-b border-surface-600/30 flex items-center gap-4">
          <h1 className="text-lg font-semibold text-white">Movies</h1>
          <div className="flex-1 max-w-sm">
            <input
              type="text"
              value={searchTerm}
              onChange={handleSearch}
              placeholder={selectedCategory ? "Filter movies..." : "Search all movies..."}
              className="w-full bg-surface-700 border border-surface-600/50 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-accent/50 transition-colors"
            />
          </div>
          {filtered.length > 0 && <span className="text-gray-500 text-sm">{filtered.length} movies</span>}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="text-center py-20 text-red-400">
              <p className="font-semibold mb-1">Error loading data</p>
              <p className="text-sm text-red-400/70">{error}</p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
            </div>
          ) : showPrompt ? (
            <div className="text-center py-20 text-gray-500">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Search for movies or select a category
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-gray-500">No movies found</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {filtered.map(stream => (
                <div
                  key={stream.stream_id}
                  className="group bg-surface-800 rounded-xl border border-surface-600/30 hover:border-accent/30 transition-all cursor-pointer overflow-hidden"
                  onClick={() => navigate(`/player/${connId}/movie/${stream.stream_id}`, { state: { containerExt: stream.container_extension, title: stream.name, streamIcon: stream.stream_icon } })}
                >
                  <div className="aspect-[2/3] bg-surface-700 relative overflow-hidden">
                    {stream.stream_icon ? (
                      <img
                        src={stream.stream_icon}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                        </svg>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <svg className="w-12 h-12 text-white drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                    {stream.rating && (
                      <div className="absolute top-2 right-2 bg-black/60 text-yellow-400 text-xs px-1.5 py-0.5 rounded">
                        {parseFloat(stream.rating).toFixed(1)}
                      </div>
                    )}
                  </div>
                  <div className="p-2.5 flex items-start gap-2">
                    <p className="text-xs text-gray-300 line-clamp-2 flex-1">{stream.name}</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(stream); }}
                      className={`flex-shrink-0 p-0.5 transition-colors ${favorites.has(stream.stream_id) ? 'text-red-400' : 'text-gray-600 hover:text-gray-400'}`}
                    >
                      <svg className="w-3.5 h-3.5" fill={favorites.has(stream.stream_id) ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
