// Audit trail: what changed, and how to say it in a language a person reads.
// Events store RAW values, so the same history can be re-rendered in any
// language later — nothing is baked in at write time.

import { esc, fmtDate, fmtDateTime, fmtMoney, relTime, uid } from './util.js';

export const AUDIT_LANGS = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'mr', label: 'Marathi', native: 'मराठी' },
];

export const EVENT = {
  CREATED: 'created',
  UPDATED: 'updated',
  DELETED: 'deleted',
  RESTORED: 'restored',
  PURGED: 'purged',
  PDF: 'pdf',
  SHARED: 'shared',
  BACKUP_EXPORT: 'backup_export',
  BACKUP_IMPORT: 'backup_import',
  SETTINGS: 'settings',
};

/* ---------------- field catalogue ---------------- */

const money = (v, s) => fmtMoney(v, s.ui.currency);

const FIELDS = [
  { path: 'challanNo',        en: 'Challan No.',    hi: 'चालान नंबर',     mr: 'चलन क्रमांक' },
  { path: 'date',             en: 'Date',           hi: 'तारीख',          mr: 'तारीख',        fmt: (v) => fmtDate(v) },
  { path: 'customer.name',    en: 'Customer',       hi: 'ग्राहक',          mr: 'ग्राहक' },
  { path: 'customer.address', en: 'Address',        hi: 'पता',            mr: 'पत्ता' },
  { path: 'customer.phone',   en: 'Phone',          hi: 'फ़ोन',            mr: 'फोन' },
  { path: 'vehicle.model',    en: 'Vehicle',        hi: 'गाड़ी',           mr: 'गाडी' },
  { path: 'vehicle.regNo',    en: 'Vehicle No.',    hi: 'गाड़ी नंबर',      mr: 'गाडी क्रमांक' },
  { path: 'vehicle.km',       en: 'Km reading',     hi: 'किलोमीटर',        mr: 'किलोमीटर' },
  { path: 'paymentMode',      en: 'Payment mode',   hi: 'भुगतान का तरीका', mr: 'पेमेंट प्रकार' },
  { path: 'paymentStatus',    en: 'Payment status', hi: 'भुगतान स्थिति',   mr: 'पेमेंट स्थिती' },
  { path: 'discount',         en: 'Discount',       hi: 'छूट',            mr: 'सवलत',        fmt: money },
  { path: 'taxPercent',       en: 'Tax %',          hi: 'टैक्स %',         mr: 'कर %',        fmt: (v) => `${v}%` },
  { path: 'advance',          en: 'Advance paid',   hi: 'एडवांस',          mr: 'आगाऊ रक्कम',   fmt: money },
  { path: 'notes',            en: 'Notes',          hi: 'नोट्स',           mr: 'नोंदी' },
  { path: 'grandTotal',       en: 'Total',          hi: 'कुल',            mr: 'एकूण',        fmt: money },
];

const ITEM_FIELDS = [
  { path: 'desc',   en: 'Particulars', hi: 'विवरण', mr: 'तपशील' },
  { path: 'qty',    en: 'Quantity',    hi: 'मात्रा', mr: 'संख्या' },
  { path: 'rate',   en: 'Rate',        hi: 'दर',    mr: 'दर',    fmt: money },
  { path: 'amount', en: 'Amount',      hi: 'रकम',   mr: 'रक्कम',  fmt: money },
];

const fieldByPath = new Map(FIELDS.map((f) => [f.path, f]));
const itemFieldByPath = new Map(ITEM_FIELDS.map((f) => [f.path, f]));

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

/* ---------------- diffing ---------------- */

const sameValue = (a, b) => {
  const na = a == null || a === '' ? '' : a;
  const nb = b == null || b === '' ? '' : b;
  if (typeof na === 'number' || typeof nb === 'number') return Number(na || 0) === Number(nb || 0);
  return String(na) === String(nb);
};

/**
 * Compare two invoice snapshots. Returns a flat list of change records that
 * carry raw values only.
 */
export function diffInvoice(before, after) {
  const changes = [];

  for (const f of FIELDS) {
    const from = getPath(before, f.path);
    const to = getPath(after, f.path);
    if (!sameValue(from, to)) changes.push({ kind: 'field', path: f.path, from, to });
  }

  const beforeItems = before?.items || [];
  const afterItems = after?.items || [];
  const beforeById = new Map(beforeItems.map((it) => [it.id, it]));
  const afterById = new Map(afterItems.map((it) => [it.id, it]));

  for (const it of afterItems) {
    const prev = beforeById.get(it.id);
    if (!prev) {
      changes.push({ kind: 'item-add', desc: it.desc, qty: it.qty, rate: it.rate, amount: it.amount });
      continue;
    }
    for (const f of ITEM_FIELDS) {
      if (!sameValue(prev[f.path], it[f.path])) {
        changes.push({
          kind: 'item-field',
          path: f.path,
          desc: it.desc || prev.desc,
          from: prev[f.path],
          to: it[f.path],
        });
      }
    }
  }

  for (const it of beforeItems) {
    if (!afterById.has(it.id)) {
      changes.push({ kind: 'item-del', desc: it.desc, qty: it.qty, rate: it.rate, amount: it.amount });
    }
  }

  return changes;
}

/* ---------------- event construction ---------------- */

export function buildEvent(type, { invoice, changes = [], meta = {} } = {}) {
  return {
    id: uid('ev'),
    ts: Date.now(),
    type,
    invoiceId: invoice?.id || null,
    challanNo: invoice?.challanNo || null,
    customer: invoice?.customer?.name || null,
    changes,
    meta,
  };
}

/* ---------------- language pack ---------------- */

const BLANK = { en: '(blank)', hi: '(खाली)', mr: '(रिकामे)' };

const T = {
  en: {
    created: (e) => `Created challan <b>${e.no}</b>${e.who ? ` for <b>${e.who}</b>` : ''}`,
    updated: (e) => `Edited challan <b>${e.no}</b>`,
    deleted: (e) => `Cancelled challan <b>${e.no}</b>`,
    restored: (e) => `Restored challan <b>${e.no}</b>`,
    purged: (e) => `Permanently deleted challan <b>${e.no}</b>`,
    pdf: (e) => `Saved challan <b>${e.no}</b> as PDF`,
    shared: (e) => `Shared challan <b>${e.no}</b>`,
    backup_export: () => 'Exported a full backup',
    backup_import: () => 'Imported a backup',
    settings: () => 'Changed settings',
    summary: (e) => `${e.n} item${e.n === 1 ? '' : 's'} · ${e.total}`,
    change: (l, from, to) => `${l} changed from <span class="was">${from}</span> to <span class="now">${to}</span>`,
    set: (l, to) => `${l} set to <span class="now">${to}</span>`,
    cleared: (l, from) => `${l} cleared (was <span class="was">${from}</span>)`,
    itemAdd: (d, amt) => `Added <b>“${d}”</b> — ${amt}`,
    itemDel: (d, amt) => `Removed <b>“${d}”</b> — ${amt}`,
    itemChange: (d, l, from, to) => `<b>“${d}”</b> — ${l} changed from <span class="was">${from}</span> to <span class="now">${to}</span>`,
    backupStats: (e) => `${e.invoices} challans, ${e.events} history entries`,
    importStats: (e) => `${e.added} added, ${e.updated} updated, ${e.skipped} skipped`,
    more: (n) => `and ${n} more change${n === 1 ? '' : 's'}`,
    noHistory: 'Nothing recorded yet',
  },
  hi: {
    created: (e) => `चालान <b>${e.no}</b> बनाया${e.who ? ` — <b>${e.who}</b> के लिए` : ''}`,
    updated: (e) => `चालान <b>${e.no}</b> में बदलाव किया`,
    deleted: (e) => `चालान <b>${e.no}</b> रद्द किया`,
    restored: (e) => `चालान <b>${e.no}</b> वापस चालू किया`,
    purged: (e) => `चालान <b>${e.no}</b> हमेशा के लिए मिटाया`,
    pdf: (e) => `चालान <b>${e.no}</b> PDF में सेव किया`,
    shared: (e) => `चालान <b>${e.no}</b> शेयर किया`,
    backup_export: () => 'पूरा बैकअप एक्सपोर्ट किया',
    backup_import: () => 'बैकअप इम्पोर्ट किया',
    settings: () => 'सेटिंग्स बदलीं',
    summary: (e) => `${e.n} वस्तुएँ · ${e.total}`,
    change: (l, from, to) => `${l} <span class="was">${from}</span> से बदलकर <span class="now">${to}</span> किया`,
    set: (l, to) => `${l} <span class="now">${to}</span> रखा`,
    cleared: (l, from) => `${l} हटाया (पहले <span class="was">${from}</span> था)`,
    itemAdd: (d, amt) => `<b>“${d}”</b> जोड़ा — ${amt}`,
    itemDel: (d, amt) => `<b>“${d}”</b> हटाया — ${amt}`,
    itemChange: (d, l, from, to) => `<b>“${d}”</b> — ${l} <span class="was">${from}</span> से <span class="now">${to}</span> किया`,
    backupStats: (e) => `${e.invoices} चालान, ${e.events} हिस्ट्री एंट्री`,
    importStats: (e) => `${e.added} नए, ${e.updated} अपडेट, ${e.skipped} छोड़े`,
    more: (n) => `और ${n} बदलाव`,
    noHistory: 'अभी कुछ दर्ज नहीं है',
  },
  mr: {
    created: (e) => `चलन <b>${e.no}</b> तयार केले${e.who ? ` — <b>${e.who}</b> साठी` : ''}`,
    updated: (e) => `चलन <b>${e.no}</b> मध्ये बदल केला`,
    deleted: (e) => `चलन <b>${e.no}</b> रद्द केले`,
    restored: (e) => `चलन <b>${e.no}</b> पुन्हा सुरू केले`,
    purged: (e) => `चलन <b>${e.no}</b> कायमचे हटवले`,
    pdf: (e) => `चलन <b>${e.no}</b> PDF मध्ये सेव्ह केले`,
    shared: (e) => `चलन <b>${e.no}</b> शेअर केले`,
    backup_export: () => 'संपूर्ण बॅकअप एक्सपोर्ट केला',
    backup_import: () => 'बॅकअप इम्पोर्ट केला',
    settings: () => 'सेटिंग्ज बदलल्या',
    summary: (e) => `${e.n} वस्तू · ${e.total}`,
    change: (l, from, to) => `${l} <span class="was">${from}</span> वरून <span class="now">${to}</span> केले`,
    set: (l, to) => `${l} <span class="now">${to}</span> ठेवले`,
    cleared: (l, from) => `${l} काढले (आधी <span class="was">${from}</span> होते)`,
    itemAdd: (d, amt) => `<b>“${d}”</b> जोडली — ${amt}`,
    itemDel: (d, amt) => `<b>“${d}”</b> काढली — ${amt}`,
    itemChange: (d, l, from, to) => `<b>“${d}”</b> — ${l} <span class="was">${from}</span> वरून <span class="now">${to}</span> केले`,
    backupStats: (e) => `${e.invoices} चलन, ${e.events} इतिहास नोंदी`,
    importStats: (e) => `${e.added} नवीन, ${e.updated} अपडेट, ${e.skipped} वगळले`,
    more: (n) => `आणि आणखी ${n} बदल`,
    noHistory: 'अजून काहीही नोंदवलेले नाही',
  },
};

const pack = (lang) => T[lang] || T.en;
const labelOf = (field, lang) => field?.[lang] || field?.en || '';

function showValue(value, field, lang, settings) {
  if (value == null || value === '') return `<span class="was">${esc(BLANK[lang] || BLANK.en)}</span>`;
  const formatted = field?.fmt ? field.fmt(value, settings) : String(value);
  return esc(formatted);
}

/* ---------------- rendering ---------------- */

const ICONS = {
  created: '<path d="M12 5v14M5 12h14"/>',
  updated: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/>',
  deleted: '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/>',
  restored: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/>',
  purged: '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/>',
  pdf: '<path d="M12 3v11M8 11l4 4 4-4"/><path d="M4 19h16"/>',
  shared: '<path d="M4 12v7h16v-7"/><path d="M12 16V4M8 8l4-4 4 4"/>',
  backup_export: '<path d="M21 15v4H3v-4"/><path d="M12 3v12M8 11l4 4 4-4"/>',
  backup_import: '<path d="M21 15v4H3v-4"/><path d="M12 15V3M8 7l4-4 4 4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
};

const KIND = {
  created: 'created', updated: 'updated', deleted: 'deleted', purged: 'deleted',
  restored: 'restored', pdf: '', shared: '', backup_export: '', backup_import: '', settings: '',
};

/**
 * Turn a stored event into display parts.
 * Returns { icon, kind, title, lines, time, absolute } — title/lines are
 * trusted HTML built here from escaped values.
 */
export function renderEvent(event, lang = 'en', settings, { maxLines = 6 } = {}) {
  const t = pack(lang);
  const ctx = { no: esc(event.challanNo || '—'), who: esc(event.customer || '') };
  const title = (t[event.type] || (() => esc(event.type)))(ctx);

  const lines = [];

  if (event.type === EVENT.CREATED && event.meta?.itemCount != null) {
    lines.push(esc(t.summary({ n: event.meta.itemCount, total: fmtMoney(event.meta.total || 0, settings.ui.currency) })));
  }
  if (event.type === EVENT.BACKUP_EXPORT) {
    lines.push(esc(t.backupStats({ invoices: event.meta?.invoices ?? 0, events: event.meta?.events ?? 0 })));
  }
  if (event.type === EVENT.BACKUP_IMPORT) {
    lines.push(esc(t.importStats({ added: event.meta?.added ?? 0, updated: event.meta?.updated ?? 0, skipped: event.meta?.skipped ?? 0 })));
  }
  if (event.type === EVENT.PDF && event.meta?.location) lines.push(esc(event.meta.location));

  for (const c of event.changes || []) {
    if (lines.length >= maxLines) break;
    if (c.kind === 'field') {
      const field = fieldByPath.get(c.path);
      const label = esc(labelOf(field, lang));
      const from = showValue(c.from, field, lang, settings);
      const to = showValue(c.to, field, lang, settings);
      const blank = (v) => v == null || v === '';
      if (blank(c.from)) lines.push(t.set(label, to));
      else if (blank(c.to)) lines.push(t.cleared(label, from));
      else lines.push(t.change(label, from, to));
    } else if (c.kind === 'item-add') {
      lines.push(t.itemAdd(esc(c.desc || '—'), esc(fmtMoney(c.amount || 0, settings.ui.currency))));
    } else if (c.kind === 'item-del') {
      lines.push(t.itemDel(esc(c.desc || '—'), esc(fmtMoney(c.amount || 0, settings.ui.currency))));
    } else if (c.kind === 'item-field') {
      const field = itemFieldByPath.get(c.path);
      lines.push(t.itemChange(
        esc(c.desc || '—'),
        esc(labelOf(field, lang)),
        showValue(c.from, field, lang, settings),
        showValue(c.to, field, lang, settings)
      ));
    }
  }

  const total = (event.changes || []).length;
  const shown = lines.length - (event.type === EVENT.CREATED && event.meta?.itemCount != null ? 1 : 0);
  const overflow = total - Math.max(0, shown);

  return {
    icon: ICONS[event.type] || ICONS.updated,
    kind: KIND[event.type] || '',
    title,
    lines,
    overflow: overflow > 0 ? t.more(overflow) : null,
    time: relTime(event.ts, lang),
    absolute: fmtDateTime(event.ts, lang === 'en' ? 'en-IN' : `${lang}-IN`),
  };
}

/** Same content as plain text — used for the human-readable file in a backup. */
export function eventToText(event, lang, settings) {
  const r = renderEvent(event, lang, settings, { maxLines: 100 });
  const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const head = `[${r.absolute}] ${strip(r.title)}`;
  const body = r.lines.map((l) => `    - ${strip(l)}`);
  return [head, ...body].join('\n');
}

export const auditLangName = (code) => AUDIT_LANGS.find((l) => l.code === code)?.native || code;
