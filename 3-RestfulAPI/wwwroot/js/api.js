// Thin client for the SmartStore REST API (same origin, served from wwwroot).
// shortcut: tokens live in localStorage, so any XSS can read them; move to httpOnly cookies if the API adds cookie auth.
const Auth = {
  get access() { try { return localStorage.getItem('ss_access'); } catch { return null; } },
  get refresh() { try { return localStorage.getItem('ss_refresh'); } catch { return null; } },
  save(access, refresh) {
    try { localStorage.setItem('ss_access', access); localStorage.setItem('ss_refresh', refresh); } catch {}
  },
  clear() { try { localStorage.removeItem('ss_access'); localStorage.removeItem('ss_refresh'); } catch {} },
  // Reads the JWT payload for display/role only; the server still checks every request.
  claims() {
    const t = this.access;
    if (!t) return null;
    try {
      const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (p.exp && p.exp * 1000 < Date.now() && !this.refresh) return null;
      return p;
    } catch { return null; }
  },
  get loggedIn() { return !!this.claims(); },
};

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let refreshing = null;
async function refreshTokens() {
  if (!Auth.refresh) return false;
  refreshing ??= fetch('/api/Auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: Auth.refresh }),
  }).then(async r => {
    if (!r.ok) { Auth.clear(); return false; }
    const d = await r.json();
    Auth.save(d.accessToken, d.refreshToken);
    return true;
  }).catch(() => false).finally(() => { refreshing = null; });
  return refreshing;
}

function errorMessage(status, body) {
  if (body && typeof body === 'object') {
    if (body.errors) return Object.values(body.errors).flat().join(' ');
    if (body.message) return body.message;
    if (body.title) return body.title;
  }
  if (typeof body === 'string' && body && body.length < 300) return body;
  if (status === 401) return 'Sign in to continue.';
  if (status === 403) return "Your account can't do that.";
  if (status === 404) return "That item doesn't exist anymore.";
  if (status === 429) return 'Too many requests. Wait a minute and try again.';
  return `The server returned an error (${status}). Try again shortly.`;
}

async function api(path, { method = 'GET', body, retry = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (Auth.access) headers.Authorization = `Bearer ${Auth.access}`;
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Can't reach the store server. Check that the API is running.");
  }
  if (res.status === 401 && retry && Auth.refresh && await refreshTokens()) {
    return api(path, { method, body, retry: false });
  }
  const text = await res.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    if (res.status === 401) Auth.clear();
    throw new ApiError(res.status, errorMessage(res.status, data));
  }
  return data;
}
