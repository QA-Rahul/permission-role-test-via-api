import { test, expect, request as playwrightRequest } from '@playwright/test';
import { USER_BY_ROLE, PASSWORD, bearer, resetState } from './helpers/api';

/**
 * Regression for a classic multi-user bug: a shared cache key on personal data
 * serving User A's profile to User B. Each user gets an ISOLATED request context
 * (separate cookies/storage), then both hammer the endpoint concurrently.
 */
test.describe('Concurrent sessions are isolated', () => {
  test.beforeEach(async ({ request }) => {
    await resetState(request);
  });

  test('two users requesting /api/profile concurrently always get their own data', async ({ baseURL }) => {
    const alice = await playwrightRequest.newContext({ baseURL });
    const bob = await playwrightRequest.newContext({ baseURL });

    try {
      const loginAs = async (ctx: typeof alice, username: string) =>
        (await (await ctx.post('/login', { data: { username, password: PASSWORD } })).json()).token as string;

      const [aliceToken, bobToken] = await Promise.all([
        loginAs(alice, USER_BY_ROLE.admin),
        loginAs(bob, USER_BY_ROLE.editor),
      ]);

      const ROUNDS = 25;
      const calls = Array.from({ length: ROUNDS }, () => [
        alice.get('/api/profile', { headers: bearer(aliceToken) }).then((r) => ({ who: 'alice', r })),
        bob.get('/api/profile', { headers: bearer(bobToken) }).then((r) => ({ who: 'bob', r })),
      ]).flat();

      const results = await Promise.all(calls);

      for (const { who, r } of results) {
        expect(r.status()).toBe(200);
        const body = await r.json();
        expect(body.username, `response for ${who} leaked another user's data`).toBe(who);
        expect(body.email).toBe(`${who}@example.com`);
        expect(r.headers()['cache-control']).toContain('private');
      }
      expect(results).toHaveLength(ROUNDS * 2);
    } finally {
      await alice.dispose();
      await bob.dispose();
    }
  });

  test("one user's role change does not affect another user's active session", async ({ request }) => {
    const login = async (u: string) => (await (await request.post('/login', { data: { username: u, password: PASSWORD } })).json()).token as string;
    const admin = await login(USER_BY_ROLE.admin);
    const carol = await login(USER_BY_ROLE.viewer);

    await request.patch('/api/admin/users/bob/role', { data: { role: 'viewer' }, headers: bearer(admin) });

    const res = await request.get('/api/profile', { headers: bearer(carol) });
    expect(res.status()).toBe(200);
    expect((await res.json()).username).toBe('carol');
  });
});
