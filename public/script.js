(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const LOCALE = 'cs-CZ';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ── Formátování čísel ──
  const numberFormats = new Map();
  function fmt(value, minDecimals = 2, maxDecimals = minDecimals) {
    const key = `${minDecimals}:${maxDecimals}`;
    let nf = numberFormats.get(key);
    if (!nf) {
      nf = new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: minDecimals,
        maximumFractionDigits: maxDecimals,
      });
      numberFormats.set(key, nf);
    }
    return nf.format(Number(value) || 0);
  }

  const fmtKm = (v) => fmt(v, 0, 1);          // 180 km, 412,5 km
  const fmtCons = (v) => fmt(v, 1, 2);        // 5,9 / 5,85 l/100 km

  // Částka s menšími desetinami. Čtečkám se přečte celá v jednom kuse.
  function amountHTML(value, decimals = 2, currency = 'Kč') {
    const text = fmt(value, decimals);
    const [int, dec] = text.split(',');
    return (
      `<span class="visually-hidden">${text}${currency ? ` ${currency}` : ''}</span>` +
      `<span class="amount-int" aria-hidden="true">${int}</span>` +
      (dec !== undefined ? `<span class="amount-dec" aria-hidden="true">,${dec}</span>` : '') +
      (currency ? `<span class="amount-cur" aria-hidden="true">${currency}</span>` : '')
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
    if (!data || typeof data.userId !== 'string' || !data.userId) {
      throw new Error('Nepodařilo se vytvořit bezpečnou relaci');
    }
    sessionUserId = data.userId;

    // Záloha ID v localStorage - prevence ztráty dat po vypršení relace (cookie)
    localStorage.setItem(LEGACY_USER_ID_KEY, sessionUserId);

    return data;
  }

  // ── Stav aplikace ──
  let trips = [];
  let isLoading = true;
  let isSaving = false;
  let selectedMonth = null; // null (bez dat) | 'all' | 'YYYY-MM'
  let activeView = 'entry';
  let openTripId = null;
  let priceMirrorsRefuelPrice = false;
  let priceAutoFilled = false;

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
    const saved = await res.json();
    if (!saved || saved.id === undefined || !saved.date || Number.isNaN(new Date(saved.date).getTime())) {
      throw new Error('Nepodařilo se uložit jízdu');
    }
    return saved;
  }

  async function apiDeleteTrip(id) {
    const res = await fetch(`/api/trips/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('Nepodařilo se smazat jízdu');
  }

  // Offline cache API odpovědí patří k jednomu ID — po přepnutí ji zahodíme
  function clearCachedTrips() {
    if (!('caches' in window)) return;
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.open(k).then((c) => c.delete('/api/trips')))))
      .catch(() => {});
  }

  // ── Last refuelling price ──
  function getLastRefuelPrice() {
    if (!trips.length) return null;
    const lastTrip = [...trips].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    // Starší záznamy vznikly před přidáním samostatné ceny tankování.
    // Jejich cenu jízdy proto použijeme jako rozumný výchozí údaj.
    const value = lastTrip.refuel_price ?? lastTrip.refuelPrice ?? lastTrip.price;
    return value === null || value === undefined ? null : Number(value);
  }

  // Do ceny jízdy se dosadí cena z předchozího tankování. Aktuálně tankovaná
  // cena se ukládá zvlášť a použije se až pro další jízdu.
  function fillLastPrice({ replaceAuto = false } = {}) {
    const lastPrice = getLastRefuelPrice();
    const priceInput = $('price');

    // Automaticky doplněnou cenu po smazání/importu nahradíme aktuální
    if (replaceAuto && priceAutoFilled) {
      priceInput.value = '';
      priceAutoFilled = false;
    }

    if (lastPrice !== null && priceInput.value === '') {
      priceInput.value = toInputValue(lastPrice, 2);
      priceAutoFilled = true;
      priceMirrorsRefuelPrice = false;
      clearInvalid('price');
    }
    updatePriceHint();
    calculate();
  }

  function updatePriceHint() {
    let hint = '';
    if (priceAutoFilled) hint = 'Z minulého tankování';
    else if (getLastRefuelPrice() === null) hint = 'U první jízdy stejná jako dnešní cena';
    setHint('price', hint);
  }

  // ── Vstupy ──
  const inputIds = ['refuelPrice', 'distance', 'consumption', 'price'];
  const LIMITS = {
    refuelPrice: { max: 500, empty: 'Zadej dnešní cenu za litr', over: 'Nejvýš 500 Kč/l' },
    distance: { max: 5000, empty: 'Zadej ujetou vzdálenost', over: 'Nejvýš 5 000 km' },
    consumption: { max: 50, empty: 'Zadej spotřebu', over: 'Nejvýš 50 l/100 km' },
    price: { max: 500, empty: 'Zadej cenu paliva', over: 'Nejvýš 500 Kč/l' },
  };

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

  // Povolí jen číslice a jeden desetinný oddělovač (zobrazený jako čárka).
  // Při vložení „1.234,5“ nebo „1,234.5“ je desetinný oddělovač ten poslední.
  function normalizeDecimal(raw) {
    let clean = raw.replace(/[^\d.,]/g, '');
    const lastSep = Math.max(clean.lastIndexOf(','), clean.lastIndexOf('.'));
    const hasBoth = clean.includes(',') && clean.includes('.');
    if (hasBoth && lastSep !== -1) {
      clean = clean.slice(0, lastSep).replace(/[.,]/g, '') + ',' + clean.slice(lastSep + 1).replace(/[.,]/g, '');
    } else {
      clean = clean.replace(/\./g, ',');
      const first = clean.indexOf(',');
      if (first !== -1) clean = clean.slice(0, first + 1) + clean.slice(first + 1).replace(/,/g, '');
    }
    return clean;
  }

  function sanitizeDecimalInput(input) {
    const raw = input.value;
    const clean = normalizeDecimal(raw);
    if (clean !== raw) {
      const pos = input.selectionStart;
      input.value = clean;
      if (pos !== null) {
        const p = Math.max(0, Math.min(clean.length, pos - (raw.length - clean.length)));
        try { input.setSelectionRange(p, p); } catch { /* některé typy výběr nepodporují */ }
      }
    }
  }

  function setHint(id, text) {
    const hint = $(`${id}Hint`);
    hint.dataset.hint = text;
    if (!$(id).closest('.row').classList.contains('is-invalid')) hint.textContent = text;
  }

  function validateField(id) {
    const value = readNumber(id);
    if (!(value > 0)) return LIMITS[id].empty;
    if (value > LIMITS[id].max) return LIMITS[id].over;
    return null;
  }

  function markInvalid(id, message) {
    const row = $(id).closest('.row');
    row.classList.add('is-invalid');
    $(id).setAttribute('aria-invalid', 'true');
    $(`${id}Hint`).textContent = message;
  }

  function clearInvalid(id) {
    const row = $(id).closest('.row');
    if (!row.classList.contains('is-invalid')) return;
    row.classList.remove('is-invalid');
    $(id).removeAttribute('aria-invalid');
    const hint = $(`${id}Hint`);
    hint.textContent = hint.dataset.hint || '';
  }

  function shake(el) {
    el.classList.remove('is-shaking');
    void el.offsetWidth;
    el.classList.add('is-shaking');
  }

  function updateSaveState() {
    const ready = inputIds.every((id) => !validateField(id));
    $('btnSave').classList.toggle('is-inactive', !ready);
  }

  // ── Calculate ──
  let liveTimer = null;
  function calculate() {
    const dist  = readNumber('distance') || 0;
    const cons  = readNumber('consumption') || 0;
    const price = readNumber('price') || 0;
    const costEl = $('resultCost');
    const summary = $('resultSummary');

    updateSaveState();
    clearTimeout(liveTimer);

    if (dist <= 0 || cons <= 0 || price <= 0) {
      costEl.classList.add('is-empty');
      costEl.innerHTML = amountHTML(0);
      costEl._value = 0;
      summary.classList.add('is-empty');
      summary.textContent = '0,00 l · 0,00 Kč/km';
      return null;
    }

    const liters = (dist * cons) / 100;
    const cost   = liters * price;
    const perKm  = cost / dist;

    costEl.classList.remove('is-empty');
    costEl.innerHTML = amountHTML(cost);
    costEl._value = cost;
    summary.classList.remove('is-empty');
    summary.textContent = `${fmt(liters, 2)} l · ${fmt(perKm, 2)} Kč/km`;

    // Čtečkám oznámíme výsledek až po dopsání čísla
    liveTimer = setTimeout(() => {
      $('calcLive').textContent = `Náklady jízdy ${fmt(cost, 2)} Kč, spotřebováno ${fmt(liters, 2)} litrů.`;
    }, 800);

    return { liters, cost, perKm };
  }

  // ── Loading state ──
  function setSaveLoading(loading) {
    const btn = $('btnSave');
    btn.disabled = loading;
    btn.setAttribute('aria-busy', String(loading));
    btn.innerHTML = loading
      ? '<span class="spinner" aria-hidden="true"></span><span>Ukládám…</span>'
      : 'Uložit tankování a jízdu';
  }

  // ── Save trip ──
  async function saveTrip(event) {
    if (event) event.preventDefault();
    if (isSaving) return;

    const errors = inputIds
      .map((id) => [id, validateField(id)])
      .filter(([, message]) => message);

    if (errors.length) {
      errors.forEach(([id, message]) => markInvalid(id, message));
      new Set(errors.map(([id]) => $(id).closest('.group'))).forEach(shake);
      $(errors[0][0]).focus();
      showToast(errors.length > 1 ? 'Doplň zvýrazněná pole' : errors[0][1], 'error');
      return;
    }

    const values = {
      refuelPrice: readNumber('refuelPrice'),
      distance: readNumber('distance'),
      consumption: readNumber('consumption'),
      price: readNumber('price'),
    };

    const result = calculate();
    if (!result) return;

    isSaving = true;
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
      priceAutoFilled = false;

      fillLastPrice();
      renderAll();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (navigator.vibrate) navigator.vibrate(12);
      showToast('Tankování a jízda uloženy');
    } catch {
      showToast(navigator.onLine === false ? 'Jsi offline — jízda se neuložila' : 'Uložení se nepovedlo', 'error');
    } finally {
      isSaving = false;
      setSaveLoading(false);
      updateSaveState();
    }
  }

  // ── Toast + oznámení pro čtečky ──
  let toastTimer = null;
  function announce(message) {
    // Stavový region v nejvrchnějším otevřeném dialogu (jinak v body)
    const host = openSheets[openSheets.length - 1];
    const region = (host && host.querySelector('[data-sr-status]')) ||
      document.querySelector('body > [data-sr-status]');
    if (!region) return;
    region.textContent = '';
    setTimeout(() => { region.textContent = message; }, 60);
  }

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
    announce(message);
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
      const name = capitalize(label);
      return `<button type="button" class="chip" data-month="${value}" aria-pressed="${pressed}" ` +
        `aria-label="${escapeHTML(name)}, ${count} ${plural(count, 'jízda', 'jízdy', 'jízd')}">` +
        `${escapeHTML(name)}<span class="chip-count" aria-hidden="true">${count}</span></button>`;
    };

    const html = chip('all', 'Vše', trips.length) +
      keys.map((k) => chip(k, monthLabel(k), months.get(k))).join('');

    document.querySelectorAll('[data-month-chips]').forEach((container) => {
      container.innerHTML = html;
      container.hidden = trips.length === 0;
      scrollChipIntoView(container);
    });
  }

  function scrollChipIntoView(container) {
    const chips = [...container.querySelectorAll('.chip')];
    const index = chips.findIndex((c) => c.getAttribute('aria-pressed') === 'true');
    if (index <= 1 || container.offsetParent === null) {
      container.scrollLeft = 0;
      return;
    }
    const active = chips[index];
    container.scrollLeft = Math.max(0, active.offsetLeft - container.clientWidth / 2 + active.clientWidth / 2);
  }

  function selectMonth(value, { focusFrom } = {}) {
    if (value === selectedMonth) return;
    selectedMonth = value;
    renderMonthChips();
    renderStats();
    renderHistory();
    // Překreslení chipů by jinak ztratilo fokus klávesnice
    if (focusFrom) {
      const container = focusFrom.closest('[data-month-chips], .chart');
      const target = container && container.querySelector(`[data-month="${value}"]`);
      if (target) target.focus({ preventScroll: true });
    }
  }

  function getFilteredTrips() {
    if (selectedMonth === 'all' || !selectedMonth) return trips;
    return trips.filter((t) => monthKey(t.date) === selectedMonth);
  }

  // ── Render stats ──
  function renderStats({ animate = false } = {}) {
    const hasTrips = trips.length > 0 && !isLoading;
    $('statsContent').hidden = !hasTrips && !isLoading;
    $('statsEmpty').hidden = hasTrips || isLoading;
    if (!hasTrips) return;

    const filtered  = getFilteredTrips();
    const totalKm   = filtered.reduce((s, t) => s + Number(t.distance), 0);
    const totalL    = filtered.reduce((s, t) => s + Number(t.liters), 0);
    const totalCost = filtered.reduce((s, t) => s + Number(t.cost), 0);
    const count     = filtered.length;

    $('statPeriodLabel').textContent = selectedMonth === 'all' || !selectedMonth
      ? 'Náklady celkem'
      : `Náklady · ${monthLabel(selectedMonth, { withYear: true })}`;

    const costEl = $('statCost');
    costEl.classList.toggle('is-empty', count === 0);
    animateAmount(costEl, totalCost, { decimals: 0, from: animate ? 0 : undefined });

    $('statSummary').textContent = count
      ? `${count} ${plural(count, 'jízda', 'jízdy', 'jízd')} · ${fmt(totalKm, 0)} km`
      : 'V tomto období nejsou žádné jízdy';

    $('statKm').textContent      = `${fmt(totalKm, 0)} km`;
    $('statLiters').textContent  = `${fmt(totalL, 1)} l`;
    $('statAvgCons').textContent = totalKm ? `${fmt((totalL / totalKm) * 100, 1)} l/100 km` : '—';
    $('statPerKm').textContent   = totalKm ? `${fmt(totalCost / totalKm, 2)} Kč` : '—';
    $('statAvgTrip').textContent = count
      ? `${fmt(totalKm / count, 0)} km · ${fmt(totalCost / count, 0)} Kč`
      : '—';

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
      months.push(monthKey(new Date(end.getFullYear(), end.getMonth() - i, 1)));
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

    const key = months.join(',');
    const rebuild = chart.dataset.key !== key;
    if (rebuild) {
      chart.dataset.key = key;
      chart.innerHTML = '<div class="chart-avg" aria-hidden="true"></div>' + months.map((k) => `
        <button type="button" class="chart-col" data-month="${k}">
          <span class="chart-track" aria-hidden="true">
            <span class="chart-bar"></span>
            <span class="chart-value"></span>
          </span>
          <span class="chart-label" aria-hidden="true">${escapeHTML(monthDate(k).toLocaleDateString(LOCALE, { month: 'short' }).replace('.', ''))}</span>
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
      avgLine.style.opacity = avg && !zero ? '' : '0';
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
      el.innerHTML = `<div class="group" aria-hidden="true">${'<div class="skeleton-row"><span></span><span></span></div>'.repeat(3)}</div>`;
      return;
    }

    if (!trips.length) {
      el.innerHTML = `
        <div class="empty">
          <span class="empty-icon">${icon('i-pump', 28)}</span>
          <p class="empty-title">Zatím žádné jízdy</p>
          <p class="empty-text">Ulož první tankování a tady uvidíš přehled všech jízd.</p>
          <button type="button" class="btn btn-primary btn-pill" data-goto="entry">${icon('i-plus', 18)}<span>Přidat jízdu</span></button>
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
        <h2 class="day-head">
          <span>${escapeHTML(dayLabel(g.date))}</span>
          ${g.trips.length > 1 ? `<span class="day-total"><span class="visually-hidden">celkem </span>${fmt(g.total, 2)} Kč</span>` : ''}
        </h2>
        <div class="group">
          ${g.trips.map((trip) => {
            const time = new Date(trip.date).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
            return `
            <button type="button" class="trip" data-trip-id="${escapeHTML(trip.id)}"
              aria-label="${fmtKm(trip.distance)} km za ${fmt(trip.cost, 2)} Kč, ${escapeHTML(time)}. Zobrazit detail">
              <span class="trip-main" aria-hidden="true">
                <span class="trip-title">${fmtKm(trip.distance)} km</span>
                <span class="trip-sub">${escapeHTML(time)} · ${fmtCons(trip.consumption)} l/100 km</span>
              </span>
              <span class="trip-end" aria-hidden="true">
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
        // Toast nesmí zůstat v zavřeném dialogu
        const toast = $('toast');
        if (dialog.contains(toast)) (openSheets[openSheets.length - 1] || document.body).appendChild(toast);
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

    // Zavření tažením dolů za hlavičku sheetu (včetně úchytu)
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
      dialog.style.setProperty('--drag', `${dy > 0 ? dy : dy / 6}px`);
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

  // Potvrzovací dialog místo nativního confirm(). Výchozí fokus je na „Zrušit“.
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
      ['Vzdálenost', `${fmtKm(trip.distance)} km`],
      ['Spotřeba', `${fmtCons(trip.consumption)} l/100 km`],
      ['Spotřebováno', `${fmt(trip.liters, 2)} l`],
      ['Cena použitá pro jízdu', `${fmt(trip.price, 2)} Kč/l`],
    ];
    if (refuel !== undefined && refuel !== null) rows.push(['Cena při tomto tankování', `${fmt(refuel, 2)} Kč/l`]);
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

    // Zapamatujeme si pozici řádku, aby fokus po smazání nezmizel
    const rows = [...document.querySelectorAll('.trip')];
    const index = rows.findIndex((r) => r.dataset.tripId === String(id));

    try {
      await apiDeleteTrip(id);
      trips = trips.filter((t) => t.id !== id);
      openTripId = null;
      await closeSheet($('tripSheet'));
      renderAll();
      fillLastPrice({ replaceAuto: true });

      const next = [...document.querySelectorAll('.trip')];
      const target = next[index] || next[index - 1] || $('historyTitle');
      target.focus({ preventScroll: false });
      showToast('Jízda smazána');
    } catch {
      showToast(navigator.onLine === false ? 'Jsi offline — jízda se nesmazala' : 'Smazání se nepovedlo', 'error');
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
      priceAutoFilled = false;
      selectedMonth = null;
      fillLastPrice();
      renderAll();
      showToast('Historie smazána');
    } catch {
      // Část jízd mohla být smazána — načteme aktuální stav ze serveru
      try {
        await fetchTrips();
        renderAll();
        fillLastPrice({ replaceAuto: true });
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

    if (name === 'stats' || name === 'history') {
      document.querySelectorAll(`#view-${name} [data-month-chips]`).forEach(scrollChipIntoView);
    }
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

    // Akcent tlačítka „Importovat“ jen když je co importovat
    importInput.addEventListener('input', () => {
      importButton.classList.toggle('pill-btn-accent', importInput.value.trim() !== '');
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
        clearCachedTrips();
        await fetchTrips();
        $('deviceIdDisplay').textContent = sessionUserId || '—';
        importInput.value = '';
        importButton.classList.remove('pill-btn-accent');
        $('price').value = '';
        $('refuelPrice').value = '';
        priceMirrorsRefuelPrice = false;
        priceAutoFilled = false;
        selectedMonth = null;
        renderAll();
        fillLastPrice();
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

  // ── Formulář ──
  function initForm() {
    $('entryForm').addEventListener('submit', saveTrip);

    inputIds.forEach((id) => {
      $(id).addEventListener('input', () => {
        sanitizeDecimalInput($(id));
        clearInvalid(id);
      });
    });

    ['distance', 'consumption'].forEach((id) => {
      $(id).addEventListener('input', calculate);
    });

    $('price').addEventListener('input', () => {
      priceMirrorsRefuelPrice = false;
      priceAutoFilled = false;
      updatePriceHint();
      calculate();
    });

    $('refuelPrice').addEventListener('input', () => {
      // U prvního záznamu není k dispozici dřívější cena. Použijeme proto
      // aktuálně zadanou cenu také pro výpočet této jízdy.
      if (isLoading) {
        updateSaveState();
        return;
      }
      if (getLastRefuelPrice() === null &&
          ($('price').value === '' || priceMirrorsRefuelPrice)) {
        $('price').value = $('refuelPrice').value;
        priceMirrorsRefuelPrice = true;
        clearInvalid('price');
      }
      calculate();
    });

    // Enter přeskočí na další pole, u posledního odešle formulář
    inputIds.forEach((id, i) => {
      $(id).addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const next = inputIds[i + 1];
        if (next) $(next).focus();
        else saveTrip();
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
        selectMonth(monthBtn.dataset.month, { focusFrom: monthBtn });
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
      showToast(navigator.onLine === false ? 'Jsi offline — data se nenačetla' : 'Nepodařilo se načíst data', 'error');
    }
    isLoading = false;
    renderAll();
    fillLastPrice();
  }

  init();

  // Registrace service workeru pro PWA offline funkčnost
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
})();
