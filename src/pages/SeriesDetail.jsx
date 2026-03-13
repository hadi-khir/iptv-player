import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as api from '../api';

export default function SeriesDetail() {
  const { connId, seriesId } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteId, setFavoriteId] = useState(null);

  useEffect(() => {
    api.getSeriesInfo(connId, seriesId).then(data => {
      setInfo(data);
      const seasons = data?.episodes ? Object.keys(data.episodes) : [];
      if (seasons.length > 0) setSelectedSeason(seasons[0]);
      setLoading(false);
    }).catch(() => setLoading(false));

    api.getFavorites(connId).then(favs => {
      const fav = favs.find(f => f.stream_id === parseInt(seriesId) && f.stream_type === 'series');
      if (fav) {
        setIsFavorite(true);
        setFavoriteId(fav.id);
      }
    }).catch(() => {});
  }, [connId, seriesId]);

  const toggleFavorite = async () => {
    if (isFavorite && favoriteId) {
      await api.removeFavorite(favoriteId).catch(() => {});
      setIsFavorite(false);
      setFavoriteId(null);
    } else {
      const seriesInfo = info?.info || {};
      const result = await api.addFavorite({
        connection_id: parseInt(connId),
        stream_id: parseInt(seriesId),
        stream_type: 'series',
        name: seriesInfo.name || 'Unknown Series',
        stream_icon: seriesInfo.cover || '',
      }).catch(() => {});
      if (result?.id) {
        setIsFavorite(true);
        setFavoriteId(result.id);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!info) {
    return <div className="flex items-center justify-center h-full text-gray-500">Series not found</div>;
  }

  const seasons = info.episodes ? Object.keys(info.episodes).sort((a, b) => parseInt(a) - parseInt(b)) : [];
  const episodes = selectedSeason && info.episodes?.[selectedSeason] ? info.episodes[selectedSeason] : [];
  const seriesInfo = info.info || {};

  return (
    <div className="h-full overflow-y-auto">
      {/* Hero banner */}
      <div className="relative h-64 bg-surface-800">
        {seriesInfo.backdrop_path && (
          <img
            src={`https://image.tmdb.org/t/p/w1280${seriesInfo.backdrop_path}`}
            alt=""
            className="w-full h-full object-cover opacity-40"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface-900 via-surface-900/50 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6 flex gap-5">
          {seriesInfo.cover && (
            <img
              src={seriesInfo.cover}
              alt=""
              className="w-32 h-48 object-cover rounded-lg shadow-xl flex-shrink-0 -mb-12 relative z-10"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          )}
          <div className="flex-1 min-w-0 pb-2">
            <div className="flex items-start gap-3">
              <h1 className="text-2xl font-bold text-white flex-1">{seriesInfo.name || info.info?.name || 'Unknown'}</h1>
              <button
                onClick={toggleFavorite}
                className={`flex-shrink-0 p-2 rounded-lg transition-colors ${isFavorite ? 'bg-red-500/15 text-red-400' : 'bg-white/10 text-gray-400 hover:text-white hover:bg-white/15'}`}
                title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <svg className="w-5 h-5" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-3 mt-2 text-sm text-gray-400">
              {seriesInfo.releaseDate && <span>{seriesInfo.releaseDate}</span>}
              {seriesInfo.rating && <span className="text-yellow-400">{seriesInfo.rating}/10</span>}
              {seriesInfo.genre && <span>{seriesInfo.genre}</span>}
            </div>
            {seriesInfo.plot && (
              <p className="text-sm text-gray-400 mt-3 line-clamp-3 max-w-2xl">{seriesInfo.plot}</p>
            )}
          </div>
        </div>
      </div>

      {/* Season tabs + episodes */}
      <div className="p-6 pt-16">
        {seasons.length > 0 && (
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            {seasons.map(season => (
              <button
                key={season}
                onClick={() => setSelectedSeason(season)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedSeason === season
                    ? 'bg-accent text-white'
                    : 'bg-surface-700 text-gray-400 hover:text-white hover:bg-surface-600'
                }`}
              >
                Season {season}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {episodes.map((ep) => (
            <div
              key={ep.id}
              className="flex items-center gap-4 bg-surface-800 rounded-xl p-4 border border-surface-600/30 hover:border-accent/30 transition-colors cursor-pointer"
              onClick={() => navigate(`/player/${connId}/series/${ep.id}`, { state: { containerExt: ep.container_extension, title: ep.title } })}
            >
              <div className="w-40 aspect-video bg-surface-700 rounded-lg overflow-hidden flex-shrink-0 relative group">
                {ep.info?.movie_image ? (
                  <img src={ep.info.movie_image} alt="" className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-gray-600" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  <svg className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                </div>
                {ep.info?.duration && (
                  <span className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1 rounded">{ep.info.duration}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-white">
                  E{ep.episode_num || '?'}: {ep.title || `Episode ${ep.episode_num}`}
                </h3>
                {ep.info?.plot && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{ep.info.plot}</p>
                )}
                {ep.info?.releasedate && (
                  <p className="text-xs text-gray-600 mt-1">{ep.info.releasedate}</p>
                )}
              </div>
              <svg className="w-5 h-5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
