// IndexedDB layer. Everything lives on the device — nothing is sent anywhere.

const DB_NAME = 'werks-invoice';
const DB_VERSION = 1;

export const STORES = {
  invoices: 'invoices',
  audit: 'audit',
  products: 'products',
  parties: 'parties',
  vehicles: 'vehicles',
  kv: 'kv',
};

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.invoices)) {
        const s = db.createObjectStore(STORES.invoices, { keyPath: 'id' });
        s.createIndex('byDate', 'date');
        s.createIndex('bySeq', 'challanSeq');
        s.createIndex('byUpdated', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORES.audit)) {
        const s = db.createObjectStore(STORES.audit, { keyPath: 'id' });
        s.createIndex('byTs', 'ts');
        s.createIndex('byInvoice', 'invoiceId');
      }
      for (const name of [STORES.products, STORES.parties, STORES.vehicles]) {
        if (!db.objectStoreNames.contains(name)) {
          const s = db.createObjectStore(name, { keyPath: 'key' });
          s.createIndex('byCount', 'count');
        }
      }
      if (!db.objectStoreNames.contains(STORES.kv)) db.createObjectStore(STORES.kv, { keyPath: 'k' });
      void e;
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is open in another tab. Close it and reload.'));
  });
  return dbPromise;
}

function run(storeNames, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, mode);
        let result;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
        const stores = Array.isArray(storeNames)
          ? Object.fromEntries(storeNames.map((n) => [n, tx.objectStore(n)]))
          : tx.objectStore(storeNames);
        Promise.resolve(fn(stores, tx)).then((r) => { result = r; }, reject);
      })
  );
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/* ---------------- generic access ---------------- */

export const getAll = (store) => run(store, 'readonly', (s) => wrap(s.getAll()));
export const get = (store, key) => run(store, 'readonly', (s) => wrap(s.get(key)));
export const put = (store, value) => run(store, 'readwrite', (s) => wrap(s.put(value)));
export const del = (store, key) => run(store, 'readwrite', (s) => wrap(s.delete(key)));
export const clear = (store) => run(store, 'readwrite', (s) => wrap(s.clear()));
export const count = (store) => run(store, 'readonly', (s) => wrap(s.count()));

export const bulkPut = (store, values) =>
  run(store, 'readwrite', (s) => Promise.all(values.map((v) => wrap(s.put(v)))));

/** Multi-store write in ONE transaction, so a failure rolls the whole thing back. */
export const transact = (storeNames, fn) => run(storeNames, 'readwrite', fn);
export { wrap as request };

/* ---------------- settings ---------------- */

export const DEFAULT_SETTINGS = {
  business: {
    name: '9WERKS',
    tagline: 'A CREW FOR YOUR LUXE RIDE',
    address: 'S No.259/3, Shatik Park, behind seasons business square, sanewadi, Aundh, Pune, 411067',
    mobile: '7083199986',
    office: '9088969999',
    instagram: '9werksofficial',
    terms: 'Received the Vehicle in Proper Condition. The Completed Services, Spare Parts and Charges are Verified and Accepted.',
  },
  challan: {
    prefix: '',        // supports {FY} {YY} {YYYY} {MM} tokens
    padding: 3,        // 34 -> "034", matching the printed book
    start: 1,
    resetPolicy: 'never', // never | fy | calendar
    autoAssign: true,
    warnOnGap: true,
  },
  pdf: {
    pageSize: 'a5',
    minRows: 12,
    filenamePattern: 'Challan-{no}-{customer}',
  },
  ui: {
    theme: 'system',   // system | dark | light
    auditLang: 'en',   // en | hi | mr
    currency: '₹',
  },
  schemaVersion: 1,
};

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object'
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}
export { deepMerge };

let settingsCache = null;

export async function getSettings() {
  if (settingsCache) return settingsCache;
  const row = await get(STORES.kv, 'settings');
  settingsCache = deepMerge(DEFAULT_SETTINGS, row?.v || {});
  return settingsCache;
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = deepMerge(current, patch);
  await put(STORES.kv, { k: 'settings', v: next });
  settingsCache = next;
  return next;
}

export async function replaceSettings(value) {
  const next = deepMerge(DEFAULT_SETTINGS, value || {});
  await put(STORES.kv, { k: 'settings', v: next });
  settingsCache = next;
  return next;
}

export const invalidateSettings = () => { settingsCache = null; };

/* ---------------- saved folder handle (preferred save location) ---------------- */

export async function getSaveFolder() {
  const row = await get(STORES.kv, 'saveFolder');
  return row?.v || null;
}
export const setSaveFolder = (handle) => put(STORES.kv, { k: 'saveFolder', v: handle });
export const clearSaveFolder = () => del(STORES.kv, 'saveFolder');

/* ---------------- invoices ---------------- */

export async function listInvoices({ includeDeleted = false } = {}) {
  const all = await getAll(STORES.invoices);
  const rows = includeDeleted ? all : all.filter((i) => !i.deletedAt);
  return rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.challanSeq || 0) - (a.challanSeq || 0));
}

export const getInvoice = (id) => get(STORES.invoices, id);

/* ---------------- audit ---------------- */

export async function listAudit({ invoiceId = null, limit = 400 } = {}) {
  const all = await getAll(STORES.audit);
  const rows = invoiceId ? all.filter((e) => e.invoiceId === invoiceId) : all;
  rows.sort((a, b) => b.ts - a.ts);
  return limit ? rows.slice(0, limit) : rows;
}

export const appendAudit = (entry) => put(STORES.audit, entry);

/* ---------------- storage estimate ---------------- */

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

/** Ask the browser to keep this data even under storage pressure. */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
