# Test Suite Plan — Unit + Integration (Jest + Supertest)

## Context

The project (`/Users/alejandro/Documents/Review/Project`) is a compact Express 5 + Prisma 7
backend in CommonJS with **no test suite and no test runner installed** (`supertest` is in
`devDependencies`, but `jest` is not). The prompt `unit-integration-test.md` (in this same
directory) asks for:

- High-quality **unit tests** for all middlewares, routers, services, and utils (≥90% coverage).
- **Integration tests** exercising complete request→response flows via Jest + Supertest.
- **Mocking policy** — run third-party libs that are pure, fast core logic **for real** (`lodash`,
  `joi`); they're already tested by their owners and give faithful coverage. **Mock a third-party
  lib when it meets any of these:** (a) it does real external I/O / has side effects (network, DB);
  (b) it is computationally intensive and would slow the suite; (c) it produces **sensitive data**
  we don't want generated during tests. Applying this:
  - `lib/prisma` (DB / external I/O) → **mocked** everywhere.
  - `jsonwebtoken` (produces real **tokens** — sensitive; unnecessary to generate) → **mocked**.
  - `bcryptjs` (deliberately CPU-**intensive** *and* produces password **hashes**) → **mocked**.
  - `lodash`, `joi` (pure, cheap, non-sensitive) → **real**.
- Naming: unit `<name>.spec.js`, integration `<name>.integration.spec.js`.
- Every test must pass (green) when the full suite runs.

Outcome: a fast, deterministic, offline test suite that documents behavior and guards regressions.

## Code map (what exists / what to mock)

Mocked: `lib/prisma` (DB), `jsonwebtoken` (tokens), `bcryptjs` (intensive + hashes). `passport` is
also stubbed in the `auth` unit test to drive its callback in isolation (the seam under test); the
real passport-jwt runs in integration, but with `jsonwebtoken` mocked so no real tokens are minted.
`logger` may optionally be silenced for clean output but is otherwise real. `lodash`/`joi` run real.

| File | Exports | Real | Mock |
|------|---------|------|------|
| `middlewares/auth.js` | `auth` (default) | — | `passport.authenticate` (unit seam) |
| `middlewares/error.handler.js` | `{ errorHandler }` | logger | — |
| `middlewares/login-schema.validation.js` | `{ loginSchemaValidation }` | joi | — |
| `middlewares/user-schema.validation.js` | `{ userSchemaValidation }` | joi | — |
| `middlewares/role.middleware.js` | `checkRole` (default) | — | — |
| `router/auth.router.js` | `{ authRouter }` | (integration only) | `lib/prisma`, `bcryptjs`, `jsonwebtoken` |
| `router/user.router.js` | `{ userRouter }` | (integration only) | `lib/prisma`, `bcryptjs`, `jsonwebtoken` |
| `services/auth/auth.js` | `{ login }` | real `TokenService` (over mocked jwt) | `lib/prisma`, `bcryptjs`, `jsonwebtoken` |
| `services/users/user.js` | `{ saveUser, getUser }` | lodash | `lib/prisma`, `bcryptjs` |
| `services/token/token.service.js` | `TokenService` (default) | — | `jsonwebtoken` |
| `services/token/const/token.constants.js` | `{ TOKEN_TYPE }` | — | — |
| `utils/errors.js` | `AppError`,`ValidationError`,`AuthenticationError`,`AuthorizationError` | — | — |
| `utils/validation.js` | `{ formatJoiErrors }` | — | — |
| `utils/passport/passport.js` | `{ jwtStrategy }` | passport-jwt | `lib/prisma` (exercise `jwtVerify`) |
| `utils/logger.js` | `logger` | winston (smoke test only) | — |

Note: `lib/prisma.js` constructs a `PrismaPg` adapter at require-time using `DATABASE_URL`.
Every test that transitively requires it **must `jest.mock('../lib/prisma')`** (correct relative
depth per file) so no real DB client is built.

## Approach

### 1. Tooling & config (edits to `package.json`, new files)

- Add `jest` to `devDependencies` (install via `npm i -D jest`). `supertest` already present.
- Add scripts:
  ```json
  "test": "jest",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage"
  ```
- New **`jest.config.js`**:
  - `testEnvironment: 'node'`
  - `setupFiles: ['<rootDir>/jest.setup.js']`
  - `collectCoverageFrom`: `middlewares/**`, `router/**`, `services/**`, `utils/**`
  - `coveragePathIgnorePatterns`: `generated/`, `lib/prisma.js`, `node_modules/`
  - `coverageThreshold.global`: 90 for branches/functions/lines/statements (business-logic scope)
  - `clearMocks: true`
- New **`jest.setup.js`**: set `process.env.JWT_ACCESS_TOKEN_SECRET`, `JWT_REFRESH_TOKEN_SECRET`,
  `NODE_ENV='test'` before modules load (so `TokenService` and passport read stable secrets).

### 2. Unit tests (`<name>.spec.js`, colocated next to source)

Group with `describe` blocks by unit/behavior; cover happy path + every error branch.

- **`utils/errors.spec.js`** — each subclass: message, `statusCode` (500/400/401/403), `details`,
  `isOperational`, `name`, and `instanceof AppError`.
- **`utils/validation.spec.js`** — `formatJoiErrors`: null/undefined/no-details → `{}`; strips
  quotes; joins nested `path` with `.`; multiple details map correctly.
- **`middlewares/error.handler.spec.js`** — `AppError` → correct status+json (with/without
  `details`); non-AppError → 500 + logger.error called; dev vs prod branch on `NODE_ENV`
  (toggle env, add `error`/`stack` only in development). Mock `res` (status/json spies), logger.
- **`middlewares/role.middleware.spec.js`** — no `req.user` → `AuthorizationError` via `next`;
  role not in list → error; role in list → `next()` with no arg.
- **`middlewares/login-schema.validation.spec.js`** & **`user-schema.validation.spec.js`** —
  valid body → `next()` + coerced `req.body` (e.g. role default `USER`); invalid → throws
  `ValidationError` with formatted `details`; boundary cases (email format, min/max lengths).
- **`middlewares/auth.spec.js`** — `jest.mock('passport')`; drive the `verifyCallBack`:
  invoke the passport callback with `(err|info|no user)` → `next(AuthenticationError)`; with a
  user → sets `req.user` and calls `next()` with no arg.
- **`services/token/token.service.spec.js`** — **mock `jsonwebtoken`** (no real tokens generated).
  ACCESS→`generateAccessToken`, REFRESH→`generateRefreshToken`, BOTH→`{accessToken, refreshToken}`,
  invalid type→`AuthenticationError`. Assert `jwt.sign` is called with the payload, the correct
  secret (access vs refresh), and `expiresIn` `'1d'` / `'7d'`; return a stub token string.
- **`services/auth/auth.spec.js`** — mock `lib/prisma`, `bcryptjs`, `jsonwebtoken`; real
  `TokenService` runs over the mocked jwt. Cases: user not found→`next(AuthenticationError)`;
  bad password (`bcrypt.compare` mocked → `false`)→`next(AuthenticationError)`; success
  (`bcrypt.compare` → `true`)→`res.status(200).send({accessToken, refreshToken})` (stub tokens),
  and assert `TokenService` produced tokens with the user payload (`id/email/role`).
- **`services/users/user.spec.js`** — mock `lib/prisma`, `bcryptjs`; real lodash.
  `saveUser`: duplicate email→`next(AppError 400)`; success→asserts `bcrypt.hash` called with the
  plaintext + cost 10, `prisma.create` called with the hashed value and the `select` projection,
  `res.status(201)`. `getUser`: missing id→`AppError 400`; not found→`AppError 404`; found→200.
- **`utils/passport/passport.spec.js`** — mock `lib/prisma`; call the exported strategy's verify
  (or refactor-free: `require` and invoke via `jwtStrategy._verify`)—user found→`done(null,user)`;
  nil→`done(null,false)`; throw→`done(error,false)`.
- **`utils/logger.spec.js`** — smoke: exports a winston logger with `info`/`error` methods
  (keeps file in coverage without asserting winston internals).

### 3. Integration tests (`*.integration.spec.js`)

Import the real `server` (`require('../server')`) with Supertest. Mock the boundaries:
`jest.mock('./lib/prisma')`, `jest.mock('bcryptjs')`, `jest.mock('jsonwebtoken')`. Real passport,
joi, and routing run end-to-end. For login tests, point `bcrypt.compare` at the outcome under test
(`true`/`false`) — no real hashing. For protected routes, set `jwt.verify` (used by passport-jwt)
to decode a stub `Bearer <token>` header to a payload, and set the prisma `findUnique` mock (keyed
on email) to return a user so auth passes; `jwt.sign` returns stub tokens on the login response.
No real tokens or hashes are produced anywhere in the suite.

- **`router/auth.router.integration.spec.js`** — `POST /login`:
  - 400 on missing/invalid body (validation middleware).
  - 401 when prisma returns no user / bcrypt.compare false.
  - 200 with `{ accessToken, refreshToken }` on valid creds.
- **`router/user.router.integration.spec.js`**:
  - `POST /users`: 401 without token; 403 with USER-role token (checkRole ADMIN); 400 invalid
    body; 400 duplicate email; 201 on success (admin token + unique email).
  - `GET /users/:id`: 401 without token; 404 when not found; 200 when found.

Auth flow note: passport `jwtVerify` looks up by **email** via `prisma.user.findUnique`; the same
mock must serve both passport lookups and service lookups — implement with `mockImplementation`
keyed on the query args, or per-test `mockResolvedValueOnce` sequencing.

### 4. Run & verify

```bash
npm i -D jest
npm test                 # all suites green, zero failures
npm run test:coverage    # confirm ≥90% on middlewares/router/services/utils
```
- Verification passes when: full suite exits 0, and the coverage summary shows ≥90% for the
  business-logic scope. Iterate on any uncovered branch until threshold met.
- Confirm no real network/DB: tests run offline with `DATABASE_URL` unset (prisma mocked).

## Files created/modified

- **Modify**: `package.json` (add `jest` devDep + `test*` scripts).
- **New config**: `jest.config.js`, `jest.setup.js`.
- **New unit specs** (12): colocated `*.spec.js` for the files in the code map above.
- **New integration specs** (2): `router/*.integration.spec.js`.

## Assumptions

- Coverage scope = business logic only (`middlewares/`, `router/`, `services/`, `utils/`);
  bootstrap/infra (`index.js`, `server.js` listen, `lib/prisma.js`, `generated/`) excluded from
  the 90% denominator.
- Jest config in a dedicated `jest.config.js` + `jest.setup.js` (not inlined in package.json).
