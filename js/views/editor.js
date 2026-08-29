// Create / edit a challan.
// The draft lives in memory and is only written on Save, so a half-typed
// challan never consumes a number.

import { getInvoice, getSaveFolder } from '../store.js';
import {
  blankInvoice, blankItem, challanFor, checkChallan, computeTotals, isBlankItem, logEvent,
  nextChallanPreview, recalcItem, saveInvoice, suggestParties, suggestProducts, suggestVehicles,
  ValidationError,
} from '../repo.js';
import { attachAutocomplete, partyOption, productOption, vehicleOption } from '../ac.js';
import { savePdf } from '../pdf.js';
import { EVENT } from '../audit.js';
import {
  confirmDialog, debounce, esc, fmtMoney, html, num, raw, round2, toast, todayISO,
} from '../util.js';
import { attachField, focusInvalid, RULES, validateAll } from '../validate.js';

// The printed challan boxes one payment mode and one status, so both are
// single-choice radio groups here too.
const PAY_MODES = [
  { value: '', label: 'Not set' },
  { value: 'Cash', label: 'Cash' },
  { value: 'Cheque', label: 'Cheque' },
  { value: 'RTGS', label: 'RTGS' },
  { value: 'Online', label: 'Online' },
];
const PAY_STATUS = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Part paid' },
  { value: 'paid', label: 'Paid' },
];

const ISSUE_ICON = {
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/>',
  warn: '<path d="M12 3l9.5 17H2.5z"/><path d="M12 10v4M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
};

const TRASH = '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/>';

function radioSet({ name, label, options, value }) {
  return html`
    <div class="field">
      <span class="field__label" id="${name}-label">${label}</span>
      <div class="radio-set radio-set--grid" data-radio="${name}" role="radiogroup" aria-labelledby="${name}-label">
        ${raw(options.map((o) => `
          <label class="radio ${o.value === value ? 'is-on' : ''}">
            <input type="radio" name="${esc(name)}" value="${esc(o.value)}" ${o.value === value ? 'checked' : ''}>
            <span class="radio__box" aria-hidden="true"></span>
            <span class="radio__label">${esc(o.label)}</span>
          </label>`).join(''))}
      </div>
    </div>`;
}

const ROW_RULES = {
  desc: RULES.particulars,
  qty: RULES.quantity,
  rate: RULES.money,
  amount: RULES.money,
};

function itemRowHtml(item, index) {
  return html`
    <div class="item-row" data-row="${item.id}">
      <div class="item-row__sr">${index + 1})</div>
      <div class="item-row__desc ac">
        <input class="input" data-f="desc" value="${item.desc || ''}" placeholder="Particulars"
               aria-label="Particulars for row ${index + 1}">
      </div>
      <div class="item-row__qty">
        <input class="input input--num" data-f="qty" value="${item.qty ?? ''}" inputmode="decimal"
               placeholder="—" aria-label="Quantity for row ${index + 1}">
      </div>
      <div class="item-row__rate">
        <input class="input input--num" data-f="rate" value="${item.rate ?? ''}" inputmode="decimal"
               placeholder="—" aria-label="Rate for row ${index + 1}">
      </div>
      <div class="item-row__amt">
        <input class="input input--num" data-f="amount" value="${item.amount || ''}" inputmode="decimal"
               placeholder="0" aria-label="Amount for row ${index + 1}">
      </div>
      <div class="item-row__del">
        <button type="button" class="icon-btn" data-del aria-label="Remove row ${index + 1}">
          <svg viewBox="0 0 24 24" aria-hidden="true">${raw(TRASH)}</svg>
        </button>
      </div>
    </div>`;
}

export async function render(root, { params, settings, navigate, setTopbar, setGuard }) {
  const isNew = params.id === 'new';
  let draft;

  if (isNew) {
    draft = blankInvoice(settings);
    const preview = await nextChallanPreview(draft.date);
    draft.challanNo = settings.challan.autoAssign ? preview.display : '';
  } else {
    const found = await getInvoice(params.id);
    if (!found) {
      toast('That challan no longer exists.', { kind: 'error' });
      navigate('#/invoices');
      return;
    }
    draft = structuredClone(found);
    if (!draft.items.length) draft.items = [blankItem()];
  }

  let dirty = false;
  const markDirty = () => { dirty = true; };
  setGuard(async () => {
    if (!dirty) return true;
    return confirmDialog({
      title: 'Discard changes?',
      body: 'This challan has edits that have not been saved.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      danger: true,
    });
  });

  setTopbar({
    title: isNew ? 'New challan' : `Challan ${draft.challanNo}`,
    sub: isNew ? 'Not saved yet' : 'Editing',
    back: true,
  });

  const cur = settings.ui.currency;
  // Whatever day the screen was opened on — the date field defaults to it and
  // will not go past it.
  const today = todayISO();

  root.innerHTML = html`
    <form class="stack" id="ed" novalidate autocomplete="off">

      <div class="card"><div class="card__body stack">
        <div class="grid-2">
          <div class="field">
            <label for="f-challan">Challan No.</label>
            <input id="f-challan" class="input" value="${draft.challanNo}" inputmode="text"
                   enterkeyhint="next" spellcheck="false">
          </div>
          <div class="field">
            <label for="f-date">Date</label>
            <input id="f-date" class="input" type="date" value="${draft.date}" max="${today}"
                   required>
            <span class="field__hint">Opens on today's date.</span>
          </div>
        </div>
        <div id="challan-issues"></div>
      </div></div>

      <div class="card">
        <div class="card__head"><h3>Customer</h3></div>
        <div class="card__body stack">
          <div class="field ac">
            <label for="f-cname">To, M/s.</label>
            <input id="f-cname" class="input" value="${draft.customer.name}" enterkeyhint="next">
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="f-caddr">Address</label>
              <input id="f-caddr" class="input" value="${draft.customer.address}">
            </div>
            <div class="field">
              <label for="f-cphone">Phone</label>
              <input id="f-cphone" class="input" type="tel" inputmode="tel" value="${draft.customer.phone}">
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><h3>Vehicle</h3></div>
        <div class="card__body stack">
          <div class="grid-2">
            <div class="field ac">
              <label for="f-vreg">Vehicle No.</label>
              <input id="f-vreg" class="input" value="${draft.vehicle.regNo}" spellcheck="false"
                     style="text-transform:uppercase">
            </div>
            <div class="field ac">
              <label for="f-vmodel">Vehicle</label>
              <input id="f-vmodel" class="input" value="${draft.vehicle.model}" placeholder="e.g. Polo GT">
            </div>
          </div>
          <div class="field">
            <label for="f-vkm">Km reading</label>
            <input id="f-vkm" class="input" value="${draft.vehicle.km}" inputmode="numeric">
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__head">
          <h3>Particulars</h3>
          <span class="card__spacer"></span>
          <button type="button" class="btn btn--sm" id="add-row">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add row
          </button>
        </div>
        <div class="card__body stack">
          <div class="items__head">
            <span>Sr</span><span>Particulars</span><span>Qty</span><span>Rate</span><span>Amount</span><span></span>
          </div>
          <div class="items" id="items"></div>
          <div class="totals" id="totals"></div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><h3>Payment</h3></div>
        <div class="card__body stack">
          <div class="grid-3">
            <div class="field">
              <label for="f-discount">Discount</label>
              <input id="f-discount" class="input input--num" inputmode="decimal" value="${draft.discount || ''}" placeholder="0">
            </div>
            <div class="field">
              <label for="f-tax">Tax %</label>
              <input id="f-tax" class="input input--num" inputmode="decimal" value="${draft.taxPercent || ''}"
                     placeholder="0" maxlength="6">
            </div>
            <div class="field">
              <label for="f-advance">Advance</label>
              <input id="f-advance" class="input input--num" inputmode="decimal" value="${draft.advance || ''}" placeholder="0">
            </div>
          </div>
          ${raw(radioSet({ name: 'pay-mode', label: 'Payment mode', options: PAY_MODES, value: draft.paymentMode || '' }))}
          ${raw(radioSet({ name: 'pay-status', label: 'Status', options: PAY_STATUS, value: draft.paymentStatus || 'unpaid' }))}
          <div class="field">
            <label for="f-notes">Notes</label>
            <textarea id="f-notes" class="textarea" placeholder="Anything to remember about this job">${draft.notes}</textarea>
          </div>
        </div>
      </div>

      <div class="sticky-actions">
        <button type="button" class="btn btn--primary" id="save">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>Save
        </button>
        <button type="button" class="btn" id="save-pdf">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11M8 11l4 4 4-4"/><path d="M4 19h16"/></svg>Save &amp; PDF
        </button>
      </div>
    </form>`;

  const $ = (sel) => root.querySelector(sel);
  const itemsEl = $('#items');
  const totalsEl = $('#totals');
  const issuesEl = $('#challan-issues');

  /* ---------- totals ---------- */

  const paintTotals = () => {
    const t = computeTotals(draft);
    const rows = [];
    rows.push(`<div class="totals__row"><span>Subtotal (${t.itemCount} item${t.itemCount === 1 ? '' : 's'})</span><b>${esc(fmtMoney(t.subtotal, cur))}</b></div>`);
    if (t.discount) rows.push(`<div class="totals__row"><span>Discount</span><b>− ${esc(fmtMoney(t.discount, cur))}</b></div>`);
    if (t.taxAmount) rows.push(`<div class="totals__row"><span>Tax ${esc(num(draft.taxPercent))}%</span><b>${esc(fmtMoney(t.taxAmount, cur))}</b></div>`);
    rows.push(`<div class="totals__row totals__row--grand"><span>Total</span><b>${esc(fmtMoney(t.grandTotal, cur))}</b></div>`);
    if (t.advance) {
      rows.push(`<div class="totals__row"><span>Advance</span><b>− ${esc(fmtMoney(t.advance, cur))}</b></div>`);
      rows.push(`<div class="totals__row"><span>Balance due</span><b>${esc(fmtMoney(t.balance, cur))}</b></div>`);
    }
    totalsEl.innerHTML = rows.join('');
  };

  /* ---------- challan validation ---------- */

  const paintIssues = (issues) => {
    if (!issues.length) { issuesEl.innerHTML = ''; return; }
    issuesEl.innerHTML = issues.map((i) => html`
      <div class="banner ${raw(i.level === 'error' ? 'banner--critical' : '')}" data-code="${i.code}">
        <svg viewBox="0 0 24 24" aria-hidden="true">${raw(ISSUE_ICON[i.level] || ISSUE_ICON.info)}</svg>
        <span class="banner__main">${i.message}</span>
        ${i.fix ? raw(`<button type="button" class="btn btn--sm" data-fix="${esc(String(i.fix.seq))}">${esc(i.fix.label)}</button>`) : ''}
      </div>`).join('');

    issuesEl.querySelectorAll('[data-fix]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = challanFor(Number(btn.dataset.fix), settings, draft.date);
        $('#f-challan').value = next;
        draft.challanNo = next;
        markDirty();
        validate();
      });
    });
  };

  // Series checks (duplicates, gaps) are separate from the format rule on the
  // field itself, so this must not stamp over what the field rule decided.
  let challanField = null;
  const validate = debounce(async () => {
    const res = await checkChallan(draft.challanNo, { currentId: draft.id, dateISO: draft.date });
    if (!res.ok) $('#f-challan').setAttribute('aria-invalid', 'true');
    else challanField?.validate();
    paintIssues(res.issues);
  }, 220);

  /* ---------- items ---------- */

  const renumber = () => {
    Array.from(itemsEl.children).forEach((row, i) => {
      const sr = row.querySelector('.item-row__sr');
      if (sr) sr.textContent = `${i + 1})`;
    });
  };

  const wireRow = (rowEl) => {
    const id = rowEl.dataset.row;
    const item = () => draft.items.find((i) => i.id === id);

    rowEl.querySelectorAll('[data-f]').forEach((input) => {
      // Attached first so the value is already sanitised by the time the
      // handler below reads it — a rate field never holds letters.
      input._field = attachField(input, ROW_RULES[input.dataset.f], { inline: false });

      input.addEventListener('input', () => {
        const it = item();
        if (!it) return;
        const field = input.dataset.f;
        it[field] = input.value;
        if (field === 'qty' || field === 'rate') {
          recalcItem(it, field);
          const amtInput = rowEl.querySelector('[data-f="amount"]');
          if (amtInput && document.activeElement !== amtInput) {
            amtInput.value = it.amount === '' ? '' : it.amount;
          }
        }
        markDirty();
        paintTotals();

        // Typing in the last row opens a fresh one, like turning to a new line.
        if (field === 'desc' && input.value && rowEl === itemsEl.lastElementChild) addRow({ focus: false });
      });
    });

    rowEl.querySelector('[data-del]').addEventListener('click', () => {
      const idx = draft.items.findIndex((i) => i.id === id);
      if (idx < 0) return;
      const removed = draft.items[idx];
      draft.items.splice(idx, 1);
      if (!draft.items.length) draft.items.push(blankItem());
      markDirty();
      rowEl.classList.add('is-leaving');
      const finish = () => {
        rowEl.remove();
        if (!itemsEl.children.length) {
          itemsEl.insertAdjacentHTML('beforeend', itemRowHtml(draft.items[0], 0));
          wireRow(itemsEl.lastElementChild);
        }
        renumber();
      };
      rowEl.addEventListener('animationend', finish, { once: true });
      setTimeout(() => { if (rowEl.isConnected) finish(); }, 400);
      paintTotals();
      if (!isBlankItem(removed)) {
        toast(`Removed “${removed.desc || 'row'}”`, {
          actionLabel: 'Undo',
          onAction: () => {
            draft.items.splice(idx, 0, removed);
            paintRows();
            paintTotals();
          },
        });
      }
    });

    // Learned products: pick one and the rate comes with it.
    attachAutocomplete(rowEl.querySelector('[data-f="desc"]'), {
      fetch: (q) => suggestProducts(q, 7),
      renderOption: (p, q) => productOption(p, q, cur),
      onPick: (p, input) => {
        const it = item();
        if (!it) return;
        input.value = p.name;
        it.desc = p.name;
        const rateInput = rowEl.querySelector('[data-f="rate"]');
        const amtInput = rowEl.querySelector('[data-f="amount"]');
        if (p.lastRate && !num(it.rate) && !num(it.amount)) {
          it.rate = p.lastRate;
          rateInput.value = p.lastRate;
          if (String(it.qty ?? '').trim() === '') {
            it.amount = round2(p.lastRate);
          } else {
            recalcItem(it, 'rate');
          }
          amtInput.value = it.amount || '';
        }
        markDirty();
        paintTotals();
        if (rowEl === itemsEl.lastElementChild) addRow({ focus: false });
        (num(it.amount) ? rowEl.querySelector('[data-f="qty"]') : amtInput)?.focus();
      },
    });
  };

  const paintRows = () => {
    itemsEl.innerHTML = draft.items.map((it, i) => itemRowHtml(it, i)).join('');
    Array.from(itemsEl.children).forEach(wireRow);
  };

  function addRow({ focus = true } = {}) {
    const item = blankItem();
    draft.items.push(item);
    itemsEl.insertAdjacentHTML('beforeend', itemRowHtml(item, draft.items.length - 1));
    const rowEl = itemsEl.lastElementChild;
    wireRow(rowEl);
    if (focus) rowEl.querySelector('[data-f="desc"]').focus();
    return rowEl;
  }

  paintRows();
  paintTotals();
  validate();

  $('#add-row').addEventListener('click', () => addRow());

  /* ---------- plain fields ---------- */

  const fields = [];
  const bind = (sel, rule, apply, { revalidate = false } = {}) => {
    const handle = attachField($(sel), rule, {
      onInput: (value) => {
        apply(value);
        markDirty();
        paintTotals();
        if (revalidate) validate();
      },
    });
    fields.push(handle);
    return handle;
  };

  challanField = bind('#f-challan', RULES.challanNo, (v) => { draft.challanNo = v; }, { revalidate: true });
  bind('#f-date', RULES.date, (v) => { draft.date = v; }, { revalidate: true });
  bind('#f-cname', RULES.customerName, (v) => { draft.customer.name = v; });
  bind('#f-caddr', RULES.address, (v) => { draft.customer.address = v; });
  bind('#f-cphone', RULES.phone, (v) => { draft.customer.phone = v; });
  bind('#f-vreg', RULES.regNo, (v) => { draft.vehicle.regNo = v; });
  bind('#f-vmodel', RULES.vehicleModel, (v) => { draft.vehicle.model = v; });
  bind('#f-vkm', RULES.km, (v) => { draft.vehicle.km = v; });
  bind('#f-discount', RULES.money, (v) => { draft.discount = v; });
  bind('#f-tax', RULES.percent, (v) => { draft.taxPercent = v; });
  bind('#f-advance', RULES.money, (v) => { draft.advance = v; });
  bind('#f-notes', RULES.text, (v) => { draft.notes = v; });

  // An emptied date snaps back to the day the screen was opened, so a challan
  // can never be saved without one.
  const dateEl = $('#f-date');
  dateEl.addEventListener('change', () => {
    if (dateEl.value) return;
    dateEl.value = today;
    draft.date = today;
    markDirty();
    validate();
  });

  attachAutocomplete($('#f-cname'), {
    fetch: (q) => suggestParties(q, 6),
    renderOption: partyOption,
    onPick: (p) => {
      draft.customer.name = p.name;
      $('#f-cname').value = p.name;
      if (!draft.customer.address && p.address) { draft.customer.address = p.address; $('#f-caddr').value = p.address; }
      if (!draft.customer.phone && p.phone) { draft.customer.phone = p.phone; $('#f-cphone').value = p.phone; }
      markDirty();
    },
  });

  const pickVehicle = (v) => {
    draft.vehicle.regNo = v.regNo || '';
    draft.vehicle.model = v.model || '';
    $('#f-vreg').value = draft.vehicle.regNo;
    $('#f-vmodel').value = draft.vehicle.model;
    if (!draft.customer.name && v.owner) { draft.customer.name = v.owner; $('#f-cname').value = v.owner; }
    markDirty();
  };
  attachAutocomplete($('#f-vreg'), { fetch: (q) => suggestVehicles(q, 6), renderOption: vehicleOption, onPick: pickVehicle });
  attachAutocomplete($('#f-vmodel'), { fetch: (q) => suggestVehicles(q, 6), renderOption: vehicleOption, onPick: pickVehicle });

  // `is-on` mirrors :checked onto the label so the box can be styled without
  // relying on :has() being available.
  const radios = (name, apply) => {
    const group = root.querySelector(`[data-radio="${name}"]`);
    group.addEventListener('change', (e) => {
      const picked = e.target.closest('input[type="radio"]');
      if (!picked) return;
      group.querySelectorAll('.radio').forEach((l) => l.classList.toggle('is-on', l.contains(picked)));
      apply(picked.value);
      markDirty();
    });
  };
  radios('pay-mode', (v) => { draft.paymentMode = v; });
  radios('pay-status', (v) => { draft.paymentStatus = v; });

  /* ---------- save ---------- */

  /**
   * Everything the form itself can catch, before the repo is asked to save.
   * Returns false and parks the cursor on the offending field.
   */
  const formIsValid = () => {
    const rowFields = Array.from(itemsEl.querySelectorAll('[data-f]')).map((i) => i._field);
    const { ok, first } = validateAll([...fields, ...rowFields]);
    if (!ok) {
      focusInvalid(first);
      toast(first.rule.check(String(first.input.value ?? '').trim()), { kind: 'error', duration: 4500 });
      return false;
    }
    if (draft.items.every(isBlankItem)) {
      toast('Add at least one line before saving.', { kind: 'error' });
      itemsEl.querySelector('[data-f="desc"]')?.focus();
      return false;
    }
    return true;
  };

  const doSave = async () => {
    if (!formIsValid()) return null;
    try {
      const { invoice } = await saveInvoice(draft);
      dirty = false;
      setGuard(null);
      return invoice;
    } catch (err) {
      if (err instanceof ValidationError) {
        paintIssues(err.issues);
        $('#f-challan').setAttribute('aria-invalid', 'true');
        $('#f-challan').scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast(err.issues[0].message, { kind: 'error', duration: 5000 });
      } else {
        console.error(err);
        toast(err.message || 'Could not save.', { kind: 'error', duration: 5000 });
      }
      return null;
    }
  };

  const withBusy = async (btn, label, fn) => {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>${esc(label)}`;
    try { await fn(); } finally { btn.disabled = false; btn.innerHTML = original; }
  };

  $('#save').addEventListener('click', (e) =>
    withBusy(e.currentTarget, 'Saving', async () => {
      const invoice = await doSave();
      if (!invoice) return;
      toast(`Challan ${invoice.challanNo} saved`, { kind: 'good' });
      navigate(`#/invoice/${invoice.id}`, { replace: true });
    }));

  $('#save-pdf').addEventListener('click', (e) =>
    withBusy(e.currentTarget, 'Saving', async () => {
      const invoice = await doSave();
      if (!invoice) return;
      const dirHandle = await getSaveFolder();
      const result = await savePdf(invoice, settings, { dirHandle });
      if (result.method !== 'cancelled') {
        await logEvent(EVENT.PDF, {
          invoice,
          meta: { file: result.name, location: result.dirName ? `Saved to ${result.dirName}` : null },
        });
        toast(result.dirName ? `Saved to ${result.dirName}` : `Saved ${result.name}`, { kind: 'good' });
      }
      navigate(`#/invoice/${invoice.id}`, { replace: true });
    }));

}
