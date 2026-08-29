// Challan list: search, filter, and the entry point to everything else.

import { listInvoices } from '../store.js';
import { amountDue } from '../repo.js';
import { debounce, esc, fmtDate, fmtMoney, html, monthKey, normKey, raw, stagger, todayISO } from '../util.js';

const state = { query: '', filter: 'all' };

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'month', label: 'This month' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'cancelled', label: 'Cancelled' },
];

const PAY_CHIP = {
  paid: { cls: 'chip--good', label: 'Paid' },
  partial: { cls: 'chip--warning', label: 'Part paid' },
  unpaid: { cls: '', label: 'Unpaid' },
};

function matches(inv, q) {
  if (!q) return true;
  const hay = [
    inv.challanNo, inv.customer?.name, inv.customer?.phone, inv.customer?.address,
    inv.vehicle?.model, inv.vehicle?.regNo, inv.notes,
    ...(inv.items || []).map((i) => i.desc),
  ].filter(Boolean).join(' ');
  return normKey(hay).includes(normKey(q));
}

function applyFilter(rows, filter) {
  if (filter === 'cancelled') return rows.filter((r) => r.deletedAt);
  const live = rows.filter((r) => !r.deletedAt);
  if (filter === 'month') {
    const key = monthKey(todayISO());
    return live.filter((r) => monthKey(r.date) === key);
  }
  if (filter === 'unpaid') return live.filter((r) => r.paymentStatus !== 'paid');
  return live;
}

function card(inv, settings) {
  const chip = PAY_CHIP[inv.paymentStatus] || PAY_CHIP.unpaid;
  const vehicle = [inv.vehicle?.model, inv.vehicle?.regNo].filter(Boolean).join(' · ');
  return html`
    <article class="inv-card" data-id="${inv.id}" tabindex="0" role="button"
             aria-label="Challan ${inv.challanNo}, ${inv.customer?.name || 'no name'}">
      <div class="inv-card__top">
        <span class="inv-card__challan">${inv.challanNo || '—'}</span>
        <div class="inv-card__who">
          <div class="inv-card__name">${inv.customer?.name || 'Unnamed'}</div>
          <div class="inv-card__veh">${vehicle || 'No vehicle noted'}</div>
        </div>
        <div class="inv-card__amt">
          <b>${fmtMoney(inv.grandTotal, settings.ui.currency)}</b>
          <small>${fmtDate(inv.date)}</small>
        </div>
      </div>
      <div class="inv-card__foot">
        ${inv.deletedAt
          ? raw('<span class="chip chip--critical">Cancelled</span>')
          : raw(`<span class="chip ${chip.cls}">${esc(chip.label)}</span>`)}
        ${inv.paymentMode ? raw(`<span class="chip">${esc(inv.paymentMode)}</span>`) : ''}
        <span class="chip">${inv.items?.length || 0} item${inv.items?.length === 1 ? '' : 's'}</span>
        ${!inv.deletedAt && amountDue(inv) > 0
          ? raw(`<span class="chip chip--warning">${esc(fmtMoney(amountDue(inv), settings.ui.currency))} due</span>`)
          : ''}
      </div>
    </article>`;
}

const EMPTY_ICON = '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12h7M9 16h5"/>';

export async function render(root, { settings, navigate, setTopbar }) {
  setTopbar({ title: 'Challans', sub: settings.business.name, back: false });

  // Nothing is pre-filled, so on a fresh install point the way to Settings —
  // a challan printed without a shop name on it is not much use.
  const needsSetup = !settings.business.name.trim();

  root.innerHTML = html`
    <div class="stack">
      ${needsSetup ? raw(`
        <div class="banner">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/></svg>
          <span class="banner__main"><b>Add your shop details.</b>
            Your name, address, phone and logo go on every challan you print.</span>
          <button class="btn btn--sm" id="go-setup">Set up</button>
        </div>`) : ''}
      <div class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input id="q" type="search" placeholder="Search name, challan, vehicle or part" value="${state.query}"
               aria-label="Search challans" enterkeyhint="search">
      </div>
      <div class="row" style="justify-content:space-between">
        <div class="segmented" role="tablist" aria-label="Filter">
          ${raw(FILTERS.map((f) => `<button role="tab" data-filter="${f.key}"
            class="${f.key === state.filter ? 'is-active' : ''}" aria-selected="${f.key === state.filter}">${esc(f.label)}</button>`).join(''))}
        </div>
        <span class="field__hint" id="count"></span>
      </div>
      <div class="list" id="rows"></div>
    </div>`;

  root.querySelector('#go-setup')?.addEventListener('click', () => navigate('#/settings'));

  const rowsEl = root.querySelector('#rows');
  const countEl = root.querySelector('#count');
  const all = await listInvoices({ includeDeleted: true });

  const paint = () => {
    const rows = applyFilter(all, state.filter).filter((r) => matches(r, state.query));
    countEl.textContent = rows.length ? `${rows.length} challan${rows.length === 1 ? '' : 's'}` : '';

    if (!rows.length) {
      const isFirstRun = !all.length;
      rowsEl.innerHTML = html`
        <div class="empty">
          <div class="empty__icon"><svg viewBox="0 0 24 24">${raw(EMPTY_ICON)}</svg></div>
          <h3>${isFirstRun ? 'No challans yet' : 'Nothing matches'}</h3>
          <p>${isFirstRun
            ? 'Create your first challan and it will be saved on this phone — no internet needed.'
            : 'Try a different name, challan number or filter.'}</p>
          ${isFirstRun ? raw('<button class="btn btn--primary" id="first">New challan</button>') : ''}
        </div>`;
      rowsEl.querySelector('#first')?.addEventListener('click', () => navigate('#/invoice/new'));
      return;
    }

    rowsEl.innerHTML = rows.map((r) => card(r, settings)).join('');
    stagger(Array.from(rowsEl.children));
  };

  paint();

  const onSearch = debounce((v) => { state.query = v; paint(); }, 140);
  root.querySelector('#q').addEventListener('input', (e) => onSearch(e.target.value));

  root.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      root.querySelectorAll('[data-filter]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
      paint();
    });
  });

  const open = (target) => {
    const cardEl = target.closest('[data-id]');
    if (cardEl) navigate(`#/invoice/${cardEl.dataset.id}`);
  };
  rowsEl.addEventListener('click', (e) => open(e.target));
  rowsEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e.target); }
  });

}
