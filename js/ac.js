// Type-ahead over previously entered data. Opens on focus with the most-used
// entries, then narrows as you type; picking one fills the related fields.

import { el, esc, highlight } from './util.js';

export function attachAutocomplete(input, { fetch, renderOption, onPick, minChars = 0, emptyHint = null }) {
  const wrap = input.closest('.ac');
  if (!wrap) return () => {};

  let menu = null;
  let items = [];
  let active = -1;
  let seq = 0;
  let closedByEscape = false;

  const close = () => {
    menu?.remove();
    menu = null;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
  };

  const pick = (index) => {
    const item = items[index];
    if (!item) return;
    close();
    onPick(item, input);
  };

  const paint = () => {
    if (!items.length) {
      close();
      return;
    }
    if (!menu) {
      menu = el('<div class="ac__menu" role="listbox"></div>');
      wrap.appendChild(menu);
      input.setAttribute('aria-expanded', 'true');
    }
    const q = input.value.trim();
    menu.innerHTML = items
      .map((it, i) => `<button type="button" class="ac__opt ${i === active ? 'is-active' : ''}" role="option"
        aria-selected="${i === active}" data-i="${i}">${renderOption(it, q)}</button>`)
      .join('');
    menu.querySelectorAll('.ac__opt').forEach((node) => {
      // pointerdown fires before blur, so the pick isn't lost to the input closing.
      node.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pick(Number(node.dataset.i));
      });
    });
  };

  const refresh = async () => {
    const q = input.value.trim();
    if (q.length < minChars) { close(); return; }
    const mySeq = ++seq;
    const found = await fetch(q);
    if (mySeq !== seq || closedByEscape) return;
    if (document.activeElement !== input) return;
    items = found || [];
    active = -1;
    paint();
  };

  const onInput = () => { closedByEscape = false; refresh(); };
  const onFocus = () => { closedByEscape = false; refresh(); };
  const onBlur = () => setTimeout(close, 120);

  const onKey = (e) => {
    if (e.key === 'Escape') {
      if (menu) { e.stopPropagation(); closedByEscape = true; close(); }
      return;
    }
    if (!menu || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = e.key === 'ArrowDown'
        ? (active + 1) % items.length
        : (active - 1 + items.length) % items.length;
      paint();
      menu.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Tab' && active >= 0) {
      pick(active);
    }
  };

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', onInput);
  input.addEventListener('focus', onFocus);
  input.addEventListener('blur', onBlur);
  input.addEventListener('keydown', onKey);
  void emptyHint;

  return () => {
    close();
    input.removeEventListener('input', onInput);
    input.removeEventListener('focus', onFocus);
    input.removeEventListener('blur', onBlur);
    input.removeEventListener('keydown', onKey);
  };
}

/* ---------------- option renderers ---------------- */

export const productOption = (p, q, currency = '₹') => `
  <span class="ac__opt-main">
    <span class="ac__opt-name">${highlight(p.name, q)}</span>
    <span class="ac__opt-meta">used ${p.count || 0}×</span>
  </span>
  ${p.lastRate ? `<span class="ac__opt-rate">${esc(currency)}${esc(new Intl.NumberFormat('en-IN').format(p.lastRate))}</span>` : ''}`;

export const partyOption = (p, q) => `
  <span class="ac__opt-main">
    <span class="ac__opt-name">${highlight(p.name, q)}</span>
    <span class="ac__opt-meta">${esc([p.phone, p.address].filter(Boolean).join(' · ') || `${p.count || 0} challans`)}</span>
  </span>`;

export const vehicleOption = (v, q) => `
  <span class="ac__opt-main">
    <span class="ac__opt-name">${highlight(v.regNo || v.model || '', q)}</span>
    <span class="ac__opt-meta">${esc([v.model, v.owner].filter(Boolean).join(' · '))}</span>
  </span>`;
