import { APIRequestContext, expect } from '@playwright/test';

export type Role = 'admin' | 'editor' | 'viewer';

export const USER_BY_ROLE: Record<Role, string> = {
  admin: 'alice',
  editor: 'bob',
  viewer: 'carol',
};

export const PASSWORD = 'password123';

/** Logs in and returns a FRESH token — never reuse tokens across a permission change. */
export async function login(request: APIRequestContext, username: string, password = PASSWORD): Promise<string> {
  const res = await request.post('/login', { data: { username, password } });
  expect(res.status(), `login as ${username}`).toBe(200);
  const body = await res.json();
  expect(body.token).toMatch(/^[a-f0-9]{48}$/);
  return body.token;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Restores the API to its seed state so every test is independent. */
export async function resetState(request: APIRequestContext): Promise<void> {
  const res = await request.post('/__test__/reset');
  expect(res.ok(), 'reset API state').toBeTruthy();
}
