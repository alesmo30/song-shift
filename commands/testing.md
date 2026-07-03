# Running Tests

This project uses **Jest** for unit tests and **Jest + Supertest** for integration tests.

## Commands

```bash
npm test              # run the full suite (unit + integration) once
npm run test:watch    # re-run affected tests on file changes
npm run test:coverage # run the full suite and print a coverage report
```

## Layout

- Unit tests are colocated with the source file: `<name>.spec.js`.
- Integration tests live under `router/` as `<name>.integration.spec.js` and exercise full
  request → response flows through the real Express app via Supertest.
- `jest.config.js` — coverage scope (`middlewares/`, `router/`, `services/`, `utils/`) and the
  90% coverage threshold (branches/functions/lines/statements).
- `jest.setup.js` — sets test env vars (`NODE_ENV=test`, `JWT_ACCESS_TOKEN_SECRET`,
  `JWT_REFRESH_TOKEN_SECRET`) before any module loads.

## Mocking policy

Only real external boundaries are mocked — everything else runs for real:

- `lib/prisma` — mocked everywhere (the only DB/external I/O in the app).
- `jsonwebtoken` — mocked (avoids generating real, sensitive tokens during tests).
- `bcryptjs` — mocked (deliberately CPU-intensive; also produces password hashes).
- `joi`, `lodash`, `passport-jwt` (in integration tests) — run for real.

The suite runs fully offline: no `DATABASE_URL`/`DIRECT_URL` needed, no network calls made.

## Current status

14 test suites / 71 tests, all passing. Coverage: 100% statements/functions/lines, 96% branches
(threshold: 90% across all four metrics).

See `prompts/testing-prompts/unit-integration-tests/` for the original testing prompt and the
plan that produced this suite.
