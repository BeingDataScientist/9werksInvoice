// The audit trail, written as sentences rather than field dumps, in the
// language the user picks. Events store raw values, so switching language
// re-renders the whole history — including entries recorded long ago.

import { getInvoice, listAudit, saveSettings } from '../store.js';
import { AUDIT_LANGS, EVENT, eventToText, renderEvent } from '../audit.js';
import {
  debounce, esc, fmtDateTime, html, normKey, raw, saveBlob, stagger, toast,
} from '../util.js';

const FILTERS = [
  { key: 'all', label: 'Everything' },
  { key: 'edits', label: 'Edits', types: [EVENT.CREATED, EVENT.UPDATED] },
  { key: 'cancels', label: 'Cancellations', types: [EVENT.DELETED, EVENT.RESTORED, EVENT.PURGED] },
  { key: 'exports', label: 'Exports', types: [EVENT.PDF, EVENT.SHARED, EVENT.BACKUP_EXPORT, EVENT.BACKUP_IMPORT] },
];

const state = { filter: 'all', query: '' };

export async function render(root, { params, settings, navigate, setTopbar }) {
  const scopedId = params.id || null;
  const scoped = scopedId ? await getInvoice(scopedId) : null;

  setTopbar({
    title: scoped ? `History · ${scoped.challanNo}` : 'History',
    sub: scoped ? scoped.customer?.name || '' : 'Everything that happened',
    back: Boolean(scoped),
  });

  let lang = settings.ui.auditLang || 'en';
  const events = await listAudit({ invoiceId: scopedId, limit: 0 });

  root.innerHTML = html`
    <div class="stack">
      <div class="row" style="justify-content:space-between">
        <div class="segmented" id="lang" role="group" aria-label="History language">
          ${raw(AUDIT_LANGS.map((l) => `<button data-lang="${l.code}" class="${l.code === lang ? 'is-active' : ''}"
            lang="${l.code}">${esc(l.native)}</button>`).join(''))}
        </div>
        <button class="btn btn--sm btn--ghost" id="export-history">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11M8 11l4 4 4-4"/><path d="M4 19h16"/></svg>
          Save as text
        </button>
      </div>

      ${scoped ? '' : raw(`
        <div class="search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input id="q" type="search" placeholder="Search history" aria-label="Search history">
        </div>
        <div class="segmented" id="filter" role="group" aria-label="Filter history">
          ${FILTERS.map((f) => `<button data-f="${f.key}" class="${f.key === state.filter ? 'is-active' : ''}">${esc(f.label)}</button>`).join('')}
        </div>`)}

      <div id="list"></div>
    </div>`;

  const listEl = root.querySelector('#list');

  const visible = () => {
    const filter = FILTERS.find((f) => f.key === state.filter);
    let rows = filter?.types ? events.filter((e) => filter.types.includes(e.type)) : events;
    if (state.query) {
      const q = normKey(state.query);
      rows = rows.filter((e) => {
        const r = renderEvent(e, lang, settings, { maxLines: 40 });
        const text = `${r.title} ${r.lines.join(' ')} ${e.challanNo || ''} ${e.customer || ''}`;
        return normKey(text.replace(/<[^>]+>/g, ' ')).includes(q);
      });
    }
    return rows;
  };

  const paint = () => {
    const rows = visible();
    if (!rows.length) {
      listEl.innerHTML = html`
        <div class="empty">
          <div class="empty__icon"><svg viewBox="0 0 24 24"><path d="M12 8v5l3 2"/><path d="M3.5 12a8.5 8.5 0 1 0 2.2-5.7"/><path d="M3 4v4h4"/></svg></div>
          <h3>Nothing here yet</h3>
          <p>Every challan you create, edit or cancel gets written down here automatically.</p>
        </div>`;
      return;
    }

    listEl.innerHTML = `<div class="timeline">${rows.map((e) => {
      const r = renderEvent(e, lang, settings, { maxLines: 6 });
      const clickable = e.invoiceId && !scopedId;
      return html`
        <div class="tl-item" ${raw(clickable ? `data-goto="${esc(e.invoiceId)}" role="button" tabindex="0" style="cursor:pointer"` : '')}>
          <span class="tl-item__dot tl-item__dot--${raw(r.kind)}"><svg viewBox="0 0 24 24">${raw(r.icon)}</svg></span>
          <div class="tl-item__head">
            <span class="tl-item__title">${raw(r.title)}</span>
            <span class="tl-item__time" title="${r.absolute}">${r.time}</span>
          </div>
          ${r.lines.length ? raw(`<div class="tl-item__lines">${r.lines.map((l) => `<div class="tl-line">${l}</div>`).join('')}</div>`) : ''}
          ${r.overflow ? raw(`<div class="tl-more">${esc(r.overflow)}</div>`) : ''}
        </div>`;
    }).join('')}</div>`;

    stagger(Array.from(listEl.querySelector('.timeline').children));

    listEl.querySelectorAll('[data-goto]').forEach((node) => {
      const go = () => navigate(`#/invoice/${node.dataset.goto}`);
      node.addEventListener('click', go);
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  };

  paint();

  root.querySelector('#lang').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-lang]');
    if (!btn) return;
    lang = btn.dataset.lang;
    root.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('is-active', b === btn));
    paint();
    await saveSettings({ ui: { auditLang: lang } });
  });

  root.querySelector('#filter')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-f]');
    if (!btn) return;
    state.filter = btn.dataset.f;
    root.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('is-active', b === btn));
    paint();
  });

  const onSearch = debounce((v) => { state.query = v; paint(); }, 160);
  root.querySelector('#q')?.addEventListener('input', (ev) => onSearch(ev.target.value));

  root.querySelector('#export-history').addEventListener('click', async () => {
    const rows = visible().slice().sort((a, b) => a.ts - b.ts);
    const langName = AUDIT_LANGS.find((l) => l.code === lang)?.native || lang;
    const text = [
      `${settings.business.name} — ${scoped ? `Challan ${scoped.challanNo}` : 'Full'} history (${langName})`,
      `Generated ${fmtDateTime(Date.now())}`,
      `${rows.length} entries`,
      ''.padEnd(60, '-'),
      '',
      ...rows.map((e) => eventToText(e, lang, settings)),
    ].join('\n');

    const name = `${scoped ? `challan-${scoped.challanNo}` : 'history'}-${lang}.txt`.replace(/[\\/:*?"<>|]+/g, '-');
    const result = await saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), name, {
      accept: { 'text/plain': ['.txt'] },
      description: 'History text file',
    });
    if (result.method !== 'cancelled') toast(`Saved ${result.name}`, { kind: 'good' });
  });
}
