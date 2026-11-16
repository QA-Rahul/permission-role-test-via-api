import { test, expect } from '@playwright/test';
import { USER_BY_ROLE, login, bearer, resetState } from './helpers/api';

/**
 * Proves a permission change ACTUALLY takes effect — verified three ways:
 * stored state (read-back), enforcement (fresh token), and revocation (old token).
 */
test.describe('Permission change takes effect', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('demoting editor → viewer: read-back, old token revoked, new token enforced', async ({ request }) => {
    const admin = await login(request, USER_BY_ROLE.admin);
    const bobOldToken = await login(request, USER_BY_ROLE.editor);

    await test.step('baseline: editor can create', async () => {
      const res = await request.post('/api/documents', { data: { title: 'before demotion' }, headers: bearer(bobOldToken) });
      expect(res.status()).toBe(201);
    });

    await test.step('admin demotes bob to viewer', async () => {
      const res = await request.patch('/api/admin/users/bob/role', { data: { role: 'viewer' }, headers: bearer(admin) });
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ username: 'bob', role: 'viewer' });
    });

    await test.step('1. stored state: read the role back from the API, not the UI', async () => {
      const res = await request.get('/api/admin/users/bob', { headers: bearer(admin) });
      expect(await res.json()).toEqual({ username: 'bob', role: 'viewer' });
    });

    await test.step('2. revocation: token issued before the change is rejected', async () => {
      const res = await request.post('/api/documents', { data: { title: 'stale token' }, headers: bearer(bobOldToken) });
      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual({ error: 'token revoked' });
    });

    await test.step('3. enforcement: fresh token gets viewer rights only', async () => {
      const bobNewToken = await login(request, USER_BY_ROLE.editor);
      const read = await request.get('/api/documents', { headers: bearer(bobNewToken) });
      expect(read.status()).toBe(200);
      const write = await request.post('/api/documents', { data: { title: 'after demotion' }, headers: bearer(bobNewToken) });
      expect(write.status()).toBe(403);
      const profile = await request.get('/api/profile', { headers: bearer(bobNewToken) });
      expect((await profile.json()).role).toBe('viewer');
    });
  });

  test('promoting viewer → admin grants new rights with a fresh token', async ({ request }) => {
    const admin = await login(request, USER_BY_ROLE.admin);
    const carolBefore = await login(request, USER_BY_ROLE.viewer);
    expect((await request.delete('/api/documents/2', { headers: bearer(carolBefore) })).status()).toBe(403);

    const promote = await request.patch('/api/admin/users/carol/role', { data: { role: 'admin' }, headers: bearer(admin) });
    expect(promote.status()).toBe(200);

    const carolAfter = await login(request, USER_BY_ROLE.viewer);
    expect((await request.delete('/api/documents/2', { headers: bearer(carolAfter) })).status()).toBe(204);
  });

  test('a non-admin cannot change roles — including their own', async ({ request }) => {
    const bob = await login(request, USER_BY_ROLE.editor);
    const res = await request.patch('/api/admin/users/bob/role', { data: { role: 'admin' }, headers: bearer(bob) });
    expect(res.status()).toBe(403);

    const admin = await login(request, USER_BY_ROLE.admin);
    const check = await request.get('/api/admin/users/bob', { headers: bearer(admin) });
    expect((await check.json()).role).toBe('editor');
  });
});
