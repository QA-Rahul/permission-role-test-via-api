// Demo API under test: role-based access control (RBAC) with token revocation.
// Zero dependencies — runs on plain Node.js so the suite is fully self-contained.
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT ?? 3000);

const PERMISSIONS = {
  admin: ['documents:read', 'documents:create', 'documents:delete', 'users:manage'],
  editor: ['documents:read', 'documents:create'],
  viewer: ['documents:read'],
};

function seed() {
  return {
    users: {
      alice: { username: 'alice', password: 'password123', role: 'admin', email: 'alice@example.com', tokenVersion: 0 },
      bob: { username: 'bob', password: 'password123', role: 'editor', email: 'bob@example.com', tokenVersion: 0 },
      carol: { username: 'carol', password: 'password123', role: 'viewer', email: 'carol@example.com', tokenVersion: 0 },
    },
    tokens: new Map(), // token -> { username, version }
    documents: [
      { id: 1, title: 'Q3 Report', owner: 'alice' },
      { id: 2, title: 'Release Notes', owner: 'bob' },
    ],
    nextId: 3,
    profileCache: new Map(), // keyed PER USER — a shared key would leak data between sessions
  };
}

let db = seed();

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

// Resolves the caller. Role is read LIVE from the user store, and a role change
// bumps tokenVersion, so tokens issued before a permission change are rejected.
function authenticate(req) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer ([a-f0-9]{48})$/);
  if (!match) return { error: 'missing or malformed token' };
  const session = db.tokens.get(match[1]);
  if (!session) return { error: 'invalid token' };
  const user = db.users[session.username];
  if (!user || session.version !== user.tokenVersion) return { error: 'token revoked' };
  return { user };
}

const can = (user, permission) => PERMISSIONS[user.role]?.includes(permission) ?? false;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  if (method === 'GET' && path === '/health') return send(res, 200, { status: 'ok' });

  // Test-only hook so every test starts from a known state.
  if (method === 'POST' && path === '/__test__/reset') {
    db = seed();
    return send(res, 200, { reset: true });
  }

  if (method === 'POST' && path === '/login') {
    const body = await readJson(req);
    const user = body && db.users[body.username];
    if (!user || user.password !== body.password) return send(res, 401, { error: 'invalid credentials' });
    const token = crypto.randomBytes(24).toString('hex');
    db.tokens.set(token, { username: user.username, version: user.tokenVersion });
    return send(res, 200, { token, role: user.role });
  }

  if (!path.startsWith('/api/')) return send(res, 404, { error: 'not found' });

  const { user, error } = authenticate(req);
  if (!user) return send(res, 401, { error });

  // GET /api/profile — personal data: per-user cache + Cache-Control: private
  if (method === 'GET' && path === '/api/profile') {
    const key = `profile:${user.username}`;
    let profile = db.profileCache.get(key);
    if (!profile) {
      profile = { username: user.username, email: user.email };
      db.profileCache.set(key, profile);
    }
    // Simulate variable latency so concurrent requests genuinely interleave.
    await new Promise((r) => setTimeout(r, Math.random() * 15));
    return send(res, 200, { ...profile, role: user.role }, { 'Cache-Control': 'private, no-store' });
  }

  if (path === '/api/documents') {
    if (method === 'GET') {
      if (!can(user, 'documents:read')) return send(res, 403, { error: 'forbidden' });
      return send(res, 200, db.documents);
    }
    if (method === 'POST') {
      if (!can(user, 'documents:create')) return send(res, 403, { error: 'forbidden' });
      const body = await readJson(req);
      if (!body || typeof body.title !== 'string' || !body.title.trim()) return send(res, 400, { error: 'title required' });
      const doc = { id: db.nextId++, title: body.title.trim(), owner: user.username };
      db.documents.push(doc);
      return send(res, 201, doc);
    }
  }

  const docMatch = path.match(/^\/api\/documents\/(\d+)$/);
  if (docMatch && method === 'DELETE') {
    if (!can(user, 'documents:delete')) return send(res, 403, { error: 'forbidden' });
    const idx = db.documents.findIndex((d) => d.id === Number(docMatch[1]));
    if (idx === -1) return send(res, 404, { error: 'not found' });
    db.documents.splice(idx, 1);
    return send(res, 204);
  }

  const userMatch = path.match(/^\/api\/admin\/users\/([a-z]+)(\/role)?$/);
  if (userMatch) {
    if (!can(user, 'users:manage')) return send(res, 403, { error: 'forbidden' });
    const target = db.users[userMatch[1]];
    if (!target) return send(res, 404, { error: 'user not found' });

    if (method === 'GET' && !userMatch[2]) {
      return send(res, 200, { username: target.username, role: target.role });
    }
    if (method === 'PATCH' && userMatch[2]) {
      const body = await readJson(req);
      if (!body || !PERMISSIONS[body.role]) return send(res, 400, { error: 'invalid role' });
      target.role = body.role;
      target.tokenVersion += 1; // revoke every token issued under the old role
      db.profileCache.delete(`profile:${target.username}`);
      return send(res, 200, { username: target.username, role: target.role });
    }
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`Demo API listening on http://localhost:${PORT}`));
