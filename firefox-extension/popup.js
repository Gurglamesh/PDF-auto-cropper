const pickBtn   = document.getElementById('pickBtn');
const tabBtn    = document.getElementById('tabBtn');
const fileInput = document.getElementById('fileInput');
const status    = document.getElementById('status');

function setStatus(text, cls = '') {
  status.textContent = text;
  status.className   = cls;
}

function busy(btn, label) {
  pickBtn.disabled = true;
  tabBtn.disabled  = true;
  btn.innerHTML    = `<span class="spinner"></span>${label}`;
}

function done() {
  setStatus('Done! Opening preview…', 'ok');
  setTimeout(() => window.close(), 800);
}

// ── decide whether "Crop this tab" is usable ───────────────────────────────────
(async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const url   = (tab?.url || '');

  if (/^https?:\/\//i.test(url) && url.toLowerCase().includes('.pdf')) {
    tabBtn.disabled = false;
    setStatus('PDF tab detected — crop it directly, or choose a file.', 'ok');
  } else if (url.startsWith('file:')) {
    setStatus('Local PDF: Firefox blocks reading file:// tabs, so use “Choose PDF & Crop”.', 'warn');
  } else {
    setStatus('Choose a PDF file to crop.');
  }
})();

// ── file picker path (works for local files) ───────────────────────────────────
pickBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;

  busy(pickBtn, 'Processing…');
  setStatus('Detecting label area…');

  try {
    const bytes = await file.arrayBuffer();
    const resp  = await browser.runtime.sendMessage({ type: 'CROP_BYTES', bytes });
    if (resp?.ok === false) throw new Error(resp.error);
    done();
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    pickBtn.disabled = false;
    tabBtn.disabled  = false;
    pickBtn.textContent = 'Choose PDF & Crop';
  }
});

// ── current-tab path (https PDFs only) ──────────────────────────────────────────
tabBtn.addEventListener('click', async () => {
  busy(tabBtn, 'Processing…');
  setStatus('Detecting label area…');

  try {
    const resp = await browser.runtime.sendMessage({ type: 'CROP_CURRENT_TAB' });
    if (resp?.ok === false) throw new Error(resp.error);
    done();
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    pickBtn.disabled = false;
    tabBtn.disabled  = false;
    tabBtn.textContent = 'Crop this tab';
  }
});
