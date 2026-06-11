pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('lib/pdf.worker.min.js');

const pickBtn   = document.getElementById('pickBtn');
const srcBtn    = document.getElementById('srcBtn');
const printBtn  = document.getElementById('printBtn');
const fileInput = document.getElementById('fileInput');
const statusEl  = document.getElementById('status');
const pagesDiv  = document.getElementById('pages');

let blobUrl = null;

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className   = cls;
}

// Offer "crop the PDF I came from" only for fetchable https PDFs.
const srcUrl = new URLSearchParams(location.search).get('src') || '';
if (/^https?:\/\//i.test(srcUrl) && srcUrl.toLowerCase().includes('.pdf')) {
  srcBtn.style.display = '';
}

// ── file picker (works for local files) ─────────────────────────────────────────
pickBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  await run(() => file.arrayBuffer());
});

// ── current-tab PDF (https only) ─────────────────────────────────────────────────
srcBtn.addEventListener('click', () => {
  run(async () => {
    const resp = await fetch(srcUrl);
    if (!resp.ok) throw new Error(`Could not fetch PDF (HTTP ${resp.status}).`);
    return resp.arrayBuffer();
  });
});

// ── shared pipeline ──────────────────────────────────────────────────────────────
async function run(getBuffer) {
  pickBtn.disabled = srcBtn.disabled = printBtn.disabled = true;
  setStatus('', '');
  setStatus('Detecting label area…');
  pagesDiv.innerHTML = '';
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }

  try {
    const buffer    = await getBuffer();
    const srcBytes  = new Uint8Array(buffer);
    const outBytes  = await cropToLabels(srcBytes);

    blobUrl = URL.createObjectURL(new Blob([outBytes], { type: 'application/pdf' }));
    await renderPreview(outBytes);

    printBtn.disabled = false;
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    pickBtn.disabled = srcBtn.disabled = false;
  }
}

async function renderPreview(bytes) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const n   = doc.numPages;

  for (let i = 1; i <= n; i++) {
    const page     = await doc.getPage(i);
    const scale    = 280 / (page.view[2] - page.view[0]);
    const viewport = page.getViewport({ scale });

    const wrap   = document.createElement('div');
    wrap.className = 'page-wrap';
    const canvas = document.createElement('canvas');
    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    wrap.appendChild(canvas);
    pagesDiv.appendChild(wrap);
  }

  const label = n === 1 ? '1 label' : `${n} labels`;
  setStatus(`${label} cropped to 95×178 mm — ready to print`, 'ok');
}

printBtn.addEventListener('click', () => {
  if (blobUrl) window.open(blobUrl, '_blank');
});
