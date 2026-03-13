import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as api from '../api';

export default function Search() {
  const { connId } = useParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const debounceTimer = useState({ current: null })[0];

  const doSearch = useCallback((q) => {
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    api.searchStreams(connId, q).then(data => {
      setResults(data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [connId]);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => doSearch(val), 400);
  };

  const getPlayerUrl = (item) => {
    const type = item.type === 'series' ? 'series' : item.type;
    const id = item.stream_id || item.series_id;
    if (item.type === 'series') return `/series/${connId}/${item.series_id}`;
    return `/player/${connId}/${type}/${id}`;
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Search</h1>

      <div className="mb-6">
        <input
          type="text"
          value={query}
          onChange={handleChange}
          placeholder="Search channels, movies, series..."
          className="w-full bg-surface-800 border border-surface-600/50 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-accent/50 focus:ring-1 focus:ring-accent/25 transition-colors"
          autoFocus
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
        </div>
      ) : !searched ? (
        <div className="text-center py-20 text-gray-500">
          Type at least 2 characters to search
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-20 text-gray-500">No results found</div>
      ) : (
        <div className="space-y-2">
          {results.map((item, i) => (
            <div
              key={`${item.type}-${item.stream_id || item.series_id}-${i}`}
              className="flex items-center gap-4 bg-surface-800 rounded-xl p-3 border border-surface-600/30 hover:border-accent/30 transition-colors cursor-pointer"
              onClick={() => navigate(getPlayerUrl(item))}
            >
              <div className="w-14 h-14 bg-surface-700 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                {item.stream_icon || item.cover ? (
                  <img
                    src={item.stream_icon || item.cover}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                ) : (
                  <svg className="w-6 h-6 text-gray-600" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{item.name}</p>
                <span className={`text-xs px-2 py-0.5 rounded mt-1 inline-block ${
                  item.type === 'live' ? 'bg-green-500/10 text-green-400' :
                  item.type === 'movie' ? 'bg-blue-500/10 text-blue-400' :
                  'bg-purple-500/10 text-purple-400'
                }`}>
                  {item.type === 'live' ? 'Live' : item.type === 'movie' ? 'Movie' : 'Series'}
                </span>
              </div>
              <svg className="w-5 h-5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
