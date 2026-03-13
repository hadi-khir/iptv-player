const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Search index: pre-lowercased names for fast searching
const searchIndexes = new Map();
const SEARCH_INDEX_TTL = 5 * 60 * 1000;

function getSearchIndex(connKey) {
  const entry = searchIndexes.get(connKey);
  if (entry && Date.now() - entry.time < SEARCH_INDEX_TTL) return entry;
  return null;
}

export async function buildSearchIndex(conn) {
  const connKey = conn.server_url + conn.username;
  const existing = getSearchIndex(connKey);
  if (existing) return existing;

  const [live, vod, series] = await Promise.all([
    getLiveStreams(conn).catch(() => []),
    getVodStreams(conn).catch(() => []),
    getSeries(conn).catch(() => []),
  ]);

  const items = [];
  for (const s of (live || [])) {
    if (s.name) items.push({ ...s, type: 'live', _name: s.name.toLowerCase() });
  }
  for (const s of (vod || [])) {
    if (s.name) items.push({ ...s, type: 'movie', _name: s.name.toLowerCase() });
  }
  for (const s of (series || [])) {
    if (s.name) items.push({ ...s, type: 'series', _name: s.name.toLowerCase() });
  }

  const entry = { items, time: Date.now() };
  searchIndexes.set(connKey, entry);
  return entry;
}

// Block requests to private/internal networks (SSRF protection)
const BLOCKED_HOSTS = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|localhost|::1|\[::1\])/i;

export function validateServerUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Invalid server URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Server URL must use http or https');
  }

  if (BLOCKED_HOSTS.test(parsed.hostname)) {
    throw new Error('Server URL cannot point to a private/internal network');
  }

  return parsed;
}

function cacheKey(url, action, extra) {
  return `${url}:${action}:${extra || ''}`;
}

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
  if (entry) cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

export function buildApiUrl(conn, action, params = {}) {
  const base = conn.server_url.replace(/\/+$/, '');
  const url = new URL(`${base}/player_api.php`);
  url.searchParams.set('username', conn.username);
  url.searchParams.set('password', conn.password);
  if (action) url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

export function buildStreamUrl(conn, type, streamId, extension = 'm3u8') {
  const base = conn.server_url.replace(/\/+$/, '');
  const typePath = type === 'live' ? 'live' : type === 'movie' ? 'movie' : 'series';
  return `${base}/${typePath}/${conn.username}/${conn.password}/${streamId}.${extension}`;
}

export async function xtreamRequest(conn, action, params = {}) {
  const key = cacheKey(conn.server_url + conn.username, action, JSON.stringify(params));
  const cached = getCached(key);
  if (cached) return cached;

  const url = buildApiUrl(conn, action, params);
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Xtream API error: ${res.status}`);
  const data = await res.json();
  setCache(key, data);
  return data;
}

export async function authenticate(conn) {
  const url = buildApiUrl(conn, null);
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('Failed to connect');
  const data = await res.json();
  if (!data.user_info) throw new Error('Invalid credentials');
  return data;
}

export async function getLiveCategories(conn) {
  return xtreamRequest(conn, 'get_live_categories');
}

export async function getLiveStreams(conn, categoryId) {
  const params = categoryId ? { category_id: categoryId } : {};
  return xtreamRequest(conn, 'get_live_streams', params);
}

export async function getVodCategories(conn) {
  return xtreamRequest(conn, 'get_vod_categories');
}

export async function getVodStreams(conn, categoryId) {
  const params = categoryId ? { category_id: categoryId } : {};
  return xtreamRequest(conn, 'get_vod_streams', params);
}

export async function getSeriesCategories(conn) {
  return xtreamRequest(conn, 'get_series_categories');
}

export async function getSeries(conn, categoryId) {
  const params = categoryId ? { category_id: categoryId } : {};
  return xtreamRequest(conn, 'get_series', params);
}

export async function getSeriesInfo(conn, seriesId) {
  return xtreamRequest(conn, 'get_series_info', { series_id: seriesId });
}

export async function getEpg(conn, streamId) {
  return xtreamRequest(conn, 'get_short_epg', { stream_id: streamId });
}

export async function getFullEpg(conn, streamId) {
  return xtreamRequest(conn, 'get_simple_data_table', { stream_id: streamId });
}
