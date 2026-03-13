import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';

export default function VideoPlayer({ urls, type = 'live', connId, streamId }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [status, setStatus] = useState('loading'); // loading, playing, error
  const [statusMsg, setStatusMsg] = useState('Connecting...');
  const containerRef = useRef(null);
  const hideTimer = useRef(null);
  const attemptRef = useRef(0);

  const cleanup = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  // Try loading a URL with HLS.js
  const tryHls = useCallback((url, onSuccess, onFail) => {
    const video = videoRef.current;
    if (!video) return onFail();

    cleanup();

    if (!Hls.isSupported()) {
      // Safari native HLS
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        const onLoaded = () => {
          video.removeEventListener('loadeddata', onLoaded);
          video.removeEventListener('error', onErr);
          onSuccess();
          video.play().catch(() => {});
        };
        const onErr = () => {
          video.removeEventListener('loadeddata', onLoaded);
          video.removeEventListener('error', onErr);
          onFail();
        };
        video.addEventListener('loadeddata', onLoaded);
        video.addEventListener('error', onErr);
        return;
      }
      return onFail();
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: type === 'live',
      backBufferLength: type === 'live' ? 30 : 90,
      maxBufferLength: type === 'live' ? 15 : 60,
      maxMaxBufferLength: type === 'live' ? 30 : 120,
      liveSyncDurationCount: 3,
      startLevel: -1, // auto quality
      fragLoadingTimeOut: 20000,
      manifestLoadingTimeOut: 15000,
      levelLoadingTimeOut: 15000,
    });

    let settled = false;

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (!settled) {
        settled = true;
        onSuccess();
        video.play().catch(() => {});
      }
    });

    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal && !settled) {
        settled = true;
        hls.destroy();
        hlsRef.current = null;
        onFail();
      } else if (data.fatal && settled) {
        // Already playing, try to recover
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setTimeout(() => hls.startLoad(), 2000);
        }
      }
    });

    hls.loadSource(url);
    hls.attachMedia(video);
    hlsRef.current = hls;

    // Timeout: if HLS doesn't load within 12s, fail
    setTimeout(() => {
      if (!settled) {
        settled = true;
        hls.destroy();
        hlsRef.current = null;
        onFail();
      }
    }, 12000);
  }, [type, cleanup]);

  // Try loading a direct URL (mp4, ts, etc) into the video element
  const tryDirect = useCallback((url, onSuccess, onFail) => {
    const video = videoRef.current;
    if (!video) return onFail();

    cleanup();

    let settled = false;

    const onCanPlay = () => {
      if (!settled) {
        settled = true;
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onErr);
        onSuccess();
        video.play().catch(() => {});
      }
    };
    const onErr = () => {
      if (!settled) {
        settled = true;
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onErr);
        video.src = '';
        onFail();
      }
    };

    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('error', onErr);
    video.src = url;
    video.load();

    // Timeout
    setTimeout(() => {
      if (!settled) {
        settled = true;
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onErr);
        video.src = '';
        onFail();
      }
    }, 15000);
  }, [cleanup]);

  // Main effect: try URLs in order of preference
  useEffect(() => {
    if (!urls) return;

    setStatus('loading');
    setStatusMsg('Connecting to stream...');
    attemptRef.current++;
    const thisAttempt = attemptRef.current;

    const isStale = () => attemptRef.current !== thisAttempt;

    // Build ordered list of attempts
    const attempts = [];

    // 1. Always try HLS first (works for live, and most xtream servers support it for VOD too)
    if (urls.hls) {
      attempts.push({ label: 'HLS stream', method: 'hls', url: urls.hls });
    }

    // 2. For VOD/series: try mp4 (browser-playable, many servers transcode)
    if (urls.mp4 && type !== 'live') {
      attempts.push({ label: 'MP4 stream', method: 'direct', url: urls.mp4 });
    }

    // 3. TS container (generally browser-playable)
    if (urls.ts) {
      attempts.push({ label: 'TS stream', method: 'direct', url: urls.ts });
    }

    // 4. Direct URL with original extension (might be mkv which won't play, but worth trying)
    if (urls.direct && urls.direct !== urls.mp4 && urls.direct !== urls.ts) {
      attempts.push({ label: 'Direct stream', method: 'direct', url: urls.direct });
    }

    let idx = 0;

    const tryNext = () => {
      if (isStale()) return;
      if (idx >= attempts.length) {
        setStatus('error');
        setStatusMsg('Could not play this stream. The server may not support web playback for this format.');
        return;
      }

      const attempt = attempts[idx];
      idx++;

      setStatusMsg(`Trying ${attempt.label}... (${idx}/${attempts.length})`);

      const onSuccess = () => {
        if (isStale()) return;
        setStatus('playing');
      };

      const onFail = () => {
        if (isStale()) return;
        tryNext();
      };

      if (attempt.method === 'hls') {
        tryHls(attempt.url, onSuccess, onFail);
      } else {
        tryDirect(attempt.url, onSuccess, onFail);
      }
    };

    tryNext();

    return cleanup;
  }, [urls, type, tryHls, tryDirect, cleanup]);

  // Video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrentTime(video.currentTime);
    const onDuration = () => setDuration(video.duration);
    const onVolumeChange = () => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onWaiting = () => {
      if (status === 'playing') {
        setStatus('loading');
        setStatusMsg('Buffering...');
      }
    };
    const onPlaying = () => setStatus('playing');

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('durationchange', onDuration);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('durationchange', onDuration);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
    };
  }, [status]);

  const resetHideTimer = () => {
    setShowControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (playing) setShowControls(false);
    }, 3000);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };

  const toggleMute = () => {
    videoRef.current.muted = !videoRef.current.muted;
  };

  const changeVolume = (e) => {
    const v = parseFloat(e.target.value);
    videoRef.current.volume = v;
    if (v > 0) videoRef.current.muted = false;
  };

  const seek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    videoRef.current.currentTime = pct * duration;
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  };

  const formatTime = (s) => {
    if (!isFinite(s)) return '--:--';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Keyboard controls
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      switch (e.key) {
        case ' ':
        case 'k': e.preventDefault(); togglePlay(); break;
        case 'f': e.preventDefault(); toggleFullscreen(); break;
        case 'm': e.preventDefault(); toggleMute(); break;
        case 'ArrowRight':
          e.preventDefault();
          if (videoRef.current) videoRef.current.currentTime += 10;
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (videoRef.current) videoRef.current.currentTime -= 10;
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (videoRef.current) videoRef.current.volume = Math.min(1, videoRef.current.volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (videoRef.current) videoRef.current.volume = Math.max(0, videoRef.current.volume - 0.1);
          break;
      }
      resetHideTimer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, duration]);

  return (
    <div
      ref={containerRef}
      className="relative bg-black w-full aspect-video group"
      onMouseMove={resetHideTimer}
      onMouseLeave={() => playing && setShowControls(false)}
    >
      <video
        ref={videoRef}
        className="w-full h-full"
        onClick={togglePlay}
        playsInline
        crossOrigin="anonymous"
      />

      {/* Loading / buffering overlay */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 pointer-events-none">
          <div className="animate-spin w-10 h-10 border-3 border-accent border-t-transparent rounded-full mb-3" />
          <p className="text-gray-400 text-sm">{statusMsg}</p>
        </div>
      )}

      {/* Error overlay */}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center max-w-md px-6">
            <svg className="w-12 h-12 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-gray-300 text-sm mb-4">{statusMsg}</p>
            <button
              onClick={() => {
                attemptRef.current++;
                setStatus('loading');
                setStatusMsg('Retrying...');
                // Re-trigger by resetting attempt
                const video = videoRef.current;
                if (video) video.src = '';
                cleanup();
                // Small delay then re-trigger effect
                setTimeout(() => {
                  attemptRef.current++;
                  // Force re-render to re-trigger the URL loading effect
                  setStatus('loading');
                }, 100);
              }}
              className="px-4 py-2 bg-accent hover:bg-accent-hover rounded-lg text-white text-sm transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Controls overlay */}
      <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 pt-12 transition-opacity duration-300 ${showControls && status === 'playing' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {/* Progress bar (not for live) */}
        {type !== 'live' && duration > 0 && isFinite(duration) && (
          <div className="mb-3 cursor-pointer group/prog" onClick={seek}>
            <div className="h-1 bg-white/20 rounded-full group-hover/prog:h-1.5 transition-all">
              <div
                className="h-full bg-accent rounded-full relative"
                style={{ width: `${(currentTime / duration) * 100}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover/prog:opacity-100 transition-opacity" />
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <button onClick={togglePlay} className="text-white hover:text-accent transition-colors">
            {playing ? (
              <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
            ) : (
              <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>

          {/* Time */}
          {type !== 'live' ? (
            <span className="text-white/70 text-xs tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-red-400">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              LIVE
            </span>
          )}

          <div className="flex-1" />

          {/* Volume */}
          <div className="flex items-center gap-2">
            <button onClick={toggleMute} className="text-white hover:text-accent transition-colors">
              {muted || volume === 0 ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              onChange={changeVolume}
              className="w-20 h-1 accent-accent"
            />
          </div>

          {/* Fullscreen */}
          <button onClick={toggleFullscreen} className="text-white hover:text-accent transition-colors">
            {fullscreen ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" /></svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
