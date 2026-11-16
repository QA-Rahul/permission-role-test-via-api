# API Permission Tests — Playwright + TypeScript

![CI](https://github.com/<your-username>/api-permission-tests/actions/workflows/playwright.yml/badge.svg)

> **What this suite proves:** every role can do exactly what it is allowed to and nothing more — allowed calls return 2xx, forbidden calls return 403 with no side effects, permission changes take effect immediately (old tokens revoked), and concurrent users never see each other's data.

## Why this exists

UIs lie: a toggle can show "saved" while the backend still enforces the old rule. This suite verifies permissions **at the API layer**, from three angles:

| Angle | Question | How it's tested |
|---|---|---|
| **Stored state** | Did the change save? | Read the role back via `GET /api/admin/users/:name` |
| **Enforcement** | Does the server actually allow/deny? | Call as the affected user with a **fresh token**, assert 2xx **and** 403 |
| **Revocation** | Do stale sessions keep old rights? | Token issued *before* the change must get `401 token revoked` |

## Test coverage (23 tests)

| Spec | What it covers |
|---|---|
| `rbac-matrix.spec.ts` | Data-driven matrix: 3 roles × 4 actions, plus a check that a denied write leaves no side effect |
| `authentication.spec.ts` | 401 vs 403 boundaries: missing, malformed, unknown token, wrong password |
| `permission-change.spec.ts` | Demotion and promotion: read-back → old token revoked → new token enforced; no self-escalation |
| `concurrent-sessions.spec.ts` | Two isolated sessions × 25 concurrent requests: no cross-user data leak, `Cache-Control: private` |

### The tests catch real bugs (mutation-checked)

| Bug injected into the API | Test that fails |
|---|---|
| Profile cache keyed as `"profile"` instead of per user (User B sees User A's data) | `concurrent-sessions › two users … always get their own data` |
| Role change doesn't revoke existing tokens | `permission-change › … old token revoked …` |

## Run it

```bash
npm install
npm test               # starts the demo API automatically and runs all tests
npm run test:report    # open the HTML report
```

No browser install is needed: these are pure API tests that use Playwright's `request` fixture.

## Project structure

```
app/server.mjs                 # Zero-dependency demo API (RBAC + token revocation)
tests/helpers/api.ts           # login(), bearer(), resetState() helpers
tests/*.spec.ts                # Test specs
playwright.config.ts           # webServer auto-start, baseURL, reporters
.github/workflows/playwright.yml  # CI: type-check, run tests, upload HTML report
```

## Design decisions

- **Self-contained target API:** deterministic, so there's no flakiness from shared public sandboxes.
- **`retries: 0`:** permission tests must be deterministic, and a retried pass hides real bugs.
- **State reset before every test:** each test is independent and the order doesn't matter.
- **Always assert both sides:** every "allowed" check has a matching "denied" check, because revokes tend to fail silently.

## Roles

| Role | User | Read docs | Create docs | Delete docs | Manage users |
|---|---|:-:|:-:|:-:|:-:|
| admin | alice | ✅ | ✅ | ✅ | ✅ |
| editor | bob | ✅ | ✅ | ❌ | ❌ |
| viewer | carol | ✅ | ❌ | ❌ | ❌ |
