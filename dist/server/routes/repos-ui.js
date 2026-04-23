const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Repository Polling</title>
  <style>
    * {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 {
      color: #333;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .form-group {
      display: flex;
      gap: 10px;
      margin-bottom: 15px;
    }
    input[type="text"] {
      flex: 1;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }
    button {
      padding: 10px 20px;
      border: none;
      border-radius: 4px;
      font-size: 14px;
      cursor: pointer;
    }
    button.primary {
      background: #28a745;
      color: white;
    }
    button.primary:hover {
      background: #218838;
    }
    button.danger {
      background: #dc3545;
      color: white;
    }
    button.danger:hover {
      background: #c82333;
    }
    button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    .repo-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .repo-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      border-bottom: 1px solid #eee;
    }
    .repo-item:last-child {
      border-bottom: none;
    }
    .repo-info {
      font-family: monospace;
    }
    .repo-date {
      font-size: 12px;
      color: #666;
    }
    .empty-state {
      text-align: center;
      padding: 40px;
      color: #666;
    }
    .error {
      background: #f8d7da;
      color: #721c24;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 15px;
    }
    .success {
      background: #d4edda;
      color: #155724;
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 15px;
    }
    #message {
      display: none;
    }
  </style>
</head>
<body>
  <h1>Repository Polling</h1>

  <div class="card">
    <h2>Add Repository</h2>
    <div id="message"></div>
    <form id="addRepoForm">
      <div class="form-group">
        <input type="text" id="owner" name="owner" placeholder="Owner (e.g., facebook)" required>
        <input type="text" id="repo" name="repo" placeholder="Repository name (e.g., react)" required>
        <button type="submit" class="primary">Add</button>
      </div>
    </form>
  </div>

  <div class="card">
    <h2>Registered Repositories</h2>
    <ul id="repoList" class="repo-list"></ul>
    <div id="emptyState" class="empty-state" style="display: none;">
      No repositories registered yet. Add one above to get started.
    </div>
  </div>

  <script>
    const API_BASE = document.querySelector('[data-api-base]')?.dataset.apiBase || '/repos';

    function showMessage(text, type) {
      const msgEl = document.getElementById('message');
      msgEl.className = type === 'error' ? 'error' : 'success';
      msgEl.textContent = text;
      msgEl.style.display = 'block';
      setTimeout(() => { msgEl.style.display = 'none'; }, 3000);
    }

    async function fetchRepos() {
      try {
        const response = await fetch(API_BASE);
        const data = await response.json();
        renderRepos(data.repos || []);
      } catch (err) {
        showMessage('Failed to load repositories', 'error');
      }
    }

    function renderRepos(repos) {
      const listEl = document.getElementById('repoList');
      const emptyEl = document.getElementById('emptyState');

      if (repos.length === 0) {
        listEl.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
      }

      emptyEl.style.display = 'none';
      listEl.innerHTML = repos.map(repo => {
        const date = new Date(repo.addedAt).toLocaleDateString();
        return '<li class="repo-item">' +
          '<div>' +
            '<span class="repo-info">' + escapeHtml(repo.owner) + ' / ' + escapeHtml(repo.repo) + '</span>' +
            '<div class="repo-date">Added: ' + date + '</div>' +
          '</div>' +
          '<button class="danger" onclick="removeRepo(' + JSON.stringify(repo.owner) + ', ' + JSON.stringify(repo.repo) + ')">Remove</button>' +
        '</li>';
      }).join('');
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    async function removeRepo(owner, repo) {
      if (!confirm('Remove ' + owner + '/' + repo + '?')) return;
      try {
        const response = await fetch(API_BASE + '/' + owner + '/' + repo, { method: 'DELETE' });
        if (response.ok) {
          showMessage('Repository removed', 'success');
          fetchRepos();
        } else {
          const data = await response.json();
          showMessage(data.error || 'Failed to remove repository', 'error');
        }
      } catch (err) {
        showMessage('Failed to remove repository', 'error');
      }
    }

    document.getElementById('addRepoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const owner = document.getElementById('owner').value.trim();
      const repo = document.getElementById('repo').value.trim();

      if (!owner || !repo) {
        showMessage('Owner and repo are required', 'error');
        return;
      }

      try {
        const response = await fetch(API_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ owner, repo })
        });

        if (response.ok) {
          document.getElementById('owner').value = '';
          document.getElementById('repo').value = '';
          showMessage('Repository added successfully', 'success');
          fetchRepos();
        } else {
          const data = await response.json();
          showMessage(data.error || 'Failed to add repository', 'error');
        }
      } catch (err) {
        showMessage('Failed to add repository', 'error');
      }
    });

    // Load repos on page load
    fetchRepos();
  </script>
</body>
</html>`;
export async function reposUIRoute(server, options) {
    const apiBaseUrl = options.apiBaseUrl ?? '/repos';
    server.get('/', async (_request, reply) => {
        reply.header('Content-Type', 'text/html');
        return HTML_PAGE.replace('<body>', `<body data-api-base="${apiBaseUrl}">`);
    });
}
export default reposUIRoute;
