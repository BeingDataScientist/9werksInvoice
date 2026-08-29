// Vector PDF of the challan, laid out like a printed challan book.
//
// Note on glyphs: jsPDF's built-in fonts are WinAnsi-encoded, which has no ₹
// and no Devanagari. Amounts are therefore printed as bare numbers — exactly
// like the paper book — and "Rs." is used where a currency word is needed.

import { fmtDate, num, saveBlob, shareFile } from './util.js';
import { fitLogo } from './logo.js';

const PAGE = {
  a5: { w: 148, h: 210 },
  a4: { w: 210, h: 297 },
};

// Whole rupees print bare, the way they are written in the book; paise only
// appear when there actually are any.
const money = (n) => {
  const v = num(n);
  if (!v) return '';
  const whole = Math.abs(v % 1) < 0.005;
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(v);
};

function jsPDFCtor() {
  const ctor = window.jspdf?.jsPDF || window.jsPDF;
  if (!ctor) throw new Error('PDF engine failed to load. Reload the app and try again.');
  return ctor;
}

/* ---------------- drawing helpers ---------------- */

function makeCtx(doc, k) {
  const ctx = {
    doc,
    k,
    line(x1, y1, x2, y2, w = 0.25) {
      doc.setLineWidth(w);
      doc.line(x1, y1, x2, y2);
    },
    rect(x, y, w, h, lw = 0.25) {
      doc.setLineWidth(lw);
      doc.rect(x, y, w, h);
    },
    font(size, style = 'normal') {
      doc.setFont('helvetica', style);
      doc.setFontSize(size * k);
      return doc.getFontSize();
    },
    /** Draw text, shrinking then clipping so it never spills its column. */
    text(str, x, y, { size = 8, style = 'normal', align = 'left', maxWidth = null } = {}) {
      const s = String(str ?? '');
      if (!s) return;
      let fs = size * k;
      doc.setFont('helvetica', style);
      doc.setFontSize(fs);
      if (maxWidth) {
        while (doc.getTextWidth(s) > maxWidth && fs > 4.2) {
          fs -= 0.25;
          doc.setFontSize(fs);
        }
        if (doc.getTextWidth(s) > maxWidth) {
          let cut = s;
          while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
          doc.text(`${cut}…`, x, y, { align });
          return;
        }
      }
      doc.text(s, x, y, { align });
    },
    width(str, size = 8, style = 'normal') {
      doc.setFont('helvetica', style);
      doc.setFontSize(size * k);
      return doc.getTextWidth(String(str ?? ''));
    },
  };
  return ctx;
}

/**
 * Place the shop's uploaded logo, fitted into a box and left-aligned within it.
 * Returns the width actually used, so callers can lay text out beside it.
 * With no logo uploaded this draws nothing and returns 0 — there is no stand-in
 * mark, because a generic glyph on someone's invoice is worse than none.
 */
function drawLogo(ctx, logo, x, y, maxW, maxH) {
  if (!logo?.dataUrl) return 0;
  const { w, h } = fitLogo(logo, maxW, maxH);
  try {
    ctx.doc.addImage(logo.dataUrl, logo.format || 'PNG', x, y + (maxH - h) / 2, w, h);
    return w;
  } catch (err) {
    // A corrupt data URL must not take the whole challan down.
    console.warn('Logo could not be drawn', err);
    return 0;
  }
}

function drawCheckbox(ctx, x, y, size, checked) {
  const { doc } = ctx;
  doc.setLineWidth(0.25);
  doc.rect(x, y, size, size);
  if (!checked) return;
  doc.setLineWidth(size * 0.16);
  doc.line(x + size * 0.2, y + size * 0.52, x + size * 0.42, y + size * 0.76);
  doc.line(x + size * 0.42, y + size * 0.76, x + size * 0.82, y + size * 0.2);
  doc.setLineWidth(0.25);
}

/* ---------------- sections ---------------- */

function drawHeader(ctx, x, y, w, biz) {
  const { k } = ctx;
  const h = 21 * k;

  // "INVOICE" tag, centred at the very top.
  const tagW = 17 * k, tagH = 4.6 * k;
  const tagX = x + w / 2 - tagW / 2;
  ctx.rect(tagX, y + 1.2 * k, tagW, tagH, 0.35);
  ctx.text('INVOICE', x + w / 2, y + 1.2 * k + tagH * 0.72, { size: 7, style: 'bold', align: 'center' });

  // Contact block, top right. Each line only appears if it was filled in, so a
  // shop that gave no landline doesn't print a bare "Office:".
  const cx = x + w - 1.6 * k;
  const contacts = [
    biz.mobile && `Mob:${biz.mobile}`,
    biz.office && `Office:${biz.office}`,
    biz.instagram && `@${biz.instagram}`,
  ].filter(Boolean);
  contacts.forEach((line, i) => {
    ctx.text(line, cx, y + (3.2 + i * 2.8) * k, { size: 6.6, style: 'bold', align: 'right' });
  });

  // Name, with the uploaded logo to its left. The pair is centred as a group,
  // and either half may be absent.
  const nameSize = 21;
  const name = biz.name || '';
  const nameW = name ? ctx.width(name, nameSize, 'bold') : 0;
  const logoMaxW = 22 * k;
  const logoMaxH = 9.5 * k;
  const logoW = biz.logo?.dataUrl ? fitLogo(biz.logo, logoMaxW, logoMaxH).w : 0;
  const gap = logoW && nameW ? 2 * k : 0;
  const groupW = logoW + gap + nameW;
  const gx = x + w / 2 - groupW / 2;
  const baseY = y + 14.6 * k;

  if (logoW) drawLogo(ctx, biz.logo, gx, baseY - logoMaxH, logoMaxW, logoMaxH);
  if (name) ctx.text(name, gx + logoW + gap, baseY, { size: nameSize, style: 'bold' });

  if (biz.tagline) {
    ctx.text(biz.tagline.toUpperCase(), x + w / 2, y + 18.4 * k, { size: 6.4, align: 'center', maxWidth: w - 6 * k });
  }
  return h;
}

function drawAddress(ctx, x, y, w, biz) {
  const { k } = ctx;
  const h = 6 * k;
  ctx.line(x, y, x + w, y, 0.35);
  ctx.text(biz.address || '', x + w / 2, y + 4 * k, { size: 6.8, style: 'bold', align: 'center', maxWidth: w - 4 * k });
  return h;
}

function drawInfo(ctx, x, y, w, invoice) {
  const { k } = ctx;
  const h = 20 * k;
  const splitX = x + w * 0.62;

  ctx.line(x, y, x + w, y, 0.35);
  ctx.line(splitX, y, splitX, y + h, 0.35);

  const labelSize = 7.2, valueSize = 8.4;
  const leftPad = x + 2 * k;
  const rows = [
    { label: 'To,', label2: 'M/s.', value: invoice.customer?.name || '' },
    { label: 'Address:', value: invoice.customer?.address || '' },
    { label: 'Vehicle:', value: invoice.vehicle?.model || '' },
  ];

  let ry = y + 5.6 * k;
  const rowGap = 5.2 * k;
  rows.forEach((r, i) => {
    if (r.label2) {
      ctx.text(r.label, leftPad, ry - 2.6 * k, { size: labelSize, style: 'bold' });
      ctx.text(r.label2, leftPad, ry, { size: labelSize, style: 'bold' });
    } else {
      ctx.text(r.label, leftPad, ry, { size: labelSize, style: 'bold' });
    }
    const lw = ctx.width(r.label2 || r.label, labelSize, 'bold') + 1.4 * k;
    const vx = leftPad + lw;
    const vw = splitX - vx - 2 * k;
    ctx.text(r.value, vx, ry - 0.6 * k, { size: valueSize, maxWidth: vw });
    ctx.line(vx, ry + 0.6 * k, splitX - 1.4 * k, ry + 0.6 * k, 0.2);
    ry += rowGap + (i === 0 ? 1.2 * k : 0);
  });

  const rightRows = [
    ['Challan No.:', invoice.challanNo || '', true],
    ['Date:', invoice.date ? fmtDate(invoice.date) : ''],
    ['Veh No.:', invoice.vehicle?.regNo || ''],
    ['Km:', invoice.vehicle?.km || ''],
  ];
  const rx = splitX + 2 * k;
  // Four rows have to fit inside the block: start high enough and space them
  // so the last baseline ("Km:") clears the table border below.
  let ry2 = y + 4.4 * k;
  const rGap = 4.4 * k;
  rightRows.forEach(([label, value, strong], i) => {
    ctx.text(label, rx, ry2, { size: labelSize, style: 'bold' });
    const lw = ctx.width(label, labelSize, 'bold') + 1.6 * k;
    ctx.text(value, rx + lw, ry2, {
      size: strong ? 11 : valueSize,
      style: strong ? 'bold' : 'normal',
      maxWidth: x + w - (rx + lw) - 2 * k,
    });
    if (i < rightRows.length - 1) ctx.line(splitX, ry2 + 1.6 * k, x + w, ry2 + 1.6 * k, 0.2);
    ry2 += rGap;
  });

  return h;
}

const COLS = [
  { key: 'sr',     title: 'Sr\nNo.',        frac: 0.09, align: 'center' },
  { key: 'desc',   title: 'Particulars',    frac: 0.46, align: 'left' },
  { key: 'qty',    title: 'Quantity',       frac: 0.13, align: 'center' },
  { key: 'rate',   title: 'Rate',           frac: 0.13, align: 'center' },
  { key: 'amount', title: 'Amount',         frac: 0.19, align: 'center' },
];

function colXs(x, w) {
  const xs = [x];
  let acc = x;
  for (const c of COLS) { acc += c.frac * w; xs.push(acc); }
  xs[xs.length - 1] = x + w;
  return xs;
}

function drawTable(ctx, x, y, w, h, rows, { startIndex, showTotal, totals, minRows }) {
  const { k } = ctx;
  const headH = 7.4 * k;
  const totalH = showTotal ? 7.4 * k : 0;
  const bodyH = h - headH - totalH;
  const rowH = bodyH / Math.max(minRows, rows.length || 1);
  const xs = colXs(x, w);

  ctx.rect(x, y, w, h, 0.35);
  ctx.line(x, y + headH, x + w, y + headH, 0.35);

  COLS.forEach((c, i) => {
    const cx = (xs[i] + xs[i + 1]) / 2;
    if (c.key === 'sr') {
      ctx.text('Sr', cx, y + 3.1 * k, { size: 7.6, style: 'bold', align: 'center' });
      ctx.text('No.', cx, y + 6 * k, { size: 7.6, style: 'bold', align: 'center' });
    } else {
      ctx.text(c.title, cx, y + 4.9 * k, { size: 7.8, style: 'bold', align: 'center' });
    }
  });

  const bodyTop = y + headH;
  const drawn = Math.max(minRows, rows.length);
  for (let i = 1; i < drawn; i++) {
    const ly = bodyTop + i * rowH;
    if (ly >= bodyTop + bodyH - 0.2) break;
    ctx.line(x, ly, x + w, ly, 0.15);
  }
  for (let i = 1; i < xs.length - 1; i++) {
    ctx.line(xs[i], y, xs[i], bodyTop + bodyH, 0.25);
  }

  rows.forEach((item, i) => {
    const ty = bodyTop + i * rowH + rowH * 0.68;
    const pad = 1.6 * k;
    ctx.text(`${startIndex + i + 1})`, (xs[0] + xs[1]) / 2, ty, { size: 8, align: 'center' });
    ctx.text(item.desc || '', xs[1] + pad, ty, { size: 8.6, maxWidth: xs[2] - xs[1] - pad * 2 });
    ctx.text(item.qty === '' || item.qty == null ? '' : String(item.qty), (xs[2] + xs[3]) / 2, ty, { size: 8.4, align: 'center' });
    ctx.text(money(item.rate), xs[4] - pad, ty, { size: 8.4, align: 'right' });
    ctx.text(money(item.amount), xs[5] - pad, ty, { size: 8.8, align: 'right' });
  });

  if (showTotal) {
    const ty = y + h - totalH;
    ctx.line(x, ty, x + w, ty, 0.35);
    const totalLabelX = xs[4] - 1.6 * k;
    ctx.text('TOTAL', totalLabelX, ty + totalH * 0.68, { size: 9.4, style: 'bold', align: 'right' });
    ctx.text(money(totals.grandTotal), xs[5] - 1.6 * k, ty + totalH * 0.68, { size: 10.4, style: 'bold', align: 'right' });
    ctx.line(xs[4], ty, xs[4], y + h, 0.25);
  }
}

function drawFooter(ctx, x, y, w, h, invoice, biz) {
  const { k } = ctx;
  ctx.rect(x, y, w, h, 0.35);
  const c1 = x + w * 0.4;
  const c2 = x + w * 0.66;
  ctx.line(c1, y, c1, y + h, 0.25);
  ctx.line(c2, y, c2, y + h, 0.25);

  // Terms + receiver signature.
  const terms = String(biz.terms || '');
  ctx.doc.setFont('helvetica', 'normal');
  ctx.doc.setFontSize(5.9 * k);
  const lines = ctx.doc.splitTextToSize(terms, w * 0.4 - 3 * k);
  lines.slice(0, 4).forEach((ln, i) => {
    ctx.text(ln, x + w * 0.2, y + 3.4 * k + i * 2.5 * k, { size: 5.9, align: 'center' });
  });
  ctx.text("Receiver's Signature.", x + w * 0.2, y + h - 2.4 * k, { size: 6.6, style: 'bold', align: 'center' });

  // Payment mode.
  const pmx = c1 + 2 * k;
  ctx.text('Payment Mode', (c1 + c2) / 2, y + 4.4 * k, { size: 8, align: 'center' });
  const box = 2.7 * k;
  const modes = [['Cash', 0, 0], ['Cheque', 1, 0], ['RTGS', 0, 1], ['Online', 1, 1]];
  const colW = (c2 - c1 - 3 * k) / 2;
  const selected = String(invoice.paymentMode || '').toLowerCase();
  modes.forEach(([label, col, row]) => {
    const bx = pmx + col * colW;
    const by = y + 6.6 * k + row * 4.6 * k;
    ctx.text(label, bx, by + box * 0.85, { size: 7.2 });
    const lw = ctx.width(label, 7.2) + 1.2 * k;
    drawCheckbox(ctx, bx + lw, by, box, selected === label.toLowerCase());
  });

  // Authorised signatory, with the same logo reduced.
  const rcx = (c2 + x + w) / 2;
  const signW = (x + w - c2) - 3 * k;
  const name = biz.name || '';
  const nameW = name ? ctx.width(name, 10.5, 'bold') : 0;
  const logoMaxW = Math.min(13 * k, signW);
  const logoMaxH = 5.4 * k;
  const logoW = biz.logo?.dataUrl ? fitLogo(biz.logo, logoMaxW, logoMaxH).w : 0;
  const gap = logoW && nameW ? 1 * k : 0;
  const gx = rcx - (logoW + gap + nameW) / 2;

  if (logoW) drawLogo(ctx, biz.logo, gx, y + 2.2 * k, logoMaxW, logoMaxH);
  if (name) ctx.text(name, gx + logoW + gap, y + 6 * k, { size: 10.5, style: 'bold', maxWidth: signW });
  if (biz.tagline) ctx.text(biz.tagline.toUpperCase(), rcx, y + 8.8 * k, { size: 4.4, align: 'center', maxWidth: signW });
  ctx.text('Authorised Signatory', rcx, y + h - 2.4 * k, { size: 6.8, style: 'bold', align: 'center' });
}

function drawExtras(ctx, x, y, w, invoice) {
  // Discount / tax / advance only appear when they are actually used, so a
  // plain challan keeps the exact look of the printed book.
  const { k } = ctx;
  const bits = [];
  if (num(invoice.discount)) bits.push(`Less discount: ${money(invoice.discount)}`);
  if (num(invoice.taxPercent)) bits.push(`Tax ${num(invoice.taxPercent)}%: ${money(invoice.taxAmount)}`);
  if (num(invoice.advance)) bits.push(`Advance: ${money(invoice.advance)}  |  Balance: ${money(invoice.balance)}`);
  if (invoice.notes) bits.push(`Note: ${invoice.notes}`);
  if (!bits.length) return 0;
  const h = bits.length * 3.2 * k + 1.4 * k;
  bits.forEach((b, i) => ctx.text(b, x + w - 1 * k, y + 2.6 * k + i * 3.2 * k, { size: 6.8, align: 'right', maxWidth: w - 2 * k }));
  return h;
}

/* ---------------- document ---------------- */

export function buildInvoicePDF(invoice, settings) {
  const JsPDF = jsPDFCtor();
  const size = PAGE[settings.pdf?.pageSize] ? settings.pdf.pageSize : 'a5';
  const { w: pw, h: ph } = PAGE[size];
  const doc = new JsPDF({ unit: 'mm', format: size, orientation: 'portrait', compress: true });

  const k = pw / 148; // everything is authored against A5 and scales up
  const ctx = makeCtx(doc, k);
  const margin = 5 * k;
  const x = margin;
  const w = pw - margin * 2;
  const biz = settings.business;

  const items = invoice.items || [];
  const minRows = Math.max(6, Number(settings.pdf?.minRows) || 12);

  // Work out how many rows fit on a page, then split.
  const probeTop = margin + 21 * k + 6 * k + 20 * k;
  const footerH = 26 * k;
  const extrasH = 0;
  const tableH = ph - margin - footerH - probeTop - extrasH - 1 * k;
  const perPage = Math.max(4, Math.floor((tableH - 7.4 * k - 7.4 * k) / (5.4 * k)));
  const pages = [];
  for (let i = 0; i < Math.max(1, Math.ceil(items.length / perPage)); i++) {
    pages.push(items.slice(i * perPage, (i + 1) * perPage));
  }

  pages.forEach((pageItems, pageIndex) => {
    if (pageIndex > 0) doc.addPage(size, 'portrait');
    doc.setDrawColor(0);
    doc.setTextColor(0);

    let y = margin;
    ctx.rect(x, y, w, ph - margin * 2, 0.5);

    y += drawHeader(ctx, x, y, w, biz);
    y += drawAddress(ctx, x, y, w, biz);
    y += drawInfo(ctx, x, y, w, invoice);

    const isLast = pageIndex === pages.length - 1;
    const footTop = ph - margin - footerH;
    const extrasHeight = isLast ? drawExtras(ctx, x, footTop - 12 * k, w, invoice) : 0;
    const tTop = y;
    const tH = footTop - tTop - extrasHeight;

    drawTable(ctx, x, tTop, w, tH, pageItems, {
      startIndex: pageIndex * perPage,
      showTotal: isLast,
      totals: invoice,
      minRows: pages.length > 1 ? perPage : minRows,
    });

    drawFooter(ctx, x, footTop, w, footerH, invoice, biz);

    if (pages.length > 1) {
      ctx.text(`Page ${pageIndex + 1} of ${pages.length}`, x + w - 1 * k, margin - 1.2 * k, { size: 6, align: 'right' });
    }
  });

  doc.setProperties({
    title: `Challan ${invoice.challanNo || ''}`,
    subject: `${biz.name || 'Challan'}`,
    author: biz.name || '',
    creator: 'Challan Book',
  });

  return doc;
}

const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();

export function invoiceFilename(invoice, settings) {
  const pattern = settings.pdf?.filenamePattern || 'Challan-{no}-{customer}';
  const name = pattern
    .replace(/\{no\}/gi, safe(invoice.challanNo))
    .replace(/\{customer\}/gi, safe(invoice.customer?.name))
    .replace(/\{date\}/gi, invoice.date || '')
    .replace(/\{vehicle\}/gi, safe(invoice.vehicle?.regNo || invoice.vehicle?.model))
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${name || 'Challan'}.pdf`;
}

export const invoiceBlob = (invoice, settings) => buildInvoicePDF(invoice, settings).output('blob');

/** Save the PDF where the user wants it. */
export async function savePdf(invoice, settings, { dirHandle = null } = {}) {
  const blob = invoiceBlob(invoice, settings);
  const filename = invoiceFilename(invoice, settings);
  return saveBlob(blob, filename, {
    dirHandle,
    accept: { 'application/pdf': ['.pdf'] },
    description: 'PDF challan',
  });
}

export async function sharePdf(invoice, settings) {
  const blob = invoiceBlob(invoice, settings);
  return shareFile(blob, invoiceFilename(invoice, settings), {
    title: `Challan ${invoice.challanNo}`,
    text: `${settings.business.name} — Challan ${invoice.challanNo}`,
  });
}

/** Open the OS print dialog with the challan (which can also "print to PDF"). */
export function printPdf(invoice, settings) {
  const doc = buildInvoicePDF(invoice, settings);
  const url = doc.output('bloburl');
  const win = window.open(url, '_blank');
  if (!win) return false;
  win.addEventListener?.('load', () => { try { win.print(); } catch { /* popup blocked print */ } });
  return true;
}

export const pdfPreviewUrl = (invoice, settings) => buildInvoicePDF(invoice, settings).output('bloburl');
