/**
 * Загрузка, нормализация и сохранение данных гостей.
 * Источники: guests.json (кэшируется) → GUESTS_LIST в config.js → localStorage в ?admin=1.
 */
let GUESTS = [];

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function normalizeGuest(raw) {
  const table = Math.min(CONFIG.TABLE_COUNT, Math.max(1, parseInt(raw.table, 10) || 1));
  const seat = Math.min(CONFIG.SEATS_PER_TABLE, Math.max(1, parseInt(raw.seat, 10) || 1));
  return {
    id: raw.id || uuid(),
    name: (raw.name || '').trim(),
    table,
    seat,
    aliases: Array.isArray(raw.aliases) ? raw.aliases.filter(Boolean) : [],
  };
}

function assignSeats(rawList) {
  const sorted = [...rawList].sort((a, b) => {
    const ta = parseInt(a.table, 10) || 1;
    const tb = parseInt(b.table, 10) || 1;
    if (ta !== tb) return ta - tb;
    return (parseInt(a.seat, 10) || 0) - (parseInt(b.seat, 10) || 0);
  });
  const counters = {};
  return sorted.map((g) => {
    const guest = normalizeGuest(g);
    if (g.seat == null || g.seat === '') {
      counters[guest.table] = (counters[guest.table] || 0) + 1;
      guest.seat = counters[guest.table];
    }
    return guest;
  });
}

function stripForStorage(guests) {
  return guests.map(({ id, name, table, seat, aliases }) => ({
    id, name, table, seat, aliases,
  }));
}

function isAdminMode() {
  return new URLSearchParams(location.search).get('admin') === '1';
}

function setGuestsFromList(rawList) {
  GUESTS = assignSeats(rawList.map(normalizeGuest));
  return GUESTS;
}

async function fetchGuestsJson() {
  const res = await fetch('guests.json', { cache: 'default' });
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;
  return data;
}

async function loadGuests() {
  if (isAdminMode()) {
    const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (Array.isArray(data) && data.length) {
          return setGuestsFromList(data);
        }
      } catch (_) {
        localStorage.removeItem(CONFIG.STORAGE_KEY);
      }
    }
  }

  try {
    const remote = await fetchGuestsJson();
    if (remote) return setGuestsFromList(remote);
  } catch (_) {}

  return setGuestsFromList(GUESTS_LIST);
}

function saveGuests(guests) {
  GUESTS = assignSeats(guests.map(normalizeGuest));
  if (isAdminMode()) {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(stripForStorage(GUESTS)));
  }
}

function formatGuestForConfig(g) {
  const aliases = g.aliases?.length ? `, aliases: ${JSON.stringify(g.aliases)}` : '';
  const name = g.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `  { id: '${g.id}', name: '${name}', table: ${g.table}, seat: ${g.seat}${aliases} },`;
}

function exportGuestsJson() {
  const blob = new Blob([JSON.stringify(stripForStorage(GUESTS), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'guests.json';
  a.click();
  URL.revokeObjectURL(url);
}

function exportGuestsConfig() {
  const lines = stripForStorage(GUESTS).map(formatGuestForConfig).join('\n');
  const content = `/** Список гостей — вставьте в config.js вместо GUESTS_LIST */\nconst GUESTS_LIST = [\n${lines}\n];\n`;
  const blob = new Blob([content], { type: 'text/javascript;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'guests-list.js';
  a.click();
  URL.revokeObjectURL(url);
}

async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function getLoginAttempts() {
  try {
    const raw = localStorage.getItem(CONFIG.LOGIN_ATTEMPTS_KEY);
    if (!raw) return { count: 0, lockedUntil: 0 };
    return JSON.parse(raw);
  } catch {
    return { count: 0, lockedUntil: 0 };
  }
}

function setLoginAttempts(data) {
  localStorage.setItem(CONFIG.LOGIN_ATTEMPTS_KEY, JSON.stringify(data));
}

function isLoginLocked() {
  const { lockedUntil } = getLoginAttempts();
  if (lockedUntil && Date.now() < lockedUntil) return true;
  if (lockedUntil && Date.now() >= lockedUntil) {
    setLoginAttempts({ count: 0, lockedUntil: 0 });
  }
  return false;
}

function getLoginLockoutMinutes() {
  const { lockedUntil } = getLoginAttempts();
  return Math.ceil((lockedUntil - Date.now()) / 60000);
}

function recordFailedLogin() {
  const attempts = getLoginAttempts();
  const count = attempts.count + 1;
  if (count >= CONFIG.LOGIN_MAX_ATTEMPTS) {
    setLoginAttempts({ count: 0, lockedUntil: Date.now() + CONFIG.LOGIN_LOCKOUT_MS });
  } else {
    setLoginAttempts({ count, lockedUntil: 0 });
  }
}

function clearLoginAttempts() {
  localStorage.removeItem(CONFIG.LOGIN_ATTEMPTS_KEY);
}

function isAdminLoggedIn() {
  const raw = sessionStorage.getItem(CONFIG.SESSION_KEY);
  if (!raw) return false;
  try {
    const session = JSON.parse(raw);
    if (!session.ok || Date.now() - session.ts > CONFIG.SESSION_TTL_MS) {
      sessionStorage.removeItem(CONFIG.SESSION_KEY);
      return false;
    }
    return true;
  } catch {
    if (raw === '1') return true;
    sessionStorage.removeItem(CONFIG.SESSION_KEY);
    return false;
  }
}

async function adminLogin(pin) {
  if (isLoginLocked()) return { ok: false, locked: true };

  const hash = await hashPin(pin);
  if (hash === CONFIG.ADMIN_PIN_HASH) {
    sessionStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify({ ok: true, ts: Date.now() }));
    clearLoginAttempts();
    return { ok: true };
  }

  recordFailedLogin();
  return { ok: false, locked: isLoginLocked() };
}

function adminLogout() {
  sessionStorage.removeItem(CONFIG.SESSION_KEY);
}
