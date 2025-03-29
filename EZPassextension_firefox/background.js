let ws;

function connectWebSocket() {
  ws = new WebSocket('ws://127.0.0.1:9001');
  ws.onopen = () => {
    console.log('WebSocket connected');
  };
  ws.onclose = () => {
    console.log('WebSocket disconnected');
    ws = null; // Reset ws to allow reconnection
  };
  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
  ws.onmessage = (event) => {
    const response = JSON.parse(event.data);
    console.log('WebSocket message received:', response);
    browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, { action: 'fillFields', data: response }, (response) => {
          if (browser.runtime.lastError) {
            console.error('Failed to send message to content script:', browser.runtime.lastError);
          }
        });
      } else {
        console.warn('No active tab found to send WebSocket response');
      }
    });
  };
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!browser.runtime?.id) {
    console.error('Extension context invalidated');
    sendResponse({ success: false, error: 'Extension context invalidated' });
    return true;
  }

  if (message.action === 'sendUrl') {
    const url = message.url;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('WebSocket not connected, attempting to connect...');
      connectWebSocket();
      ws.onopen = () => {
        console.log('Sending URL after WebSocket opened:', url);
        ws.send(url);
      };
    } else {
      console.log('Sending URL via WebSocket:', url);
      ws.send(url);
    }
    sendResponse({ success: true }); // Acknowledge receipt; actual data comes via WebSocket
  } else if (message.action === 'savePasswordViaWebSocket') {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected for savePassword');
      sendResponse({ success: false, error: 'WebSocket not connected' });
    } else {
      const msg = `ADD_PASSWORD|${message.hostname}|${message.username}|${message.password}|${message.usernameSelector}|${message.passwordSelector}`;
      console.log('Sending save password message:', msg);
      ws.send(msg);
      sendResponse({ success: true });
    }
  } else if (message.action === 'savePreference') {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected for savePreference');
      sendResponse({ success: false, error: 'WebSocket not connected' });
    } else {
      const msg = `PREF:${message.hostname}|${message.selector}|${message.role}`;
      console.log('Sending preference message:', msg);
      ws.send(msg);
      sendResponse({ success: true });
    }
  }
  return true; // Keep the message channel open for async responses
});

// Ensure WebSocket reconnects if closed unexpectedly
browser.runtime.onStartup.addListener(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectWebSocket();
  }
});