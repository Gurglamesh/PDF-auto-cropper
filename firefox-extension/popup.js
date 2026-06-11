const btn    = document.getElementById('cropBtn');
const status = document.getElementById('status');

function setStatus(text, cls = '') {
  status.textContent = text;
  status.className   = cls;
}

(async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const url   = (tab?.url || '').toLowerCase();
  const isPdf = url.includes('.pdf') || url.startsWith('blob:') ||
                url.startsWith('file:');

  if (!isPdf) {
    setStatus('Open a PDF file in this tab first.', 'warn');
    return;
  }

  setStatus('PDF detected — ready to crop.', 'ok');
  btn.disabled = false;
})();

btn.addEventListener('click', async () => {
  btn.disabled  = true;
  btn.innerHTML = '<span class="spinner"></span>Processing…';
  setStatus('Detecting label area…');

  try {
    const resp = await browser.runtime.sendMessage({ type: 'CROP_CURRENT_TAB' });
    if (resp?.ok === false) throw new Error(resp.error);
    setStatus('Done! Opening viewer…', 'ok');
    setTimeout(() => window.close(), 800);
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    btn.textContent = 'Crop & Print';
    btn.disabled    = false;
  }
});
