// crop.js — shared PDF detection + cropping logic (runs in the cropper page)
//
// Works in rendered-image space: each page is rasterised with PDF.js (which
// already honours any /Rotate on the page), the content bounding box is found,
// the crop is rotated to portrait if it came out landscape, then it's placed on
// a 95×178 mm page preserving aspect ratio. Rasterising sidesteps the fragile
// coordinate maths that broke on rotated pages.

const MM_TO_PT   = 72 / 25.4;
const TARGET_W   = 95  * MM_TO_PT;   // ~269.3 pt — portrait label width
const TARGET_H   = 178 * MM_TO_PT;   // ~504.1 pt — portrait label height
const PAD_MM     = 2;                // padding around detected content, in mm
const RENDER_DPI = 300;              // raster resolution (crisp barcodes)
const WHITE_THR  = 245;              // pixels >= this on all channels = background

// If a landscape crop must be rotated to portrait, which way to turn it.
// Flip to false if labels come out upside-down.
const ROTATE_CLOCKWISE = true;

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

function rotate90(src, clockwise) {
  const out = document.createElement('canvas');
  out.width = src.height;
  out.height = src.width;
  const ctx = out.getContext('2d');
  if (clockwise) {
    ctx.translate(src.height, 0);
    ctx.rotate(Math.PI / 2);
  } else {
    ctx.translate(0, src.width);
    ctx.rotate(-Math.PI / 2);
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

// ── main ───────────────────────────────────────────────────────────────────────

async function cropToLabels(srcBytes) {
  const { PDFDocument } = PDFLib;

  const pdfJsDoc = await pdfjsLib.getDocument({ data: srcBytes.slice() }).promise;
  const outDoc   = await PDFDocument.create();
  const padPx    = Math.round(PAD_MM / 25.4 * RENDER_DPI);

  for (let i = 1; i <= pdfJsDoc.numPages; i++) {
    const page     = await pdfJsDoc.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_DPI / 72 });

    const canvas  = document.createElement('canvas');
    canvas.width  = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    // White background so transparent PDFs scan/crop correctly
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const b = detectBoundsPx(ctx, canvas.width, canvas.height);
    if (!b) continue;

    const x = Math.max(0, b.minX - padPx);
    const y = Math.max(0, b.minY - padPx);
    const w = Math.min(canvas.width,  b.maxX + 1 + padPx) - x;
    const h = Math.min(canvas.height, b.maxY + 1 + padPx) - y;

    let crop = cropCanvas(canvas, x, y, w, h);

    // Target is portrait; if the content is landscape, turn it upright.
    if (crop.width > crop.height) {
      crop = rotate90(crop, ROTATE_CLOCKWISE);
    }

    const pngBytes = await canvasToPngBytes(crop);
    const img      = await outDoc.embedPng(pngBytes);

    const outPage = outDoc.addPage([TARGET_W, TARGET_H]);
    // Fit preserving aspect ratio, centred (no distortion)
    const scale = Math.min(TARGET_W / img.width, TARGET_H / img.height);
    const dw = img.width  * scale;
    const dh = img.height * scale;
    outPage.drawImage(img, {
      x: (TARGET_W - dw) / 2,
      y: (TARGET_H - dh) / 2,
      width: dw,
      height: dh,
    });
  }

  if (outDoc.getPageCount() === 0) {
    throw new Error('No label content detected (the page may be blank).');
  }

  return outDoc.save();
}
