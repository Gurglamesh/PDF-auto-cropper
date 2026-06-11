// background.js — opens the cropper page when the toolbar icon is clicked.
// All PDF work happens in cropper.html (a real tab), so the file picker
// won't be killed the way a popup would be.

browser.browserAction.onClicked.addListener((tab) => {
  const src = encodeURIComponent(tab?.url || '');
  browser.tabs.create({
    url: browser.runtime.getURL('cropper.html') + '?src=' + src,
  });
});
