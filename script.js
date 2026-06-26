/**
 * Основное приложение: экраны, поиск, схема зала, анимации.
 */
let selectedGuest = null;
let currentScreen = 'welcome';
let isTransitioning = false;
let revealTimeout = null;
let searchDebounceTimer = null;
let suggestionFocusIndex = -1;
let lastSearchResults = [];
let hallMapRendered = false;
let petalsCreated = false;

const screens = {
  welcome: document.getElementById('screen-welcome'),
  map: document.getElementById('screen-map'),
  adminLogin: document.getElementById('screen-admin-login'),
  admin: document.getElementById('screen-admin'),
};
const appLoader = document.getElementById('app-loader');
const guestReveal = document.getElementById('guest-reveal');
const revealName = document.getElementById('reveal-name');
const confettiEl = document.getElementById('confetti');
const btnStart = document.getElementById('btn-start');
const btnBackWelcome = document.getElementById('btn-back-welcome');
const searchInput = document.getElementById('guest-search');
const suggestionsEl = document.getElementById('suggestions');
const guestCard = document.getElementById('guest-card');
const searchEmpty = document.getElementById('search-empty');
const hallMap = document.getElementById('hall-map');
const tableModal = document.getElementById('table-modal');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalClose = document.getElementById('modal-close');
const modalTitle = document.getElementById('modal-title');
const modalScene = document.getElementById('modal-scene');
const petalsContainer = document.getElementById('petals');
const guestFormModal = document.getElementById('guest-form-modal');

const TABLE_LAYOUT = {
  head: { cx: 180, cy: 34 },
  1: { cx: 180, cy: 118 },
  2: { cx: 76, cy: 286 },
  3: { cx: 284, cy: 286 },
  4: { cx: 64, cy: 454 },
  5: { cx: 296, cy: 454 },
};

const TABLE_RADIUS = 32;
const CHAIR_ORBIT = 46;
const CHAIR_RADIUS = 6;

function normalize(str) {
  return str.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ё/g, 'е');
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') || '' };
}

function getInitials(name) {
  const { first, last } = splitName(name);
  return ((first[0] || '') + (last[0] || '')).toUpperCase();
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function getRandomGreeting() {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}

function groupByTable() {
  const groups = {};
  for (let i = 1; i <= CONFIG.TABLE_COUNT; i++) groups[i] = [];
  GUESTS.forEach((g) => groups[g.table]?.push(g));
  Object.values(groups).forEach((list) => list.sort((a, b) => a.seat - b.seat));
  return groups;
}

function updateBodyScroll() {
  const modalOpen = !tableModal.hidden || !guestFormModal.hidden;
  const revealOpen = !guestReveal.hidden;
  document.body.style.overflow = (modalOpen || revealOpen) ? 'hidden' : '';
}

function haptic(pattern = 12) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function hideLoader() {
  appLoader.classList.add('app-loader--hidden');
}

function spawnConfetti() {
  if (prefersReducedMotion()) return;
  const colors = ['#f5d5d8', '#e8d4b0', '#d4e8d9', '#e0d8f0', '#c9a87c'];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 18; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti__piece';
    piece.style.left = `${15 + Math.random() * 70}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.35}s`;
    frag.appendChild(piece);
  }
  confettiEl.replaceChildren(frag);
  setTimeout(() => { confettiEl.replaceChildren(); }, 2200);
}

function searchGuests(query) {
  const q = normalize(query);
  if (!q) return [];

  return GUESTS.filter((guest) => {
    const name = normalize(guest.name);
    const parts = name.split(' ');
    if (name.includes(q)) return true;
    if (parts.some((p) => p.startsWith(q))) return true;
    return (guest.aliases || []).some((alias) => {
      const a = normalize(alias);
      return a.startsWith(q) || a.includes(q);
    });
  });
}

function renderSuggestions(results) {
  lastSearchResults = results;
  suggestionFocusIndex = -1;

  if (!results.length) {
    suggestionsEl.innerHTML = '';
    return;
  }

  suggestionsEl.innerHTML = results
    .map((guest, i) => `
      <li class="suggestion" role="option" tabindex="-1" id="suggestion-${i}" aria-selected="false">
        <div class="suggestion__avatar">${escapeHtml(getInitials(guest.name))}</div>
        <div class="suggestion__info">
          <div class="suggestion__name">${escapeHtml(guest.name)}</div>
          <div class="suggestion__meta">Стол ${guest.table} · Место ${guest.seat}</div>
        </div>
      </li>
    `)
    .join('');

  suggestionsEl.querySelectorAll('.suggestion').forEach((el, i) => {
    el.style.animationDelay = `${i * 0.04}s`;
    el.addEventListener('click', () => selectGuest(results[i]));
  });

  previewGuestOnMap(results[0]);
}

function setSuggestionFocus(index) {
  const items = suggestionsEl.querySelectorAll('.suggestion');
  if (!items.length) return;

  suggestionFocusIndex = Math.max(0, Math.min(index, items.length - 1));
  items.forEach((el, i) => {
    const focused = i === suggestionFocusIndex;
    el.classList.toggle('suggestion--focused', focused);
    el.setAttribute('aria-selected', focused ? 'true' : 'false');
    if (focused) {
      el.focus();
      previewGuestOnMap(lastSearchResults[i]);
    }
  });
}

function clearSuggestionFocus() {
  suggestionFocusIndex = -1;
  suggestionsEl.querySelectorAll('.suggestion').forEach((el) => {
    el.classList.remove('suggestion--focused');
    el.setAttribute('aria-selected', 'false');
  });
}

function previewGuestOnMap(guest) {
  if (!guest || !hallMapRendered) return;
  selectedGuest = guest;
  renderHallMap();
}

function showGuestCard(guest) {
  document.getElementById('guest-avatar').textContent = getInitials(guest.name);
  document.getElementById('guest-greeting').textContent = getRandomGreeting();
  document.getElementById('guest-name').textContent = guest.name;
  document.getElementById('guest-table').textContent = guest.table;
  document.getElementById('guest-seat').textContent = guest.seat;

  guestCard.hidden = false;
  guestCard.classList.remove('seat-banner--appear');
  void guestCard.offsetWidth;
  guestCard.classList.add('seat-banner--appear');

  ensureHallMap();
  playGuestMapReveal(guest, false);

  requestAnimationFrame(() => {
    guestCard.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  });

  const modalDelay = prefersReducedMotion() ? 150 : 650;
  setTimeout(() => openTableModal(guest.table, guest.name), modalDelay);
}

function selectGuest(guest) {
  selectedGuest = guest;
  suggestionsEl.innerHTML = '';
  lastSearchResults = [];
  searchInput.value = guest.name;
  searchEmpty.hidden = true;
  guestCard.hidden = true;

  haptic([10, 30, 10]);
  spawnConfetti();

  const { first } = splitName(guest.name);
  revealName.textContent = first || guest.name;
  guestReveal.hidden = false;
  updateBodyScroll();

  clearTimeout(revealTimeout);
  const delay = prefersReducedMotion() ? 100 : 1800;
  revealTimeout = setTimeout(() => {
    guestReveal.hidden = true;
    updateBodyScroll();
    showGuestCard(guest);
  }, delay);
}

function handleSearchInput() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(runSearch, 100);
}

function runSearch() {
  const query = searchInput.value.trim();

  if (!query) {
    suggestionsEl.innerHTML = '';
    lastSearchResults = [];
    suggestionFocusIndex = -1;
    guestCard.hidden = true;
    searchEmpty.hidden = true;
    guestReveal.hidden = true;
    selectedGuest = null;
    if (hallMapRendered) renderHallMap();
    return;
  }

  const results = searchGuests(query);

  if (results.length === 0) {
    suggestionsEl.innerHTML = '';
    lastSearchResults = [];
    suggestionFocusIndex = -1;
    guestCard.hidden = true;
    searchEmpty.hidden = false;
    selectedGuest = null;
    if (hallMapRendered) renderHallMap();
    return;
  }

  searchEmpty.hidden = true;

  if (results.length === 1 && normalize(results[0].name) === normalize(query)) {
    selectGuest(results[0]);
    return;
  }

  guestCard.hidden = true;
  selectedGuest = null;
  renderSuggestions(results);
}

function showScreen(name) {
  if (name === currentScreen || isTransitioning) return;

  const prev = screens[currentScreen];
  const next = screens[name];
  if (!next) return;

  isTransitioning = true;
  const animate = !prefersReducedMotion();

  if (prev) {
    prev.classList.remove('screen--active');
    if (animate) prev.classList.add('screen--leaving');
    else prev.classList.remove('screen--leaving');
  }

  next.classList.add('screen--active');
  if (animate) {
    next.classList.add('screen--entering');
  } else {
    next.classList.remove('screen--entering');
  }

  const finishMs = animate ? 320 : 0;
  setTimeout(() => {
    if (prev) prev.classList.remove('screen--leaving');
    next.classList.remove('screen--entering');
    isTransitioning = false;
  }, finishMs);

  currentScreen = name;

  if (name === 'map') {
    ensureHallMap();
    if (selectedGuest) playGuestMapReveal(selectedGuest, false);
    setTimeout(() => {
      try { searchInput.focus({ preventScroll: true }); } catch (_) {}
    }, finishMs + 50);
  }

  if (name === 'admin') renderAdminPanel();
}

function chairPosition(cx, cy, seat, total) {
  const angle = ((seat - 1) / total) * 360 - 90;
  const rad = (angle * Math.PI) / 180;
  return {
    x: cx + CHAIR_ORBIT * Math.cos(rad),
    y: cy + CHAIR_ORBIT * Math.sin(rad),
  };
}

function buildChairsSvg(cx, cy, tableNum, highlightSeat) {
  const total = CONFIG.SEATS_PER_TABLE;
  const hlSeat = Number(highlightSeat);
  const hlTable = Number(selectedGuest?.table);
  let svg = '';
  for (let seat = 1; seat <= total; seat++) {
    const { x, y } = chairPosition(cx, cy, seat, total);
    const isHl = hlSeat === seat && hlTable === tableNum;
    svg += `
      <g class="svg-chair-wrap${isHl ? ' svg-chair-wrap--highlight' : ''}" data-seat="${seat}">
        <circle class="svg-chair${isHl ? ' svg-chair--highlight' : ''}" cx="${x}" cy="${y}" r="${CHAIR_RADIUS}" />
      </g>
    `;
  }
  return svg;
}

function buildHeadTableSvg() {
  const { cx, cy } = TABLE_LAYOUT.head;
  const w = 120;
  const h = 28;
  const x = cx - w / 2;
  const y = cy - h / 2;
  return `
    <g transform="translate(${x},${y})">
      <g class="svg-table svg-table--head" data-table="head">
        <rect class="svg-table__shadow" x="2" y="4" width="${w}" height="${h}" rx="14" />
        <rect class="svg-table__top svg-table__top--head" width="${w}" height="${h}" rx="14" />
        <rect class="svg-table__rim svg-table__rim--head" width="${w}" height="${h}" rx="14" fill="none" />
        <text class="svg-table__label svg-table__label--head" x="${w / 2}" y="${h / 2 + 1}" text-anchor="middle" dominant-baseline="middle">♥ Кирилл &amp; Анна</text>
        <rect class="svg-table__hit" width="${w}" height="${h}" rx="14" aria-hidden="true" />
      </g>
    </g>
  `;
}

function buildRoundTableSvg(tableNum, highlightTable, highlightSeat) {
  const { cx, cy } = TABLE_LAYOUT[tableNum];
  const isHl = Number(highlightTable) === tableNum;
  const hlClass = isHl ? ' svg-table--highlight' : '';
  const r = TABLE_RADIUS;

  return `
    <g class="svg-table-group svg-table-group--${tableNum}">
      <g class="svg-table svg-table--${tableNum}${hlClass}" data-table="${tableNum}">
        ${buildChairsSvg(cx, cy, tableNum, highlightSeat)}
        <ellipse class="svg-table__shadow" cx="${cx}" cy="${cy + 4}" rx="${r + 2}" ry="${r}" />
        <circle class="svg-table__top" cx="${cx}" cy="${cy}" r="${r}" />
        <circle class="svg-table__rim" cx="${cx}" cy="${cy}" r="${r}" fill="none" />
        <text class="svg-table__number" x="${cx}" y="${cy + 1}" text-anchor="middle" dominant-baseline="middle">${tableNum}</text>
        <circle class="svg-table__hit" cx="${cx}" cy="${cy}" r="${r + 18}" aria-hidden="true" />
      </g>
    </g>
  `;
}

function ensureHallMap() {
  renderHallMap();
  hallMapRendered = true;
}

function renderHallMap() {
  const hlTable = selectedGuest?.table;
  const hlSeat = selectedGuest?.seat;

  let tablesSvg = buildHeadTableSvg();
  for (let i = 1; i <= CONFIG.TABLE_COUNT; i++) {
    tablesSvg += buildRoundTableSvg(i, hlTable, hlSeat);
  }

  hallMap.innerHTML = `
    <svg class="hall-map__svg" viewBox="0 0 360 500" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Схема рассадки гостей">
      <defs>
        <radialGradient id="table-top" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#FFFFFF"/>
          <stop offset="55%" stop-color="#F8F4EE"/>
          <stop offset="100%" stop-color="#EDE6DA"/>
        </radialGradient>
        <radialGradient id="table-top-head" cx="40%" cy="25%" r="75%">
          <stop offset="0%" stop-color="#FFFCF7"/>
          <stop offset="100%" stop-color="#F0E8DC"/>
        </radialGradient>
      </defs>
      <path class="svg-floor-line" d="M180 52 Q180 200 180 348" />
      ${tablesSvg}
    </svg>
  `;

  bindHallMapClicks();
}

function bindHallMapClicks() {
  if (hallMap.dataset.clicksBound) return;
  hallMap.dataset.clicksBound = '1';

  hallMap.addEventListener('click', (e) => {
    const tableEl = e.target.closest('.svg-table[data-table]');
    if (!tableEl) return;

    const table = tableEl.dataset.table;
    haptic(8);
    if (table === 'head') openHeadTableModal();
    else openTableModal(parseInt(table, 10));
  });
}

function playGuestMapReveal(guest, scrollPage = true) {
  if (!guest) return;

  if (scrollPage && !prefersReducedMotion()) {
    hallMap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const tableEl = hallMap.querySelector(`.svg-table[data-table="${guest.table}"]`);
  if (!tableEl) return;

  tableEl.classList.remove('svg-table--reveal');
  void tableEl.offsetWidth;
  tableEl.classList.add('svg-table--reveal');

  if (prefersReducedMotion()) return;

  setTimeout(() => {
    const chair = hallMap.querySelector('.svg-chair-wrap--highlight');
    if (chair) {
      chair.classList.remove('svg-chair--reveal');
      void chair.offsetWidth;
      chair.classList.add('svg-chair--reveal');
    }
  }, 320);
}

function openHeadTableModal() {
  modalTitle.textContent = 'Стол молодожёнов';
  modalScene.innerHTML = `
    <div class="head-modal">
      <div class="head-modal__badge">
        <span class="head-modal__heart" aria-hidden="true">♥</span>
        <span class="head-modal__names">Кирилл <span class="head-modal__amp">&amp;</span> Анна</span>
      </div>
      <p class="head-modal__text">Главный стол торжества</p>
    </div>
  `;
  modalScene.classList.add('modal-scene--head');
  tableModal.hidden = false;
  updateBodyScroll();
}

function openTableModal(tableNum, highlightName) {
  modalScene.classList.remove('modal-scene--head');
  const guests = groupByTable()[tableNum] || [];
  const name = highlightName || selectedGuest?.name;
  const colors = ['--t1', '--t2', '--t3', '--t4', '--t5'];

  modalTitle.textContent = `Стол ${tableNum}`;
  modalScene.innerHTML = `
    <div class="modal-scene__ring"></div>
    <div class="modal-scene__center" style="background: linear-gradient(145deg, var(${colors[tableNum - 1]}), var(${colors[tableNum - 1]}d))">
      ${tableNum}
    </div>
  `;

  const step = guests.length ? 360 / guests.length : 0;
  guests.forEach((guest, i) => {
    const angle = i * step - 90;
    const { first, last } = splitName(guest.name);
    const isHighlight = name && guest.name === name;
    const el = document.createElement('div');
    el.className = `modal-guest${isHighlight ? ' modal-guest--highlight' : ''}`;
    el.style.setProperty('--angle', `${angle}deg`);
    el.style.setProperty('--delay', `${i * 0.06}s`);
    el.innerHTML = `
      <div class="modal-guest__avatar">${escapeHtml(getInitials(guest.name))}</div>
      <div class="modal-guest__name">
        <span class="modal-guest__name-first">${escapeHtml(first)}</span>
        ${last ? `<span class="modal-guest__name-last">${escapeHtml(last)}</span>` : ''}
      </div>
    `;
    modalScene.appendChild(el);
  });

  tableModal.hidden = false;
  updateBodyScroll();
}

function closeTableModal() {
  tableModal.hidden = true;
  modalScene.classList.remove('modal-scene--head');
  updateBodyScroll();
}

function refreshAfterDataChange() {
  selectedGuest = null;
  searchInput.value = '';
  suggestionsEl.innerHTML = '';
  lastSearchResults = [];
  suggestionFocusIndex = -1;
  guestCard.hidden = true;
  guestReveal.hidden = true;
  searchEmpty.hidden = true;
  hallMapRendered = false;
  if (currentScreen === 'map') ensureHallMap();
}

function createPetals() {
  if (petalsCreated || prefersReducedMotion()) return;
  petalsCreated = true;
  const count = window.matchMedia('(max-width: 480px)').matches ? 5 : 8;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const petal = document.createElement('span');
    petal.className = 'petal';
    petal.style.left = `${Math.random() * 100}%`;
    petal.style.animationDuration = `${9 + Math.random() * 7}s`;
    petal.style.animationDelay = `${Math.random() * 8}s`;
    frag.appendChild(petal);
  }
  petalsContainer.appendChild(frag);
}

btnStart.addEventListener('click', () => {
  haptic(8);
  showScreen('map');
});

btnBackWelcome.addEventListener('click', () => showScreen('welcome'));

searchInput.addEventListener('input', handleSearchInput);

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' && lastSearchResults.length) {
    e.preventDefault();
    setSuggestionFocus(suggestionFocusIndex + 1);
    return;
  }
  if (e.key === 'ArrowUp' && lastSearchResults.length) {
    e.preventDefault();
    setSuggestionFocus(suggestionFocusIndex <= 0 ? lastSearchResults.length - 1 : suggestionFocusIndex - 1);
    return;
  }
  if (e.key === 'Escape') {
    clearSuggestionFocus();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (suggestionFocusIndex >= 0 && lastSearchResults[suggestionFocusIndex]) {
      selectGuest(lastSearchResults[suggestionFocusIndex]);
      return;
    }
    const results = searchGuests(searchInput.value.trim());
    if (results.length === 1) selectGuest(results[0]);
  }
});

modalBackdrop.addEventListener('click', closeTableModal);
modalClose.addEventListener('click', closeTableModal);

function loadAdminScript() {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[data-admin]')) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = 'admin.js';
    s.dataset.admin = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('admin.js'));
    document.body.appendChild(s);
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!tableModal.hidden) closeTableModal();
  else if (!guestFormModal.hidden) closeGuestForm?.();
});

function scheduleIdleWork(fn) {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(fn, { timeout: 1500 });
  } else {
    setTimeout(fn, 1);
  }
}

async function initApp() {
  try {
    await loadGuests();
  } catch (_) {
    if (typeof GUESTS_LIST !== 'undefined') setGuestsFromList(GUESTS_LIST);
  }

  hideLoader();
  scheduleIdleWork(createPetals);

  if (new URLSearchParams(location.search).get('admin') === '1') {
    try {
      await loadAdminScript();
      if (isAdminLoggedIn()) showScreen('admin');
      else showScreen('adminLogin');
    } catch {
      console.error('Не удалось загрузить admin.js');
    }
  }
}

initApp();
