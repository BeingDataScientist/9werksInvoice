// Domain operations. Every write goes through here so the audit trail and the
// learned suggestion lists can never drift from the invoices themselves.

import {
  STORES, getSettings, listInvoices, getInvoice, transact, request, getAll, put,
} from './store.js';
import { buildEvent, diffInvoice, EVENT } from './audit.js';
import { formatChallan, nextChallan, validateChallan } from './challan.js';
import { fuzzyScore, normKey, num, round2, titleish, todayISO, uid } from './util.js';

export class ValidationError extends Error {
  constructor(issues) {
    super(issues[0]?.message || 'Invalid invoice');
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

/* ---------------- shapes ---------------- */

export const blankItem = () => ({ id: uid('it'), desc: '', qty: '', rate: '', amount: '' });

export function blankInvoice(settings) {
  return {
    id: uid('inv'),
    challanNo: '',
    challanSeq: 0,
    date: todayISO(),
    customer: { name: '', address: '', phone: '' },
    vehicle: { model: '', regNo: '', km: '' },
    items: [blankItem(), blankItem(), blankItem()],
    discount: 0,
    taxPercent: 0,
    advance: 0,
    subtotal: 0,
    taxAmount: 0,
    grandTotal: 0,
    balance: 0,
    paymentMode: '',
    paymentStatus: 'unpaid',
    notes: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    _settingsSnapshot: { currency: settings?.ui?.currency || '₹' },
  };
}

/** Rows with nothing typed in them are ignored — the paper book has blanks too. */
export const isBlankItem = (it) =>
  !String(it.desc || '').trim() && !num(it.qty) && !num(it.rate) && !num(it.amount);

/**
 * Amount follows qty x rate whenever both are filled; otherwise it is whatever
 * was typed, which is how the printed book is actually used.
 */
export function recalcItem(item, changedField) {
  const hasQty = String(item.qty ?? '').trim() !== '';
  const hasRate = String(item.rate ?? '').trim() !== '';
  if ((changedField === 'qty' || changedField === 'rate') && hasQty && hasRate) {
    item.amount = round2(num(item.qty) * num(item.rate));
  }
  return item;
}

export function computeTotals(invoice) {
  const items = (invoice.items || []).filter((it) => !isBlankItem(it));
  const subtotal = round2(items.reduce((s, it) => s + num(it.amount), 0));
  const discount = round2(num(invoice.discount));
  const taxable = round2(Math.max(0, subtotal - discount));
  const taxAmount = round2((taxable * num(invoice.taxPercent)) / 100);
  const grandTotal = round2(taxable + taxAmount);
  const advance = round2(num(invoice.advance));
  const balance = round2(grandTotal - advance);
  return { subtotal, discount, taxable, taxAmount, grandTotal, advance, balance, itemCount: items.length };
}

/**
 * What is actually owed. `balance` is just total minus advance, so a challan
 * settled in full still carries a non-zero balance — marking it paid is what
 * clears it.
 */
export const amountDue = (invoice) =>
  (invoice.paymentStatus === 'paid' ? 0 : Math.max(0, round2(invoice.balance || 0)));

/** Trim, drop blank rows, and fold the totals in. */
export function normalizeInvoice(invoice) {
  const items = (invoice.items || [])
    .filter((it) => !isBlankItem(it))
    .map((it) => ({
      id: it.id || uid('it'),
      desc: titleish(it.desc),
      qty: String(it.qty ?? '').trim() === '' ? '' : num(it.qty),
      rate: String(it.rate ?? '').trim() === '' ? '' : num(it.rate),
      amount: round2(num(it.amount)),
    }));

  const totals = computeTotals({ ...invoice, items });

  return {
    ...invoice,
    challanNo: String(invoice.challanNo || '').trim(),
    date: invoice.date || todayISO(),
    customer: {
      name: titleish(invoice.customer?.name),
      address: titleish(invoice.customer?.address),
      phone: titleish(invoice.customer?.phone),
    },
    vehicle: {
      model: titleish(invoice.vehicle?.model),
      regNo: titleish(invoice.vehicle?.regNo).toUpperCase(),
      km: titleish(invoice.vehicle?.km),
    },
    items,
    discount: totals.discount,
    taxPercent: num(invoice.taxPercent),
    advance: totals.advance,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    grandTotal: totals.grandTotal,
    balance: totals.balance,
    notes: String(invoice.notes || '').trim(),
  };
}

/* ---------------- learned suggestions ---------------- */

function upsert(store, key, patch, stamp) {
  return request(store.get(key)).then((existing) => {
    const row = existing || { key, count: 0, createdAt: stamp };
    return request(store.put({ ...row, ...patch, key, lastUsed: stamp }));
  });
}

async function learnFromInvoice(stores, before, after) {
  const stamp = Date.now();
  const prevKeys = new Set((before?.items || []).map((it) => normKey(it.desc)).filter(Boolean));

  const seen = new Set();
  for (const it of after.items) {
    const key = normKey(it.desc);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const existing = await request(stores[STORES.products].get(key));
    const isNewToThisInvoice = !prevKeys.has(key);
    await request(stores[STORES.products].put({
      key,
      name: it.desc,
      count: (existing?.count || 0) + (isNewToThisInvoice ? 1 : 0),
      lastRate: num(it.rate) || existing?.lastRate || 0,
      lastAmount: num(it.amount) || existing?.lastAmount || 0,
      totalAmount: round2((existing?.totalAmount || 0) + (isNewToThisInvoice ? num(it.amount) : 0)),
      createdAt: existing?.createdAt || stamp,
      lastUsed: stamp,
    }));
  }

  const nameKey = normKey(after.customer.name);
  if (nameKey) {
    const existing = await request(stores[STORES.parties].get(nameKey));
    await request(stores[STORES.parties].put({
      key: nameKey,
      name: after.customer.name,
      address: after.customer.address || existing?.address || '',
      phone: after.customer.phone || existing?.phone || '',
      count: (existing?.count || 0) + (normKey(before?.customer?.name) === nameKey ? 0 : 1),
      createdAt: existing?.createdAt || stamp,
      lastUsed: stamp,
    }));
  }

  const vehKey = normKey(after.vehicle.regNo || after.vehicle.model);
  if (vehKey) {
    const existing = await request(stores[STORES.vehicles].get(vehKey));
    const prevVehKey = normKey(before?.vehicle?.regNo || before?.vehicle?.model);
    await request(stores[STORES.vehicles].put({
      key: vehKey,
      model: after.vehicle.model || existing?.model || '',
      regNo: after.vehicle.regNo || existing?.regNo || '',
      km: after.vehicle.km || existing?.km || '',
      owner: after.customer.name || existing?.owner || '',
      count: (existing?.count || 0) + (prevVehKey === vehKey ? 0 : 1),
      createdAt: existing?.createdAt || stamp,
      lastUsed: stamp,
    }));
  }
}

const rank = (rows, query, textOf, limit) => {
  const q = String(query || '').trim();
  const scored = rows
    .map((r) => ({ r, s: q ? fuzzyScore(textOf(r), q) : (r.count || 0) * 10 + 1 }))
    .filter((x) => x.s >= 0);
  scored.sort((a, b) => b.s - a.s || (b.r.count || 0) - (a.r.count || 0) || (b.r.lastUsed || 0) - (a.r.lastUsed || 0));
  return scored.slice(0, limit).map((x) => x.r);
};

export const suggestProducts = async (query, limit = 7) =>
  rank(await getAll(STORES.products), query, (r) => r.name, limit);

export const suggestParties = async (query, limit = 6) =>
  rank(await getAll(STORES.parties), query, (r) => r.name, limit);

export const suggestVehicles = async (query, limit = 6) =>
  rank(await getAll(STORES.vehicles), query, (r) => `${r.regNo} ${r.model}`.trim(), limit);

/* ---------------- save / delete ---------------- */

/**
 * Persist an invoice, assigning a challan number when needed, recording the
 * audit event and updating the suggestion lists — all in one transaction.
 */
export async function saveInvoice(draft, { assignChallan = true } = {}) {
  const settings = await getSettings();
  const all = await listInvoices({ includeDeleted: true });
  const before = draft.id ? await getInvoice(draft.id) : null;
  const isNew = !before;

  const invoice = normalizeInvoice(draft);

  if (!invoice.challanNo && assignChallan && settings.challan.autoAssign) {
    invoice.challanNo = nextChallan(all, settings, invoice.date).display;
  }

  const check = validateChallan({
    display: invoice.challanNo,
    invoices: all,
    currentId: invoice.id,
    settings,
    dateISO: invoice.date,
  });
  if (!check.ok) throw new ValidationError(check.issues.filter((i) => i.level === 'error'));

  invoice.challanSeq = check.seq;
  invoice.updatedAt = Date.now();
  if (isNew) invoice.createdAt = invoice.createdAt || Date.now();

  const changes = isNew ? [] : diffInvoice(before, invoice);
  if (!isNew && changes.length === 0) {
    // Nothing actually changed — don't write a meaningless history entry.
    await put(STORES.invoices, invoice);
    return { invoice, event: null, unchanged: true };
  }

  const event = buildEvent(isNew ? EVENT.CREATED : EVENT.UPDATED, {
    invoice,
    changes,
    meta: isNew ? { itemCount: invoice.items.length, total: invoice.grandTotal } : {},
  });

  await transact(
    [STORES.invoices, STORES.audit, STORES.products, STORES.parties, STORES.vehicles],
    async (stores) => {
      await request(stores[STORES.invoices].put(invoice));
      await request(stores[STORES.audit].put(event));
      await learnFromInvoice(stores, before, invoice);
    }
  );

  return { invoice, event, unchanged: false };
}

async function writeInvoiceAndEvent(invoice, event) {
  await transact([STORES.invoices, STORES.audit], async (stores) => {
    await request(stores[STORES.invoices].put(invoice));
    await request(stores[STORES.audit].put(event));
  });
}

/** Soft delete: the challan stays in the book as a cancelled page. */
export async function deleteInvoice(id) {
  const invoice = await getInvoice(id);
  if (!invoice) return null;
  const next = { ...invoice, deletedAt: Date.now(), updatedAt: Date.now() };
  await writeInvoiceAndEvent(next, buildEvent(EVENT.DELETED, { invoice: next }));
  return next;
}

export async function restoreInvoice(id) {
  const invoice = await getInvoice(id);
  if (!invoice) return null;
  const next = { ...invoice, deletedAt: null, updatedAt: Date.now() };
  await writeInvoiceAndEvent(next, buildEvent(EVENT.RESTORED, { invoice: next }));
  return next;
}

/** Hard delete. The history entry survives so the number is still accounted for. */
export async function purgeInvoice(id) {
  const invoice = await getInvoice(id);
  if (!invoice) return null;
  const event = buildEvent(EVENT.PURGED, {
    invoice,
    meta: { total: invoice.grandTotal, itemCount: invoice.items?.length || 0 },
  });
  await transact([STORES.invoices, STORES.audit], async (stores) => {
    await request(stores[STORES.invoices].delete(id));
    await request(stores[STORES.audit].put(event));
  });
  return invoice;
}

/** Record something that isn't an invoice edit (PDF saved, backup, settings). */
export async function logEvent(type, { invoice = null, meta = {}, changes = [] } = {}) {
  const event = buildEvent(type, { invoice, meta, changes });
  await put(STORES.audit, event);
  return event;
}

/* ---------------- read helpers ---------------- */

export async function nextChallanPreview(dateISO) {
  const settings = await getSettings();
  const all = await listInvoices({ includeDeleted: true });
  return nextChallan(all, settings, dateISO);
}

export async function checkChallan(display, { currentId, dateISO }) {
  const settings = await getSettings();
  const all = await listInvoices({ includeDeleted: true });
  return validateChallan({ display, invoices: all, currentId, settings, dateISO });
}

export const challanFor = (seq, settings, dateISO) => formatChallan(seq, settings.challan, dateISO);
