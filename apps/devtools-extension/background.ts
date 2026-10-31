// Service worker: the only part that talks to the native helper and captures tabs.
// It also removes the live filter from a page when its DevTools window closes.

import { LIVE_ID, removeLive } from './live.ts';

export const HOST = 'com.phosphor.helper';

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'detect') {
    chrome.runtime.sendNativeMessage(HOST, { type: 'detect' })
      .then(reply, (e: Error) => reply({ error: `native helper not connected (${e.message}). Run \`phosphor setup\` in Terminal.` }));
    return true;
  }
  if (msg.type === 'capture') {
    chrome.tabs.get(msg.tabId)
      .then(tab => chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }))
      .then(dataUrl => reply({ dataUrl }), (e: Error) => reply({ error: e.message }));
    return true;
  }
});

// The panel keeps a port open per inspected tab; when DevTools closes the port drops and the page is restored.
chrome.runtime.onConnect.addListener(port => {
  if (!port.name.startsWith('phosphor-panel:')) return;
  const tabId = Number(port.name.split(':')[1]);
  port.onDisconnect.addListener(() => {
    chrome.scripting.executeScript({ target: { tabId }, func: removeLive, args: [LIVE_ID] })
      .catch(() => { /* tab gone or restricted page: nothing to restore */ });
  });
});
