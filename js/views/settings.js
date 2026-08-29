// Settings: business details, the challan series, PDF output, backup/restore.

import {
  STORES, clear, clearSaveFolder, getSaveFolder, getSettings,
  listInvoices, requestPersistence, saveSettings, setSaveFolder, storageEstimate,
} from '../store.js';
import { AUDIT_LANGS, EVENT } from '../audit.js';
import { logEvent } from '../repo.js';
import { nextChallan, prefixNeedsYearToken } from '../challan.js';
import { exportBackup, importBackup, inspectBackup } from '../backup.js';
import {
  actionSheet, alertDialog, canPickDirectory, confirmDialog, debounce, esc,
  html, pickFile, raw, toast, todayISO,
} from '../util.js';
import { applyTheme } from '../theme.js';

const THEMES = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];
const RESET_POLICIES = [
  { key: 'never', label: 'Never — one running series' },
  { key: 'fy', label: 'Every financial year (1 April)' },
  { key: 'calendar', label: 'Every calendar year (1 January)' },
];

const fmtBytes = (n) => {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export async function render(root, { settings, navigate, setTopbar, reload }) {
  setTopbar({ title: 'Settings', sub: settings.business.name, back: false });

  const [invoices, folder, estimate] = await Promise.all([
    listInvoices({ includeDeleted: true }),
    getSaveFolder(),
    storageEstimate(),
  ]);

  const biz = settings.business;
  const ch = settings.challan;

  root.innerHTML = html`
    <div class="stack">

      <div class="card">
        <div class="card__head"><h3>Business details</h3></div>
        <div class="card__body stack">
          <div class="grid-2">
            <div class="field"><label for="s-name">Name</label>
              <input id="s-name" class="input" value="${biz.name}" data-s="business.name"></div>
            <div class="field"><label for="s-tagline">Tagline</label>
              <input id="s-tagline" class="input" value="${biz.tagline}" data-s="business.tagline"></div>
          </div>
          <div class="field"><label for="s-address">Address</label>
            <textarea id="s-address" class="textarea" data-s="business.address">${biz.address}</textarea></div>
          <div class="grid-3">
            <div class="field"><label for="s-mobile">Mobile</label>
              <input id="s-mobile" class="input" inputmode="tel" value="${biz.mobile}" data-s="business.mobile"></div>
            <div class="field"><label for="s-office">Office</label>
              <input id="s-office" class="input" inputmode="tel" value="${biz.office}" data-s="business.office"></div>
            <div class="field"><label for="s-insta">Instagram</label>
              <input id="s-insta" class="input" value="${biz.instagram}" data-s="business.instagram"></div>
          </div>
          <div class="field"><label for="s-terms">Terms printed on the challan</label>
            <textarea id="s-terms" class="textarea" data-s="business.terms">${biz.terms}</textarea></div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><h3>Challan numbering</h3></div>
        <div class="card__body stack">
          <div class="challan-box">
            <div style="flex:1">
              <div class="challan-box__label">Next challan will be</div>
              <div class="challan-box__no" id="next-preview">—</div>
            </div>
          </div>
          <div id="series-warning"></div>
          <div class="grid-2">
            <div class="field">
              <label for="s-prefix">Series prefix</label>
              <input id="s-prefix" class="input" value="${ch.prefix}" placeholder="none" data-s="challan.prefix" spellcheck="false">
              <span class="field__hint">Optional. Use {FY} for 26-27, {YY} for 26, {MM} for the month.</span>
            </div>
            <div class="field">
              <label for="s-padding">Digits</label>
              <input id="s-padding" class="input" type="number" min="1" max="8" value="${ch.padding}" data-s="challan.padding">
              <span class="field__hint">3 digits prints 34 as 034.</span>
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="s-start">Start numbering at</label>
              <input id="s-start" class="input" type="number" min="1" value="${ch.start}" data-s="challan.start">
            </div>
            <div class="field">
              <label for="s-reset">Restart numbering</label>
              <select id="s-reset" class="select" data-s="challan.resetPolicy">
                ${raw(RESET_POLICIES.map((p) => `<option value="${p.key}" ${p.key === ch.resetPolicy ? 'selected' : ''}>${esc(p.label)}</option>`).join(''))}
              </select>
            </div>
          </div>
          <div class="pref-row">
            <div class="pref-row__main">
              <strong>Fill the number automatically</strong>
              <small>A new challan opens with the next number already in place.</small>
            </div>
            <label class="switch"><input type="checkbox" data-s="challan.autoAssign" ${raw(ch.autoAssign ? 'checked' : '')}>
              <span class="switch__track"></span><span class="visually-hidden">Fill automatically</span></label>
          </div>
          <div class="pref-row">
            <div class="pref-row__main">
              <strong>Warn when a number is skipped</strong>
              <small>Tells you before you leave a hole in the book.</small>
            </div>
            <label class="switch"><input type="checkbox" data-s="challan.warnOnGap" ${raw(ch.warnOnGap ? 'checked' : '')}>
              <span class="switch__track"></span><span class="visually-hidden">Warn on gaps</span></label>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><h3>PDF</h3></div>
        <div class="card__body stack">
          <div class="grid-2">
            <div class="field">
              <label for="s-page">Paper size</label>
              <select id="s-page" class="select" data-s="pdf.pageSize">
                <option value="a5" ${raw(settings.pdf.pageSize === 'a5' ? 'selected' : '')}>A5 — like the book</option>
                <option value="a4" ${raw(settings.pdf.pageSize === 'a4' ? 'selected' : '')}>A4</option>
              </select>
            </div>
            <div class="field">
              <label for="s-rows">Blank rows to print</label>
              <input id="s-rows" class="input" type="number" min="6" max="30" value="${settings.pdf.minRows}" data-s="pdf.minRows">
            </div>
          </div>
          <div class="field">
            <label for="s-filename">File name</label>
            <input id="s-filename" class="input" value="${settings.pdf.filenamePattern}" data-s="pdf.filenamePattern" spellcheck="false">
            <span class="field__hint">{no} {customer} {date} {vehicle}</span>
          </div>
          <div class="pref-row">
            <div class="pref-row__main">
              <strong>Where PDFs are saved</strong>
              <small id="folder-label">${folder ? `Straight into “${folder.name}”` : 'You are asked each time'}</small>
            </div>
            <div class="row">
              ${raw(canPickDirectory()
                ? '<button class="btn btn--sm" id="pick-folder">Choose folder</button>'
                : '<span class="chip">Ask each time</span>')}
              ${folder ? raw('<button class="btn btn--sm btn--ghost" id="clear-folder">Clear</button>') : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><h3>Appearance</h3></div>
        <div class="card__body stack">
          <div class="pref-row">
            <div class="pref-row__main"><strong>Theme</strong></div>
            <div class="segmented" id="theme">
              ${raw(THEMES.map((t) => `<button data-theme="${t.key}" class="${settings.ui.theme === t.key ? 'is-active' : ''}">${esc(t.label)}</button>`).join(''))}
            </div>
          </div>
          <div class="pref-row">
            <div class="pref-row__main">
              <strong>History language</strong>
              <small>How the audit trail is written.</small>
            </div>
            <div class="segmented" id="audit-lang">
              ${raw(AUDIT_LANGS.map((l) => `<button data-lang="${l.code}" lang="${l.code}"
                class="${settings.ui.auditLang === l.code ? 'is-active' : ''}">${esc(l.native)}</button>`).join(''))}
            </div>
          </div>
          <div class="pref-row">
            <div class="pref-row__main">
              <strong>Currency symbol</strong>
              <small>Shown in the app. PDFs print plain numbers, like the book.</small>
            </div>
            <input class="input" style="width:90px" value="${settings.ui.currency}" data-s="ui.currency" maxlength="3">
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><h3>Backup</h3></div>
        <div class="card__body stack">
          <p class="field__hint">
            Everything lives on this phone only. A backup is a single .zip holding all
            ${invoices.length} challan${invoices.length === 1 ? '' : 's'}, the full history, and your settings —
            plus CSV copies you can open in Excel.
          </p>
          <div class="row">
            <button class="btn btn--primary" id="export">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4H3v-4"/><path d="M12 3v12M8 11l4 4 4-4"/></svg>
              Back up now
            </button>
            <button class="btn" id="import">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4H3v-4"/><path d="M12 15V3M8 7l4-4 4 4"/></svg>
              Restore from backup
            </button>
          </div>
          ${estimate ? raw(`<p class="field__hint">Using ${esc(fmtBytes(estimate.usage))} of device storage.</p>`) : ''}
          <div class="pref-row">
            <div class="pref-row__main">
              <strong>Keep this data safe</strong>
              <small id="persist-label">Ask the phone not to clear this app's storage.</small>
            </div>
            <button class="btn btn--sm" id="persist">Turn on</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><h3>Danger zone</h3></div>
        <div class="card__body stack">
          <div class="pref-row">
            <div class="pref-row__main">
              <strong>Erase everything</strong>
              <small>Deletes all challans, history and learned suggestions from this phone.</small>
            </div>
            <button class="btn btn--danger btn--sm" id="wipe">Erase</button>
          </div>
        </div>
      </div>

      <p class="field__hint" style="text-align:center">
        9WERKS Invoice · works offline · nothing leaves this device
      </p>
    </div>`;

  /* ---------- live settings binding ---------- */

  const setPath = (obj, path, value) => {
    const parts = path.split('.');
    const last = parts.pop();
    const target = parts.reduce((o, k) => (o[k] ??= {}), obj);
    target[last] = value;
    return obj;
  };

  const previewEl = root.querySelector('#next-preview');
  const warnEl = root.querySelector('#series-warning');

  const refreshPreview = async () => {
    const current = await getSettings();
    previewEl.textContent = nextChallan(invoices, current, todayISO()).display;
    warnEl.innerHTML = prefixNeedsYearToken(current.challan)
      ? html`<div class="banner">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9.5 17H2.5z"/><path d="M12 10v4M12 17.5v.01"/></svg>
          <span class="banner__main">Numbering restarts each year but the prefix has no year in it, so
          last year's <b>001</b> and this year's <b>001</b> would look identical. Add <b>{FY}</b> to the prefix.</span>
        </div>`
      : '';
  };
  refreshPreview();

  const persist = debounce(async (path, value) => {
    const patch = setPath({}, path, value);
    await saveSettings(patch);
    await logEvent(EVENT.SETTINGS, { meta: { path } });
    refreshPreview();
  }, 420);

  root.querySelectorAll('[data-s]').forEach((node) => {
    const path = node.dataset.s;
    const isCheck = node.type === 'checkbox';
    const isNumber = node.type === 'number';
    const evt = isCheck || node.tagName === 'SELECT' ? 'change' : 'input';
    node.addEventListener(evt, () => {
      const value = isCheck ? node.checked : isNumber ? Number(node.value) : node.value;
      persist(path, value);
    });
  });

  /* ---------- theme & language ---------- */

  root.querySelector('#theme').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-theme]');
    if (!btn) return;
    root.querySelectorAll('[data-theme]').forEach((b) => b.classList.toggle('is-active', b === btn));
    applyTheme(btn.dataset.theme);
    await saveSettings({ ui: { theme: btn.dataset.theme } });
  });

  root.querySelector('#audit-lang').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-lang]');
    if (!btn) return;
    root.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('is-active', b === btn));
    await saveSettings({ ui: { auditLang: btn.dataset.lang } });
    toast('History language changed', { kind: 'good' });
  });

  /* ---------- save folder ---------- */

  root.querySelector('#pick-folder')?.addEventListener('click', async () => {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
      await setSaveFolder(handle);
      root.querySelector('#folder-label').textContent = `Straight into “${handle.name}”`;
      toast(`PDFs will be saved into “${handle.name}”`, { kind: 'good' });
    } catch (err) {
      if (err?.name !== 'AbortError') toast('Could not set that folder.', { kind: 'error' });
    }
  });

  root.querySelector('#clear-folder')?.addEventListener('click', async () => {
    await clearSaveFolder();
    root.querySelector('#folder-label').textContent = 'You are asked each time';
    toast('Cleared. You will be asked each time.', { kind: 'good' });
  });

  /* ---------- persistence ---------- */

  const persistBtn = root.querySelector('#persist');
  if (navigator.storage?.persisted) {
    navigator.storage.persisted().then((on) => {
      if (on) {
        persistBtn.textContent = 'On';
        persistBtn.disabled = true;
        root.querySelector('#persist-label').textContent = 'This app’s storage is protected from automatic clearing.';
      }
    });
  }
  persistBtn.addEventListener('click', async () => {
    const ok = await requestPersistence();
    toast(ok ? 'Storage protected' : 'The browser did not grant this.', { kind: ok ? 'good' : 'info' });
    if (ok) { persistBtn.textContent = 'On'; persistBtn.disabled = true; }
  });

  /* ---------- backup ---------- */

  root.querySelector('#export').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Packing…';
    try {
      const folderHandle = await getSaveFolder();
      const { result, size } = await exportBackup({ dirHandle: folderHandle, lang: settings.ui.auditLang });
      if (result.method === 'cancelled') return;
      toast(`Backup saved — ${result.name} (${fmtBytes(size)})`, { kind: 'good', duration: 4500 });
    } catch (err) {
      console.error(err);
      toast(err.message || 'Backup failed.', { kind: 'error' });
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  root.querySelector('#import').addEventListener('click', async () => {
    const file = await pickFile('.zip,application/zip');
    if (!file) return;

    let info;
    try {
      info = await inspectBackup(file);
    } catch (err) {
      await alertDialog({ title: 'Cannot read that file', body: esc(err.message) });
      return;
    }

    const mode = await actionSheet({
      title: `Restore ${info.invoiceCount} challans?`,
      options: [
        {
          value: 'merge',
          label: 'Merge with what is here',
          sub: 'Adds anything missing and keeps the newest version of each challan.',
          icon: '<path d="M8 7h8M8 12h8M8 17h5"/>',
        },
        {
          value: 'replace',
          label: 'Replace everything',
          sub: 'Erases this phone first, then loads the backup exactly as it was.',
          icon: '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/>',
          danger: true,
        },
      ],
    });
    if (!mode) return;

    if (mode === 'replace') {
      const ok = await confirmDialog({
        title: 'Replace everything?',
        body: `All ${invoices.length} challans on this phone will be erased and replaced with the backup from <b>${esc(info.manifest.exportedAtText || 'an earlier date')}</b>. This cannot be undone.`,
        confirmLabel: 'Replace',
        danger: true,
      });
      if (!ok) return;
    }

    try {
      const { stats } = await importBackup(file, { mode, restoreSettings: mode === 'replace' });
      toast(`Restored — ${stats.added} added, ${stats.updated} updated`, { kind: 'good', duration: 4500 });
      reload();
    } catch (err) {
      console.error(err);
      await alertDialog({ title: 'Restore failed', body: esc(err.message || 'Something went wrong.') });
    }
  });

  /* ---------- wipe ---------- */

  root.querySelector('#wipe').addEventListener('click', async () => {
    const first = await confirmDialog({
      title: 'Erase everything?',
      body: `This removes all <b>${invoices.length}</b> challans, the entire history and every learned suggestion from this phone. Make a backup first if you might want any of it back.`,
      confirmLabel: 'Continue',
      danger: true,
    });
    if (!first) return;
    const second = await confirmDialog({
      title: 'Really erase?',
      body: 'Last chance. There is no undo.',
      confirmLabel: 'Erase everything',
      danger: true,
    });
    if (!second) return;

    for (const name of [STORES.invoices, STORES.audit, STORES.products, STORES.parties, STORES.vehicles]) {
      await clear(name);
    }
    toast('Everything erased', { kind: 'good' });
    navigate('#/invoices', { replace: true, reload: true });
  });

}
