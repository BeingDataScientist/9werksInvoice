// Read-only view of one challan, with everything you can do to it.

import { getInvoice, getSaveFolder, listAudit } from '../store.js';
import { amountDue, deleteInvoice, logEvent, purgeInvoice, restoreInvoice } from '../repo.js';
import { EVENT, renderEvent } from '../audit.js';
import { printPdf, savePdf, sharePdf, pdfPreviewUrl } from '../pdf.js';
import {
  actionSheet, confirmDialog, esc, fmtDate, fmtMoney, html, raw, stagger, toast,
} from '../util.js';

const ICONS = {
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/>',
  pdf: '<path d="M12 3v11M8 11l4 4 4-4"/><path d="M4 19h16"/>',
  share: '<path d="M4 12v7h16v-7"/><path d="M12 16V4M8 8l4-4 4 4"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="7" rx="2"/><path d="M6 14h12v7H6z"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>',
  history: '<path d="M12 8v5l3 2"/><path d="M3.5 12a8.5 8.5 0 1 0 2.2-5.7"/><path d="M3 4v4h4"/>',
  cancel: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
};

const PAY_CHIP = {
  paid: { cls: 'chip--good', label: 'Paid' },
  partial: { cls: 'chip--warning', label: 'Part paid' },
  unpaid: { cls: '', label: 'Unpaid' },
};

const field = (label, value) => (value
  ? html`<div class="pref-row"><div class="pref-row__main"><small>${label}</small><strong>${value}</strong></div></div>`
  : '');

export async function render(root, { params, settings, navigate, setTopbar }) {
  const invoice = await getInvoice(params.id);
  if (!invoice) {
    toast('That challan no longer exists.', { kind: 'error' });
    navigate('#/invoices');
    return;
  }

  const cur = settings.ui.currency;
  const chip = PAY_CHIP[invoice.paymentStatus] || PAY_CHIP.unpaid;

  setTopbar({
    title: `Challan ${invoice.challanNo}`,
    sub: fmtDate(invoice.date),
    back: true,
    actions: [
      { id: 'edit', icon: ICONS.edit, label: 'Edit challan' },
      { id: 'more', icon: ICONS.more, label: 'More actions' },
    ],
  });

  const events = (await listAudit({ invoiceId: invoice.id, limit: 4 }));

  const itemRows = (invoice.items || []).map((it, i) => html`
    <tr>
      <td class="num">${i + 1}</td>
      <td>${it.desc}</td>
      <td class="num">${it.qty === '' || it.qty == null ? '—' : it.qty}</td>
      <td class="num">${it.rate ? fmtMoney(it.rate, cur) : '—'}</td>
      <td class="num">${fmtMoney(it.amount, cur)}</td>
    </tr>`).join('');

  root.innerHTML = html`
    <div class="stack">
      ${invoice.deletedAt ? raw(`
        <div class="banner banner--critical">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>
          <span class="banner__main"><b>This challan is cancelled.</b> Its number stays reserved so the book still adds up.</span>
          <button class="btn btn--sm" id="restore">Restore</button>
        </div>`) : ''}

      <div class="card"><div class="card__body">
        <div class="challan-box">
          <div style="flex:1;min-width:0">
            <div class="challan-box__label">Challan No.</div>
            <div class="challan-box__no">${invoice.challanNo}</div>
          </div>
          <div style="text-align:right">
            <div class="challan-box__label">Total</div>
            <div class="challan-box__no">${fmtMoney(invoice.grandTotal, cur)}</div>
          </div>
        </div>
        <div class="row" style="margin-top:12px">
          <span class="chip ${raw(chip.cls)}">${chip.label}</span>
          ${invoice.paymentMode ? raw(`<span class="chip">${esc(invoice.paymentMode)}</span>`) : ''}
          <span class="chip">${fmtDate(invoice.date)}</span>
          ${amountDue(invoice) > 0 ? raw(`<span class="chip chip--warning">${esc(fmtMoney(amountDue(invoice), cur))} due</span>`) : ''}
        </div>
      </div></div>

      <div class="card">
        <div class="card__head"><h3>Customer &amp; vehicle</h3></div>
        <div class="card__body" style="padding-top:0">
          ${raw(field('To, M/s.', invoice.customer?.name))}
          ${raw(field('Address', invoice.customer?.address))}
          ${raw(field('Phone', invoice.customer?.phone))}
          ${raw(field('Vehicle', invoice.vehicle?.model))}
          ${raw(field('Vehicle No.', invoice.vehicle?.regNo))}
          ${raw(field('Km', invoice.vehicle?.km))}
        </div>
      </div>

      <div class="card">
        <div class="card__head"><h3>Particulars</h3></div>
        <div class="card__body">
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr>
                <th class="num">Sr</th><th>Particulars</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th>
              </tr></thead>
              <tbody>${raw(itemRows || '<tr><td colspan="5">No items</td></tr>')}</tbody>
            </table>
          </div>
          <div class="totals" style="margin-top:16px">
            <div class="totals__row"><span>Subtotal</span><b>${fmtMoney(invoice.subtotal, cur)}</b></div>
            ${invoice.discount ? raw(`<div class="totals__row"><span>Discount</span><b>− ${esc(fmtMoney(invoice.discount, cur))}</b></div>`) : ''}
            ${invoice.taxAmount ? raw(`<div class="totals__row"><span>Tax ${esc(invoice.taxPercent)}%</span><b>${esc(fmtMoney(invoice.taxAmount, cur))}</b></div>`) : ''}
            <div class="totals__row totals__row--grand"><span>Total</span><b>${fmtMoney(invoice.grandTotal, cur)}</b></div>
            ${invoice.advance ? raw(`<div class="totals__row"><span>Advance</span><b>− ${esc(fmtMoney(invoice.advance, cur))}</b></div>
              <div class="totals__row"><span>Balance due</span><b>${esc(fmtMoney(invoice.balance, cur))}</b></div>`) : ''}
          </div>
        </div>
      </div>

      ${invoice.notes ? raw(`<div class="card"><div class="card__head"><h3>Notes</h3></div>
        <div class="card__body" style="padding-top:8px;color:var(--text-secondary)">${esc(invoice.notes)}</div></div>`) : ''}

      <div class="card">
        <div class="card__head">
          <h3>History</h3>
          <span class="card__spacer"></span>
          <button class="btn btn--sm btn--ghost" id="all-history">See all</button>
        </div>
        <div class="card__body">
          <div class="timeline" id="mini-history"></div>
        </div>
      </div>

      <div class="sticky-actions">
        <button class="btn btn--primary" id="pdf">
          <svg viewBox="0 0 24 24" aria-hidden="true">${raw(ICONS.pdf)}</svg>Save PDF
        </button>
        <button class="btn" id="share">
          <svg viewBox="0 0 24 24" aria-hidden="true">${raw(ICONS.share)}</svg>Share
        </button>
      </div>
    </div>`;

  /* ---------- mini history ---------- */

  const mini = root.querySelector('#mini-history');
  if (!events.length) {
    mini.innerHTML = '<p class="field__hint">Nothing recorded yet.</p>';
  } else {
    mini.innerHTML = events.map((e) => {
      const r = renderEvent(e, settings.ui.auditLang, settings, { maxLines: 3 });
      return html`
        <div class="tl-item">
          <span class="tl-item__dot tl-item__dot--${raw(r.kind)}"><svg viewBox="0 0 24 24">${raw(r.icon)}</svg></span>
          <div class="tl-item__head">
            <span class="tl-item__title">${raw(r.title)}</span>
            <span class="tl-item__time" title="${r.absolute}">${r.time}</span>
          </div>
          ${r.lines.length ? raw(`<div class="tl-item__lines">${r.lines.map((l) => `<div class="tl-line">${l}</div>`).join('')}</div>`) : ''}
        </div>`;
    }).join('');
    stagger(Array.from(mini.children));
  }
  root.querySelector('#all-history').addEventListener('click', () => navigate(`#/history/${invoice.id}`));

  /* ---------- actions ---------- */

  const doPdf = async () => {
    try {
      const dirHandle = await getSaveFolder();
      const result = await savePdf(invoice, settings, { dirHandle });
      if (result.method === 'cancelled') return;
      await logEvent(EVENT.PDF, {
        invoice,
        meta: { file: result.name, location: result.dirName ? `Saved to ${result.dirName}` : null },
      });
      toast(result.dirName ? `Saved to ${result.dirName}` : `Saved ${result.name}`, { kind: 'good' });
    } catch (err) {
      console.error(err);
      toast(err.message || 'Could not create the PDF.', { kind: 'error' });
    }
  };

  const doShare = async () => {
    try {
      const ok = await sharePdf(invoice, settings);
      if (ok === true) {
        await logEvent(EVENT.SHARED, { invoice, meta: {} });
      } else if (ok === false) {
        toast('Sharing is not available here — saving instead.', { kind: 'info' });
        await doPdf();
      }
    } catch (err) {
      console.error(err);
      toast('Could not share the challan.', { kind: 'error' });
    }
  };

  const doPreview = () => {
    try {
      const url = pdfPreviewUrl(invoice, settings);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast(err.message || 'Could not build the preview.', { kind: 'error' });
    }
  };

  const doCancel = async () => {
    const ok = await confirmDialog({
      title: `Cancel challan ${esc(invoice.challanNo)}?`,
      body: 'It stays in the list as cancelled and keeps its number, so the book still adds up. You can restore it later.',
      confirmLabel: 'Cancel challan',
      cancelLabel: 'Keep it',
      danger: true,
    });
    if (!ok) return;
    await deleteInvoice(invoice.id);
    toast(`Challan ${invoice.challanNo} cancelled`, { kind: 'good' });
    navigate('#/invoices', { replace: true });
  };

  const doRestore = async () => {
    await restoreInvoice(invoice.id);
    toast(`Challan ${invoice.challanNo} restored`, { kind: 'good' });
    navigate(`#/invoice/${invoice.id}`, { replace: true, reload: true });
  };

  const doPurge = async () => {
    const ok = await confirmDialog({
      title: 'Delete forever?',
      body: `Challan <b>${esc(invoice.challanNo)}</b> and its details will be gone for good. The history entry stays, so the number is still accounted for. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      danger: true,
    });
    if (!ok) return;
    await purgeInvoice(invoice.id);
    toast('Challan deleted', { kind: 'good' });
    navigate('#/invoices', { replace: true });
  };

  root.querySelector('#pdf').addEventListener('click', doPdf);
  root.querySelector('#share').addEventListener('click', doShare);
  root.querySelector('#restore')?.addEventListener('click', doRestore);

  document.querySelector('[data-topbar-action="edit"]')?.addEventListener('click', () =>
    navigate(`#/invoice/${invoice.id}/edit`));

  document.querySelector('[data-topbar-action="more"]')?.addEventListener('click', async () => {
    const options = [
      { value: 'preview', label: 'Preview PDF', sub: 'Open it before saving', icon: ICONS.eye },
      { value: 'print', label: 'Print', sub: 'Or print to PDF', icon: ICONS.print },
      { value: 'history', label: 'Full history', sub: 'Every change to this challan', icon: ICONS.history },
    ];
    options.push(invoice.deletedAt
      ? { value: 'restore', label: 'Restore challan', icon: ICONS.restore }
      : { value: 'cancel', label: 'Cancel challan', sub: 'Keeps the number reserved', icon: ICONS.cancel, danger: true });
    options.push({ value: 'purge', label: 'Delete forever', icon: ICONS.trash, danger: true });

    const choice = await actionSheet({ title: `Challan ${invoice.challanNo}`, options });
    if (choice === 'preview') doPreview();
    else if (choice === 'print') printPdf(invoice, settings);
    else if (choice === 'history') navigate(`#/history/${invoice.id}`);
    else if (choice === 'cancel') doCancel();
    else if (choice === 'restore') doRestore();
    else if (choice === 'purge') doPurge();
  });
}
