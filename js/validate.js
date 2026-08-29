// Field validation for the editor and settings forms.
//
// Two jobs, deliberately kept apart:
//   sanitise — what a field will physically accept while typing
//              (a rate field never holds letters in the first place)
//   check    — what makes a filled-in field valid, on blur and on save
//
// Messages are written the way the counter would say them, not the way a
// form library would.

import { html, raw, todayISO } from './util.js';

const WARN_ICON = '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/>';

/* ---------------- sanitisers ---------------- */

/** Digits and one dot — what a rate, quantity or amount may contain. */
export function sanitizeDecimal(v) {
  let s = String(v).replace(/[^\d.]/g, '');
  const first = s.indexOf('.');
  if (first !== -1) s = `${s.slice(0, first + 1)}${s.slice(first + 1).replace(/\./g, '')}`;
  return s;
}

/** Whole numbers only — km, digit counts, blank row counts. */
export const sanitizeInteger = (v) => String(v).replace(/\D/g, '');

/** Phone: digits, one leading +, and the spacers people actually type. */
export const sanitizePhone = (v) => String(v).replace(/[^\d+\-\s]/g, '').replace(/(?!^)\+/g, '');

/** A person or firm name: letters, spaces, and the punctuation in "M/s. R.K. & Co." */
export const sanitizeName = (v) => String(v).replace(/[^\p{L}\p{M}\p{Nd}\s.,'&()/-]/gu, '');

/** Registration numbers are letters, digits and separators, always upper case. */
export const sanitizeRegNo = (v) => String(v).replace(/[^a-zA-Z0-9\s-]/g, '').toUpperCase();

/* ---------------- rules ---------------- */

const isBlank = (v) => String(v ?? '').trim() === '';
const digitsOf = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * A rule is { required?, sanitize?, check(trimmedValue) -> message | null }.
 */
export const RULES = {
  challanNo: {
    required: true,
    check: (v) => {
      if (isBlank(v)) return 'A challan number is needed — it is what ties this to the book.';
      if (v.length > 24) return 'That is too long for a challan number.';
      if (!/\d/.test(v)) return 'A challan number needs at least one digit.';
      if (!/^[A-Za-z0-9][A-Za-z0-9/\-. ]*$/.test(v)) return 'Use letters, digits, / - and . only.';
      return null;
    },
  },

  date: {
    required: true,
    check: (v) => {
      if (isBlank(v)) return 'Pick a date.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'That is not a date the app can read.';
      if (Number.isNaN(new Date(`${v}T00:00:00`).getTime())) return 'That is not a real date.';
      if (v > todayISO()) return 'A challan cannot be dated in the future.';
      if (v < '2000-01-01') return 'That date looks wrong.';
      return null;
    },
  },

  customerName: {
    required: true,
    sanitize: sanitizeName,
    check: (v) => {
      if (isBlank(v)) return 'Who is this challan for?';
      if (v.length < 2) return 'That name is too short.';
      if (v.length > 80) return 'That name is too long.';
      if (!/\p{L}/u.test(v)) return 'A name needs letters, not only digits.';
      return null;
    },
  },

  address: {
    check: (v) => (v.length > 160 ? 'Keep the address under 160 characters.' : null),
  },

  phone: {
    sanitize: sanitizePhone,
    check: (v) => {
      if (isBlank(v)) return null; // walk-in jobs often leave no number
      const d = digitsOf(v);
      if (d.length < 10) return 'A phone number needs at least 10 digits.';
      if (d.length > 13) return 'That is too many digits for a phone number.';
      return null;
    },
  },

  regNo: {
    sanitize: sanitizeRegNo,
    check: (v) => {
      if (isBlank(v)) return null;
      if (v.replace(/[\s-]/g, '').length < 4) return 'That registration number looks incomplete.';
      if (v.length > 16) return 'That registration number is too long.';
      if (!/^[A-Z0-9][A-Z0-9\s-]*$/.test(v)) return 'Use letters and digits only, like MH12AB1234.';
      return null;
    },
  },

  vehicleModel: {
    check: (v) => (v.length > 60 ? 'Keep the vehicle name under 60 characters.' : null),
  },

  particulars: {
    check: (v) => (v.length > 70 ? 'Too long to print on one line of the challan.' : null),
  },

  km: {
    sanitize: sanitizeInteger,
    check: (v) => {
      if (isBlank(v)) return null;
      if (Number(v) > 2000000) return 'That is more kilometres than any car has done.';
      return null;
    },
  },

  money: {
    sanitize: sanitizeDecimal,
    check: (v) => {
      if (isBlank(v)) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return 'Enter a number.';
      if (n > 99999999) return 'That amount is too large.';
      return null;
    },
  },

  quantity: {
    sanitize: sanitizeDecimal,
    check: (v) => {
      if (isBlank(v)) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return 'Enter a number.';
      if (n > 100000) return 'That quantity looks wrong.';
      return null;
    },
  },

  percent: {
    sanitize: sanitizeDecimal,
    check: (v) => {
      if (isBlank(v)) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return 'Enter a number.';
      if (n > 100) return 'A percentage runs from 0 to 100.';
      return null;
    },
  },

  text: {
    check: (v) => (v.length > 400 ? 'That is longer than the challan can print.' : null),
  },

  seriesPrefix: {
    check: (v) => {
      if (isBlank(v)) return null; // an unprefixed series is perfectly normal
      if (v.length > 16) return 'Keep the prefix short — it prints beside the number.';
      if (!/^[A-Za-z0-9{}/\-. ]+$/.test(v)) return 'Use letters, digits, / - . and the {FY} style tokens.';
      const tokens = v.match(/\{[^}]*\}/g) || [];
      const bad = tokens.find((t) => !['{FY}', '{YY}', '{YYYY}', '{MM}'].includes(t.toUpperCase()));
      if (bad) return `${bad} is not a token. Use {FY}, {YY}, {YYYY} or {MM}.`;
      return null;
    },
  },

  filename: {
    required: true,
    check: (v) => {
      if (isBlank(v)) return 'A file name is needed.';
      if (v.length > 80) return 'That file name is too long.';
      if (/[\\/:*?"<>|]/.test(v)) return 'A file name cannot contain \\ / : * ? " < > or |';
      return null;
    },
  },

  currencySymbol: {
    check: (v) => {
      if (isBlank(v)) return 'Pick a symbol — ₹ if in doubt.';
      if (v.length > 3) return 'One or two characters is plenty.';
      return null;
    },
  },
};

/** A plain "must be filled in" text rule. */
export const requiredText = (label, max = 80) => ({
  required: true,
  check: (v) => {
    if (isBlank(v)) return `${label} cannot be empty.`;
    if (v.length > max) return `Keep ${label.toLowerCase()} under ${max} characters.`;
    return null;
  },
});

/** A whole-number rule with its own bounds, for the settings screen. */
export const intRange = (min, max, label = 'This') => ({
  required: true,
  sanitize: sanitizeInteger,
  check: (v) => {
    if (isBlank(v)) return `${label} cannot be empty.`;
    const n = Number(v);
    if (!Number.isInteger(n)) return 'Whole numbers only.';
    if (n < min || n > max) return `${label} must be between ${min} and ${max}.`;
    return null;
  },
});

/* ---------------- wiring ---------------- */

let errSeq = 0;

function errorSlot(input) {
  const field = input.closest('.field') || input.parentElement;
  let slot = field.querySelector(':scope > .field__error');
  if (!slot) {
    slot = document.createElement('div');
    slot.className = 'field__error';
    slot.hidden = true;
    slot.id = `${input.id || `fld${++errSeq}`}-err`;
    field.appendChild(slot);
  }
  return slot;
}

function paint(input, message, inline) {
  if (!inline) {
    // Cells in the items grid are too narrow for a sentence — they only go
    // red, and the message is spoken by the toast on save.
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    return;
  }
  const slot = errorSlot(input);
  if (message) {
    slot.innerHTML = html`<svg viewBox="0 0 24 24" aria-hidden="true">${raw(WARN_ICON)}</svg><span>${message}</span>`;
    slot.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', slot.id);
  } else {
    slot.hidden = true;
    slot.textContent = '';
    input.removeAttribute('aria-invalid');
    if (input.getAttribute('aria-describedby') === slot.id) input.removeAttribute('aria-describedby');
  }
  input.closest('.field')?.classList.toggle('field--invalid', Boolean(message));
}

/**
 * Attach a rule to an input.
 *
 * Errors stay quiet until the field has been left once — nobody wants
 * "too short" while they are still typing the second letter — but once a
 * field is known to be bad it re-checks on every keystroke, so the message
 * clears the moment it is fixed.
 *
 * Returns a handle: { input, rule, validate(force), clear() }.
 *
 * `inline: false` skips the printed message and only marks the field — for
 * the narrow cells of the items grid.
 */
export function attachField(input, rule, { onInput, inline = true } = {}) {
  if (!input || !rule) return { input, rule, validate: () => true, clear: () => {} };
  let touched = false;

  if (rule.required) {
    input.setAttribute('aria-required', 'true');
    input.closest('.field')?.querySelector('label, .field__label')?.classList.add('field__label--req');
  }

  const validate = (force = false) => {
    if (force) touched = true;
    const message = rule.check(String(input.value ?? '').trim());
    paint(input, touched ? message : null, inline);
    return !message;
  };

  input.addEventListener('input', () => {
    if (rule.sanitize) {
      const clean = rule.sanitize(input.value);
      if (clean !== input.value) {
        const at = input.selectionStart;
        const dropped = input.value.length - clean.length;
        input.value = clean;
        // Keep the caret where the typist left it, minus whatever was rejected.
        if (at != null) {
          const to = Math.max(0, at - dropped);
          try { input.setSelectionRange(to, to); } catch { /* not a text-ish input */ }
        }
      }
    }
    if (touched) validate();
    onInput?.(input.value);
  });

  input.addEventListener('blur', () => { touched = true; validate(); });

  return {
    input,
    rule,
    validate,
    clear: () => { touched = false; paint(input, null, inline); },
  };
}

/**
 * Check a set of handles. Returns { ok, first } — `first` is the handle that
 * failed, so the caller can send the typist straight there.
 */
export function validateAll(handles) {
  let first = null;
  for (const h of handles) {
    if (!h) continue;
    if (!h.validate(true) && !first) first = h;
  }
  return { ok: !first, first };
}

/** Move to the field that failed. */
export function focusInvalid(handle) {
  if (!handle) return;
  handle.input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  handle.input.focus({ preventScroll: true });
}
