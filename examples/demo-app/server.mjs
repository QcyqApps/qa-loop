// Demo app for qa-loop: a users list with a status filter.
// It contains deliberate bugs so the tester has something real to find.
// Run: node examples/demo-app/server.mjs  (PORT=4317 by default)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.PORT || 4317);
const SESSION_TTL_MS = 30 * 60 * 1000;
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public');

const ACCOUNTS = {
  admin: { password: 'demo', role: 'admin', store: null, label: 'Administrator' },
  manager: { password: 'demo', role: 'manager', store: 'Warsaw', label: 'Store manager Warsaw' },
};

const USERS = [
  { id: 1, name: 'Anna Kowalska', email: 'anna.kowalska@example.com', store: 'Warsaw', status: 'active' },
  { id: 2, name: 'Piotr Nowak', email: 'piotr.nowak@example.com', store: 'Warsaw', status: 'disabled' },
  { id: 3, name: 'Katarzyna Wiśniewska', email: 'k.wisniewska@example.com', store: 'Warsaw', status: 'active' },
  { id: 4, name: 'Tomasz Wójcik', email: 'tomasz.wojcik@example.com', store: 'Krakow', status: 'active' },
  { id: 5, name: 'Magdalena Kamińska', email: 'm.kaminska@example.com', store: 'Krakow', status: 'disabled' },
  { id: 6, name: 'Michał Lewandowski', email: 'michal.l@example.com', store: 'Gdansk', status: 'active' },
  { id: 7, name: 'Agnieszka Zielińska', email: 'a.zielinska@example.com', store: 'Gdansk', status: 'disabled' },
  { id: 8, name: 'Krzysztof Szymański', email: 'k.szymanski@example.com', store: 'Warsaw', status: 'active' },
  { id: 9, name: 'Ewa Woźniak', email: 'ewa.wozniak@example.com', store: 'Krakow', status: 'active' },
  { id: 10, name: 'Paweł Dąbrowski', email: 'pawel.d@example.com', store: 'Gdansk', status: 'disabled' },
];

const sessions = new Map();

function getSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)demo_session=([^;]+)/);
  if (!match) return null;
  const session = sessions.get(match[1]);
  if (!session || session.expires < Date.now()) return null;
  return session;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

function visibleUsers(session, status) {
  let list = USERS;
  if (status === 'active' || status === 'disabled') list = list.filter((u) => u.status === status);
  // BUG (planted): store scoping is skipped for the "disabled" filter, so a manager
  // sees disabled users from every store.
  if (session.store && status !== 'disabled') list = list.filter((u) => u.store === session.store);
  return list;
}

const loginPage = (error = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sign in — Demo CP</title>
<link rel="stylesheet" href="/style.css"></head>
<body><main class="login">
<h1>Demo CP</h1>
<form method="post" action="/login">
  <label>Username <input name="username" autocomplete="username" required></label>
  <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
  ${error ? `<p class="error" role="alert">${error}</p>` : ''}
  <button type="submit">Sign in</button>
</form>
</main></body></html>`;

const usersPage = (session) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Users — Demo CP</title>
<link rel="stylesheet" href="/style.css"></head>
<body>
<header><strong>Demo CP</strong><span>${session.label}</span><a href="/logout">Log out</a></header>
<main>
  <h1>Users</h1>
  <div class="toolbar">
    <label>Status
      <select id="status" name="status">
        <option value="all">All</option>
        <option value="active">Active</option>
        <option value="disabled">Disabled</option>
      </select>
    </label>
    <span id="count" aria-live="polite"></span>
  </div>
  <table id="users">
    <thead><tr><th>Name</th><th>E-mail</th><th>Store</th><th>Status</th></tr></thead>
    <tbody></tbody>
  </table>
</main>
<script src="/app.js"></script>
</body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const session = getSession(req);

  if (url.pathname === '/style.css' || url.pathname === '/app.js') {
    const type = url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript';
    const file = await readFile(join(PUBLIC_DIR, url.pathname.slice(1)));
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
    return res.end(file);
  }

  if (url.pathname === '/login' && req.method === 'POST') {
    const form = await readBody(req);
    const account = ACCOUNTS[form.get('username')];
    if (!account || account.password !== form.get('password')) {
      return send(res, 401, loginPage('Invalid username or password.'));
    }
    const token = randomUUID();
    sessions.set(token, { ...account, expires: Date.now() + SESSION_TTL_MS });
    return send(res, 302, '', { Location: '/users', 'Set-Cookie': `demo_session=${token}; HttpOnly; Path=/; SameSite=Lax` });
  }

  if (url.pathname === '/login') return send(res, 200, loginPage());

  if (url.pathname === '/logout') {
    return send(res, 302, '', { Location: '/login', 'Set-Cookie': 'demo_session=; Path=/; Max-Age=0' });
  }

  if (url.pathname === '/api/users') {
    if (!session) return sendJson(res, 401, { error: 'unauthorized' });
    const status = url.searchParams.get('status') || 'all';
    if (!['all', 'active', 'disabled'].includes(status)) return sendJson(res, 400, { error: 'invalid status' });
    // The "all" query is slow on purpose; together with the client code this creates a race.
    const delay = status === 'all' ? 900 : 150;
    return setTimeout(() => sendJson(res, 200, { users: visibleUsers(session, status) }), delay);
  }

  if (url.pathname === '/' || url.pathname === '/users') {
    if (!session) return send(res, 302, '', { Location: '/login' });
    if (url.pathname === '/') return send(res, 302, '', { Location: '/users' });
    return send(res, 200, usersPage(session));
  }

  send(res, 404, '<h1>404</h1>');
});

server.listen(PORT, () => {
  console.log(`Demo app: http://localhost:${PORT}  (accounts: admin/demo, manager/demo)`);
});
