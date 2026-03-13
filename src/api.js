const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

// Auth
export const login = (username, password) =>
  request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });

export const register = (username, password) =>
  request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) });

export const getMe = () => request('/auth/me');

// Connections
export const getConnections = () => request('/connections');

export const addConnection = (data) =>
  request('/connections', { method: 'POST', body: JSON.stringify(data) });

export const deleteConnection = (id) =>
  request(`/connections/${id}`, { method: 'DELETE' });

export const getConnectionInfo = (id) => request(`/connections/${id}/info`);

// Channels
export const getLiveCategories = (connId) => request(`/channels/${connId}/live/categories`);
export const getLiveStreams = (connId, categoryId) =>
  request(`/channels/${connId}/live/streams${categoryId ? `?category_id=${categoryId}` : ''}`);

export const getVodCategories = (connId) => request(`/channels/${connId}/vod/categories`);
export const getVodStreams = (connId, categoryId) =>
  request(`/channels/${connId}/vod/streams${categoryId ? `?category_id=${categoryId}` : ''}`);

export const getSeriesCategories = (connId) => request(`/channels/${connId}/series/categories`);
export const getSeriesList = (connId, categoryId) =>
  request(`/channels/${connId}/series/list${categoryId ? `?category_id=${categoryId}` : ''}`);

export const getSeriesInfo = (connId, seriesId) =>
  request(`/channels/${connId}/series/${seriesId}`);

export const getEpg = (connId, streamId) => request(`/channels/${connId}/epg/${streamId}`);

export const searchStreams = (connId, query) =>
  request(`/channels/${connId}/search?q=${encodeURIComponent(query)}`);

// Favorites
export const getFavorites = (connId) =>
  connId ? request(`/favorites/${connId}`) : request('/favorites');

export const addFavorite = (data) =>
  request('/favorites', { method: 'POST', body: JSON.stringify(data) });

export const removeFavorite = (id) =>
  request(`/favorites/${id}`, { method: 'DELETE' });

export const removeFavoriteByStream = (connId, streamId, streamType) =>
  request(`/favorites/stream/${connId}/${streamId}/${streamType}`, { method: 'DELETE' });

// Stream URLs - fetches proxy URLs from backend (credentials stay server-side)
export const getStreamUrls = (connId, type, streamId, containerExt) => {
  const token = getToken();
  const params = new URLSearchParams();
  if (containerExt) params.set('ext', containerExt);
  if (token) params.set('token', token);
  const qs = params.toString();
  return request(`/stream/${connId}/${type}/${streamId}/urls${qs ? `?${qs}` : ''}`);
};
