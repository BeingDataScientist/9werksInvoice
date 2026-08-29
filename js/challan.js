// Challan numbering: formatting, next-number assignment, validation and
// sequence health. The printed book is pre-numbered, so the rules here are
// built around "a number is consumed once and never silently reused".

import { fyLabel, todayISO } from './util.js';

/* ---------------- formatting ---------------- */

/** Expand {FY} {YY} {YYYY} {MM} in a series prefix against the invoice date. */
export function expandPrefix(prefix, dateISO) {
  const iso = dateISO || todayISO();
  const d = new Date(`${iso}T00:00:00`);
  const y = Number.isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
  const mm = Number.isNaN(d.getTime()) ? '01' : String(d.getMonth() + 1).padStart(2, '0');
  return String(prefix || '')
    .replace(/\{FY\}/gi, fyLabel(iso))
    .replace(/\{YYYY\}/gi, String(y))
    .replace(/\{YY\}/gi, String(y).slice(2))
    .replace(/\{MM\}/gi, mm);
}

/** 34 -> "034" (padding 3), with the expanded prefix in front. */
export function formatChallan(seq, challan, dateISO) {
  const pad = Math.max(0, Math.min(10, Number(challan?.padding ?? 3)));
  return expandPrefix(challan?.prefix, dateISO) + String(Math.max(0, Math.trunc(seq || 0))).padStart(pad, '0');
}

/** Pull the sequence number out of a typed challan string: "9W/034" -> 34. */
export function parseSeq(display) {
  const matches = String(display || '').match(/\d+/g);
  if (!matches) return null;
  const n = parseInt(matches[matches.length - 1], 10);
  return Number.isFinite(n) ? n : null;
}

/** Which numbering series a date belongs to, per the reset policy. */
export function scopeKey(dateISO, policy) {
  if (policy === 'fy') return `FY${fyLabel(dateISO)}`;
  if (policy === 'calendar') return `Y${(dateISO || todayISO()).slice(0, 4)}`;
  return 'ALL';
}

export const scopeLabel = (key) => {
  if (key === 'ALL') return 'All challans';
  if (key.startsWith('FY')) return `FY ${key.slice(2)}`;
  if (key.startsWith('Y')) return key.slice(1);
  return key;
};

/** True when a resetting policy has no year token to keep series apart. */
export function prefixNeedsYearToken(challan) {
  const policy = challan?.resetPolicy || 'never';
  if (policy === 'never') return false;
  return !/\{(FY|YY|YYYY)\}/i.test(String(challan?.prefix || ''));
}

/* ---------------- next number ---------------- */

/**
 * The next number to hand out. Counts cancelled (soft-deleted) challans as
 * consumed — a voided page in the book is not written on again.
 */
export function nextSeq(invoices, settings, dateISO) {
  const challan = settings.challan;
  const scope = scopeKey(dateISO, challan.resetPolicy);
  let max = 0;
  for (const inv of invoices) {
    if (scopeKey(inv.date, challan.resetPolicy) !== scope) continue;
    const seq = Number(inv.challanSeq) || 0;
    if (seq > max) max = seq;
  }
  return Math.max(max + 1, Number(challan.start) || 1);
}

export function nextChallan(invoices, settings, dateISO) {
  const seq = nextSeq(invoices, settings, dateISO);
  return { seq, display: formatChallan(seq, settings.challan, dateISO) };
}

/**
 * The number to offer when the typed one won't do: the first hole *inside* the
 * book, else the next number after the last one. Numbers below where the book
 * begins were never part of it, so they are not "free".
 */
export function firstFreeSeq(invoices, settings, dateISO) {
  const challan = settings.challan;
  const scope = scopeKey(dateISO, challan.resetPolicy);
  const seqs = invoices
    .filter((i) => scopeKey(i.date, challan.resetPolicy) === scope)
    .map((i) => Number(i.challanSeq) || 0)
    .filter((n) => n > 0);

  if (!seqs.length) return Math.max(1, Number(challan.start) || 1);

  const used = new Set(seqs);
  const min = Math.min(...seqs);
  const max = Math.max(...seqs);
  for (let n = min; n <= max; n++) if (!used.has(n)) return n;
  return max + 1;
}

/* ---------------- validation ---------------- */

/**
 * Validate a typed challan number in context.
 * Returns { seq, display, ok, issues[] } where an issue is
 * { level: 'error'|'warn'|'info', code, message, fix?: {label, seq} }.
 * Only `error` blocks saving.
 */
export function validateChallan({ display, invoices, currentId = null, settings, dateISO }) {
  const challan = settings.challan;
  const issues = [];
  const text = String(display || '').trim();
  const seq = parseSeq(text);
  const scope = scopeKey(dateISO, challan.resetPolicy);

  if (!text) {
    issues.push({ level: 'error', code: 'empty', message: 'Challan number is required.' });
    return { seq: null, display: text, ok: false, issues };
  }
  if (seq === null) {
    issues.push({ level: 'error', code: 'nodigits', message: 'Challan number needs at least one digit, like 034.' });
    return { seq: null, display: text, ok: false, issues };
  }

  const sameScope = invoices.filter(
    (i) => i.id !== currentId && scopeKey(i.date, challan.resetPolicy) === scope
  );

  // Duplicates — compared on the full printed string, case-insensitively.
  const norm = (s) => String(s || '').trim().toLowerCase();
  const clashes = sameScope.filter((i) => norm(i.challanNo) === norm(text));
  const live = clashes.filter((i) => !i.deletedAt);
  const voided = clashes.filter((i) => i.deletedAt);
  const free = firstFreeSeq([...invoices.filter((i) => i.id !== currentId)], settings, dateISO);

  if (live.length) {
    issues.push({
      level: 'error',
      code: 'duplicate',
      message: `Challan ${text} is already used by ${live[0].customer?.name || 'another entry'}.`,
      fix: { label: `Use ${formatChallan(free, challan, dateISO)}`, seq: free },
    });
  } else if (voided.length) {
    issues.push({
      level: 'warn',
      code: 'void-duplicate',
      message: `Challan ${text} belonged to a cancelled entry. Reusing a voided book number is usually a mistake.`,
      fix: { label: `Use ${formatChallan(free, challan, dateISO)}`, seq: free },
    });
  }

  // Sequence position. With an empty book any starting number is legitimate,
  // so neither the gap warning nor the backfill note applies to the first entry.
  const others = invoices.filter((i) => i.id !== currentId);
  const expected = nextSeq(others, settings, dateISO);
  const hasHistory = others.some((i) => scopeKey(i.date, challan.resetPolicy) === scope);

  if (hasHistory && !live.length && !voided.length) {
    if (seq > expected) {
      const skipped = seq - expected;
      if (challan.warnOnGap) {
        issues.push({
          level: 'warn',
          code: 'gap',
          message: `Skips ${skipped} number${skipped > 1 ? 's' : ''} — ${formatChallan(expected, challan, dateISO)}${
            skipped > 1 ? ` to ${formatChallan(seq - 1, challan, dateISO)}` : ''
          } will show as missing.`,
          fix: { label: `Use ${formatChallan(expected, challan, dateISO)}`, seq: expected },
        });
      }
    } else if (seq < expected - 1) {
      issues.push({
        level: 'info',
        code: 'backfill',
        message: `Filling an earlier gap. Latest issued is ${formatChallan(expected - 1, challan, dateISO)}.`,
      });
    }
  }

  // Series prefix drift.
  const wantPrefix = expandPrefix(challan.prefix, dateISO);
  if (wantPrefix && !text.toLowerCase().startsWith(wantPrefix.toLowerCase())) {
    issues.push({
      level: 'warn',
      code: 'prefix',
      message: `Your series prefix is "${wantPrefix}". This number does not use it.`,
      fix: { label: `Use ${formatChallan(seq, challan, dateISO)}`, seq },
    });
  }

  return { seq, display: text, ok: !issues.some((i) => i.level === 'error'), issues };
}

/* ---------------- sequence health ---------------- */

/**
 * Per-series report of what the book looks like: which numbers are used,
 * which are missing, which were cancelled, and which got typed twice.
 */
export function sequenceReport(invoices, settings) {
  const policy = settings.challan.resetPolicy;
  const byScope = new Map();

  for (const inv of invoices) {
    const scope = scopeKey(inv.date, policy);
    if (!byScope.has(scope)) byScope.set(scope, []);
    byScope.get(scope).push(inv);
  }

  const reports = [];
  for (const [scope, rows] of byScope) {
    const seqs = rows.map((r) => Number(r.challanSeq) || 0).filter((n) => n > 0);
    if (!seqs.length) continue;
    const min = Math.min(...seqs);
    const max = Math.max(...seqs);

    const byNo = new Map();
    for (const r of rows) {
      const key = String(r.challanNo || '').trim().toLowerCase();
      if (!byNo.has(key)) byNo.set(key, []);
      byNo.get(key).push(r);
    }
    const duplicates = [...byNo.entries()]
      .filter(([, list]) => list.filter((r) => !r.deletedAt).length > 1)
      .map(([, list]) => ({ display: list[0].challanNo, seq: list[0].challanSeq, rows: list }));

    const bySeq = new Map();
    for (const r of rows) bySeq.set(Number(r.challanSeq) || 0, r);

    const cells = [];
    const gaps = [];
    const voids = [];
    // Cap the strip so a stray 99999 can't blow up the DOM.
    const span = Math.min(max - min + 1, 600);
    for (let n = min; n < min + span; n++) {
      const inv = bySeq.get(n);
      let state = 'used';
      if (!inv) { state = 'gap'; gaps.push(n); }
      else if (inv.deletedAt) { state = 'void'; voids.push(n); }
      if (duplicates.some((d) => d.seq === n)) state = 'dupe';
      cells.push({ seq: n, state, invoice: inv || null, display: formatChallan(n, settings.challan, inv?.date) });
    }

    reports.push({
      scope,
      label: scopeLabel(scope),
      min, max,
      truncated: max - min + 1 > span,
      count: rows.length,
      live: rows.filter((r) => !r.deletedAt).length,
      cells, gaps, voids, duplicates,
    });
  }

  reports.sort((a, b) => b.scope.localeCompare(a.scope));
  return reports;
}
