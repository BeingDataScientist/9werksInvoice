// Full local backup as a .zip, and restore from one.
// The archive carries machine-readable JSON *and* plain CSV/TXT copies, so the
// data is still readable years later without this app.

import { STORES, getAll, getSettings, replaceSettings, transact, request, listInvoices, listAudit } from './store.js';
import { EVENT, eventToText, auditLangName } from './audit.js';
import { logEvent } from './repo.js';
import { fmtDate, fmtDateTime, saveBlob, round2 } from './util.js';

const APP_ID = 'werks-invoice';
const BACKUP_VERSION = 1;

function JSZipCtor() {
  if (!window.JSZip) throw new Error('Zip engine failed to load. Reload the app and try again.');
  return window.JSZip;
}

/* ---------------- csv ---------------- */

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

function invoicesCsv(invoices) {
  const head = ['Challan No', 'Sequence', 'Date', 'Customer', 'Phone', 'Address', 'Vehicle', 'Vehicle No', 'Km',
    'Items', 'Subtotal', 'Discount', 'Tax %', 'Tax Amount', 'Total', 'Advance', 'Balance',
    'Payment Mode', 'Payment Status', 'Notes', 'Status', 'Created', 'Last Edited'];
  const rows = invoices.map((i) => [
    i.challanNo, i.challanSeq, i.date, i.customer?.name, i.customer?.phone, i.customer?.address,
    i.vehicle?.model, i.vehicle?.regNo, i.vehicle?.km,
    i.items?.length || 0, i.subtotal, i.discount, i.taxPercent, i.taxAmount, i.grandTotal, i.advance, i.balance,
    i.paymentMode, i.paymentStatus, i.notes,
    i.deletedAt ? 'Cancelled' : 'Active',
    i.createdAt ? fmtDateTime(i.createdAt) : '',
    i.updatedAt ? fmtDateTime(i.updatedAt) : '',
  ]);
  return csv([head, ...rows]);
}

function itemsCsv(invoices) {
  const head = ['Challan No', 'Date', 'Customer', 'Vehicle No', 'Sr', 'Particulars', 'Quantity', 'Rate', 'Amount', 'Status'];
  const rows = [];
  for (const i of invoices) {
    (i.items || []).forEach((it, idx) => {
      rows.push([i.challanNo, i.date, i.customer?.name, i.vehicle?.regNo, idx + 1,
        it.desc, it.qty, it.rate, it.amount, i.deletedAt ? 'Cancelled' : 'Active']);
    });
  }
  return csv([head, ...rows]);
}

/* ---------------- export ---------------- */

export async function buildBackupZip({ lang = 'en' } = {}) {
  const JSZip = JSZipCtor();
  const zip = new JSZip();

  const [invoices, audit, products, parties, vehicles, settings] = await Promise.all([
    listInvoices({ includeDeleted: true }),
    listAudit({ limit: 0 }),
    getAll(STORES.products),
    getAll(STORES.parties),
    getAll(STORES.vehicles),
    getSettings(),
  ]);

  const exportedAt = Date.now();
  const manifest = {
    app: APP_ID,
    appName: 'Challan Book',
    backupVersion: BACKUP_VERSION,
    schemaVersion: settings.schemaVersion || 1,
    exportedAt,
    exportedAtText: fmtDateTime(exportedAt),
    counts: {
      invoices: invoices.length,
      active: invoices.filter((i) => !i.deletedAt).length,
      cancelled: invoices.filter((i) => i.deletedAt).length,
      auditEvents: audit.length,
      products: products.length,
      customers: parties.length,
      vehicles: vehicles.length,
    },
    totals: {
      grandTotal: round2(invoices.filter((i) => !i.deletedAt).reduce((s, i) => s + (i.grandTotal || 0), 0)),
    },
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const data = zip.folder('data');
  data.file('invoices.json', JSON.stringify(invoices, null, 2));
  data.file('audit.json', JSON.stringify(audit, null, 2));
  data.file('products.json', JSON.stringify(products, null, 2));
  data.file('parties.json', JSON.stringify(parties, null, 2));
  data.file('vehicles.json', JSON.stringify(vehicles, null, 2));
  data.file('settings.json', JSON.stringify(settings, null, 2));

  const readable = zip.folder('readable');
  readable.file('challans.csv', invoicesCsv(invoices));
  readable.file('line-items.csv', itemsCsv(invoices));

  const historyLines = audit
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map((e) => eventToText(e, lang, settings));
  readable.file(
    `history-${lang}.txt`,
    [
      `${settings.business.name || 'Challan Book'} — full history (${auditLangName(lang)})`,
      `Generated ${fmtDateTime(exportedAt)}`,
      `${audit.length} entries`,
      ''.padEnd(60, '-'),
      '',
      ...historyLines,
    ].join('\n')
  );

  const active = invoices.filter((i) => !i.deletedAt);
  readable.file('README.txt', [
    `${settings.business.name || 'Challan Book'} — data backup`,
    ''.padEnd(60, '='),
    '',
    `Taken on : ${fmtDateTime(exportedAt)}`,
    `Challans : ${manifest.counts.invoices} (${manifest.counts.active} active, ${manifest.counts.cancelled} cancelled)`,
    `Value    : ${manifest.totals.grandTotal.toLocaleString('en-IN')}`,
    `Range    : ${active.length ? `${fmtDate(active[active.length - 1].date)} to ${fmtDate(active[0].date)}` : '—'}`,
    '',
    'WHAT IS IN THIS FILE',
    '  data/       Exact copies of everything the app stores. Used when restoring.',
    '  readable/   Plain CSV and text copies you can open in Excel or Notepad.',
    '',
    'HOW TO RESTORE',
    '  Open the app > Settings > Restore from backup, and pick this .zip file.',
    '  "Merge" keeps whatever is already on the phone and adds what is missing.',
    '  "Replace" wipes the phone first, then loads this backup exactly as it is.',
    '',
    'This backup contains no passwords and was never uploaded anywhere.',
  ].join('\n'));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { blob, manifest };
}

export function backupFilename(settings, when = new Date()) {
  const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
  const time = `${String(when.getHours()).padStart(2, '0')}${String(when.getMinutes()).padStart(2, '0')}`;
  const name = String(settings.business?.name || 'challan-book').replace(/[^\w-]+/g, '');
  return `${name}-backup-${stamp}-${time}.zip`;
}

export async function exportBackup({ dirHandle = null, lang = 'en' } = {}) {
  const settings = await getSettings();
  const { blob, manifest } = await buildBackupZip({ lang });
  const filename = backupFilename(settings);
  const result = await saveBlob(blob, filename, {
    dirHandle,
    accept: { 'application/zip': ['.zip'] },
    description: 'Backup archive',
  });
  if (result.method !== 'cancelled') {
    await logEvent(EVENT.BACKUP_EXPORT, {
      meta: {
        invoices: manifest.counts.invoices,
        events: manifest.counts.auditEvents,
        file: result.name,
        location: result.dirName ? `Saved to ${result.dirName}` : null,
      },
    });
  }
  return { result, manifest, size: blob.size };
}

/* ---------------- import ---------------- */

async function readJson(zip, path) {
  const entry = zip.file(path);
  if (!entry) return null;
  try {
    return JSON.parse(await entry.async('string'));
  } catch {
    throw new Error(`${path} in this backup is damaged and could not be read.`);
  }
}

/** Peek inside a zip so the user can confirm before anything is written. */
export async function inspectBackup(file) {
  const JSZip = JSZipCtor();
  const zip = await JSZip.loadAsync(file);
  const manifest = await readJson(zip, 'manifest.json');
  if (!manifest || manifest.app !== APP_ID) {
    throw new Error('This does not look like a Challan Book backup file.');
  }
  if ((manifest.backupVersion || 1) > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of the app. Update the app first.');
  }
  const invoices = (await readJson(zip, 'data/invoices.json')) || [];
  return { zip, manifest, invoiceCount: invoices.length };
}

const newest = (a, b) => ((a?.updatedAt || 0) >= (b?.updatedAt || 0) ? a : b);

/**
 * Restore a backup.
 *   mode 'merge'   — keep what's here, add what's missing, newest edit wins
 *   mode 'replace' — wipe everything first, then load the backup verbatim
 */
export async function importBackup(file, { mode = 'merge', restoreSettings = false } = {}) {
  const { zip, manifest } = await inspectBackup(file);

  const [invoices, audit, products, parties, vehicles, settings] = await Promise.all([
    readJson(zip, 'data/invoices.json'),
    readJson(zip, 'data/audit.json'),
    readJson(zip, 'data/products.json'),
    readJson(zip, 'data/parties.json'),
    readJson(zip, 'data/vehicles.json'),
    readJson(zip, 'data/settings.json'),
  ]);

  const stats = { added: 0, updated: 0, skipped: 0, events: 0 };
  const allStores = [STORES.invoices, STORES.audit, STORES.products, STORES.parties, STORES.vehicles];

  await transact(allStores, async (stores) => {
    if (mode === 'replace') {
      for (const name of allStores) await request(stores[name].clear());
    }

    for (const inv of invoices || []) {
      if (!inv?.id) { stats.skipped++; continue; }
      const existing = mode === 'replace' ? null : await request(stores[STORES.invoices].get(inv.id));
      if (!existing) {
        await request(stores[STORES.invoices].put(inv));
        stats.added++;
      } else if ((inv.updatedAt || 0) > (existing.updatedAt || 0)) {
        await request(stores[STORES.invoices].put(newest(inv, existing)));
        stats.updated++;
      } else {
        stats.skipped++;
      }
    }

    for (const ev of audit || []) {
      if (!ev?.id) continue;
      const existing = mode === 'replace' ? null : await request(stores[STORES.audit].get(ev.id));
      if (!existing) { await request(stores[STORES.audit].put(ev)); stats.events++; }
    }

    const mergeList = async (storeName, rows) => {
      for (const row of rows || []) {
        if (!row?.key) continue;
        const existing = mode === 'replace' ? null : await request(stores[storeName].get(row.key));
        if (!existing) { await request(stores[storeName].put(row)); continue; }
        await request(stores[storeName].put({
          ...existing,
          ...row,
          count: Math.max(existing.count || 0, row.count || 0),
          lastUsed: Math.max(existing.lastUsed || 0, row.lastUsed || 0),
        }));
      }
    };
    await mergeList(STORES.products, products);
    await mergeList(STORES.parties, parties);
    await mergeList(STORES.vehicles, vehicles);
  });

  if (restoreSettings && settings) await replaceSettings(settings);

  await logEvent(EVENT.BACKUP_IMPORT, {
    meta: {
      added: stats.added,
      updated: stats.updated,
      skipped: stats.skipped,
      events: stats.events,
      mode,
      from: manifest.exportedAtText,
    },
  });

  return { stats, manifest };
}
