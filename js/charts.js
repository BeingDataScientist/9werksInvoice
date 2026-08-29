// Small hand-rolled SVG charts.
// Single-series throughout, so identity never depends on colour: the title
// names what is plotted, hover gives exact values, and every chart has a
// table view behind a toggle.

import { esc, prefersReducedMotion } from './util.js';

const MAX_BAR = 24;   // marks stay thin; the band's leftover is air
const RADIUS = 4;     // rounded data-end, square at the baseline

/* ---------------- scales ---------------- */

function niceScale(max, ticks = 4) {
  if (!(max > 0)) return { max: 1, step: 1 };
  const rough = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { max: Math.ceil(max / step) * step, step };
}

const topRect = (x, y, w, h, r = RADIUS) => {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}L${x},${y + rr}Q${x},${y} ${x + rr},${y}L${x + w - rr},${y}Q${x + w},${y} ${x + w},${y + rr}L${x + w},${y + h}Z`;
};

const rightRect = (x, y, w, h, r = RADIUS) => {
  const rr = Math.min(r, h / 2, w);
  return `M${x},${y}L${x + w - rr},${y}Q${x + w},${y} ${x + w},${y + rr}L${x + w},${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}L${x},${y + h}Z`;
};

/* ---------------- tooltip ---------------- */

let tipEl = null;
function tip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'chart-tip';
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function showTip(evt, html) {
  const t = tip();
  t.innerHTML = html;
  t.classList.add('is-on');
  const pad = 12;
  const r = t.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY - r.height - pad;
  if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y < 8) y = evt.clientY + pad;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${y}px`;
}

const hideTip = () => tipEl?.classList.remove('is-on');

function wireHits(root) {
  root.querySelectorAll('[data-tip]').forEach((node) => {
    const show = (e) => showTip(e, node.dataset.tip);
    node.addEventListener('pointerenter', show);
    node.addEventListener('pointermove', show);
    node.addEventListener('pointerleave', hideTip);
    node.addEventListener('pointercancel', hideTip);
  });
  root.addEventListener('pointerleave', hideTip);
}

const delay = (i) => (prefersReducedMotion() ? '' : ` style="animation-delay:${Math.min(i, 18) * 26}ms"`);

/* ---------------- column chart (value over time) ---------------- */

/**
 * data: [{ label, value, sub? }]
 * Labels every band when they fit, otherwise every nth.
 */
export function columnChart(container, { data, format = String, ariaLabel = 'Column chart', height = 210 }) {
  const width = Math.max(280, container.clientWidth || 560);
  const m = { top: 18, right: 8, bottom: 26, left: 44 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const max = Math.max(0, ...data.map((d) => d.value));
  const scale = niceScale(max);
  const band = iw / Math.max(1, data.length);
  const barW = Math.min(MAX_BAR, band * 0.6);
  const y = (v) => m.top + ih - (v / scale.max) * ih;

  const ticks = [];
  for (let v = 0; v <= scale.max + 1e-9; v += scale.step) {
    ticks.push(`<line class="grid-line" x1="${m.left}" y1="${y(v)}" x2="${m.left + iw}" y2="${y(v)}"/>
      <text class="axis-text" x="${m.left - 7}" y="${y(v) + 3.5}" text-anchor="end">${esc(format(v, true))}</text>`);
  }

  const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 46)));
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);

  const marks = data.map((d, i) => {
    const cx = m.left + band * i + band / 2;
    const h = Math.max(d.value > 0 ? 2 : 0, ((d.value / scale.max) * ih) || 0);
    const bx = cx - barW / 2;
    const by = m.top + ih - h;
    const label = i % every === 0 || i === data.length - 1
      ? `<text class="axis-text" x="${cx}" y="${m.top + ih + 16}" text-anchor="middle">${esc(d.label)}</text>` : '';
    // Only the peak carries a direct value label; the rest live on the axis and in the tooltip.
    const direct = i === peak && d.value > 0
      ? `<text class="value-text" x="${cx}" y="${by - 6}" text-anchor="middle">${esc(format(d.value))}</text>` : '';
    const tipHtml = esc(`<span class="chart-tip__k">${esc(d.label)}</span><br><span class="chart-tip__v">${esc(format(d.value))}</span>${d.sub ? `<br><span class="chart-tip__k">${esc(d.sub)}</span>` : ''}`);
    return `<g>
      <rect class="hit" x="${m.left + band * i}" y="${m.top}" width="${band}" height="${ih}" data-tip="${tipHtml}"/>
      ${h > 0 ? `<path class="mark mark--grow" d="${topRect(bx, by, barW, h)}"${delay(i)}/>` : ''}
      ${direct}${label}
    </g>`;
  }).join('');

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(ariaLabel)}">
    ${ticks.join('')}
    <line class="grid-line" x1="${m.left}" y1="${m.top + ih}" x2="${m.left + iw}" y2="${m.top + ih}"/>
    ${marks}
  </svg>`;
  wireHits(container);
}

/* ---------------- horizontal bars (ranked categories) ---------------- */

export function barChart(container, { data, format = String, ariaLabel = 'Bar chart', rowHeight = 34 }) {
  const width = Math.max(280, container.clientWidth || 560);
  const labelW = Math.min(150, Math.max(90, width * 0.32));
  const m = { top: 6, right: 60, bottom: 6, left: labelW };
  const iw = width - m.left - m.right;
  const height = m.top + m.bottom + data.length * rowHeight;
  const max = Math.max(0, ...data.map((d) => d.value)) || 1;
  const barH = Math.min(MAX_BAR, rowHeight * 0.58);

  const rows = data.map((d, i) => {
    const cy = m.top + i * rowHeight + rowHeight / 2;
    const w = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * iw);
    const tipHtml = esc(`<span class="chart-tip__k">${esc(d.label)}</span><br><span class="chart-tip__v">${esc(format(d.value))}</span>${d.sub ? `<br><span class="chart-tip__k">${esc(d.sub)}</span>` : ''}`);
    return `<g>
      <rect class="hit" x="0" y="${m.top + i * rowHeight}" width="${width}" height="${rowHeight}" data-tip="${tipHtml}"/>
      <text class="label-text" x="${m.left - 10}" y="${cy + 4}" text-anchor="end">${esc(d.label)}</text>
      ${w > 0 ? `<path class="mark mark--growx" d="${rightRect(m.left, cy - barH / 2, w, barH)}"${delay(i)}/>` : ''}
      <text class="value-text" x="${m.left + w + 8}" y="${cy + 4}">${esc(format(d.value))}</text>
    </g>`;
  }).join('');

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(ariaLabel)}">${rows}</svg>`;
  wireHits(container);
}

/* ---------------- table view (the always-available fallback) ---------------- */

export function dataTable(columns, rows) {
  const head = columns.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.title)}</th>`).join('');
  const body = rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${esc(c.get(r))}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Re-render a chart when its container resizes (orientation change, sidebar). */
export function responsive(container, draw) {
  draw();
  if (!window.ResizeObserver) return () => {};
  let last = container.clientWidth;
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth;
    if (Math.abs(w - last) < 24) return;
    last = w;
    draw();
  });
  ro.observe(container);
  return () => ro.disconnect();
}

export { hideTip };
