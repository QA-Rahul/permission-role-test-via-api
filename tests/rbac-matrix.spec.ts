import { test, expect } from '@playwright/test';
import { Role, USER_BY_ROLE, login, bearer, resetState } from './helpers/api';

/**
 * Data-driven permission matrix: every role × every protected action.
 * Each row asserts BOTH sides — what must be allowed and what must be denied.
 */
type Case = {
  action: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  data?: Record<string, unknown>;
  expected: Record<Role, number>;
};

const MATRIX: Case[] = [
  { action: 'list documents', method: 'GET', path: '/api/documents', expected: { admin: 200, editor: 200, viewer: 200 } },
  { action: 'create document', method: 'POST', path: '/api/documents', data: { title: 'Matrix doc' }, expected: { admin: 201, editor: 201, viewer: 403 } },
  { action: 'delete document', method: 'DELETE', path: '/api/documents/1', expected: { admin: 204, editor: 403, viewer: 403 } },
  { action: 'read user role (admin API)', method: 'GET', path: '/api/admin/users/carol', expected: { admin: 200, editor: 403, viewer: 403 } },
];

test.describe('RBAC permission matrix', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  for (const role of Object.keys(USER_BY_ROLE) as Role[]) {
    for (const c of MATRIX) {
      const status = c.expected[role];
      test(`${role} → ${c.action} → ${status}`, async ({ request }) => {
        const token = await login(request, USER_BY_ROLE[role]);
        const res = await request.fetch(c.path, { method: c.method, data: c.data, headers: bearer(token) });
        expect(res.status()).toBe(status);
        if (status === 403) {
          expect(await res.json()).toEqual({ error: 'forbidden' });
        }
      });
    }
  }

  test('denied write has no side effect (403 is enforced, not just reported)', async ({ request }) => {
    const viewer = await login(request, USER_BY_ROLE.viewer);
    const editor = await login(request, USER_BY_ROLE.editor);

    const before = await (await request.get('/api/documents', { headers: bearer(viewer) })).json();

    const createRes = await request.post('/api/documents', { data: { title: 'should not exist' }, headers: bearer(viewer) });
    expect(createRes.status()).toBe(403);
    const deleteRes = await request.delete('/api/documents/1', { headers: bearer(editor) });
    expect(deleteRes.status()).toBe(403);

    const after = await (await request.get('/api/documents', { headers: bearer(viewer) })).json();
    expect(after).toEqual(before);
  });
});
