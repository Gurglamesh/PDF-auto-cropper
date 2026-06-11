// crop.js — shared PDF detection + cropping logic (runs in the cropper page)

const MM_TO_PT   = 72 / 25.4;
const TARGET_W   = 95  * MM_TO_PT;   // ~269.3 pt
const TARGET_H   = 178 * MM_TO_PT;   // ~504.1 pt
const PAD        = 2   * MM_TO_PT;   // 2 mm padding
const DETECT_DPI = 150;
const WHITE_THR  = 245;

// Detect the bounding box of non-white content on a PDF.js page.
async function detectBounds(pdfJsPage) {
  const scale = DETECT_DPI / 72;
  const vp    = pdfJsPage.getViewport({ scale });

  const canvas  = document.createElement('canvas');
  canvas.width  = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');

  await pdfJsPage.render({ canvasContext: ctx, viewport: vp }).promise;

  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

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

  // Convert canvas pixels (top-left origin) → PDF points (bottom-left origin)
  const [vx0, vy0, vx1, vy1] = pdfJsPage.view;
  const ptScale = 1 / scale;

  return {
    left:   minX       * ptScale + vx0,
    right:  (maxX + 1) * ptScale + vx0,
    top:    vy1 - minY       * ptScale,
    bottom: vy1 - (maxY + 1) * ptScale,
    pageX0: vx0, pageY0: vy0,
    pageX1: vx1, pageY1: vy1,
  };
}

// Take source PDF bytes (Uint8Array) → cropped 95×178 mm PDF bytes (Uint8Array).
async function cropToLabels(srcBytes) {
  const { PDFDocument } = PDFLib;

  const pdfJsDoc = await pdfjsLib.getDocument({ data: srcBytes.slice() }).promise;
  const srcDoc   = await PDFDocument.load(srcBytes.slice());
  const outDoc   = await PDFDocument.create();

  for (let i = 0; i < pdfJsDoc.numPages; i++) {
    const jPage  = await pdfJsDoc.getPage(i + 1);
    const bounds = await detectBounds(jPage);
    if (!bounds) continue;

    const { left, right, top, bottom, pageX0, pageY0, pageX1, pageY1 } = bounds;

    const clipBox = {
      left:   Math.max(pageX0, left   - PAD),
      right:  Math.min(pageX1, right  + PAD),
      bottom: Math.max(pageY0, bottom - PAD),
      top:    Math.min(pageY1, top    + PAD),
    };

    const [embedded] = await outDoc.embedPages([srcDoc.getPage(i)], clipBox);
    const outPage    = outDoc.addPage([TARGET_W, TARGET_H]);
    outPage.drawPage(embedded, { x: 0, y: 0, width: TARGET_W, height: TARGET_H });
  }

  if (outDoc.getPageCount() === 0) {
    throw new Error('No label content detected (the page may be blank).');
  }

  return outDoc.save();
}
