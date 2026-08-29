// Analytics over locally stored challans. Every chart is single-series, so
// colour never carries meaning on its own, and each has a table view.

import { listInvoices } from '../store.js';
import { sequenceReport } from '../challan.js';
import { amountDue } from '../repo.js';
import { barChart, columnChart, dataTable, responsive } from '../charts.js';
import {
  countUp, esc, fmtCompact, fmtMoney, fmtNum, html, monthKey, monthLabel,
  normKey, raw, todayISO, fyLabel,
} from '../util.js';

const RANGES = [
  { key: '3m', label: '3 months' },
  { key: '12m', label: '12 months' },
  { key: 'fy', label: 'This FY' },
  { key: 'all', label: 'All time' },
];

const state = { range: '12m' };

function inRange(iso, range) {
  if (range === 'all') return true;
  if (range === 'fy') return fyLabel(iso) === fyLabel(todayISO());
  const months = range === '3m' ? 3 : 12;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - (months - 1));
  cutoff.setDate(1);
  return new Date(`${iso}T00:00:00`) >= cutoff;
}

/** Continuous month buckets so a quiet month reads as a gap, not a missing bar. */
function monthSeries(rows, range) {
  const buckets = new Map();
  for (const r of rows) {
    const k = monthKey(r.date);
    if (!k) continue;
    const b = buckets.get(k) || { total: 0, count: 0 };
    b.total += r.grandTotal || 0;
    b.count += 1;
    buckets.set(k, b);
  }
  if (!buckets.size) return [];

  const keys = [...buckets.keys()].sort();
  const start = new Date(`${keys[0]}-01T00:00:00`);
  const end = new Date(`${keys[keys.length - 1]}-01T00:00:00`);
  const out = [];
  const cursor = new Date(start);
  while (cursor <= end && out.length < 60) {
    const k = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    const b = buckets.get(k) || { total: 0, count: 0 };
    out.push({ key: k, label: monthLabel(k), value: b.total, count: b.count });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  void range;
  return out;
}

function topBy(rows, keyFn, labelFn, valueFn, limit = 6) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    const entry = map.get(k) || { label: labelFn(r), value: 0, count: 0 };
    entry.value += valueFn(r);
    entry.count += 1;
    map.set(k, entry);
  }
  return [...map.values()].sort((a, b) => b.value - a.value).slice(0, limit);
}

/* ---------------- card with chart / table toggle ---------------- */

function chartCard({ id, title, note }) {
  return html`
    <div class="card" id="${id}">
      <div class="card__head">
        <h3>${title}</h3>
        <span class="card__spacer"></span>
        <div class="segmented" role="group" aria-label="${title} view">
          <button data-view="chart" class="is-active">Chart</button>
          <button data-view="table">Table</button>
        </div>
      </div>
      <div class="card__body">
        ${note ? raw(`<p class="field__hint" style="margin-bottom:10px">${esc(note)}</p>`) : ''}
        <div class="chart" data-chart></div>
        <div data-table hidden></div>
      </div>
    </div>`;
}

function wireCard(root, id, { draw, table }) {
  const card = root.querySelector(`#${id}`);
  if (!card) return;
  const chartEl = card.querySelector('[data-chart]');
  const tableEl = card.querySelector('[data-table]');
  let stop = responsive(chartEl, () => draw(chartEl));

  card.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const isChart = btn.dataset.view === 'chart';
      card.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('is-active', b === btn));
      chartEl.hidden = !isChart;
      tableEl.hidden = isChart;
      if (isChart) {
        stop?.();
        stop = responsive(chartEl, () => draw(chartEl));
      } else {
        tableEl.innerHTML = table();
      }
    });
  });
}

/* ---------------- view ---------------- */

export async function render(root, { settings, navigate, setTopbar }) {
  setTopbar({ title: 'Analytics', sub: settings.business.name, back: false });

  const all = await listInvoices({ includeDeleted: true });
  const live = all.filter((i) => !i.deletedAt);
  const cur = settings.ui.currency;
  const money = (v) => fmtMoney(v, cur);
  const moneyAxis = (v, axis) => (axis ? fmtCompact(v) : money(v));

  root.innerHTML = html`
    <div class="stack">
      <div class="segmented" id="range" role="group" aria-label="Date range">
        ${raw(RANGES.map((r) => `<button data-range="${r.key}" class="${r.key === state.range ? 'is-active' : ''}">${esc(r.label)}</button>`).join(''))}
      </div>
      <div id="body"></div>
    </div>`;

  const body = root.querySelector('#body');

  const paint = () => {
    const rows = live.filter((i) => inRange(i.date, state.range));

    if (!rows.length) {
      body.innerHTML = html`
        <div class="empty">
          <div class="empty__icon"><svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></div>
          <h3>Nothing to chart yet</h3>
          <p>Save a few challans and the numbers will show up here.</p>
          <button class="btn btn--primary" id="go-new">New challan</button>
        </div>`;
      body.querySelector('#go-new').addEventListener('click', () => navigate('#/invoice/new'));
      return;
    }

    const revenue = rows.reduce((s, r) => s + (r.grandTotal || 0), 0);
    const due = rows.reduce((s, r) => s + amountDue(r), 0);
    const avg = revenue / rows.length;

    const thisMonth = monthKey(todayISO());
    const prevDate = new Date();
    prevDate.setMonth(prevDate.getMonth() - 1);
    const lastMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const sumFor = (k) => live.filter((r) => monthKey(r.date) === k).reduce((s, r) => s + (r.grandTotal || 0), 0);
    const cm = sumFor(thisMonth), lm = sumFor(lastMonth);
    const deltaPct = lm > 0 ? ((cm - lm) / lm) * 100 : null;
    const deltaKind = deltaPct == null ? 'flat' : deltaPct > 0.5 ? 'up' : deltaPct < -0.5 ? 'down' : 'flat';
    const deltaArrow = deltaKind === 'up' ? '<path d="M12 19V5M5 12l7-7 7 7"/>'
      : deltaKind === 'down' ? '<path d="M12 5v14M5 12l7 7 7-7"/>' : '<path d="M5 12h14"/>';

    const months = monthSeries(rows, state.range);
    const items = [];
    for (const r of rows) for (const it of r.items || []) items.push({ ...it, invoice: r });
    const topItems = topBy(items, (i) => normKey(i.desc), (i) => i.desc, (i) => i.amount || 0, 6);
    const topCustomers = topBy(rows, (r) => normKey(r.customer?.name), (r) => r.customer?.name || '—', (r) => r.grandTotal || 0, 6);
    const modes = ['Cash', 'Cheque', 'RTGS', 'Online', 'Not set'].map((m) => {
      const match = rows.filter((r) => (r.paymentMode || 'Not set') === m);
      return { label: m, value: match.reduce((s, r) => s + (r.grandTotal || 0), 0), count: match.length };
    }).filter((m) => m.count > 0);

    const seq = sequenceReport(all, settings);
    const gapTotal = seq.reduce((s, r) => s + r.gaps.length, 0);
    const dupeTotal = seq.reduce((s, r) => s + r.duplicates.length, 0);

    body.innerHTML = html`
      <div class="stack">
        <div class="kpis">
          <div class="kpi kpi--hero">
            <div class="kpi__label">Total billed</div>
            <div class="kpi__value" id="kpi-revenue">${money(revenue)}</div>
            ${deltaPct == null ? '' : raw(`<div class="kpi__delta kpi__delta--${deltaKind}">
              <svg viewBox="0 0 24 24" aria-hidden="true">${deltaArrow}</svg>
              ${esc(`${Math.abs(deltaPct).toFixed(0)}% vs last month`)}</div>`)}
          </div>
          <div class="kpi">
            <div class="kpi__label">Challans</div>
            <div class="kpi__value" id="kpi-count">${rows.length}</div>
          </div>
          <div class="kpi">
            <div class="kpi__label">Average job</div>
            <div class="kpi__value">${money(Math.round(avg))}</div>
          </div>
          <div class="kpi">
            <div class="kpi__label">Outstanding</div>
            <div class="kpi__value" style="${raw(due > 0 ? 'color:var(--critical)' : '')}">${money(due)}</div>
          </div>
        </div>

        ${raw(chartCard({ id: 'c-months', title: 'Billed per month', note: 'Peak month is labelled; hover any bar for its exact value.' }))}
        ${raw(chartCard({ id: 'c-items', title: 'Top services & parts', note: 'By total value billed across the selected range.' }))}
        ${raw(chartCard({ id: 'c-customers', title: 'Top customers' }))}
        ${raw(chartCard({ id: 'c-modes', title: 'How customers paid' }))}

        <div class="card">
          <div class="card__head"><h3>Challan book health</h3></div>
          <div class="card__body stack" id="seq"></div>
        </div>
      </div>`;

    const revEl = body.querySelector('#kpi-revenue');
    countUp(revEl, revenue, { format: (v) => money(v) });
    countUp(body.querySelector('#kpi-count'), rows.length, { format: (v) => fmtNum(Math.round(v)) });

    wireCard(body, 'c-months', {
      draw: (elm) => columnChart(elm, {
        data: months.map((m) => ({ label: m.label, value: m.value, sub: `${m.count} challan${m.count === 1 ? '' : 's'}` })),
        format: moneyAxis,
        ariaLabel: 'Amount billed per month',
      }),
      table: () => dataTable(
        [{ title: 'Month', get: (r) => r.label }, { title: 'Challans', num: true, get: (r) => r.count }, { title: 'Billed', num: true, get: (r) => money(r.value) }],
        months
      ),
    });

    wireCard(body, 'c-items', {
      draw: (elm) => barChart(elm, {
        data: topItems.map((t) => ({ label: t.label, value: t.value, sub: `on ${t.count} challan${t.count === 1 ? '' : 's'}` })),
        format: (v) => fmtCompact(v),
        ariaLabel: 'Top services and parts by value',
      }),
      table: () => dataTable(
        [{ title: 'Item', get: (r) => r.label }, { title: 'Times', num: true, get: (r) => r.count }, { title: 'Value', num: true, get: (r) => money(r.value) }],
        topItems
      ),
    });

    wireCard(body, 'c-customers', {
      draw: (elm) => barChart(elm, {
        data: topCustomers.map((t) => ({ label: t.label, value: t.value, sub: `${t.count} visit${t.count === 1 ? '' : 's'}` })),
        format: (v) => fmtCompact(v),
        ariaLabel: 'Top customers by value',
      }),
      table: () => dataTable(
        [{ title: 'Customer', get: (r) => r.label }, { title: 'Visits', num: true, get: (r) => r.count }, { title: 'Billed', num: true, get: (r) => money(r.value) }],
        topCustomers
      ),
    });

    wireCard(body, 'c-modes', {
      draw: (elm) => barChart(elm, {
        data: modes.map((m) => ({ label: m.label, value: m.value, sub: `${m.count} challan${m.count === 1 ? '' : 's'}` })),
        format: (v) => fmtCompact(v),
        ariaLabel: 'Amount billed by payment mode',
      }),
      table: () => dataTable(
        [{ title: 'Mode', get: (r) => r.label }, { title: 'Challans', num: true, get: (r) => r.count }, { title: 'Billed', num: true, get: (r) => money(r.value) }],
        modes
      ),
    });

    /* ---------- sequence health ---------- */

    const seqEl = body.querySelector('#seq');
    if (!seq.length) {
      seqEl.innerHTML = '<p class="field__hint">No challan numbers recorded yet.</p>';
    } else {
      seqEl.innerHTML = html`
        <div class="kpis">
          <div class="kpi"><div class="kpi__label">Numbers used</div><div class="kpi__value">${seq.reduce((s, r) => s + r.live, 0)}</div></div>
          <div class="kpi"><div class="kpi__label">Missing</div>
            <div class="kpi__value" style="${raw(gapTotal ? 'color:var(--critical)' : '')}">${gapTotal}</div></div>
          <div class="kpi"><div class="kpi__label">Duplicates</div>
            <div class="kpi__value" style="${raw(dupeTotal ? 'color:var(--critical)' : '')}">${dupeTotal}</div></div>
        </div>
        ${raw(seq.map((r) => `
          <div>
            <div class="section-title">${esc(r.label)} — ${esc(r.min)} to ${esc(r.max)}${r.truncated ? ' (showing first 600)' : ''}</div>
            <div class="seq-strip">${r.cells.map((c, i) => {
              const cls = c.state === 'gap' ? 'seq-cell--gap' : c.state === 'dupe' ? 'seq-cell--dupe' : '';
              const title = c.state === 'gap' ? `${c.display} — missing`
                : c.state === 'void' ? `${c.display} — cancelled`
                : c.state === 'dupe' ? `${c.display} — used more than once`
                : `${c.display} — ${c.invoice?.customer?.name || 'used'}`;
              const style = c.state === 'void' ? 'opacity:.42' : '';
              const delay = i < 60 ? ` animation-delay:${i * 8}ms;` : '';
              return `<span class="seq-cell ${cls}" style="${style};${delay}" title="${esc(title)}">${esc(String(c.seq).slice(-3))}</span>`;
            }).join('')}</div>
            ${r.gaps.length ? `<p class="field__hint" style="margin-top:8px">Missing: ${esc(r.gaps.slice(0, 30).join(', '))}${r.gaps.length > 30 ? ` +${r.gaps.length - 30} more` : ''}</p>` : ''}
            ${r.duplicates.length ? `<p class="field__hint" style="margin-top:6px;color:var(--critical)">Used twice: ${esc(r.duplicates.map((d) => d.display).join(', '))}</p>` : ''}
          </div>`).join(''))}
        <div class="legend">
          <span class="legend__item"><span class="legend__swatch" style="background:var(--series-1)"></span>Used</span>
          <span class="legend__item"><span class="legend__swatch" style="background:var(--series-1);opacity:.42"></span>Cancelled</span>
          <span class="legend__item"><span class="legend__swatch legend__swatch--gap"></span>Missing</span>
          <span class="legend__item"><span class="legend__swatch" style="background:var(--critical)"></span>Duplicate</span>
        </div>`;
    }

  };

  paint();

  root.querySelector('#range').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    state.range = btn.dataset.range;
    root.querySelectorAll('[data-range]').forEach((b) => b.classList.toggle('is-active', b === btn));
    paint();
  });
}
