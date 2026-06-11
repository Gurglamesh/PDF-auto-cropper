pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('lib/pdf.worker.min.js');

const statusBar = document.getElementById('statusBar');
const pagesDiv  = document.getElementById('pages');
const printBtn  = document.getElementById('printBtn');

let blobUrl = null;

async function init() {
  const { bytes } = await browser.runtime.sendMessage({ type: 'GET_PDF' });

  if (!bytes) {
    statusBar.textContent = 'No processed PDF found. Use the extension button on a PDF tab.';
    statusBar.className   = 'error';
    return;
  }

  const pdfBytes = new Uint8Array(bytes);
  const blob     = new Blob([pdfBytes], { type: 'application/pdf' });
  blobUrl        = URL.createObjectURL(blob);

  // render preview pages
  const doc      = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
  const numPages = doc.numPages;

  for (let i = 1; i <= numPages; i++) {
    await renderPage(doc, i);
  }

  const label = numPages === 1 ? '1 label' : `${numPages} labels`;
  statusBar.textContent = `${label} cropped to 95×178 mm — ready to print`;

  printBtn.disabled = false;
}

async function renderPage(doc, pageNum) {
  const page = await doc.getPage(pageNum);

  // render at a DPI that fills the fixed-width container (300px wide in CSS)
  const cssWidth  = Math.min(300, window.innerWidth * 0.8);
  const scale     = cssWidth / (page.view[2] - page.view[0]);
  const viewport  = page.getViewport({ scale });

  const wrap   = document.createElement('div');
  wrap.className = 'page-wrap';

  const canvas   = document.createElement('canvas');
  canvas.width   = viewport.width;
  canvas.height  = viewport.height;

  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

  wrap.appendChild(canvas);
  pagesDiv.appendChild(wrap);
}

printBtn.addEventListener('click', () => {
  if (blobUrl) window.open(blobUrl, '_blank');
});

init().catch(err => {
  statusBar.textContent = `Error: ${err.message}`;
  statusBar.className   = 'error';
});
