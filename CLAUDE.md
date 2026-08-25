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

The database has no migration history (`prisma/migrations/` does not exist) — the schema was originally applied with `db push`, not `migrate dev`. Running `migrate dev` against it reports schema drift and offers to reset the database. Keep using `db push` for schema changes until a first migration baseline is established.

## Architecture

**Entry point**: `index.js` loads `dotenv/config` first, creates an HTTP server from `server.js`, and registers global error handlers.

**Request flow**: `index.js` → `server.js` → routers → middlewares → services → `lib/prisma.js`

### Key design decisions

**Authentication**: JWT-based via Passport. `utils/passport/passport.js` defines a `jwt` `JwtStrategy` (bearer token, verified against `JWT_ACCESS_TOKEN_SECRET`, looks up the user by email via Prisma). `server.js` registers it with `passport.initialize()` at startup. `middlewares/auth.js` wraps `passport.authenticate('jwt', { session: false }, ...)` in a promise so auth failures are forwarded to the global error handler as an `AuthenticationError`, instead of using Passport's default callback style. Apply it per-route (e.g. `router/user.router.js` puts `auth` before `userSchemaValidation`/handlers on protected routes).

`services/auth/auth.js`'s `login` looks up the user by email, verifies the password with `bcryptjs`, then issues both tokens via `new TokenService(TOKEN_TYPE.BOTH_TOKENS, payload)`. `TokenService` expiry constants (`accessExpiresTime`/`refreshExpiresTime`) are jsonwebtoken-style duration strings (`'1d'`, `'7d'`), not pre-computed timestamps — pass straight to `jwt.sign`'s `expiresIn`. Token secrets are read directly from `process.env` (`JWT_ACCESS_TOKEN_SECRET`, `JWT_REFRESH_TOKEN_SECRET`), not injected via config.

**Prisma 7 + Supabase setup**: The project uses Prisma 7 with `prisma-client-js` generator (not `prisma-client`, which generates TS-only output). The `prisma.config.ts` uses `DIRECT_URL` (session-mode pooler, port 5432) for CLI operations. `lib/prisma.js` uses `DATABASE_URL` (transaction pooler, port 6543) via `@prisma/adapter-pg` — required by Prisma 7's WASM engine. Two env vars are mandatory: `DATABASE_URL` and `DIRECT_URL`.

**Error hierarchy** (`utils/errors.js`): `AppError` is the base class with `statusCode`, `details`, and `isOperational`. Subclasses: `ValidationError` (400), `AuthenticationError` (401), `AuthorizationError` (403), `NotFoundError` (404), `RateLimitError` (429, carries `retryAfter` in `details`), `ExternalServiceError` (502). The global `errorHandler` middleware in `server.js` catches all `AppError` instances and formats the response; for `RateLimitError` it also sets the `Retry-After` response header.

**Services**: Stateless functions exported directly (e.g. `services/users/user.js`). The exception is `TokenService` (`services/token/token.service.js`), which is a class because it needs injectable config (token type, secrets) and supports multiple instances with different behavior.

**Validation**: Joi schemas in `middlewares/` validate request bodies before they reach services. `ValidationError` is thrown directly from middleware — the global error handler catches it.

**Logging**: Winston via `utils/logger.js`. Level is `debug` in development, `info` in production. Use `logger.info` / `logger.error` in services, not `console.log`.

**Spotify OAuth** (`services/spotify/`, `router/spotify.router.js`, spec `specs/02-spotify-oauth.md`): the backend owns the full Authorization Code flow — the frontend never sees a Spotify token. Five new env vars: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` (must be `http://127.0.0.1:3000/spotify/callback` in dev — Spotify rejects `localhost` redirect URIs), `SPOTIFY_TOKEN_ENC_KEY` (32 bytes base64, `openssl rand -base64 32`), and `FRONTEND_URL` (already read by `server.js` for CORS). Both the access and refresh tokens are encrypted at rest via `utils/crypto.js` (AES-256-GCM, format `v1:iv:tag:ct`) before being stored in `SpotifyAccount`; only `services/spotify/spotify.tokens.js` decrypts them.

Before testing the OAuth flow, the Spotify account you authorize with **must** be added under Settings → User Management in the Spotify developer dashboard — the app runs in Development Mode with a 25-user allowlist, and a non-allowlisted user gets an opaque consent-screen error that looks like a code bug.

The `state` query param on `/spotify/callback` is a single-use, 10-minute CSRF token stored in Mongo (`mongo/spotify-oauth-state-schema.js`, TTL index on `expiresAt`) — it is what ties an incoming `code` back to the Totify user who started the flow, since the callback is a bare browser redirect with no `Authorization` header to identify the user otherwise. `GET /spotify/callback` always responds with a 3xx redirect to `FRONTEND_URL` (`?spotify=connected` or `?spotify=error&reason=...`), never JSON — the only exception is a bare 400 when `state` is missing entirely.

**A failed Spotify token refresh (`invalid_grant`, or a second consecutive 401 from `spotifyFetch`) must respond `409` with `{ code: 'SPOTIFY_REAUTH_REQUIRED' }`, never `401`.** The frontend's axios response interceptor (`frontend/src/api/client.ts`) fires `/renew-tokens` on any `401` that isn't `/login` — returning `401` for a dead Spotify grant would trigger a pointless Totify token refresh and a confusing retry loop instead of surfacing a "reconnect Spotify" prompt.

**Spotify playlists** (`services/spotify/spotify.playlists.js`, `services/spotify/playlist.mapper.js`, spec `specs/03-spotify-playlists.md`): three endpoints let the user pick where their imported songs land. `GET /spotify/playlists?limit&offset` lists the user's writable playlists over `GET /v1/me/playlists`, filtered server-side to `owner.id === spotifyUserId` so a followed-but-not-owned playlist never becomes a selectable destination. `POST /spotify/playlists` creates one over `POST /v1/me/playlists` with `public: false` fixed and not configurable from the UI — Spotify's own default is `public: true`, and silently publishing an import target to the user's profile is an unacceptable surprise; note `public: false` means "not on your profile", not "private" — it's still reachable by URL. `PUT /spotify/default-playlist` persists the chosen `defaultPlaylistId` on `SpotifyAccount` (server-side, so it survives logout/device changes); `{ playlistId: null }` clears it. It does **not** validate the id against Spotify — the string is saved as-is, and a since-deleted playlist surfaces as a 404 only when something later tries to write to it. `GET /spotify/status` includes `defaultPlaylistId` alongside the spec 02 fields.

**The February 2026 Spotify API migration** removed the `/users/{id}/...` endpoints (so playlist creation goes through `/v1/me/playlists`, no `spotifyUserId` required) and is renaming a playlist's `tracks` field to `items`. Both are present during the transition, so `toPlaylistDTO` reads `trackCount` defensively: `playlist.items?.total ?? playlist.tracks?.total ?? 0`. All playlist reads go through this one function — if `tracks` disappears, the fix is a one-line change there, not a hunt through every handler that touched a raw Spotify response.

### Import order convention

1. External packages (`bcryptjs`, `lodash`, etc.)
2. Internal modules (`../../lib/prisma`, `../../utils/errors`, etc.)
