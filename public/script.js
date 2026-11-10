(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LOCALE = 'cs-CZ';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ── Formátování čísel ──
  const numberFormats = new Map();
  function fmt(value, decimals = 2) {
    let nf = numberFormats.get(decimals);
    if (!nf) {
      nf = new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      numberFormats.set(decimals, nf);
    }
    return nf.format(Number(value) || 0);
  }

  // Částka s menšími desetinami: <int><,dec><měna>
  function amountHTML(value, decimals = 2, currency = 'Kč') {
    const [int, dec] = fmt(value, decimals).split(',');
    return (
      `<span class="amount-int">${int}</span>` +
      (dec !== undefined ? `<span class="amount-dec">,${dec}</span>` : '') +
      (currency ? `<span class="amount-cur">${currency}</span>` : '')
    );
  }

  // Plynulé „dopočítání“ čísla (respektuje omezení animací)
  function animateAmount(el, to, { decimals = 2, currency = 'Kč', from } = {}) {
    if (el._raf) cancelAnimationFrame(el._raf);
    const start = from !== undefined ? from : (el._value || 0);
    el._value = to;

    if (reducedMotion.matches || start === to) {
      el.innerHTML = amountHTML(to, decimals, currency);
      return;
    }

    const duration = 650;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 4);
      el.innerHTML = amountHTML(start + (to - start) * eased, decimals, currency);
      if (p < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  function plural(n, one, few, many) {
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return few;
    return many;
  }

  function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function monthKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function monthDate(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }

  function monthLabel(key, { withYear = 'auto' } = {}) {
    const d = monthDate(key);
    const showYear = withYear === true || (withYear === 'auto' && d.getFullYear() !== new Date().getFullYear());
    return d.toLocaleDateString(LOCALE, showYear ? { month: 'long', year: 'numeric' } : { month: 'long' });
  }

  function icon(id, size = 20) {
    return `<svg width="${size}" height="${size}" aria-hidden="true"><use href="#${id}"/></svg>`;
  }

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

  // ── Stav aplikace ──
  let trips = [];
  let isLoading = true;
  let selectedMonth = null; // 'all' | 'YYYY-MM'
  let activeView = 'entry';
  let openTripId = null;

  function sortTrips() {
    trips.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  // ── API helpers ──
  async function fetchTrips() {
    const res = await fetch('/api/trips', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Nepodařilo se načíst jízdy');
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Nepodařilo se načíst jízdy');
    // Odstraní user_id z odpovědi — frontend ho nepotřebuje
    trips = data.map(({ user_id, ...rest }) => rest);
    sortTrips();
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
    const res = await fetch(`/api/trips/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('Nepodařilo se smazat jízdu');
  }

  // ── Last refuelling price ──
  function getRefuelPrice(trip) {
    // Starší záznamy vznikly před přidáním samostatné ceny tankování.
    // Jejich cenu jízdy proto použijeme jako rozumný výchozí údaj.
    const value = trip.refuel_price ?? trip.refuelPrice ?? trip.price;
    return value === null || value === undefined ? null : Number(value);
  }

  function getLastRefuelPrice() {
    if (!trips.length) return null;
    const lastTrip = [...trips].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    return getRefuelPrice(lastTrip);
  }

  // Do ceny jízdy se dosadí cena z předchozího tankování. Aktuálně tankovaná
  // cena se ukládá zvlášť a použije se až pro další jízdu.
  function fillLastPrice() {
    const lastPrice = getLastRefuelPrice();
    const priceInput = $('price');

    if (lastPrice !== null && priceInput.value === '') {
      priceInput.value = toInputValue(lastPrice, 2);
      calculate();
    }
    updatePriceHint();
  }

  function updatePriceHint() {
    const lastPrice = getLastRefuelPrice();
    $('priceHint').textContent = lastPrice !== null
      ? `Doplněno z minulého tankování (${fmt(lastPrice, 2)} Kč/l). Můžeš ji přepsat.`
      : 'U první jízdy použijeme dnešní cenu za litr.';
  }

  // ── Calculate ──
  const inputIds = ['refuelPrice', 'distance', 'consumption', 'price'];

  // Pole jsou textová (inputmode=decimal), aby šla psát česká desetinná čárka
  function parseDecimal(value) {
    return parseFloat(String(value).replace(/\s/g, '').replace(',', '.'));
  }

  function readNumber(id) {
    return parseDecimal($(id).value);
  }

  function toInputValue(value, decimals) {
    return Number(value).toFixed(decimals).replace('.', ',');
  }

  // Povolí jen číslice a jeden desetinný oddělovač (zobrazený jako čárka)
  function sanitizeDecimalInput(input) {
    const raw = input.value;
    let clean = raw.replace(/[^\d.,]/g, '').replace(/\./g, ',');
    const firstComma = clean.indexOf(',');
    if (firstComma !== -1) {
      clean = clean.slice(0, firstComma + 1) + clean.slice(firstComma + 1).replace(/,/g, '');
    }
    if (clean !== raw) {
      const pos = input.selectionStart;
      input.value = clean;
      if (pos !== null) {
        const p = Math.max(0, pos - (raw.length - clean.length));
        try { input.setSelectionRange(p, p); } catch { /* některé typy výběr nepodporují */ }
      }
    }
  }

  function calculate() {
    const dist  = readNumber('distance') || 0;
    const cons  = readNumber('consumption') || 0;
    const price = readNumber('price') || 0;
    const costEl = $('resultCost');

    if (dist <= 0 || cons <= 0 || price <= 0) {
      costEl.classList.add('is-empty');
      costEl.innerHTML = amountHTML(0);
      costEl._value = 0;
      $('resultLiters').textContent = '—';
      $('resultPerKm').textContent  = '—';
      return null;
    }

    const liters = (dist * cons) / 100;
    const cost   = liters * price;
    const perKm  = cost / dist;

    costEl.classList.remove('is-empty');
    costEl.innerHTML = amountHTML(cost);
    costEl._value = cost;
    $('resultLiters').textContent = `${fmt(liters, 2)} l`;
    $('resultPerKm').textContent  = `${fmt(perKm, 2)} Kč`;

    return { liters, cost, perKm };
  }

  // ── Loading state ──
  function setSaveLoading(isSaving) {
    const btn = $('btnSave');
    btn.disabled = isSaving;
    btn.setAttribute('aria-busy', String(isSaving));
    btn.innerHTML = isSaving
      ? '<span class="spinner" aria-hidden="true"></span><span>Ukládám…</span>'
      : 'Uložit tankování a jízdu';
  }

  function markInvalid(ids) {
    ids.forEach((id) => {
      const row = $(id).closest('.row');
      row.classList.remove('is-invalid');
      // Restart animace
      void row.offsetWidth;
      row.classList.add('is-invalid');
      $(id).setAttribute('aria-invalid', 'true');
    });
  }

  function clearInvalid(id) {
    $(id).closest('.row').classList.remove('is-invalid');
    $(id).removeAttribute('aria-invalid');
  }

  // ── Save trip ──
  async function saveTrip(event) {
    if (event) event.preventDefault();

    const values = {
      refuelPrice: readNumber('refuelPrice'),
      distance: readNumber('distance'),
      consumption: readNumber('consumption'),
      price: readNumber('price'),
    };
    const missing = inputIds.filter((id) => !(values[id] > 0));

    if (missing.length) {
      markInvalid(missing);
      $(missing[0]).focus();
      showToast('Vyplň všechna pole', 'error');
      return;
    }

    const result = calculate();
    if (!result) return;

    setSaveLoading(true);
    try {
      const saved = await postTrip({
        date:        new Date().toISOString(),
        distance:    values.distance,
        consumption: values.consumption,
        price:       values.price,
        refuelPrice: values.refuelPrice,
        liters:      result.liters,
        cost:        result.cost,
      });

      trips.push(saved);
      sortTrips();

      $('distance').value    = '';
      $('price').value       = '';
      $('refuelPrice').value = '';
      priceMirrorsRefuelPrice = false;
      calculate();

      fillLastPrice();
      renderAll();
      if (navigator.vibrate) navigator.vibrate(12);
      showToast('Tankování a jízda uloženy');
    } catch {
      showToast('Uložení se nepovedlo', 'error');
    } finally {
      setSaveLoading(false);
    }
  }

  // ── Toast ──
  let toastTimer = null;
  function showToast(message, tone = 'success') {
    const toast = $('toast');
    const icons = { success: 'i-check', error: 'i-alert', info: 'i-check' };
    $('toastText').textContent = message;
    $('toastIcon').innerHTML = icon(icons[tone] || 'i-check', 14);
    toast.dataset.tone = tone;

    // Otevřený dialog je v top-layer — toast přesuneme do něj, aby byl vidět
    const host = openSheets[openSheets.length - 1] || document.body;
    if (toast.parentNode !== host) {
      toast.classList.remove('is-visible');
      host.appendChild(toast);
      void toast.offsetWidth;
    }
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  // ── Výběr období ──
  function getMonthCounts() {
    const months = new Map();
    trips.forEach((t) => {
      const key = monthKey(t.date);
      months.set(key, (months.get(key) || 0) + 1);
    });
    return months;
  }

  function syncSelectedMonth() {
    const months = getMonthCounts();
    const keys = [...months.keys()].sort().reverse();
    if (!keys.length) {
      // Bez dat nic nevybíráme — po načtení se zvolí nejnovější měsíc
      selectedMonth = null;
      return;
    }
    if (selectedMonth === 'all') return;
    if (selectedMonth && months.has(selectedMonth)) return;
    selectedMonth = keys[0];
  }

  function renderMonthChips() {
    const months = getMonthCounts();
    const keys = [...months.keys()].sort().reverse();

    const chip = (value, label, count) => {
      const pressed = value === selectedMonth;
      return `<button type="button" class="chip" data-month="${value}" aria-pressed="${pressed}">` +
        `${escapeHTML(capitalize(label))}<span class="chip-count">${count}</span></button>`;
    };

    const html = chip('all', 'Vše', trips.length) +
      keys.map((k) => chip(k, monthLabel(k), months.get(k))).join('');

    document.querySelectorAll('[data-month-chips]').forEach((container) => {
      container.innerHTML = html;
      container.hidden = trips.length === 0;
      const active = container.querySelector('[aria-pressed="true"]');
      if (active && container.offsetParent !== null) {
        container.scrollLeft = Math.max(0, active.offsetLeft - container.clientWidth / 2 + active.clientWidth / 2);
      }
    });
  }

  function selectMonth(value) {
    if (value === selectedMonth) return;
    selectedMonth = value;
    renderMonthChips();
    renderStats();
    renderHistory();
  }

  function getFilteredTrips() {
    if (selectedMonth === 'all' || !selectedMonth) return trips;
    return trips.filter((t) => monthKey(t.date) === selectedMonth);
  }

  // ── Render stats ──
  function renderStats({ animate = false } = {}) {
    const filtered  = getFilteredTrips();
    const totalKm   = filtered.reduce((s, t) => s + Number(t.distance), 0);
    const totalL    = filtered.reduce((s, t) => s + Number(t.liters), 0);
    const totalCost = filtered.reduce((s, t) => s + Number(t.cost), 0);
    const count     = filtered.length;

    $('statPeriodLabel').textContent = selectedMonth === 'all' || !selectedMonth
      ? 'Náklady celkem'
      : `Náklady · ${monthLabel(selectedMonth, { withYear: true })}`;

    animateAmount($('statCost'), totalCost, { decimals: 0, from: animate ? 0 : undefined });

    $('statSummary').textContent = count
      ? `${count} ${plural(count, 'jízda', 'jízdy', 'jízd')} · ${fmt(totalKm, 0)} km`
      : (trips.length ? 'V tomto období nejsou žádné jízdy' : 'Zatím žádné jízdy');

    $('statKm').textContent      = fmt(totalKm, 1);
    $('statLiters').textContent  = fmt(totalL, 1);
    $('statTrips').textContent   = String(count);
    $('statAvgCons').textContent = totalKm ? fmt((totalL / totalKm) * 100, 1) : fmt(0, 1);
    $('statAvgKm').textContent   = count ? fmt(totalKm / count, 1) : fmt(0, 1);
    $('statAvgCost').textContent = count ? fmt(totalCost / count, 0) : '0';

    renderChart({ animate });
  }

  function renderChart({ animate = false } = {}) {
    const chart = $('costChart');
    const now = new Date();
    let end = new Date(now.getFullYear(), now.getMonth(), 1);

    // Pokud je vybraný měsíc mimo posledních 6 měsíců, posuň okno na něj
    if (selectedMonth && selectedMonth !== 'all') {
      const sel = monthDate(selectedMonth);
      const start = new Date(end.getFullYear(), end.getMonth() - 5, 1);
      if (sel < start || sel > end) end = sel;
    }

    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
      months.push(monthKey(d));
    }

    const totals = new Map(months.map((k) => [k, 0]));
    trips.forEach((t) => {
      const k = monthKey(t.date);
      if (totals.has(k)) totals.set(k, totals.get(k) + Number(t.cost));
    });

    const values = months.map((k) => totals.get(k));
    const max = Math.max(...values, 0);
    const nonZero = values.filter((v) => v > 0);
    const avg = nonZero.length ? nonZero.reduce((s, v) => s + v, 0) / nonZero.length : 0;

    $('chartAvg').textContent = avg ? `Ø ${fmt(avg, 0)} Kč / měsíc` : '';
    chart.classList.toggle('is-all', selectedMonth === 'all');

    const key = months.join(',');
    const rebuild = chart.dataset.key !== key;
    if (rebuild) {
      chart.dataset.key = key;
      chart.innerHTML = '<div class="chart-avg" aria-hidden="true"></div>' + months.map((k) => `
        <button type="button" class="chart-col" data-month="${k}">
          <span class="chart-track">
            <span class="chart-bar"></span>
            <span class="chart-value"></span>
          </span>
          <span class="chart-label">${escapeHTML(monthDate(k).toLocaleDateString(LOCALE, { month: 'short' }).replace('.', ''))}</span>
        </button>`).join('');
    }

    const cols = chart.querySelectorAll('.chart-col');
    const ratios = values.map((v) => (max ? v / max : 0));

    cols.forEach((col, i) => {
      const k = months[i];
      const v = values[i];
      col.classList.toggle('is-selected', k === selectedMonth);
      col.classList.toggle('is-empty', v === 0);
      col.disabled = v === 0;
      col.setAttribute('aria-pressed', String(k === selectedMonth));
      col.setAttribute('aria-label', `${capitalize(monthLabel(k, { withYear: true }))}: ${fmt(v, 0)} Kč`);
      col.querySelector('.chart-value').textContent = `${fmt(v, 0)} Kč`;
    });

    const avgLine = chart.querySelector('.chart-avg');
    const setHeights = (zero) => {
      cols.forEach((col, i) => {
        const pct = zero ? 0 : ratios[i] * 100;
        col.querySelector('.chart-bar').style.height = `${pct}%`;
        col.querySelector('.chart-value').style.bottom = `calc(${pct}% + 6px)`;
      });
      const avgRatio = zero || !max ? 0 : avg / max;
      avgLine.style.bottom = `calc(24px + (100% - 44px) * ${avgRatio})`;
      avgLine.style.opacity = avg && !zero ? '1' : '0';
    };

    if ((animate || rebuild) && !reducedMotion.matches) {
      setHeights(true);
      // Dvojitý rAF zajistí, že prohlížeč nejdřív vykreslí nulovou výšku
      requestAnimationFrame(() => requestAnimationFrame(() => setHeights(false)));
    } else {
      setHeights(false);
    }
  }

  // ── Render history ──
  function dayLabel(date) {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

    if (sameDay(d, today)) return 'Dnes';
    if (sameDay(d, yesterday)) return 'Včera';
    const opts = { weekday: 'long', day: 'numeric', month: 'long' };
    if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
    return capitalize(d.toLocaleDateString(LOCALE, opts));
  }

  function renderHistory() {
    const el = $('historyList');

    if (isLoading) {
      el.innerHTML = `<div class="group skeleton" aria-hidden="true">${'<div class="skeleton-row"><span></span><span></span></div>'.repeat(3)}</div>`;
      return;
    }

    if (!trips.length) {
      el.innerHTML = `
        <div class="empty">
          <span class="empty-icon">${icon('i-pump', 28)}</span>
          <p class="empty-title">Zatím žádné jízdy</p>
          <p class="empty-text">Ulož první tankování a tady uvidíš přehled všech jízd.</p>
          <button type="button" class="btn btn-primary" data-goto="entry">${icon('i-plus', 18)}<span>Přidat jízdu</span></button>
        </div>`;
      return;
    }

    const filtered = getFilteredTrips();
    if (!filtered.length) {
      el.innerHTML = `
        <div class="empty">
          <span class="empty-icon">${icon('i-list', 28)}</span>
          <p class="empty-title">Žádné jízdy</p>
          <p class="empty-text">V tomto období nic není. Zkus vybrat jiný měsíc.</p>
        </div>`;
      return;
    }

    // Seskupení po dnech
    const groups = [];
    let current = null;
    filtered.forEach((trip) => {
      const d = new Date(trip.date);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!current || current.key !== key) {
        current = { key, date: trip.date, trips: [], total: 0 };
        groups.push(current);
      }
      current.trips.push(trip);
      current.total += Number(trip.cost);
    });

    el.innerHTML = groups.map((g) => `
      <section class="day">
        <h3 class="day-head">
          <span class="day-name">${escapeHTML(dayLabel(g.date))}</span>
          <span class="day-total">${fmt(g.total, 2)} Kč</span>
        </h3>
        <div class="group">
          ${g.trips.map((trip) => {
            const time = new Date(trip.date).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
            return `
            <button type="button" class="trip" data-trip-id="${escapeHTML(trip.id)}"
              aria-label="Jízda ${fmt(trip.distance, 1)} km za ${fmt(trip.cost, 2)} Kč, ${escapeHTML(time)}">
              <span class="trip-icon">${icon('i-drop', 20)}</span>
              <span class="trip-main">
                <span class="trip-title">${fmt(trip.distance, 1)} km</span>
                <span class="trip-sub">${escapeHTML(time)} · ${fmt(trip.consumption, 1)} l/100 km</span>
              </span>
              <span class="trip-end">
                <span class="trip-amount amount">${amountHTML(trip.cost)}</span>
                <span class="trip-sub">${fmt(trip.liters, 2)} l</span>
              </span>
            </button>`;
          }).join('')}
        </div>
      </section>`).join('');
  }

  function renderAll() {
    syncSelectedMonth();
    renderMonthChips();
    renderStats();
    renderHistory();
    updatePriceHint();
  }

  // ── Sheets (bottom sheet / dialog) ──
  const openSheets = [];

  function openSheet(dialog) {
    if (dialog.open) return;
    dialog._returnFocus = document.activeElement;
    dialog.style.removeProperty('--drag');
    dialog.showModal();
    openSheets.push(dialog);
    document.documentElement.classList.add('has-sheet');
    requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add('is-open')));
  }

  function closeSheet(dialog) {
    return new Promise((resolve) => {
      if (!dialog.open || dialog._closing) return resolve();
      dialog._closing = true;
      dialog.classList.remove('is-open', 'is-dragging');
      dialog.style.removeProperty('--drag');

      const finish = () => {
        dialog.close();
        dialog._closing = false;
        const idx = openSheets.indexOf(dialog);
        if (idx !== -1) openSheets.splice(idx, 1);
        if (!openSheets.length) document.documentElement.classList.remove('has-sheet');
        const target = dialog._returnFocus;
        if (target && document.contains(target) && typeof target.focus === 'function') {
          target.focus({ preventScroll: true });
        }
        dialog.dispatchEvent(new CustomEvent('sheetclose'));
        resolve();
      };

      if (reducedMotion.matches) finish();
      else setTimeout(finish, 360);
    });
  }

  function initSheet(dialog) {
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeSheet(dialog);
    });

    dialog.addEventListener('click', (e) => {
      if (e.target.closest('[data-sheet-close]')) closeSheet(dialog);
    });

    // Zavření tažením dolů za hlavičku sheetu
    const handle = dialog.querySelector('.sheet-head');
    if (!handle) return;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let dragging = false;

    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || window.matchMedia('(min-width: 640px)').matches) return;
      dragging = true;
      startY = lastY = e.clientY;
      lastT = performance.now();
      velocity = 0;
      handle.setPointerCapture(e.pointerId);
      dialog.classList.add('is-dragging');
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const now = performance.now();
      velocity = (e.clientY - lastY) / Math.max(1, now - lastT);
      lastY = e.clientY;
      lastT = now;
      const dy = e.clientY - startY;
      // Nahoru jen s odporem
      const offset = dy > 0 ? dy : dy / 6;
      dialog.style.setProperty('--drag', `${offset}px`);
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      dialog.classList.remove('is-dragging');
      const dy = e.clientY - startY;
      if (dy > 110 || (dy > 30 && velocity > 0.6)) {
        closeSheet(dialog);
      } else {
        dialog.style.setProperty('--drag', '0px');
      }
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  // Potvrzovací dialog místo nativního confirm()
  function confirmSheet({ title, message, confirmLabel, destructive = false }) {
    const dialog = $('confirmSheet');
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    const ok = $('confirmOk');
    ok.textContent = confirmLabel;
    ok.classList.toggle('is-destructive', destructive);
    $('confirmIcon').classList.toggle('is-destructive', destructive);
    $('confirmIcon').innerHTML = icon(destructive ? 'i-trash' : 'i-alert', 22);

    return new Promise((resolve) => {
      let result = false;
      const onOk = () => {
        result = true;
        closeSheet(dialog);
      };
      ok.addEventListener('click', onOk, { once: true });
      dialog.addEventListener('sheetclose', () => {
        ok.removeEventListener('click', onOk);
        resolve(result);
      }, { once: true });
      openSheet(dialog);
      // Bezpečnější výchozí volba je „Zrušit“
      requestAnimationFrame(() => $('confirmCancel').focus());
    });
  }

  // ── Detail jízdy ──
  function openTrip(id) {
    const trip = trips.find((t) => String(t.id) === String(id));
    if (!trip) return;
    openTripId = trip.id;

    const d = new Date(trip.date);
    const dateText = d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeText = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
    $('tripSheetCost').innerHTML = amountHTML(trip.cost);
    $('tripSheetDate').textContent = `${capitalize(dateText)} · ${timeText}`;

    const refuel = trip.refuel_price ?? trip.refuelPrice;
    const rows = [
      ['Vzdálenost', `${fmt(trip.distance, 1)} km`],
      ['Spotřeba', `${fmt(trip.consumption, 1)} l/100 km`],
      ['Spotřebováno', `${fmt(trip.liters, 3)} l`],
      ['Cena paliva pro jízdu', `${fmt(trip.price, 2)} Kč/l`],
    ];
    if (refuel !== undefined && refuel !== null) rows.push(['Cena při tankování', `${fmt(refuel, 2)} Kč/l`]);
    if (Number(trip.distance) > 0) rows.push(['Cena za km', `${fmt(Number(trip.cost) / Number(trip.distance), 2)} Kč`]);

    $('tripSheetRows').innerHTML = rows.map(([label, value]) =>
      `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${value}</span></div>`
    ).join('');

    openSheet($('tripSheet'));
  }

  async function handleDeleteTrip() {
    const id = openTripId;
    if (!id) return;

    const confirmed = await confirmSheet({
      title: 'Smazat jízdu?',
      message: 'Jízda zmizí z historie i ze statistik. Tuto akci nelze vrátit.',
      confirmLabel: 'Smazat jízdu',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await apiDeleteTrip(id);
      trips = trips.filter((t) => t.id !== id);
      openTripId = null;
      await closeSheet($('tripSheet'));
      renderAll();
      fillLastPrice();
      showToast('Jízda smazána');
    } catch {
      showToast('Smazání se nepovedlo', 'error');
    }
  }

  // ── Clear all ──
  async function handleClearAll() {
    if (!trips.length) {
      showToast('Historie je prázdná', 'info');
      return;
    }

    const confirmed = await confirmSheet({
      title: 'Smazat celou historii?',
      message: `Smaže se ${trips.length} ${plural(trips.length, 'jízda', 'jízdy', 'jízd')} včetně statistik. Tuto akci nelze vrátit.`,
      confirmLabel: 'Smazat vše',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await Promise.all(trips.map((t) => apiDeleteTrip(t.id)));
      trips = [];
      $('price').value = '';
      $('refuelPrice').value = '';
      priceMirrorsRefuelPrice = false;
      selectedMonth = null;
      calculate();
      renderAll();
      fillLastPrice();
      showToast('Historie smazána');
    } catch {
      // Část jízd mohla být smazána — načteme aktuální stav ze serveru
      try {
        await fetchTrips();
        renderAll();
      } catch {
        // Ignorujeme, chybu oznámíme níže.
      }
      showToast('Smazání se nepovedlo', 'error');
    }
  }

  // ── Navigace (tab bar) ──
  const VIEWS = ['entry', 'stats', 'history'];
  const HASHES = { entry: '#jizda', stats: '#prehled', history: '#historie' };
  const scrollPositions = {};

  function switchView(name, { initial = false } = {}) {
    if (!VIEWS.includes(name)) name = 'entry';
    if (name === activeView && !initial) {
      // Opakovaný tap na aktivní záložku = scroll nahoru
      window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      return;
    }

    scrollPositions[activeView] = window.scrollY;
    activeView = name;

    VIEWS.forEach((v) => {
      const section = $(`view-${v}`);
      const isActive = v === name;
      section.hidden = !isActive;
      section.classList.toggle('is-active', isActive);
      if (isActive && !initial) {
        section.classList.remove('is-entering');
        void section.offsetWidth;
        section.classList.add('is-entering');
      }
    });

    const index = VIEWS.indexOf(name);
    document.querySelectorAll('.tab').forEach((tab) => {
      const isActive = tab.dataset.view === name;
      tab.classList.toggle('is-active', isActive);
      if (isActive) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    $('tabIndicator').style.transform = `translateX(${index * 100}%)`;
    $('topbarTitle').textContent = $(`view-${name}`).dataset.title;

    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', HASHES[name]);
    }

    if (name === 'stats' || name === 'history') renderMonthChips();
    if (name === 'stats' && !initial) renderStats({ animate: true });

    window.scrollTo(0, initial ? 0 : (scrollPositions[name] || 0));
    updateTopbar();
  }

  function viewFromHash() {
    const entry = Object.entries(HASHES).find(([, hash]) => hash === window.location.hash);
    return entry ? entry[0] : 'entry';
  }

  // Kompaktní titulek v horní liště po odscrollování velkého nadpisu
  let topbarTicking = false;
  function updateTopbar() {
    const title = document.querySelector('.view.is-active .large-title');
    const threshold = title ? title.offsetTop + title.offsetHeight - 52 : 40;
    $('topbar').classList.toggle('is-scrolled', window.scrollY > Math.max(8, threshold));
  }

  // ── Nastavení ──
  function initThemeControl() {
    const control = $('themeControl');
    const thumb = control.querySelector('.segmented-thumb');
    const buttons = [...control.querySelectorAll('[data-theme-value]')];

    const sync = () => {
      const pref = window.FuelTheme ? window.FuelTheme.get() : 'auto';
      buttons.forEach((btn, i) => {
        const on = btn.dataset.themeValue === pref;
        btn.setAttribute('aria-pressed', String(on));
        if (on) thumb.style.transform = `translateX(${i * 100}%)`;
      });
    };

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.FuelTheme) window.FuelTheme.set(btn.dataset.themeValue);
        sync();
      });
    });
    sync();
  }

  function initSettings() {
    const importInput = $('importIdInput');
    const importButton = $('btnImportId');
    const copyButton = $('btnCopyId');
    let copyTimer = null;

    $('btnOpenSettings').addEventListener('click', () => {
      $('deviceIdDisplay').textContent = sessionUserId || '—';
      openSheet($('settingsSheet'));
    });

    // Kopírování ID do schránky
    copyButton.addEventListener('click', async () => {
      if (!sessionUserId) {
        showToast('ID zatím není k dispozici', 'error');
        return;
      }
      try {
        await navigator.clipboard.writeText(sessionUserId);
        copyButton.classList.add('is-done');
        copyButton.innerHTML = `${icon('i-check', 16)}<span>Zkopírováno</span>`;
        showToast('ID zkopírováno');
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => {
          copyButton.classList.remove('is-done');
          copyButton.innerHTML = `${icon('i-copy', 16)}<span>Kopírovat</span>`;
        }, 2000);
      } catch {
        showToast('Kopírování se nepovedlo', 'error');
      }
    });

    const handleImport = async () => {
      const targetId = importInput.value.trim();

      if (!targetId) {
        showToast('Vlož ID zařízení', 'error');
        importInput.focus();
        return;
      }

      if (targetId === sessionUserId) {
        showToast('Už používáš toto ID', 'info');
        return;
      }

      const confirmed = await confirmSheet({
        title: 'Přepnout na jiné ID?',
        message: 'Aktuální relace v tomto prohlížeči bude nahrazena a načtou se data z importovaného ID. Své současné ID si předem ulož.',
        confirmLabel: 'Přepnout',
      });
      if (!confirmed) return;

      importButton.disabled = true;
      importButton.textContent = 'Importuji…';

      try {
        await ensureSession({ legacyUserId: targetId, force: true });
        await fetchTrips();
        $('deviceIdDisplay').textContent = sessionUserId || '—';
        importInput.value = '';
        $('price').value = '';
        $('refuelPrice').value = '';
        priceMirrorsRefuelPrice = false;
        selectedMonth = null;
        calculate();
        fillLastPrice();
        renderAll();
        showToast('ID importováno, data načtena');
      } catch (err) {
        showToast((err && err.message) || 'Import se nepovedl', 'error');
      } finally {
        importButton.disabled = false;
        importButton.textContent = 'Importovat';
      }
    };

    importButton.addEventListener('click', handleImport);
    importInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleImport();
      }
    });

    $('btnClearAll').addEventListener('click', handleClearAll);
    $('btnDeleteTrip').addEventListener('click', handleDeleteTrip);
  }

  // ── Event listeners ──
  let priceMirrorsRefuelPrice = false;

  function initForm() {
    $('entryForm').addEventListener('submit', saveTrip);

    inputIds.forEach((id) => {
      $(id).addEventListener('input', () => sanitizeDecimalInput($(id)));
    });

    ['distance', 'consumption'].forEach((id) => {
      $(id).addEventListener('input', () => {
        clearInvalid(id);
        calculate();
      });
    });

    $('price').addEventListener('input', () => {
      clearInvalid('price');
      priceMirrorsRefuelPrice = false;
      calculate();
    });

    $('refuelPrice').addEventListener('input', () => {
      clearInvalid('refuelPrice');
      // U prvního záznamu není k dispozici dřívější cena. Použijeme proto
      // aktuálně zadanou cenu také pro výpočet této jízdy.
      if (getLastRefuelPrice() === null &&
          ($('price').value === '' || priceMirrorsRefuelPrice)) {
        $('price').value = $('refuelPrice').value;
        priceMirrorsRefuelPrice = true;
        clearInvalid('price');
        calculate();
      }
    });

    // Enter přeskočí na další pole, u posledního odešle formulář
    inputIds.forEach((id, i) => {
      $(id).addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const next = inputIds[i + 1];
        if (next) $(next).focus();
        else $('entryForm').requestSubmit ? $('entryForm').requestSubmit() : saveTrip();
      });
    });
  }

  function initNavigation() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    // Výběr měsíce (chipy i sloupce grafu) + otevření detailu jízdy
    document.addEventListener('click', (e) => {
      const monthBtn = e.target.closest('[data-month]');
      if (monthBtn && !monthBtn.disabled) {
        selectMonth(monthBtn.dataset.month);
        return;
      }
      const tripBtn = e.target.closest('[data-trip-id]');
      if (tripBtn) {
        openTrip(tripBtn.dataset.tripId);
        return;
      }
      const gotoBtn = e.target.closest('[data-goto]');
      if (gotoBtn) {
        switchView(gotoBtn.dataset.goto);
        $('refuelPrice').focus({ preventScroll: true });
      }
    });

    window.addEventListener('scroll', () => {
      if (topbarTicking) return;
      topbarTicking = true;
      requestAnimationFrame(() => {
        updateTopbar();
        topbarTicking = false;
      });
    }, { passive: true });

    window.addEventListener('hashchange', () => switchView(viewFromHash()));
  }

  // ── Init ──
  async function init() {
    document.querySelectorAll('dialog.sheet').forEach(initSheet);
    initForm();
    initNavigation();
    initSettings();
    initThemeControl();
    switchView(viewFromHash(), { initial: true });
    calculate();
    renderAll();

    try {
      await ensureSession();
      await fetchTrips();
    } catch {
      showToast('Nepodařilo se načíst data', 'error');
    }
    isLoading = false;
    fillLastPrice();
    renderAll();
  }

  init();

  // Registrace service workeru pro PWA offline funkčnost
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
})();
