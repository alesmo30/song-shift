# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Run with nodemon (auto-reload)
node index.js      # Run without auto-reload
```

### Prisma

```bash
./node_modules/.bin/prisma generate                          # Regenerate client after schema changes
./node_modules/.bin/prisma migrate dev --name <name>        # Create and apply a migration
./node_modules/.bin/prisma db push                          # Push schema to DB without migration file
```

Always use `./node_modules/.bin/prisma` directly — `npx prisma` hangs in this project due to the RTK proxy.

## Architecture

**Entry point**: `index.js` loads `dotenv/config` first, creates an HTTP server from `server.js`, and registers global error handlers.

**Request flow**: `index.js` → `server.js` → routers → middlewares → services → `lib/prisma.js`

### Key design decisions

**Authentication**: JWT-based via Passport. `utils/passport/passport.js` defines a `jwt` `JwtStrategy` (bearer token, verified against `JWT_ACCESS_TOKEN_SECRET`, looks up the user by email via Prisma). `server.js` registers it with `passport.initialize()` at startup. `middlewares/auth.js` wraps `passport.authenticate('jwt', { session: false }, ...)` in a promise so auth failures are forwarded to the global error handler as an `AuthenticationError`, instead of using Passport's default callback style. Apply it per-route (e.g. `router/user.router.js` puts `auth` before `userSchemaValidation`/handlers on protected routes).

`services/auth/auth.js`'s `login` looks up the user by email, verifies the password with `bcryptjs`, then issues both tokens via `new TokenService(TOKEN_TYPE.BOTH_TOKENS, payload)`. `TokenService` expiry constants (`accessExpiresTime`/`refreshExpiresTime`) are jsonwebtoken-style duration strings (`'1d'`, `'7d'`), not pre-computed timestamps — pass straight to `jwt.sign`'s `expiresIn`. Token secrets are read directly from `process.env` (`JWT_ACCESS_TOKEN_SECRET`, `JWT_REFRESH_TOKEN_SECRET`), not injected via config.

**Prisma 7 + Supabase setup**: The project uses Prisma 7 with `prisma-client-js` generator (not `prisma-client`, which generates TS-only output). The `prisma.config.ts` uses `DIRECT_URL` (session-mode pooler, port 5432) for CLI operations. `lib/prisma.js` uses `DATABASE_URL` (transaction pooler, port 6543) via `@prisma/adapter-pg` — required by Prisma 7's WASM engine. Two env vars are mandatory: `DATABASE_URL` and `DIRECT_URL`.

**Error hierarchy** (`utils/errors.js`): `AppError` is the base class with `statusCode`, `details`, and `isOperational`. Subclasses: `ValidationError` (400), `AuthenticationError` (401), `AuthorizationError` (403). The global `errorHandler` middleware in `server.js` catches all `AppError` instances and formats the response.

**Services**: Stateless functions exported directly (e.g. `services/users/user.js`). The exception is `TokenService` (`services/token/token.service.js`), which is a class because it needs injectable config (token type, secrets) and supports multiple instances with different behavior.

**Validation**: Joi schemas in `middlewares/` validate request bodies before they reach services. `ValidationError` is thrown directly from middleware — the global error handler catches it.

**Logging**: Winston via `utils/logger.js`. Level is `debug` in development, `info` in production. Use `logger.info` / `logger.error` in services, not `console.log`.

### Import order convention

1. External packages (`bcryptjs`, `lodash`, etc.)
2. Internal modules (`../../lib/prisma`, `../../utils/errors`, etc.)
