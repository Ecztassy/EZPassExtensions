function normalizeUrl(url) {
  try {
    if (url.startsWith('file://')) return 'file';
    const { hostname } = new URL(url.startsWith('http') ? url : `http://${url}`);
    return hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    console.error('URL normalization error:', e);
    return url.split('/')[0].toLowerCase();
  }
}

function getEffectiveHostname() {
  const url = window.location.href;
  const hostname = normalizeUrl(url);
  if (!hostname) {
    console.warn(`Hostname is empty for URL: ${url}, defaulting to 'file'`);
    return 'file';
  }
  console.log(`Effective hostname: ${hostname} for URL: ${url}`);
  return hostname;
}

function appendStyles() {
  if (!document.head) return;
  const style = document.createElement('style');
  style.textContent = `
    .ezpass-save-prompt, .ezpass-account-selector {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: white; border: 1px solid #ccc; border-radius: 4px; padding: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 10000; font-family: Arial, sans-serif; text-align: center;
    }
    .ezpass-save-button, .ezpass-account-button {
      padding: 5px 10px; margin: 5px; background: #007bff; color: white; border: none;
      border-radius: 3px; cursor: pointer;
    }
    .ezpass-save-button:hover, .ezpass-account-button:hover { background: #0056b3; }
  `;
  document.head.appendChild(style);
}

function getUniqueSelector(el) {
  if (!(el instanceof HTMLInputElement)) return null;
  if (el.name) return `input[name="${el.name}"]`;
  if (el.id) return `#${el.id}`;
  if (el.type === 'password') return 'input[type="password"]';
  let path = [];
  let current = el;
  while (current && current !== document.body) {
    let selector = current.nodeName.toLowerCase();
    if (current.className) selector += '.' + Array.from(current.classList).join('.').replace(/\s+/g, '.');
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(' > ');
}

function showAccountSelector(data) {
  const existingPrompt = document.querySelector('.ezpass-account-selector');
  if (existingPrompt) existingPrompt.remove();

  const prompt = document.createElement('div');
  prompt.className = 'ezpass-account-selector';
  prompt.innerHTML = '<p>Select an account:</p>';
  data.multiple_accounts.forEach(([password, username_email], index) => {
    const button = document.createElement('button');
    button.className = 'ezpass-account-button';
    button.textContent = username_email || `Account ${index + 1}`;
    button.onclick = () => {
      fillFields({ ...data, password, username_email, multiple_accounts: null });
      prompt.remove();
    };
    prompt.appendChild(button);
  });
  document.body.appendChild(prompt);
}

function fillFields(data) {
  const hostname = getEffectiveHostname();
  console.log('Fill data received:', JSON.stringify(data, null, 2));

  if (!data || !data.preferences || data.preferences.length === 0 || (!data.username_email && !data.password)) {
    console.warn('No valid credentials or preferences to fill for hostname:', hostname, 'Data:', data);
    return;
  }

  if (data.multiple_accounts && data.multiple_accounts.length > 0) {
    showAccountSelector(data);
    return;
  }

  data.preferences.forEach(pref => {
    const field = document.querySelector(pref.selector);
    if (field) {
      if (pref.role === 'Username' && data.username_email && data.username_email !== 'User/Email') {
        field.value = data.username_email;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        console.log(`Filled ${pref.role} in ${pref.selector} with ${data.username_email}`);
      } else if (pref.role === 'Password' && data.password && data.password !== 'Password') {
        field.value = data.password;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        console.log(`Filled ${pref.role} in ${pref.selector} with ${data.password}`);
      }
    } else {
      console.warn(`Field not found for selector: ${pref.selector} on hostname: ${hostname}`);
    }
  });
}

function sendMessageToBackground(message) {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.id) {
      reject(new Error('Extension context invalidated'));
      return;
    }
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function showSavePrompt(hostname) {
  const existingPrompt = document.querySelector('.ezpass-save-prompt');
  if (existingPrompt) existingPrompt.remove();

  const fields = await getMappedFields();
  if (!fields.usernameField || !fields.passwordField) {
    console.log('No mapped fields found for', hostname, '- save prompt aborted.');
    return;
  }

  const prompt = document.createElement('div');
  prompt.className = 'ezpass-save-prompt';
  prompt.innerHTML = `
    <p>Save password for ${hostname}?</p>
    <button id="saveYes" class="ezpass-save-button">Yes</button>
    <button id="saveNo" class="ezpass-save-button">No</button>
  `;
  document.body.appendChild(prompt);

  let isSaving = false;
  document.getElementById('saveYes').onclick = async () => {
    if (isSaving) return;
    isSaving = true;
    try {
      const currentHostname = getEffectiveHostname();
      if (currentHostname !== hostname) {
        console.warn(`Hostname mismatch: mapped on ${hostname}, but currently on ${currentHostname}`);
        alert('Please save credentials on the same page where fields were mapped.');
        prompt.remove();
        return;
      }

      const username = fields.usernameField.value;
      const password = fields.passwordField.value;
      const usernameSelector = getUniqueSelector(fields.usernameField);
      const passwordSelector = getUniqueSelector(fields.passwordField);
      if (username && password && usernameSelector && passwordSelector) {
        const saveResponse = await sendMessageToBackground({
          action: 'savePasswordViaWebSocket',
          hostname: hostname,
          username: username,
          password: password,
          usernameSelector: usernameSelector,
          passwordSelector: passwordSelector
        });
        console.log(`Credentials saved for ${hostname}:`, saveResponse);
        triggerFill();
      } else {
        alert('Please enter both username and password.');
      }
    } catch (error) {
      console.error('Error saving credentials:', error);
      alert('Failed to save credentials. Check console for details.');
    } finally {
      isSaving = false;
      prompt.remove();
    }
  };

  document.getElementById('saveNo').onclick = () => prompt.remove();
}

function getMappedFields() {
  return new Promise((resolve) => {
    const hostname = getEffectiveHostname();
    if (!chrome.runtime?.id) {
      resolve({ usernameField: null, passwordField: null });
      return;
    }
    chrome.storage.local.get(['fieldMappings'], (result) => {
      const mappings = result.fieldMappings || {};
      if (mappings[hostname]) {
        const usernameField = document.querySelector(mappings[hostname].usernameSelector);
        const passwordField = document.querySelector(mappings[hostname].passwordSelector);
        resolve({ usernameField, passwordField });
      } else {
        resolve({ usernameField: null, passwordField: null });
      }
    });
  });
}

function setupDragAndDrop() {
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const role = e.dataTransfer.getData('text/plain');
    let target = e.target;
    while (target && !(target instanceof HTMLInputElement) && target !== document.body) {
      target = target.parentElement;
    }
    if (target && target instanceof HTMLInputElement) {
      const selector = getUniqueSelector(target);
      if (!selector) return;
      const hostname = getEffectiveHostname();
      if (!chrome.runtime?.id) return;
      chrome.storage.local.get(['fieldMappings'], (result) => {
        const mappings = result.fieldMappings || {};
        mappings[hostname] = mappings[hostname] || {};
        if (role === 'username' || role === 'password') {
          const mappedRole = role === 'username' ? 'Username' : 'Password';
          mappings[hostname][role === 'username' ? 'usernameSelector' : 'passwordSelector'] = selector;
          chrome.storage.local.set({ fieldMappings: mappings }, () => {
            chrome.runtime.sendMessage({
              action: 'savePreference',
              hostname: hostname,
              selector: selector,
              role: mappedRole
            });
          });
        }
      });
    }
  });
}

function monitorFormSubmission() {
  const forms = document.querySelectorAll('form');
  forms.forEach(form => {
    form.addEventListener('submit', async () => {
      const hostname = getEffectiveHostname();
      const fields = await getMappedFields();
      if (fields.usernameField && fields.passwordField) {
        showSavePrompt(hostname);
      }
    }, { once: true });
  });
}

let listenerAdded = false;
function setupMessageListener() {
  if (listenerAdded || !chrome.runtime?.id) return;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!chrome.runtime?.id) return;
    if (message.action === 'fillFields') {
      fillFields(message.data);
    } else if (message.action === 'triggerSave') {
      showSavePrompt(message.hostname);
    }
    sendResponse({ received: true });
  });
  listenerAdded = true;
}

function triggerFill() {
  const hostname = getEffectiveHostname();
  console.log('Triggering fill request for:', hostname);
  sendMessageToBackground({ action: 'sendUrl', url: hostname })
    .then(response => {
      if (!response.success) {
        console.error('Fill request failed:', response.error);
      }
    })
    .catch(err => console.error('Fill failed:', err));
}

function monitorUrlChanges() {
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      triggerFill();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', () => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      triggerFill();
    }
  });
}

function initialize() {
  if (!chrome.runtime?.id) {
    console.error('Extension context invalidated on initialization.');
    return;
  }
  appendStyles();
  setupDragAndDrop();
  monitorFormSubmission();
  setupMessageListener();
  monitorUrlChanges();
  triggerFill(); // Autofill on load
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initialize();
} else {
  window.addEventListener('load', initialize, { once: true });
}
