// ── Session bootstrap ──
  const LEGACY_USER_ID_KEY = 'fuel_user_id';
  let sessionUserId = null;

  async function ensureSession(options = {}) {
    const legacyUserId =
      options.legacyUserId !== undefined
        ? options.legacyUserId
        : localStorage.getItem(LEGACY_USER_ID_KEY);
    const payload = {};

    if (legacyUserId) {
      payload.legacyUserId = legacyUserId;
    }

    if (options.force === true) {
      payload.force = true;
    }

    const res = await fetch('/api/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let msg = 'Nepodařilo se vytvořit bezpečnou relaci';
      try {
        const errData = await res.json();
        if (errData && errData.error) msg = errData.error;
      } catch {
        // Ignore parse errors and keep generic message.
      }
      throw new Error(msg);
    }

    const data = await res.json();
    sessionUserId = data.userId;

    // Záloha ID v localStorage - prevence ztráty dat po vypršení relace (cookie)
    localStorage.setItem(LEGACY_USER_ID_KEY, sessionUserId);

    return data;
  }

  let history = [];

  // ── API helpers ──
  async function fetchTrips() {
    const res = await fetch('/api/trips', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Nepodařilo se načíst jízdy');
    const data = await res.json();
    // Odstraní user_id z odpovědi — frontend ho nepotřebuje
    history = data.map(({ user_id, ...rest }) => rest);
  }

  async function postTrip(trip) {
    const res = await fetch('/api/trips', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trip),
    });
    if (!res.ok) throw new Error('Nepodařilo se uložit jízdu');
    return res.json();
  }

  async function apiDeleteTrip(id) {
    const res = await fetch(`/api/trips/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('Nepodařilo se smazat jízdu');
  }

  // ── Last refuelling price ──
  function getLastRefuelPrice() {
    if (!history.length) return null;
    const lastTrip = [...history].sort((a, b) => new Date(b.date) - new Date(a.date))[0];

    // Starší záznamy vznikly před přidáním samostatné ceny tankování.
    // Jejich cenu jízdy proto použijeme jako rozumný výchozí údaj.
    return lastTrip.refuel_price ?? lastTrip.refuelPrice ?? lastTrip.price;
  }

  // Do ceny jízdy se dosadí cena z předchozího tankování. Aktuálně tankovaná
  // cena se ukládá zvlášť a použije se až pro další jízdu.
  function fillLastPrice() {
    const lastPrice = getLastRefuelPrice();
    const priceInput = document.getElementById('price');

    if (lastPrice !== null && priceInput.value === '') {
      priceInput.value = lastPrice.toFixed(2);
      calculate();
    }
  }

  // ── Calculate ──
  function calculate() {
    const dist  = parseFloat(document.getElementById('distance').value) || 0;
    const cons  = parseFloat(document.getElementById('consumption').value) || 0;
    const price = parseFloat(document.getElementById('price').value) || 0;

    if (dist <= 0 || cons <= 0 || price <= 0) {
      document.getElementById('resultLiters').textContent = '—';
      document.getElementById('resultCost').textContent   = '—';
      document.getElementById('resultPerKm').textContent  = '—';
      return null;
    }

    const liters = (dist * cons) / 100;
    const cost   = liters * price;
    const perKm  = cost / dist;

    document.getElementById('resultLiters').textContent = liters.toFixed(3);
    document.getElementById('resultCost').textContent   = cost.toFixed(2);
    document.getElementById('resultPerKm').textContent  = perKm.toFixed(2);

    return { liters, cost, perKm };
  }

  // ── Loading state ──
  function setSaveLoading(isLoading) {
    const btn = document.getElementById('btnSave');
    btn.disabled    = isLoading;
    btn.textContent = isLoading ? 'Ukládám...' : 'Uložit tankování a jízdu';
  }

  // ── Save trip ──
  async function saveTrip() {
    const dist  = parseFloat(document.getElementById('distance').value);
    const cons  = parseFloat(document.getElementById('consumption').value);
    const price = parseFloat(document.getElementById('price').value);
    const refuelPrice = parseFloat(document.getElementById('refuelPrice').value);

    if (!dist || !cons || !price || !refuelPrice) {
      showToast(' Vyplň všechna pole!', '#f59e0b', '#451a03');
      return;
    }

    const result = calculate();
    if (!result) return;

    setSaveLoading(true);
    try {
      const saved = await postTrip({
        date:        new Date().toISOString(),
        distance:    dist,
        consumption: cons,
        price:       price,
        refuelPrice: refuelPrice,
        liters:      result.liters,
        cost:        result.cost,
      });

      history.push(saved);

      document.getElementById('distance').value           = '';
      document.getElementById('price').value              = '';
      document.getElementById('refuelPrice').value        = '';
      document.getElementById('resultLiters').textContent = '—';
      document.getElementById('resultCost').textContent   = '—';
      document.getElementById('resultPerKm').textContent  = '—';

      fillLastPrice();
      renderHistory();
      renderStats();
      showToast(' Tankování a jízda uloženy!');
    } catch {
      showToast(' Chyba při ukládání!', '#f59e0b', '#451a03');
    } finally {
      setSaveLoading(false);
    }
  }

  // ── Toast ──
  function showToast(msg, bg = '#22c55e', color = '#052e16') {
    const t = document.getElementById('toast');
    t.textContent      = msg;
    t.style.background = bg;
    t.style.color      = color;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ── Month selector ──
  function buildMonthSelector() {
    const months = {};
    history.forEach(t => {
      const d   = new Date(t.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months[key] = (months[key] || 0) + 1;
    });

    const keys = Object.keys(months).sort().reverse();
    const sel  = document.getElementById('monthSelect');
    const current = sel.value;
    sel.innerHTML = `<option value="all">Všechny měsíce (${history.length})</option>`;

    keys.forEach(k => {
      const [y, m] = k.split('-');
      const label  = new Date(y, m - 1).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' });
      const opt    = document.createElement('option');
      opt.value    = k;
      opt.textContent = `${label} (${months[k]})`;
      sel.appendChild(opt);
    });

    if (current && [...sel.options].some(o => o.value === current)) {
      sel.value = current;
    } else if (keys.length) {
      sel.value = keys[0];
    }
  }

  function getFilteredHistory() {
    const sel = document.getElementById('monthSelect').value;
    if (sel === 'all') return history;
    return history.filter(t => {
      const d   = new Date(t.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return key === sel;
    });
  }

  // ── Render stats ──
  function renderStats() {
    const filtered  = getFilteredHistory();
    const totalKm   = filtered.reduce((s, t) => s + t.distance, 0);
    const totalL    = filtered.reduce((s, t) => s + t.liters, 0);
    const totalCost = filtered.reduce((s, t) => s + t.cost, 0);
    const trips     = filtered.length;

    document.getElementById('statKm').textContent      = totalKm.toFixed(1);
    document.getElementById('statLiters').textContent  = totalL.toFixed(2);
    document.getElementById('statCost').textContent    = Math.round(totalCost);
    document.getElementById('statTrips').textContent   = trips;
    document.getElementById('statAvgKm').textContent   = trips ? (totalKm / trips).toFixed(1) : '0';
    document.getElementById('statAvgCost').textContent = trips ? Math.round(totalCost / trips) : '0';
  }

  // ── Render history ──
  function renderHistory() {
    buildMonthSelector();
    const filtered = getFilteredHistory();
    const el       = document.getElementById('historyList');

    if (!filtered.length) {
      el.innerHTML = `<div class="empty-state">Žádné jízdy v tomto období</div>`;
      return;
    }

    el.innerHTML = filtered.map(trip => {
      const d          = new Date(trip.date);
      const day        = d.getDate();
      const monthShort = d.toLocaleDateString('cs-CZ', { month: 'short' });
      const time       = d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
      const refuelPrice = trip.refuel_price ?? trip.refuelPrice;
      const refuelInfo  = refuelPrice !== undefined && refuelPrice !== null
        ? ` &nbsp;·&nbsp; Tankování: ${Number(refuelPrice).toFixed(2)} Kč/l`
        : '';

      return `
        <div class="history-item">
          <div class="hi-date">
            <div class="day">${day}.</div>
            <div>${monthShort}</div>
            <div>${time}</div>
          </div>
          <div class="hi-body">
            <div class="hi-km">${trip.distance.toFixed(1)} km</div>
            <div class="hi-meta">${trip.consumption} l/100 &nbsp;·&nbsp; Pro jízdu: ${trip.price.toFixed(2)} Kč/l${refuelInfo}</div>
          </div>
          <div class="hi-cost">
            <div class="amount">${trip.cost.toFixed(2)} Kč</div>
            <div class="liters">${trip.liters.toFixed(3)} l</div>
          </div>
          <button class="hi-delete" data-trip-id="${trip.id}" title="Smazat">✕</button>
        </div>
      `;
    }).join('');

    el.querySelectorAll('.hi-delete').forEach((btn) => {
      btn.addEventListener('click', () => handleDeleteTrip(btn.dataset.tripId));
    });
  }

  // ── Delete trip ──
  async function handleDeleteTrip(id) {
    const confirmed = confirm('Opravdu smazat tuto jízdu?');
    if (!confirmed) return;

    try {
      await apiDeleteTrip(id);
      history = history.filter(t => t.id !== id);
      renderHistory();
      renderStats();
      fillLastPrice();
      showToast(' Jízda smazána', '#ef4444', '#450a0a');
    } catch {
      showToast(' Chyba při mazání!', '#f59e0b', '#451a03');
    }
  }

  // ── Clear all ──
  document.getElementById('btnClearAll').onclick = async () => {
    if (!history.length) return;
    if (confirm('Opravdu smazat celou historii?')) {
      try {
        await Promise.all(history.map(t => apiDeleteTrip(t.id)));
        history = [];
        document.getElementById('price').value = '';
        document.getElementById('refuelPrice').value = '';
        priceMirrorsRefuelPrice = false;
        renderHistory();
        renderStats();
        fillLastPrice();
        showToast(' Historie smazána', '#ef4444', '#450a0a');
      } catch {
        showToast(' Chyba při mazání!', '#f59e0b', '#451a03');
      }
    }
  };

  // ── Event listeners ──
  document.getElementById('btnSave').onclick = saveTrip;

  ['distance', 'consumption'].forEach(id => {
    document.getElementById(id).addEventListener('input', calculate);
  });

  let priceMirrorsRefuelPrice = false;
  document.getElementById('price').addEventListener('input', () => {
    priceMirrorsRefuelPrice = false;
    calculate();
  });

  document.getElementById('refuelPrice').addEventListener('input', () => {
    // U prvního záznamu není k dispozici dřívější cena. Použijeme proto
    // aktuálně zadanou cenu také pro výpočet této jízdy.
    if (getLastRefuelPrice() === null &&
        (document.getElementById('price').value === '' || priceMirrorsRefuelPrice)) {
      document.getElementById('price').value = document.getElementById('refuelPrice').value;
      priceMirrorsRefuelPrice = true;
      calculate();
    }
  });

  document.getElementById('monthSelect').addEventListener('change', () => {
    renderHistory();
    renderStats();
  });

  document.getElementById('btnResetFilter').addEventListener('click', () => {
    document.getElementById('monthSelect').value = 'all';
    renderHistory();
    renderStats();
  });

  // ── Settings drawer ──
  
  // ── Dark Mode Logic ──
  function initDarkMode() {
    const dmToggle = document.getElementById('darkModeToggle');
    const dmKnob = document.getElementById('dmKnob');
    
    // Zjistit, jestli má být tmavý režim (z localStorage nebo systému)
    const isDark = localStorage.getItem('dark-mode') === 'true' || 
                  (localStorage.getItem('dark-mode') === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
                  
    // Aktualizuje theme-color meta tag podle aktuálního barevného schématu (status bar v PWA)
    function updateThemeColor(dark) {
      document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove());
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = dark ? '#121212' : '#f4f4f5';
      document.head.appendChild(meta);
    }

    if (isDark) {
      document.documentElement.classList.add('dark');
      updateThemeColor(true);
      if (dmToggle && dmKnob) {
          dmToggle.checked = true;
          dmKnob.style.transform = 'translate(28px, 0)';
          dmKnob.style.background = 'var(--bg-card)';
      }
    }

    if (dmToggle && dmKnob) {
      dmToggle.addEventListener('change', (e) => {
          if(e.target.checked) {
              document.documentElement.classList.add('dark');
              localStorage.setItem('dark-mode', 'true');
              updateThemeColor(true);
              dmKnob.style.transform = 'translate(28px, 0)';
              dmKnob.style.background = 'var(--bg-card)';
          } else {
              document.documentElement.classList.remove('dark');
              localStorage.setItem('dark-mode', 'false');
              updateThemeColor(false);
              dmKnob.style.transform = 'translate(0, 0)';
              dmKnob.style.background = 'var(--text-main)';
          }
      });
    }
  }

  function initSettings() {
    const overlay = document.getElementById('settingsOverlay');
    const drawer  = document.getElementById('settingsDrawer');
    const importInput = document.getElementById('importIdInput');
    const importButton = document.getElementById('btnImportId');

    function openSettings() {
      overlay.classList.add('open');
      drawer.classList.add('open');
    }
    function closeSettings() {
      overlay.classList.remove('open');
      drawer.classList.remove('open');
    }

    document.getElementById('btnOpenSettings').onclick = openSettings;
    document.getElementById('btnCloseSettings').onclick = closeSettings;
    // Klik na overlay zavře drawer
    overlay.onclick = closeSettings;
    // Escape zavře drawer
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

    // Zobraz aktuální serverovou identitu session
    document.getElementById('deviceIdDisplay').textContent = sessionUserId || '—';

    // Kopírování ID do schránky
    document.getElementById('btnCopyId').onclick = async () => {
      if (!sessionUserId) {
        showToast(' ID není zatím dostupné', '#f59e0b', '#451a03');
        return;
      }
      try {
        await navigator.clipboard.writeText(sessionUserId);
        showToast(' ID zkopírováno!');
      } catch {
        showToast(' Kopírování selhalo', '#f59e0b', '#451a03');
      }
    };

    const handleImport = async () => {
      const targetId = importInput.value.trim();

      if (!targetId) {
        showToast(' Vlož ID zařízení', '#f59e0b', '#451a03');
        return;
      }

      if (targetId === sessionUserId) {
        showToast(' Už používáš toto ID');
        return;
      }

      const confirmed = confirm(
        'Přepnout zařízení na importované ID? Aktuální lokální relace bude nahrazena.'
      );
      if (!confirmed) return;

      importButton.disabled = true;
      importButton.textContent = 'Importuji...';

      try {
        await ensureSession({ legacyUserId: targetId, force: true });
        await fetchTrips();
        document.getElementById('deviceIdDisplay').textContent = sessionUserId || '—';
        importInput.value = '';
        document.getElementById('price').value = '';
        document.getElementById('refuelPrice').value = '';
        fillLastPrice();
        renderHistory();
        renderStats();
        showToast(' ID importováno, data načtena');
      } catch (err) {
        showToast(` ${err.message || 'Import selhal'}`, '#f59e0b', '#451a03');
      } finally {
        importButton.disabled = false;
        importButton.textContent = 'Importovat ID';
      }
    };

    importButton.onclick = handleImport;
    importInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleImport();
      }
    });
  }

  // ── Init ──
  async function init() {
    try {
      await ensureSession();
      await fetchTrips();
    } catch {
      showToast(' Nepodařilo se inicializovat aplikaci', '#f59e0b', '#451a03');
    }
    fillLastPrice();
    renderHistory();
    renderStats();
    initSettings();
    initDarkMode();
  }

  init();
