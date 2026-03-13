import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';

export default function Favorites() {
  const navigate = useNavigate();
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api.getFavorites().then(data => {
      setFavorites(data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const removeFav = async (id) => {
    await api.removeFavorite(id).catch(() => {});
    setFavorites(prev => prev.filter(f => f.id !== id));
  };

  const handleClick = (fav) => {
    if (fav.stream_type === 'series') {
      navigate(`/series/${fav.connection_id}/${fav.stream_id}`);
    } else {
      navigate(`/player/${fav.connection_id}/${fav.stream_type}/${fav.stream_id}`);
    }
  };

  const filtered = useMemo(() => {
    return filter === 'all' ? favorites : favorites.filter(f => f.stream_type === filter);
  }, [favorites, filter]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Favorites</h1>
        <div className="flex gap-2">
          {['all', 'live', 'movie', 'series'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                filter === f ? 'bg-accent text-white' : 'bg-surface-700 text-gray-400 hover:text-white'
              }`}
            >
              {f === 'all' ? 'All' : f === 'live' ? 'Live TV' : f === 'movie' ? 'Movies' : 'Series'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <svg className="w-12 h-12 mx-auto text-gray-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
          <p className="text-gray-500">No favorites yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map(fav => (
            <div
              key={fav.id}
              className="group bg-surface-800 rounded-xl border border-surface-600/30 hover:border-accent/30 transition-all cursor-pointer overflow-hidden"
              onClick={() => handleClick(fav)}
            >
              <div className={`${fav.stream_type === 'live' ? 'aspect-video' : 'aspect-[2/3]'} bg-surface-700 relative overflow-hidden`}>
                {fav.stream_icon ? (
                  <img
                    src={fav.stream_icon}
                    alt=""
                    className={`w-full h-full ${fav.stream_type === 'live' ? 'object-contain p-3' : 'object-cover'}`}
                    loading="lazy"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    {fav.stream_type === 'series' ? (
                      <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    ) : (
                      <svg className="w-8 h-8 text-gray-600" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    )}
                  </div>
                )}
                <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded capitalize">
                  {fav.stream_type === 'live' ? 'Live TV' : fav.stream_type === 'movie' ? 'Movie' : 'Series'}
                </div>
              </div>
              <div className="p-2.5 flex items-start gap-2">
                <p className="text-xs text-gray-300 line-clamp-2 flex-1">{fav.name || `Stream ${fav.stream_id}`}</p>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFav(fav.id); }}
                  className="flex-shrink-0 text-red-400 hover:text-red-300 p-0.5 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
