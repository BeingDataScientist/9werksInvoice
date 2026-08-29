// Shared helpers: formatting, templating, dialogs, file saving.

/* ---------------- templating ---------------- */

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const raw = (value) => ({ __raw: true, value: String(value) });

function serialize(v) {
  if (v == null || v === false || v === true) return '';
  if (Array.isArray(v)) return v.map(serialize).join('');
  if (typeof v === 'object' && v.__raw) return v.value;
  return esc(v);
}

/** Tagged template that escapes every interpolation unless wrapped in raw(). */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += serialize(vals[i]) + strings[i + 1];
  return out;
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Build a detached element from an HTML string. */
export function el(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

/* ---------------- ids & timing ---------------- */

export function uid(prefix = 'id') {
  const rand = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}${rand[0].toString(36)}${rand[1].toString(36)}`;
}

export function debounce(fn, ms = 200) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/* ---------------- numbers & money ---------------- */

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Round to 2dp without binary-float drift (12.345 -> 12.35, not 12.34). */
export const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

export const fmtNum = (n) => inr.format(round2(n));
export const fmtMoney = (n, symbol = '₹') => `${symbol}${inr.format(round2(n))}`;
export const fmtMoney2 = (n, symbol = '₹') => `${symbol}${inr2.format(round2(n))}`;

/** Compact form for stat tiles: 1,284 / 12.9K / 4.2L / 1.3Cr (Indian scale). */
export function fmtCompact(n) {
  const v = Math.abs(num(n));
  const sign = n < 0 ? '-' : '';
  if (v >= 1e7) return `${sign}${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)}Cr`;
  if (v >= 1e5) return `${sign}${(v / 1e5).toFixed(v >= 1e6 ? 0 : 1)}L`;
  if (v >= 1e3) return `${sign}${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}K`;
  return `${sign}${inr.format(Math.round(v))}`;
}

/* ---------------- dates ---------------- */

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(ts, locale = 'en-IN') {
  const d = new Date(ts);
  return d.toLocaleString(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const RTF_LOCALE = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };

/** "2 hours ago" in the audit language. */
export function relTime(ts, lang = 'en') {
  const rtf = new Intl.RelativeTimeFormat(RTF_LOCALE[lang] || 'en-IN', { numeric: 'auto' });
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 31536000) return rtf.format(Math.round(diff / 2592000), 'month');
  return rtf.format(Math.round(diff / 31536000), 'year');
}

/** Indian financial year label for a date: 2026-08-29 -> "26-27". */
export function fyLabel(iso) {
  const d = new Date(`${iso || todayISO()}T00:00:00`);
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1; // FY starts 1 April
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

export const monthKey = (iso) => (iso || '').slice(0, 7);

export function monthLabel(key) {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

/* ---------------- text ---------------- */

export const normKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export const titleish = (s) => String(s || '').trim().replace(/\s+/g, ' ');

/** Highlight the matched span of a suggestion. */
export function highlight(text, query) {
  const q = String(query || '').trim();
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
}

/** Loose subsequence match so "rr kit" finds "Rear Kit Set". */
export function fuzzyScore(text, query) {
  const t = text.toLowerCase(), q = query.toLowerCase().trim();
  if (!q) return 0;
  if (t.startsWith(q)) return 1000 - t.length;
  const idx = t.indexOf(q);
  if (idx >= 0) return 700 - idx * 4 - t.length;
  let ti = 0, hits = 0, gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    gaps += found - ti;
    ti = found + 1;
    hits++;
  }
  return hits === q.length ? 300 - gaps * 3 - t.length : -1;
}

/* ---------------- toast ---------------- */

const ICONS = {
  good: '<path d="M20 6L9 17l-5-5"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
};

export function toast(message, { kind = 'info', duration = 3200, actionLabel, onAction } = {}) {
  const host = qs('#toast-host');
  if (!host) return;
  const node = el(html`
    <div class="toast toast--${raw(kind)}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${raw(ICONS[kind] || ICONS.info)}</svg>
      <span>${message}</span>
      ${actionLabel ? raw(`<button class="btn btn--sm toast__action">${esc(actionLabel)}</button>`) : ''}
    </div>`);
  host.appendChild(node);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    node.classList.add('is-out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 500);
  };
  node.querySelector('.toast__action')?.addEventListener('click', () => { close(); onAction?.(); });
  setTimeout(close, duration);
  return close;
}

/* ---------------- modal & sheet ---------------- */

function openOverlay(hostSel, markup, { onMount } = {}) {
  return new Promise((resolve) => {
    const host = qs(hostSel);
    host.innerHTML = markup;
    host.hidden = false;
    const prevFocus = document.activeElement;
    let settled = false;

    const done = (value) => {
      if (settled) return;
      settled = true;
      host.hidden = true;
      host.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      if (prevFocus instanceof HTMLElement) prevFocus.focus?.();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
    };
    document.addEventListener('keydown', onKey);
    host.addEventListener('click', (e) => { if (e.target === host) done(null); });
    host.querySelectorAll('[data-close]').forEach((b) =>
      b.addEventListener('click', () => done(b.dataset.close === '' ? null : b.dataset.close)));
    onMount?.(host, done);
    host.querySelector('[autofocus], .btn--primary, .sheet__opt, button')?.focus?.();
  });
}

export function confirmDialog({ title, body = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return openOverlay('#modal-host', html`
    <div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
      <h3>${title}</h3>
      <p>${raw(body)}</p>
      <div class="modal__actions">
        <button class="btn btn--ghost" data-close>${cancelLabel}</button>
        <button class="btn ${raw(danger ? 'btn--danger' : 'btn--primary')}" data-close="yes">${confirmLabel}</button>
      </div>
    </div>`).then((v) => v === 'yes');
}

export function alertDialog({ title, body = '', okLabel = 'OK' }) {
  return openOverlay('#modal-host', html`
    <div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
      <h3>${title}</h3>
      <p>${raw(body)}</p>
      <div class="modal__actions"><button class="btn btn--primary" data-close="ok">${okLabel}</button></div>
    </div>`);
}

/** Bottom sheet of actions. options: [{value,label,sub,icon,danger}] */
export function actionSheet({ title, options }) {
  const rows = options.map((o) => html`
    <button class="sheet__opt ${raw(o.danger ? 'sheet__opt--danger' : '')}" data-close="${o.value}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${raw(o.icon || '')}</svg>
      <span class="sheet__opt-main">${o.label}${o.sub ? raw(`<small>${esc(o.sub)}</small>`) : ''}</span>
    </button>`).join('');
  return openOverlay('#sheet-host', html`
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="sheet__grip"></div>
      <div class="sheet__title">${title}</div>
      ${raw(rows)}
    </div>`);
}

/* ---------------- file saving ---------------- */

export const canPickSaveLocation = () => typeof window.showSaveFilePicker === 'function';
export const canPickDirectory = () => typeof window.showDirectoryPicker === 'function';

/** Trigger a plain browser download (goes to the default Downloads folder). */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function ensurePermission(handle, mode = 'readwrite') {
  if (!handle?.queryPermission) return false;
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  return (await handle.requestPermission({ mode })) === 'granted';
}

/**
 * Save a blob where the user wants it.
 *  - dirHandle given + permission granted -> writes straight into that folder
 *  - else showSaveFilePicker -> user chooses the location
 *  - else -> browser download
 * Returns { method, name, dirName? }.
 */
export async function saveBlob(blob, filename, { dirHandle = null, accept, description } = {}) {
  if (dirHandle && (await ensurePermission(dirHandle))) {
    const fh = await dirHandle.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    return { method: 'folder', name: filename, dirName: dirHandle.name };
  }

  if (canPickSaveLocation()) {
    try {
      const fh = await window.showSaveFilePicker({
        suggestedName: filename,
        types: accept ? [{ description: description || 'File', accept }] : undefined,
      });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return { method: 'picker', name: fh.name || filename };
    } catch (err) {
      if (err?.name === 'AbortError') return { method: 'cancelled', name: filename };
      // Picker unavailable in this context (e.g. embedded webview) — fall through.
    }
  }

  downloadBlob(blob, filename);
  return { method: 'download', name: filename };
}

/** Share a file through the OS share sheet (WhatsApp, Drive, mail...). */
export async function shareFile(blob, filename, { title, text } = {}) {
  const file = new File([blob], filename, { type: blob.type });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title, text });
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
    return false;
  }
}

/** Read a file the user picks (used by backup import). */
export function pickFile(accept = '.zip') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
    // Safari needs the input in the DOM for the change event to land reliably.
    input.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 60000);
  });
}

/* ---------------- misc ---------------- */

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animate a number into place on a stat tile. */
export function countUp(node, to, { duration = 700, format = fmtNum } = {}) {
  if (prefersReducedMotion()) { node.textContent = format(to); return; }
  const start = performance.now();
  const from = 0;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = format(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Stagger entry animations across a list, capped so long lists stay snappy. */
export function stagger(nodes, step = 34, max = 14) {
  nodes.forEach((n, i) => { n.style.animationDelay = `${Math.min(i, max) * step}ms`; });
}
