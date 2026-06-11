pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('lib/pdf.worker.min.js');

const pickBtn   = document.getElementById('pickBtn');
const srcBtn    = document.getElementById('srcBtn');
const printBtn  = document.getElementById('printBtn');
const fileInput = document.getElementById('fileInput');
const statusEl  = document.getElementById('status');
const pagesDiv  = document.getElementById('pages');
const rotateBar = document.getElementById('rotateBar');
const rotLeft   = document.getElementById('rotLeft');
const rotRight  = document.getElementById('rotRight');

let baseCanvases = [];   // portrait-oriented crops from crop.js
let rotation     = 0;    // user rotation in degrees, clockwise
let blobUrl      = null;

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className   = cls;
}

// Offer "crop the PDF I came from" only for fetchable https PDFs.
const srcUrl = new URLSearchParams(location.search).get('src') || '';
if (/^https?:\/\//i.test(srcUrl) && srcUrl.toLowerCase().includes('.pdf')) {
  srcBtn.style.display = '';
}

// ── inputs ───────────────────────────────────────────────────────────────────
pickBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  await run(() => file.arrayBuffer());
});

srcBtn.addEventListener('click', () => {
  run(async () => {
    const resp = await fetch(srcUrl);
    if (!resp.ok) throw new Error(`Could not fetch PDF (HTTP ${resp.status}).`);
    return resp.arrayBuffer();
  });
});

rotLeft.addEventListener('click', () => { rotation = (rotation + 270) % 360; onRotate(); });
rotRight.addEventListener('click', () => { rotation = (rotation + 90)  % 360; onRotate(); });

// ── pipeline ─────────────────────────────────────────────────────────────────
async function run(getBuffer) {
  pickBtn.disabled = srcBtn.disabled = printBtn.disabled = true;
  rotateBar.classList.remove('show');
  pagesDiv.innerHTML = '';
  invalidateBlob();
  setStatus('Detecting label area…');

  try {
    const buffer = await getBuffer();
    baseCanvases = await cropToCanvases(new Uint8Array(buffer));
    rotation     = 0;

    drawPreview();
    rotateBar.classList.add('show');
    printBtn.disabled = false;

    const n = baseCanvases.length;
    setStatus(`${n === 1 ? '1 label' : n + ' labels'} cropped to 95×178 mm — rotate if needed, then print`, 'ok');
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    pickBtn.disabled = srcBtn.disabled = false;
  }
}

function onRotate() {
  if (!baseCanvases.length) return;
  invalidateBlob();          // printed PDF must be rebuilt with new rotation
  drawPreview();
}

function drawPreview() {
  pagesDiv.innerHTML = '';
  for (const base of baseCanvases) {
    const c    = rotateCanvasDeg(base, rotation);
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    c.style.maxWidth  = '100%';
    c.style.maxHeight = '100%';
    c.style.width     = 'auto';
    c.style.height    = 'auto';
    wrap.appendChild(c);
    pagesDiv.appendChild(wrap);
  }
}

// ── print ────────────────────────────────────────────────────────────────────
function invalidateBlob() {
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
}

printBtn.addEventListener('click', async () => {
  printBtn.disabled = true;
  try {
    if (!blobUrl) {
      const bytes = await canvasesToPdf(baseCanvases, rotation);
      blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    }
    window.open(blobUrl, '_blank');
  } catch (err) {
    setStatus(`Error building PDF: ${err.message}`, 'error');
  } finally {
    printBtn.disabled = false;
  }
});
