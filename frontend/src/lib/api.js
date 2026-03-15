const TOKEN_KEY = 'jeip_token';
const INCIDENT_CACHE_KEY = 'jeip_cached_incidents';
const REPORT_QUEUE_KEY = 'jeip_report_queue';

export const storage = {
  getToken() {
    return window.localStorage.getItem(TOKEN_KEY) || '';
  },
  setToken(token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  },
  clearToken() {
    window.localStorage.removeItem(TOKEN_KEY);
  },
  getIncidentCache() {
    return JSON.parse(window.localStorage.getItem(INCIDENT_CACHE_KEY) || '[]');
  },
  setIncidentCache(incidents) {
    window.localStorage.setItem(INCIDENT_CACHE_KEY, JSON.stringify(incidents));
  },
  getQueuedReports() {
    return JSON.parse(window.localStorage.getItem(REPORT_QUEUE_KEY) || '[]');
  },
  setQueuedReports(items) {
    window.localStorage.setItem(REPORT_QUEUE_KEY, JSON.stringify(items));
  }
};

export async function apiRequest(path, { method = 'GET', token = '', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.code = data.code || response.status;
    throw error;
  }

  return data;
}
