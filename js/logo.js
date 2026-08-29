// Shop logo handling.
//
// The logo is printed on challans, which are black-and-white documents, so an
// uploaded image is flattened onto white and converted to grey. That also
// keeps it small: it is stored inline with the settings (and therefore travels
// inside a backup), so it has to stay in the low hundreds of KB.

const MAX_W = 720;      // plenty for an A4 letterhead at print resolution
const MAX_H = 360;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const PNG_BUDGET = 180 * 1024;

export const ACCEPTED = 'image/png,image/jpeg,image/webp,image/svg+xml';

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
    img.src = url;
  });
}

/**
 * Turn a picked file into a print-ready mono logo.
 * Returns { dataUrl, width, height, bytes } — width/height are the stored
 * pixel size, used to keep the aspect ratio right on the challan.
 */
export async function processLogo(file, { grayscale = true } = {}) {
  if (!file) throw new Error('No file chosen.');
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('That image is very large. Please pick one under 8 MB.');
  }

  const img = await loadImage(file);

  // An SVG without an intrinsic size reports 0 — give it a sensible box.
  const srcW = img.naturalWidth || img.width || MAX_W;
  const srcH = img.naturalHeight || img.height || MAX_H;
  if (!srcW || !srcH) throw new Error('That image has no size the browser can read.');

  const scale = Math.min(MAX_W / srcW, MAX_H / srcH, 1);
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Flatten transparency onto white — the challan is printed on white paper,
  // and a PDF viewer would otherwise show the alpha as black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  if (grayscale) {
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      // Rec. 601 luma — matches how a mono printer renders colour.
      const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      px[i] = px[i + 1] = px[i + 2] = y;
      px[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
  }

  let dataUrl = canvas.toDataURL('image/png');
  let format = 'PNG';
  if (dataUrl.length > PNG_BUDGET) {
    // Photographic or gradient-heavy logos blow up as PNG; JPEG on white is
    // visually identical here and an order of magnitude smaller.
    const jpeg = canvas.toDataURL('image/jpeg', 0.9);
    if (jpeg.length < dataUrl.length) {
      dataUrl = jpeg;
      format = 'JPEG';
    }
  }

  return { dataUrl, width: w, height: h, format, bytes: Math.round(dataUrl.length * 0.75) };
}

/**
 * Fit the logo inside a box, preserving aspect. Units are whatever the caller
 * uses — mm for the PDF, px for the screen.
 */
export function fitLogo(logo, maxW, maxH) {
  const ratio = (logo?.width || 1) / (logo?.height || 1);
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w, h };
}

export const hasLogo = (settings) => Boolean(settings?.business?.logo?.dataUrl);
