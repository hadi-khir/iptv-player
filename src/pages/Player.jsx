import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import VideoPlayer from '../components/VideoPlayer';
import * as api from '../api';

export default function Player() {
  const { connId, type, streamId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const containerExt = location.state?.containerExt;
  const streamTitle = location.state?.title;
  const streamIcon = location.state?.streamIcon;
  const seriesId = location.state?.seriesId || null;
  const [epg, setEpg] = useState(null);
  const [streamUrls, setStreamUrls] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteId, setFavoriteId] = useState(null);
  const [savedPosition, setSavedPosition] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setStreamUrls(null);

    // Fetch stream URLs from backend, passing container extension if known
    api.getStreamUrls(connId, type, streamId, containerExt)
      .then(data => {
        setStreamUrls(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });

    if (type === 'live') {
      api.getEpg(connId, streamId).then(data => {
        setEpg(data?.epg_listings || []);
      }).catch(() => {});
    }

    // Check if favorited (only for live channels and movies, not series episodes)
    if (type === 'live' || type === 'movie') {
      api.getFavorites(connId).then(favs => {
        const fav = favs.find(f => f.stream_id === parseInt(streamId) && f.stream_type === type);
        if (fav) {
          setIsFavorite(true);
          setFavoriteId(fav.id);
        }
      }).catch(() => {});
    }

    // Load saved watch position for VOD content
    if (type !== 'live') {
      api.getWatchProgress(connId, streamId, type).then(data => {
        if (data?.position > 0) setSavedPosition(data.position);
      }).catch(() => {});
    }

    // Record that we started watching
    api.saveWatchProgress({
      connection_id: parseInt(connId),
      stream_id: parseInt(streamId),
      stream_type: type,
      series_id: seriesId,
      name: streamTitle || `Stream ${streamId}`,
      stream_icon: streamIcon || '',
      position: 0,
      duration: 0,
    }).catch(() => {});
  }, [connId, type, streamId]);

  const handleProgress = useCallback((position, duration) => {
    api.saveWatchProgress({
      connection_id: parseInt(connId),
      stream_id: parseInt(streamId),
      stream_type: type,
      series_id: seriesId,
      name: streamTitle || `Stream ${streamId}`,
      stream_icon: streamIcon || '',
      position,
      duration,
    }).catch(() => {});
  }, [connId, streamId, type, seriesId, streamTitle, streamIcon]);

  const toggleFavorite = async () => {
    if (isFavorite && favoriteId) {
      await api.removeFavorite(favoriteId).catch(() => {});
      setIsFavorite(false);
      setFavoriteId(null);
    } else {
      const result = await api.addFavorite({
        connection_id: parseInt(connId),
        stream_id: parseInt(streamId),
        stream_type: type,
        name: streamTitle || `Stream ${streamId}`,
        stream_icon: streamIcon || '',
      }).catch(() => {});
      if (result?.id) {
        setIsFavorite(true);
        setFavoriteId(result.id);
      }
    }
  };

  const currentEpg = epg?.find(e => {
    const now = Date.now() / 1000;
    return e.start_timestamp <= now && e.stop_timestamp >= now;
  });

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-surface-900/90 backdrop-blur-sm z-10">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          {currentEpg && (
            <p className="text-sm text-white truncate">{currentEpg.title}</p>
          )}
          <p className="text-xs text-gray-500 truncate">
            {type === 'live' ? 'Live TV' : type === 'movie' ? 'Movie' : 'Series'}
            {streamUrls && ` — Stream ${streamId}`}
          </p>
        </div>
        {(type === 'live' || type === 'movie') && (
          <button
            onClick={toggleFavorite}
            className={`p-2 rounded-lg transition-colors ${isFavorite ? 'text-red-400' : 'text-gray-400 hover:text-white'}`}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <svg className="w-5 h-5" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </button>
        )}
      </div>

      {/* Video player */}
      <div className="flex-1 flex items-center justify-center bg-black min-h-0">
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
            <p className="text-gray-500 text-sm">Loading stream...</p>
          </div>
        ) : error ? (
          <div className="text-center p-6">
            <p className="text-red-400 mb-3">{error}</p>
            <button
              onClick={() => navigate(-1)}
              className="px-4 py-2 bg-surface-700 hover:bg-surface-600 rounded-lg text-sm text-white transition-colors"
            >
              Go Back
            </button>
          </div>
        ) : streamUrls ? (
          <VideoPlayer
            urls={streamUrls}
            type={type}
            connId={connId}
            streamId={streamId}
            initialPosition={savedPosition}
            onProgress={handleProgress}
          />
        ) : null}
      </div>

      {/* EPG info for live channels */}
      {type === 'live' && epg && epg.length > 0 && (
        <div className="bg-surface-900 border-t border-surface-600/30 p-4 max-h-48 overflow-y-auto">
          <h3 className="text-sm font-semibold text-white mb-3">Program Guide</h3>
          <div className="space-y-2">
            {epg.slice(0, 10).map((item, i) => {
              const start = new Date(item.start_timestamp * 1000);
              const end = new Date(item.stop_timestamp * 1000);
              const now = Date.now() / 1000;
              const isCurrent = item.start_timestamp <= now && item.stop_timestamp >= now;

              return (
                <div
                  key={i}
                  className={`flex items-start gap-3 p-2 rounded-lg ${isCurrent ? 'bg-accent/10 border border-accent/20' : ''}`}
                >
                  <span className="text-xs text-gray-500 whitespace-nowrap tabular-nums mt-0.5">
                    {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {' - '}
                    {end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${isCurrent ? 'text-accent font-medium' : 'text-gray-300'}`}>
                      {item.title}
                    </p>
                    {item.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{item.description}</p>
                    )}
                  </div>
                  {isCurrent && (
                    <span className="text-xs text-accent bg-accent/10 px-2 py-0.5 rounded flex-shrink-0">NOW</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
