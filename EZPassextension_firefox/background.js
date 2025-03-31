let ws;

function connectWebSocket(attempt = 1, maxAttempts = 3) {
  ws = new WebSocket('ws://127.0.0.1:9001');
  
  ws.onopen = () => {
    console.log(`WebSocket connected on attempt ${attempt}`);
  };
  
  ws.onclose = () => {
    console.log('WebSocket disconnected');
    ws = null;
    if (attempt <= maxAttempts) {
      console.log(`Reconnecting... Attempt ${attempt + 1}`);
      setTimeout(() => connectWebSocket(attempt + 1, maxAttempts), 1000);
    } else {
      console.error('Max WebSocket reconnection attempts reached');
    }
  };
  
  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
  
  ws.onmessage = (event) => {
    let response;
    try {
      response = JSON.parse(event.data);
      console.log('WebSocket message received:', response);
    } catch (e) {
      console.error('Failed to parse WebSocket message:', event.data, e);
      return;
    }
    
    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, { action: 'fillFields', data: response }).catch(err => {
          console.error('Failed to send message to content script:', err);
        });
      } else {
        console.warn('No active tab found to send WebSocket response');
      }
    }).catch(err => console.error('Tab query failed:', err));
  };
}

function normalizeUrl(url) {
  try {
    if (url.startsWith('file://')) return 'file';
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    console.error('URL normalization error:', e);
    return url.split('/')[0].toLowerCase();
  }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!browser.runtime?.id) {
    console.error('Extension context invalidated');
    sendResponse({ success: false, error: 'Extension context invalidated' });
    return true;
  }

  if (message.action === 'sendUrl') {
    const url = message.url;
    const hostname = normalizeUrl(url);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('WebSocket not connected, attempting to connect...');
      connectWebSocket();
      const waitForConnection = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          console.log('Sending hostname after WebSocket opened:', hostname);
          ws.send(hostname);
          clearInterval(waitForConnection);
          sendResponse({ success: true });
        }
      }, 100);
      setTimeout(() => {
        clearInterval(waitForConnection);
        if (ws?.readyState !== WebSocket.OPEN) {
          console.error('WebSocket failed to connect in time');
          sendResponse({ success: false, error: 'WebSocket connection timeout' });
        }
      }, 3000);
    } else {
      console.log('Sending hostname via WebSocket:', hostname);
      ws.send(hostname);
      sendResponse({ success: true });
    }
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
  } else if (message.action === 'fillWithSelectedAccount') {
    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, {
          action: 'fillFields',
          data: {
            username_email: message.username_email,
            password: message.password,
            preferences: message.preferences
          }
        });
      }
    }).catch(err => console.error('Tab query failed:', err));
    sendResponse({ success: true });
  }
  return true; // Keep the message channel open for async responses
});

browser.runtime.onStartup.addListener(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectWebSocket();
  }
});
