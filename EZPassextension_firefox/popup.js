document.getElementById('fillNow').addEventListener('click', () => {
  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    const url = tabs[0].url;
    const hostname = url.startsWith('file://') ? 'file' : new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    browser.runtime.sendMessage({ action: 'sendUrl', url: hostname }).then(response => {
      if (!response.success) {
        console.error('Fill request failed:', response.error);
      } else {
        console.log('Fill request sent successfully');
      }
    }).catch(err => console.error('Error sending fill message:', err));
  }).catch(err => console.error('Tab query failed:', err));
});

document.getElementById('saveCredentials').addEventListener('click', () => {
  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    const url = tabs[0].url;
    const hostname = url.startsWith('file://') ? 'file' : new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    browser.tabs.sendMessage(tabs[0].id, { action: 'triggerSave', hostname: hostname });
  }).catch(err => console.error('Tab query failed:', err));
});

document.getElementById('user').addEventListener('dragstart', (e) => {
  e.dataTransfer.setData('text/plain', 'username');
  console.log('Dragging User/Email as username');
});

document.getElementById('password').addEventListener('dragstart', (e) => {
  e.dataTransfer.setData('text/plain', 'password');
  console.log('Dragging Password as password');
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'showAccountSelector') {
    showAccountSelector(message.hostname, message.accounts, message.preferences);
  }
});

function showAccountSelector(hostname, accounts, preferences) {
  const container = document.createElement('div');
  container.id = 'accountSelector';
  container.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: white; border: 1px solid #ccc; border-radius: 4px; padding: 20px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 10000; font-family: Arial, sans-serif;
  `;

  const title = document.createElement('h3');
  title.textContent = `Select an account for ${hostname}`;
  container.appendChild(title);

  const table = document.createElement('table');
  table.style.cssText = 'width: 100%; border-collapse: collapse;';
  const header = document.createElement('tr');
  header.innerHTML = `
    <th style="border: 1px solid #ddd; padding: 8px;">Username</th>
    <th style="border: 1px solid #ddd; padding: 8px;">Action</th>
  `;
  table.appendChild(header);

  accounts.forEach(([password, username_email]) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="border: 1px solid #ddd; padding: 8px;">${username_email}</td>
      <td style="border: 1px solid #ddd; padding: 8px;">
        <button class="select-btn" style="padding: 5px 10px; background: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer;">Fill</button>
      </td>
    `;
    const btn = row.querySelector('.select-btn');
    btn.onclick = () => {
      browser.runtime.sendMessage({
        action: 'fillWithSelectedAccount',
        password: password,
        username_email: username_email,
        preferences: preferences
      });
      container.remove();
    };
    table.appendChild(row);
  });

  container.appendChild(table);
  document.body.appendChild(container);
}
