import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as api from '../api';

export default function Series() {
  const { connId } = useParams();
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [series, setSeries] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [favorites, setFavorites] = useState(new Set());

  useEffect(() => {
    api.getSeriesCategories(connId).then(data => {
      setCategories(data || []);
      setLoading(false);
    }).catch(() => setLoading(false));

    api.getFavorites(connId).then(favs => {
      setFavorites(new Set(favs.filter(f => f.stream_type === 'series').map(f => f.stream_id)));
    }).catch(() => {});
  }, [connId]);

  useEffect(() => {
    setLoading(true);
    api.getSeriesList(connId, selectedCategory).then(data => {
      setSeries(data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [connId, selectedCategory]);

  const toggleFavorite = async (s) => {
    const id = s.series_id;
    if (favorites.has(id)) {
      await api.removeFavoriteByStream(connId, id, 'series').catch(() => {});
      setFavorites(prev => { const next = new Set(prev); next.delete(id); return next; });
    } else {
      await api.addFavorite({
        connection_id: parseInt(connId),
        stream_id: id,
        stream_type: 'series',
        name: s.name,
        stream_icon: s.cover || '',
      }).catch(() => {});
      setFavorites(prev => new Set(prev).add(id));
    }
  };

  const filtered = searchTerm
    ? series.filter(s => s.name?.toLowerCase().includes(searchTerm.toLowerCase()))
    : series;

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
            All Series
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
          <h1 className="text-lg font-semibold text-white">Series</h1>
          <div className="flex-1 max-w-sm">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter series..."
              className="w-full bg-surface-700 border border-surface-600/50 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-accent/50 transition-colors"
            />
          </div>
          <span className="text-gray-500 text-sm">{filtered.length} series</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-gray-500">No series found</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {filtered.map(s => (
                <div
                  key={s.series_id}
                  className="group bg-surface-800 rounded-xl border border-surface-600/30 hover:border-accent/30 transition-all cursor-pointer overflow-hidden"
                  onClick={() => navigate(`/series/${connId}/${s.series_id}`)}
                >
                  <div className="aspect-[2/3] bg-surface-700 relative overflow-hidden">
                    {s.cover ? (
                      <img src={s.cover} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                      </div>
                    )}
                    {s.rating && (
                      <div className="absolute top-2 right-2 bg-black/60 text-yellow-400 text-xs px-1.5 py-0.5 rounded">
                        {parseFloat(s.rating).toFixed(1)}
                      </div>
                    )}
                  </div>
                  <div className="p-2.5 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-300 line-clamp-2">{s.name}</p>
                      {s.num && <p className="text-xs text-gray-500 mt-1">{s.num} seasons</p>}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(s); }}
                      className={`flex-shrink-0 p-0.5 transition-colors ${favorites.has(s.series_id) ? 'text-red-400' : 'text-gray-600 hover:text-gray-400'}`}
                    >
                      <svg className="w-3.5 h-3.5" fill={favorites.has(s.series_id) ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
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
