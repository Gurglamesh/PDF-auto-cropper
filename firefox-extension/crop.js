// crop.js — shared PDF detection + cropping logic (runs in the cropper page)
//
// Works in rendered-image space: each page is rasterised with PDF.js (which
// already honours any /Rotate on the page), the content bounding box is found,
// and a portrait-oriented crop canvas is produced. The page then lets the user
// rotate, and canvasesToPdf() bakes the chosen rotation into a 95×178 mm PDF.

const MM_TO_PT   = 72 / 25.4;
const TARGET_W   = 95  * MM_TO_PT;   // ~269.3 pt — portrait label width
const TARGET_H   = 178 * MM_TO_PT;   // ~504.1 pt — portrait label height
const PAD_MM     = 2;                // padding around detected content, in mm
const RENDER_DPI = 300;              // raster resolution (crisp barcodes)
const WHITE_THR  = 245;              // pixels >= this on all channels = background

// ── helpers ──────────────────────────────────────────────────────────────────

function detectBoundsPx(ctx, width, height) {
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width, maxX = -1, minY = height, maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] < WHITE_THR || data[i + 1] < WHITE_THR || data[i + 2] < WHITE_THR) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

function cropCanvas(src, x, y, w, h) {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
  return out;
}

// Rotate a canvas by 0/90/180/270 degrees clockwise; returns a new canvas.
function rotateCanvasDeg(src, deg) {
  deg = ((deg % 360) + 360) % 360;
  if (deg === 0) return src;

  const out = document.createElement('canvas');
  const ctx = out.getContext('2d');

  if (deg === 180) {
    out.width = src.width;
    out.height = src.height;
    ctx.translate(src.width, src.height);
    ctx.rotate(Math.PI);
  } else {                       // 90 or 270 — dimensions swap
    out.width = src.height;
    out.height = src.width;
    if (deg === 90) {
      ctx.translate(src.height, 0);
      ctx.rotate(Math.PI / 2);
    } else {                     // 270
      ctx.translate(0, src.width);
      ctx.rotate(-Math.PI / 2);
    }
  }
  ctx.drawImage(src, 0, 0);
  return out;
}

function canvasToPngBytes(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

// ── detect + crop each page → portrait-oriented canvases ─────────────────────────

async function cropToCanvases(srcBytes) {
  const pdfJsDoc = await pdfjsLib.getDocument({ data: srcBytes.slice() }).promise;
  const padPx    = Math.round(PAD_MM / 25.4 * RENDER_DPI);
  const canvases = [];

  for (let i = 1; i <= pdfJsDoc.numPages; i++) {
    const page     = await pdfJsDoc.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_DPI / 72 });

    const canvas  = document.createElement('canvas');
    canvas.width  = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';                       // flatten transparency to white
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const b = detectBoundsPx(ctx, canvas.width, canvas.height);
    if (!b) continue;

    const x = Math.max(0, b.minX - padPx);
    const y = Math.max(0, b.minY - padPx);
    const w = Math.min(canvas.width,  b.maxX + 1 + padPx) - x;
    const h = Math.min(canvas.height, b.maxY + 1 + padPx) - y;

    let crop = cropCanvas(canvas, x, y, w, h);

    // Best-guess starting orientation: target is portrait, so turn landscape upright.
    if (crop.width > crop.height) crop = rotateCanvasDeg(crop, 90);

    canvases.push(crop);
  }

  if (canvases.length === 0) {
    throw new Error('No label content detected (the page may be blank).');
  }
  return canvases;
}

// ── canvases (+ user rotation) → 95×178 mm PDF bytes ─────────────────────────────

async function canvasesToPdf(canvases, rotationDeg = 0) {
  const { PDFDocument } = PDFLib;
  const outDoc = await PDFDocument.create();

  for (const base of canvases) {
    const c        = rotateCanvasDeg(base, rotationDeg);
    const pngBytes = await canvasToPngBytes(c);
    const img      = await outDoc.embedPng(pngBytes);

    const outPage = outDoc.addPage([TARGET_W, TARGET_H]);
    const scale   = Math.min(TARGET_W / img.width, TARGET_H / img.height);
    const dw = img.width  * scale;
    const dh = img.height * scale;
    outPage.drawImage(img, {
      x: (TARGET_W - dw) / 2,
      y: (TARGET_H - dh) / 2,
      width: dw,
      height: dh,
    });
  }

  return outDoc.save();
}
