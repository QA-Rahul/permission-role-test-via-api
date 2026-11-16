import { test, expect } from '@playwright/test';
import { USER_BY_ROLE, login, bearer, resetState } from './helpers/api';

/** 401 = "who are you?" — must be distinct from 403 = "you can't do that". */
test.describe('Authentication boundaries (401 vs 403)', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('no token → 401', async ({ request }) => {
    const res = await request.get('/api/documents');
    expect(res.status()).toBe(401);
  });

  test('malformed Authorization header → 401', async ({ request }) => {
    for (const header of ['Bearer', 'Bearer not-a-token', 'Basic YWxpY2U6cGFzc3dvcmQxMjM=', 'token abc']) {
      const res = await request.get('/api/documents', { headers: { Authorization: header } });
      expect(res.status(), `header: "${header}"`).toBe(401);
    }
  });

  test('well-formed but unknown token → 401', async ({ request }) => {
    const res = await request.get('/api/documents', { headers: bearer('a'.repeat(48)) });
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid token' });
  });

  test('wrong password → 401 and no token issued', async ({ request }) => {
    const res = await request.post('/login', { data: { username: USER_BY_ROLE.admin, password: 'wrong' } });
    expect(res.status()).toBe(401);
    expect(await res.json()).not.toHaveProperty('token');
  });

  test('authenticated but unauthorised → 403, not 401', async ({ request }) => {
    const token = await login(request, USER_BY_ROLE.viewer);
    const res = await request.delete('/api/documents/1', { headers: bearer(token) });
    expect(res.status()).toBe(403);
  });
});
