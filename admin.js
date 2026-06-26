/**
 * Админ-панель: вход по паролю, CRUD гостей, экспорт/импорт.
 * Доступ только по ссылке ?admin=1
 */
const btnAdminLoginBack = document.getElementById('btn-admin-login-back');
const btnAdminLogin = document.getElementById('btn-admin-login');
const adminPinInput = document.getElementById('admin-pin');
const adminLoginError = document.getElementById('admin-login-error');
const btnAdminBack = document.getElementById('btn-admin-back');
const btnAdminLogout = document.getElementById('btn-admin-logout');
const adminStats = document.getElementById('admin-stats');
const adminGuestList = document.getElementById('admin-guest-list');
const adminFilterTable = document.getElementById('admin-filter-table');
const btnAddGuest = document.getElementById('btn-add-guest');
const btnExport = document.getElementById('btn-export');
const btnExportConfig = document.getElementById('btn-export-config');
const btnImport = document.getElementById('btn-import');

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const guestFormBackdrop = document.getElementById('guest-form-backdrop');
const guestForm = document.getElementById('guest-form');
const guestFormTitle = document.getElementById('guest-form-title');
const guestFormId = document.getElementById('guest-form-id');
const guestFormName = document.getElementById('guest-form-name');
const guestFormTable = document.getElementById('guest-form-table');
const guestFormSeat = document.getElementById('guest-form-seat');
const guestFormAliases = document.getElementById('guest-form-aliases');
const guestFormDelete = document.getElementById('guest-form-delete');

/** Заполнение select-ов столов и мест из CONFIG */
function initAdminFormOptions() {
  guestFormTable.innerHTML = Array.from({ length: CONFIG.TABLE_COUNT }, (_, i) => {
    const n = i + 1;
    return `<option value="${n}">${n}</option>`;
  }).join('');

  guestFormSeat.innerHTML = Array.from({ length: CONFIG.SEATS_PER_TABLE }, (_, i) => {
    const n = i + 1;
    return `<option value="${n}">${n}</option>`;
  }).join('');

  const filter = document.getElementById('admin-filter-table');
  filter.innerHTML = '<option value="all">Все столы</option>' +
    Array.from({ length: CONFIG.TABLE_COUNT }, (_, i) => {
      const n = i + 1;
      return `<option value="${n}">Стол ${n}</option>`;
    }).join('');
}

function openAdminLogin() {
  adminPinInput.value = '';
  adminLoginError.hidden = true;
  showScreen('adminLogin');
}

async function tryAdminLogin() {
  if (isLoginLocked()) {
    adminLoginError.textContent = `Слишком много попыток. Подождите ${getLoginLockoutMinutes()} мин.`;
    adminLoginError.hidden = false;
    return;
  }

  const result = await adminLogin(adminPinInput.value.trim());
  if (result.ok) {
    adminLoginError.hidden = true;
    showScreen('admin');
  } else if (result.locked) {
    adminLoginError.textContent = `Слишком много попыток. Подождите ${getLoginLockoutMinutes()} мин.`;
    adminLoginError.hidden = false;
    adminPinInput.value = '';
  } else {
    adminLoginError.textContent = 'Неверный пароль';
    adminLoginError.hidden = false;
    adminPinInput.value = '';
    adminPinInput.focus();
  }
}

function renderAdminStats() {
  const byTable = groupByTable();
  const counts = [];
  for (let i = 1; i <= CONFIG.TABLE_COUNT; i++) {
    counts.push(`Стол ${i}: ${byTable[i].length}`);
  }
  adminStats.innerHTML = `
    <span class="admin-stats__total">${GUESTS.length} гостей</span>
    <span class="admin-stats__tables">${counts.join(' · ')}</span>
  `;
}

function renderAdminPanel() {
  if (!isAdminLoggedIn()) {
    openAdminLogin();
    return;
  }

  renderAdminStats();

  const filter = adminFilterTable.value;
  const sorted = [...GUESTS].sort((a, b) => {
    if (a.table !== b.table) return a.table - b.table;
    return a.seat - b.seat;
  });

  const filtered = filter === 'all'
    ? sorted
    : sorted.filter((g) => g.table === parseInt(filter, 10));

  if (!filtered.length) {
    adminGuestList.innerHTML = '<p class="admin-empty">Нет гостей</p>';
    return;
  }

  adminGuestList.innerHTML = filtered
    .map((g) => `
      <div class="admin-guest-item glass" data-id="${escapeAttr(g.id)}">
        <div class="admin-guest-item__avatar">${escapeHtml(getInitials(g.name))}</div>
        <div class="admin-guest-item__info">
          <div class="admin-guest-item__name">${escapeHtml(g.name)}</div>
          <div class="admin-guest-item__meta">Стол ${g.table} · Место ${g.seat}</div>
          ${g.aliases?.length ? `<div class="admin-guest-item__aliases">${escapeHtml(g.aliases.join(', '))}</div>` : ''}
        </div>
        <button type="button" class="admin-guest-item__edit" data-id="${escapeAttr(g.id)}" aria-label="Редактировать">✎</button>
      </div>
    `)
    .join('');

  adminGuestList.querySelectorAll('.admin-guest-item__edit').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openGuestForm(btn.dataset.id);
    });
  });

  adminGuestList.querySelectorAll('.admin-guest-item').forEach((item) => {
    item.addEventListener('click', () => openGuestForm(item.dataset.id));
  });
}

function openGuestForm(id) {
  const isEdit = Boolean(id);
  guestFormTitle.textContent = isEdit ? 'Редактировать гостя' : 'Новый гость';
  guestFormDelete.hidden = !isEdit;

  if (isEdit) {
    const guest = GUESTS.find((g) => g.id === id);
    if (!guest) return;
    guestFormId.value = guest.id;
    guestFormName.value = guest.name;
    guestFormTable.value = String(guest.table);
    guestFormSeat.value = String(guest.seat);
    guestFormAliases.value = (guest.aliases || []).join(', ');
  } else {
    guestFormId.value = '';
    guestFormName.value = '';
    guestFormTable.value = '1';
    guestFormSeat.value = '1';
    guestFormAliases.value = '';
  }

  guestFormModal.hidden = false;
  updateBodyScroll();
  guestFormName.focus();
}

function closeGuestForm() {
  guestFormModal.hidden = true;
  updateBodyScroll();
}

function parseAliases(str) {
  return str.split(',').map((s) => s.trim()).filter(Boolean);
}

function handleGuestFormSubmit(e) {
  e.preventDefault();

  const id = guestFormId.value;
  const guest = normalizeGuest({
    id: id || uuid(),
    name: guestFormName.value.trim(),
    table: guestFormTable.value,
    seat: guestFormSeat.value,
    aliases: parseAliases(guestFormAliases.value),
  });

  if (!guest.name) return;

  const updated = id
    ? GUESTS.map((g) => (g.id === id ? guest : g))
    : [...GUESTS, guest];

  saveGuests(updated);
  closeGuestForm();
  renderAdminPanel();
  refreshAfterDataChange();
}

function handleGuestDelete() {
  const id = guestFormId.value;
  if (!id || !confirm('Удалить этого гостя?')) return;

  saveGuests(GUESTS.filter((g) => g.id !== id));
  closeGuestForm();
  renderAdminPanel();
  refreshAfterDataChange();
}

function handleImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (file.size > 512 * 1024) {
    alert('Файл слишком большой. Максимум 512 КБ.');
    btnImport.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error('Неверный формат');
      const valid = data.every((g) => g && typeof g.name === 'string' && g.name.trim());
      if (!valid) throw new Error('Некорректные записи');
      saveGuests(data);
      renderAdminPanel();
      refreshAfterDataChange();
      alert('Импорт выполнен. Не забудьте экспортировать guests.json и перезалить сайт.');
    } catch {
      alert('Не удалось прочитать файл. Нужен JSON-массив гостей.');
    }
    btnImport.value = '';
  };
  reader.readAsText(file);
}

// --- События ---
btnAdminLoginBack.addEventListener('click', () => showScreen('welcome'));
btnAdminLogin.addEventListener('click', tryAdminLogin);
adminPinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryAdminLogin();
});

btnAdminBack.addEventListener('click', () => showScreen('welcome'));
btnAdminLogout.addEventListener('click', () => {
  adminLogout();
  showScreen('welcome');
});

adminFilterTable.addEventListener('change', renderAdminPanel);
btnAddGuest.addEventListener('click', () => openGuestForm(null));
btnExport.addEventListener('click', exportGuestsJson);
btnExportConfig.addEventListener('click', () => {
  exportGuestsConfig();
  alert('Файл guests-list.js скачан. Вставьте GUESTS_LIST в config.js и перезалейте сайт.');
});
btnImport.addEventListener('change', handleImport);

guestForm.addEventListener('submit', handleGuestFormSubmit);
guestFormDelete.addEventListener('click', handleGuestDelete);
guestFormBackdrop.addEventListener('click', closeGuestForm);

initAdminFormOptions();
