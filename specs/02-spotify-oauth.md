# 02 — OAuth de Spotify en el backend

**Estado:** Aprobado
**Depende de:** `backend/specs/01-extraccion-canciones-screenshot.md` (Draft)
**Fecha:** 2026-08-24

**Objetivo:** Permitir que un usuario autenticado de Totify conecte su cuenta de Spotify mediante Authorization Code, dejando los tokens cifrados y renovables en el backend, sin que el frontend llegue a verlos nunca.

## Context

El backend hoy no tiene nada de Spotify: ni rutas, ni servicios, ni variables de entorno, ni columnas en `prisma/schema.prisma`. La spec 01 dejó `POST /songs/playlist` como stub en `services/playlist/playlist.js`, devolviendo `202 { status: 'not-implemented' }`, y anotó que una spec posterior rellenaría el cuerpo. Esta es el primer tramo de esa spec posterior: sin una cuenta de Spotify conectada no hay a dónde mandar nada.

En el frontend, el banner de Landing (`frontend/src/pages/Landing/Landing.tsx:106-113`) es un toggle visual que invierte un booleano de Redux y llama a un `console.log`. Las specs 01 y 02 del frontend dejaron la integración real fuera de alcance de forma explícita.

La decisión de fondo, tomada antes de escribir esta spec, es que **el backend es dueño del OAuth**. El `client_secret` no puede vivir en un bundle de Vite, y con un backend ya en pie el flujo Authorization Code clásico es el camino correcto. El frontend nunca ve un token de Spotify.

Esta spec cubre solo conectar, consultar y desconectar. No habla con playlists ni con búsqueda.

## Scope

**Incluido:**

- Alta manual de la app en el dashboard de Spotify: credenciales, redirect URI `http://127.0.0.1:3000/spotify/callback` y lista blanca de usuarios (paso 0 del plan).
- Modelo `SpotifyAccount` en Prisma, 1:1 con `User`, con `onDelete: Cascade`.
- Colección Mongo `SpotifyOAuthState` con índice TTL para el parámetro `state` anti-CSRF, de un solo uso.
- `utils/crypto.js`: AES-256-GCM sobre `SPOTIFY_TOKEN_ENC_KEY`, formato `v1:iv:tag:ct`. Cifra access token y refresh token.
- `services/spotify/spotify.tokens.js`: leer, descifrar, persistir y renovar los tokens de un usuario.
- `services/spotify/spotify.client.js`: wrapper HTTP sobre la Web API con refresh proactivo, un reintento tras 401, backoff honrando `Retry-After` en 429 y un reintento en 5xx.
- Cuatro endpoints en `router/spotify.router.js`: `POST /spotify/auth-url`, `GET /spotify/callback`, `GET /spotify/status`, `DELETE /spotify/connection`.
- Los cinco scopes: `playlist-read-private`, `playlist-modify-private`, `playlist-modify-public`, `user-read-private`, `user-read-email`.
- `needsReconnect` en dos casos: refresh rechazado con `invalid_grant`, y scopes guardados que no cubren el set requerido actual.
- Tres subclases nuevas en `utils/errors.js`: `NotFoundError` (404), `RateLimitError` (429) y `ExternalServiceError` (502).
- Cabecera `Retry-After` en la respuesta de `RateLimitError`, añadida en `middlewares/error.handler.js`.
- Validación Joi del body de `POST /spotify/auth-url` en `middlewares/spotify-schema.validation.js`.
- Tests de Jest en cada paso, manteniendo el umbral global del 90 % de `jest.config.js`.
- `.env.example` con las claves nuevas vacías.

**NO incluido (specs futuras):**

- **Cualquier cambio en `frontend/`.** El banner de Landing sigue siendo un toggle local que miente hasta la spec 05 del frontend.
- Rellenar el stub `services/playlist/playlist.js` de la spec 01 con el alta real de tracks → `backend/specs/04`.
- Endpoints de playlists: listar, crear y leer tracks → `backend/specs/03`.
- Matching de tracks, scorer puro y búsqueda libre → `backend/specs/03`.
- Conexión y desconexión desde la UI, ruta `/spotify/callback` en la SPA y estado derivado del servidor → `frontend/specs/05`.
- Selector de playlist destino y UI de revisión de matches → `frontend/specs/06`.
- Caché de resultados de búsqueda. No sirve de nada hasta que exista matching.
- Job de limpieza de documentos de `SpotifyOAuthState`. El índice TTL de Mongo lo cubre.
- Rotación de `SPOTIFY_TOKEN_ENC_KEY`. El prefijo `v1:` deja la puerta abierta, pero el procedimiento no se escribe aquí.
- Solicitud de ampliación de cuota a Spotify. La app se queda en Development Mode con el tope de 25 usuarios.
- Revocación del grant del lado de Spotify. No existe endpoint; `DELETE /spotify/connection` solo borra la fila local.
- Refresh concurrente entre varias instancias del backend. La protección anti-estampida es en proceso.

## Modelo de datos

### `SpotifyAccount` — Prisma (`prisma/schema.prisma`)

Relación 1:1 con `User`. Borrar el usuario borra su conexión.

```prisma
model SpotifyAccount {
  id                   String    @id @default(uuid())
  userId               String    @unique
  user                 User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  spotifyUserId        String
  displayName          String?
  email                String?
  country              String?
  product              String?

  accessTokenEnc       String
  refreshTokenEnc      String
  accessTokenExpiresAt DateTime
  scopes               String
  needsReconnect       Boolean   @default(false)

  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  @@index([spotifyUserId])
}
```

Más la relación inversa en `User`: `spotifyAccount SpotifyAccount?`.

Convenciones:

- `scopes` guarda los scopes **concedidos**, separados por espacio, tal cual los devuelve Spotify. No los solicitados: el usuario puede conceder menos.
- `accessTokenExpiresAt` se calcula como `now + expires_in - 60s`. El margen de 60 s evita usar un token que caduca en vuelo.
- `country` alimenta el parámetro `market` de `/v1/search` en la spec 03. Se guarda aquí porque viene gratis en `GET /v1/me`.
- `displayName`, `email`, `country` y `product` son opcionales: Spotify los omite según los scopes concedidos.
- `needsReconnect` lo escribe solo `spotify.tokens.js`. Ningún handler lo escribe directamente.

### `SpotifyOAuthState` — Mongo (`mongo/spotify-oauth-state-schema.js`)

Vive en Mongo, junto al `Token` existente, y no en Postgres, para aprovechar el índice TTL.

```js
{
  state: String,        // 32 bytes aleatorios en base64url, único
  user: String,         // id del usuario de Totify, mismo tipo que en token-schema
  redirectPath: String, // default '/', debe empezar por '/'
  expiresAt: Date,      // índice TTL: expireAfterSeconds 0
  consumedAt: Date,     // null hasta que se usa
  createdAt: Date
}
```

Convenciones:

- Índice TTL sobre `expiresAt` con `expireAfterSeconds: 0`. Mongo borra el documento solo al pasar la fecha.
- `expiresAt` se fija a `now + 10 min` al crear el state.
- Un state es de **un solo uso**: el callback escribe `consumedAt` antes de intercambiar el `code`. Un segundo intento con el mismo state se rechaza aunque no haya expirado.
- El barrido del TTL no es inmediato (Mongo lo corre cada ~60 s), así que la comprobación de `expiresAt` en código es obligatoria, no decorativa.
- El campo se llama `user` y es `String`, igual que en `mongo/token-schema.js`. Los ids viven en Postgres como `uuid`, así que Mongo los guarda como string, no como `ObjectId`.

### Formato de token cifrado (`utils/crypto.js`)

AES-256-GCM. Las columnas `accessTokenEnc` y `refreshTokenEnc` guardan una única cadena:

```
v1:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>
```

- `v1` es el identificador de clave. Existe desde el día uno para que rotar la clave sea descifrar-con-vieja y recifrar-con-nueva, en vez de forzar reconexión a todos.
- IV aleatorio de 12 bytes por operación. Nunca reutilizado.
- Clave: `SPOTIFY_TOKEN_ENC_KEY`, 32 bytes en base64.
- Solo `services/spotify/spotify.tokens.js` toca estas columnas. Ningún otro módulo importa `crypto.js` para leerlas.

### Respuesta de `GET /spotify/status`

```js
{
  connected: Boolean,
  spotifyUserId: String | null,
  displayName: String | null,
  email: String | null,
  country: String | null,
  scopes: [String],
  connectedAt: String | null,   // ISO 8601
  needsReconnect: Boolean
}
```

No llama a Spotify. Lee la fila y responde.

### Variables de entorno nuevas (`.env` y `.env.example`)

```
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_REDIRECT_URI      # http://127.0.0.1:3000/spotify/callback
SPOTIFY_TOKEN_ENC_KEY     # 32 bytes base64: openssl rand -base64 32
FRONTEND_URL              # http://localhost:5173, ya lo lee server.js
```

`FRONTEND_URL` ya se consume en `server.js:18` para CORS pero no está definida en `.env`; esta spec la formaliza porque el callback la necesita para el 302.

## Plan de implementación

Cada paso deja el backend arrancable y con `npm test` en verde. El umbral del 90 % de `jest.config.js` se mantiene en todo momento: ningún paso añade código de producción sin su `*.spec.js`.

0. **Alta manual en Spotify.** Crear la app en developer.spotify.com/dashboard con API "Web API", registrar la redirect URI `http://127.0.0.1:3000/spotify/callback` (pulsar Add y Save), copiar Client ID y Client Secret, y darse de alta en Settings → User Management con el email exacto de la cuenta de Spotify. Detalle paso a paso en `frontend/docs/spotify-integration-plan.md` §1.1–1.8. Verificación manual: el curl de Client Credentials de §1.7 devuelve un `access_token`. Sin commit.

1. **Variables de entorno.** Añadir las cinco claves a `.env` y crear `.env.example` con las mismas vacías. Generar `SPOTIFY_TOKEN_ENC_KEY` con `openssl rand -base64 32`. Verificación: `node -e "require('dotenv/config'); console.log(!!process.env.SPOTIFY_CLIENT_ID)"` imprime `true`.

2. **`utils/crypto.js`.** `encrypt(plaintext)` y `decrypt(payload)` con AES-256-GCM, IV de 12 bytes aleatorio, salida `v1:iv:tag:ct`. Lanza `AppError` si el prefijo de versión es desconocido o el authTag no valida. Tests: ida y vuelta, IV distinto en dos cifrados del mismo texto, ciphertext manipulado lanza, prefijo desconocido lanza.

3. **Errores nuevos.** Añadir `NotFoundError` (404), `RateLimitError` (429, con `retryAfter` en `details`) y `ExternalServiceError` (502) a `utils/errors.js`, siguiendo el patrón de las subclases existentes. En `middlewares/error.handler.js`, poner la cabecera `Retry-After` cuando el error sea `RateLimitError`. Tests: cada subclase con su `statusCode` y `name`, y el handler emitiendo la cabecera.

4. **Modelo `SpotifyAccount`.** Añadir el modelo y la relación inversa en `User`. Migrar con `./node_modules/.bin/prisma migrate dev --name add_spotify_account` y regenerar con `./node_modules/.bin/prisma generate`. Verificación: la tabla existe en Supabase y `prisma.spotifyAccount` está en el cliente generado.

5. **Colección de states.** Crear `mongo/spotify-oauth-state-schema.js` con el índice TTL sobre `expiresAt` (`expireAfterSeconds: 0`) y `state` único. Tests: creación, unicidad de `state`, y que `consumedAt` arranca nulo.

6. **Constantes.** `services/spotify/const/spotify.constants.js` con los cinco scopes, las URLs base de `accounts.spotify.com` y `api.spotify.com`, el TTL de 10 minutos del state y el margen de 60 s de expiración. Sin lógica.

7. **`services/spotify/spotify.tokens.js`.** Funciones puras sobre la fila: `saveTokens`, `getDecryptedTokens`, `refreshAccessToken` y `hasRequiredScopes`. `refreshAccessToken` llama a `POST /api/token` con `grant_type=refresh_token` y Basic auth, conserva el refresh token viejo si Spotify no devuelve uno nuevo, y ante `invalid_grant` marca `needsReconnect: true`. Caché de promesa por usuario para evitar la estampida de refresh concurrente. Tests con `jest.spyOn(global, 'fetch')`: refresh normal, refresh sin `refresh_token` en la respuesta, `invalid_grant`, y dos llamadas concurrentes disparando un solo fetch.

8. **`services/spotify/spotify.client.js`.** `spotifyFetch(userId, path, options)`: refresca antes de llamar si el token está vencido, adjunta el bearer, reintenta una vez tras 401, respeta `Retry-After` en 429 con máximo dos intentos y lanza `RateLimitError` al agotarlos, reintenta una vez en 5xx y lanza `ExternalServiceError`. Nunca loguea tokens ni `code`. Tests: camino feliz, 401 que se recupera, 401 doble que no entra en bucle, 429 con reintento, 429 agotado, 5xx.

9. **Validación Joi.** `middlewares/spotify-schema.validation.js` con el esquema de `POST /spotify/auth-url`: `redirectPath` opcional, string, que empiece por `/` y no por `//` (guard de open-redirect). Tests: válido, ausente, `//evil.com` rechazado, URL absoluta rechazada.

10. **Router montado y `POST /spotify/auth-url`.** Crear `router/spotify.router.js` y `services/spotify/spotify.auth.js` con el handler `startOAuth`: genera 32 bytes en base64url, guarda el state con `expiresAt` a 10 minutos y devuelve `{ authorizeUrl, state, expiresAt }`. Montar `spotifyRouter` en `server.js` entre `userRouter` y `errorHandler`. Tests de integración con supertest, al estilo de `router/auth.router.integration.spec.js`: sin JWT da 401, con JWT devuelve una URL con los cinco scopes y el `redirect_uri` correcto.

11. **`GET /spotify/callback`.** Handler `oauthCallback`, sin `auth`. Resuelve el usuario desde el state, rechaza state desconocido, expirado o ya consumido, marca `consumedAt`, intercambia el `code` en `POST /api/token` con Basic auth, llama a `GET /v1/me`, hace `upsert` de `SpotifyAccount` con ambos tokens cifrados, y responde siempre con un 302 a `FRONTEND_URL`. Los errores son `302 …?spotify=error&reason=<reason>`, nunca JSON. Tests: éxito, `?error=access_denied`, state inválido, state reusado, fallo del intercambio, y que ni `code` ni tokens aparecen en la URL de destino.

12. **`GET /spotify/status` y `DELETE /spotify/connection`.** `getStatus` lee la fila sin llamar a Spotify y calcula `needsReconnect` como el flag persistido o la falta de scopes requeridos. `disconnect` borra la fila y devuelve 204. Tests: sin conexión devuelve `connected: false`, con conexión devuelve el perfil, scopes insuficientes fuerzan `needsReconnect: true`, y desconectar deja `connected: false`.

13. **Documentar en `CLAUDE.md`.** Añadir la sección de Spotify: variables de entorno, el paso obligatorio de lista blanca, y la regla de que un fallo de auth de Spotify responde 409 y no 401. Verificación: un lector nuevo puede montar el flujo sin abrir la spec.

## Criterios de aceptación

### Conexión

- [ ] `POST /spotify/auth-url` sin JWT responde 401.
- [ ] `POST /spotify/auth-url` con JWT válido responde 200 con `authorizeUrl`, `state` y `expiresAt`.
- [ ] La `authorizeUrl` contiene los cinco scopes, `response_type=code` y un `redirect_uri` idéntico a `SPOTIFY_REDIRECT_URI`.
- [ ] `POST /spotify/auth-url` con `redirectPath: "//evil.com"` responde 400.
- [ ] Abrir la `authorizeUrl` en el navegador muestra la pantalla de consentimiento de Spotify.
- [ ] Aprobar el consentimiento termina en un 302 a `http://localhost:5173/?spotify=connected`.
- [ ] Tras aprobar, existe exactamente una fila en `SpotifyAccount` para ese usuario.

### Seguridad

- [ ] `accessTokenEnc` y `refreshTokenEnc` en la base empiezan por `v1:` y no contienen el token en claro.
- [ ] Descifrar `accessTokenEnc` devuelve un token que Spotify acepta en `GET /v1/me`.
- [ ] Cifrar el mismo texto dos veces produce dos ciphertext distintos.
- [ ] Un `state` ya consumido reintentado responde con 302 y `reason=state_reused`.
- [ ] Un `state` inexistente responde con 302 y `reason=invalid_state`.
- [ ] Un `state` con `expiresAt` en el pasado responde con 302 y `reason=state_expired`.
- [ ] La URL de destino del 302 no contiene `code`, ni access token, ni refresh token, en ningún caso de éxito o error.
- [ ] Los logs de Winston tras un flujo completo no contienen ningún `code` ni token.
- [ ] `GET /spotify/callback` sin parámetro `state` responde 400.

### Tokens

- [ ] Con `accessTokenExpiresAt` puesto a mano en el pasado, la siguiente llamada refresca el token sin error visible.
- [ ] Tras ese refresco, `accessTokenExpiresAt` es posterior a `now`.
- [ ] Si Spotify no devuelve `refresh_token` en el refresco, `refreshTokenEnc` conserva su valor anterior.
- [ ] Un refresco que devuelve `invalid_grant` deja `needsReconnect: true` en la fila.
- [ ] Dos llamadas concurrentes con el token vencido disparan una sola petición a `accounts.spotify.com`.

### Estado y desconexión

- [ ] `GET /spotify/status` sin conexión responde `connected: false` y el resto de campos a `null`.
- [ ] `GET /spotify/status` con conexión responde `connected: true`, `displayName` y `country` poblados.
- [ ] `GET /spotify/status` no realiza ninguna petición a `api.spotify.com`.
- [ ] Con `scopes` guardados que no cubren los cinco requeridos, `needsReconnect` es `true`.
- [ ] `DELETE /spotify/connection` responde 204 y deja `GET /spotify/status` en `connected: false`.
- [ ] Tras revocar Totify en spotify.com/account/apps, la siguiente llamada deja `needsReconnect: true` y **no** responde 401.

### Errores de la Web API

- [ ] Un 429 de Spotify con `Retry-After: 1` se reintenta y termina en éxito.
- [ ] Un 429 sostenido tras dos reintentos responde 429 con la cabecera `Retry-After`.
- [ ] Un 401 de Spotify se recupera con un refresco y un reintento.
- [ ] Un segundo 401 tras el reintento no entra en bucle y responde 409 con `code: 'SPOTIFY_REAUTH_REQUIRED'`.
- [ ] Un 5xx de Spotify tras un reintento responde 502.

### Proyecto

- [ ] `npm test` pasa en `backend/`.
- [ ] La cobertura global sigue en 90 % o más en branches, functions, lines y statements.
- [ ] `npm start` arranca sin warnings nuevos.
- [ ] `git status` en `frontend/` no muestra cambios nuevos: esta spec no toca el frontend.
- [ ] Las 14 baselines de Playwright del frontend siguen pasando sin regenerarse.
- [ ] `.env.example` existe y lista las cinco claves nuevas vacías.

## Decisiones tomadas y descartadas

- **El backend es dueño del OAuth, no el frontend**: el `client_secret` no puede vivir en un bundle de Vite, así que el flujo Authorization Code clásico exige un servidor. Como ya existe uno, se usa. Descartado Authorization Code con PKCE en el navegador: no necesita secret y habría evitado tocar el backend, pero deja el token de Spotify en memoria o `sessionStorage` del cliente, expuesto al mismo XSS que la spec 03 del frontend ya asumió para el JWT — y ahí el radio de explosión pasa a incluir la biblioteca de Spotify del usuario. Con el backend de por medio, un XSS da acceso a tu API, no a Spotify directamente.

- **Un fallo de auth de Spotify responde 409, no 401**: el interceptor de respuesta del frontend (`frontend/src/api/client.ts:46`) dispara `/renew-tokens` ante cualquier 401 que no sea de `/login`. Devolver 401 cuando lo que caducó es el grant de Spotify provocaría un refresco inútil del JWT de Totify, un reintento y un fallo confuso. El 401 queda reservado a la auth de Totify y Spotify usa `409` con `code: 'SPOTIFY_REAUTH_REQUIRED'`. Es la decisión con más probabilidad de ahorrarse una tarde de depuración en la spec 05 del frontend.

- **`POST /spotify/auth-url` devuelve la URL en vez de redirigir**: el JWT viaja como cabecera `Authorization` puesta por el interceptor de axios, y una navegación top-level del navegador no puede llevar cabeceras. Un `GET /spotify/connect` al que el navegador navegase sería anónimo y habría que inventar otro modo de saber qué usuario conecta. Devolver la URL a JS ya autenticado, que luego hace `window.location.assign`, deja la auth donde ya funciona.

- **`redirect_uri` con `127.0.0.1` y no `localhost`**: desde abril de 2025 Spotify rechaza `http://localhost:…` y solo acepta HTTPS o un literal loopback. No es una preferencia, es un requisito de la plataforma. Efecto colateral: el callback aterriza en un origen distinto al del frontend, lo que descarta autenticarlo por cookie y refuerza la decisión siguiente.

- **El `state` vive en Mongo con índice TTL, no en Postgres**: Mongo ya se usa para los refresh tokens (`mongo/token-schema.js`), y el TTL borra los documentos vencidos sin escribir un job de limpieza. Descartado un modelo Prisma junto a `SpotifyAccount`: dejaba todo el OAuth en una sola base y era transaccional con el upsert, pero obligaba a un barrido periódico de filas muertas. Descartado también un JWT firmado sin almacenar: cero escrituras, pero imposible garantizar un solo uso, y el uso único es justo lo que neutraliza un `code` interceptado.

- **El `state` es obligatorio y de un solo uso**: sin él, un atacante puede completar el flujo con su propio `code` contra la sesión de la víctima y quedarse enlazado a su cuenta de Totify. El `state` es a la vez la defensa CSRF y el vínculo con el usuario que inició el flujo. Como se consume antes del intercambio, una URL de callback robada no vale para nada tras el primer uso.

- **El callback responde siempre 3xx, nunca JSON**: quien lo consume es el navegador tras un redirect de Spotify, no un cliente HTTP. Un JSON de error dejaría al usuario mirando texto crudo en `127.0.0.1:3000`. Los errores viajan como `?spotify=error&reason=…` y los renderiza la SPA en la spec 05 del frontend. Único no-3xx: un 400 cuando falta el `state`, que solo ocurre si alguien entra a la URL a mano.

- **Se cifran los dos tokens, no solo el refresh**: el access token es un bearer de una hora sobre toda la biblioteca de playlists. Cifrarlo cuesta lo mismo que no hacerlo, ya que el módulo de cifrado hace falta igualmente para el refresh. Descartado guardarlos en claro y añadir el cifrado en una spec posterior: obligaría a un script que recifre filas existentes o a forzar reconexión a todos los usuarios ya conectados.

- **Identificador de clave `v1:` desde el día uno**: cuesta cuatro caracteres por fila y convierte una rotación de clave en un barrido descifra-con-vieja/recifra-con-nueva. Sin él, rotar significa invalidar todas las conexiones. El alcance honesto del cifrado es protegerse de un dump de la base o de acceso de lectura a Supabase; **no** protege ante compromiso del servidor, porque la clave está en el mismo `process.env`.

- **Se piden los cinco scopes ya, no solo los de identidad**: pedir solo `user-read-private` y `user-read-email` ahora sería más honesto con el usuario, pero obligaría a una segunda pantalla de consentimiento en la spec 03 y a que `needsReconnect` funcione perfecto antes de que haya nada que reconectar. Se piden los cinco de una vez y `scopes` guarda lo **concedido**, no lo solicitado, para que la comprobación siga siendo real.

- **Playlists creadas con `public: false` por defecto** (se fija aquí aunque la creación llegue en la spec 03): una playlist pública aparece en el perfil del usuario al instante, efecto sorpresa inaceptable en una herramienta de importación. Matiz que conviene no olvidar: `public: false` significa "no aparece en el perfil", no "secreta" — sigue siendo accesible por URL.

- **`GET /spotify/status` no llama a Spotify**: lo consume el montaje de Landing en cada carga. Verificar contra Spotify daría una respuesta más fresca a costa de una llamada de red por render y de quemar rate limit compartido entre los 25 usuarios de la app. El estado se mantiene fresco desde el lado de la escritura: es `spotify.tokens.js` quien marca `needsReconnect` cuando un refresco falla.

- **La protección anti-estampida de refresco es en proceso**: una caché de promesa por usuario evita que dos peticiones simultáneas con el token vencido disparen dos refrescos, donde el segundo invalidaría al primero. Descartado un advisory lock de Postgres: correcto con varias instancias, pero el backend hoy corre en una sola y el lock añade una dependencia de la base en el camino caliente. El caveat multi-instancia queda en riesgos.

- **Los tests mockean `global.fetch` con `jest.spyOn`**: cero dependencias nuevas, y `clearMocks: true` ya está en `jest.config.js`. Es además lo que ya hace la spec 01 para Groq. Descartado `nock`: aserciones más expresivas sobre las peticiones salientes, pero intercepta el módulo `http` y no el `fetch` nativo sin configuración extra. Descartada también una capa de transporte inyectable: más limpia de testear, pero mete un parámetro de fontanería en cada firma.

- **Se mantiene el umbral del 90 % de cobertura**: la spec añade nueve archivos, y excluir `services/spotify` de `collectCoverageFrom` "temporalmente" es la clase de excepción que nunca se revierte, justo sobre el módulo que maneja tokens. Cada paso del plan trae su `*.spec.js`.

- **Esta spec no toca `frontend/`**: tras implementarla, el producto no cambia para el usuario final — el banner sigue con su booleano local. Es deliberado: permite que la spec 05 del frontend aterrice el cableado con el markup intacto y las 14 baselines de Playwright pasando sin regenerarse.

- **La app se queda en Development Mode**: la ampliación de cuota exige demo, política de privacidad y revisión de Spotify, y no es un requisito para desarrollar. Se asume el tope de 25 usuarios en lista blanca. Ver riesgos: hay motivos para creer que ese tope puede ser permanente.

## Riesgos identificados

- **El tope de 25 usuarios puede ser permanente.** La app nace en Development Mode y solo pueden autorizarla los usuarios dados de alta a mano. La ampliación de cuota exige app funcional, vídeo demo, política de privacidad y términos, pasa por revisión humana y tarda semanas. Spotify ha denegado históricamente ampliaciones a aplicaciones que mueven bibliotecas entre servicios competidores, que es exactamente lo que hace Totify. Es el riesgo con más peso del proyecto, no solo de esta spec: conviene planificar asumiendo que el tope no se levanta y decidir si eso es compatible con el objetivo del producto antes de invertir en las specs siguientes.

- **Olvidar la lista blanca se manifiesta como un bug de código.** Un usuario no dado de alta recibe un error opaco al aprobar el consentimiento, o un 403 en la primera llamada. Nada en el mensaje apunta a la causa real. Mitigación: el paso 0 del plan lo incluye explícitamente, y `GET /spotify/status` traduce el 403 a `reason: 'user_not_allowlisted'` en vez de propagarlo crudo.

- **La clave de cifrado vive junto a la base que protege.** `SPOTIFY_TOKEN_ENC_KEY` y `DATABASE_URL` están en el mismo `.env`. El cifrado protege ante un dump de la base o acceso de lectura a Supabase; no protege ante compromiso del servidor de aplicación. Se asume conscientemente. Si la clave se pierde, todas las conexiones quedan irrecuperables y los usuarios deben reconectar — no hay copia de los tokens en claro por diseño.

- **Perder o rotar mal la clave desconecta a todos.** El prefijo `v1:` permite rotar sin forzar reconexión, pero el procedimiento no está escrito en esta spec. Hasta que lo esté, una rotación improvisada es un incidente. Mitigación mínima: no rotar sin escribir antes el script de recifrado.

- **El TTL de Mongo no borra al instante.** El barrido corre cada ~60 segundos, así que un documento de `SpotifyOAuthState` puede seguir existiendo pasado su `expiresAt`. Por eso la comprobación de `expiresAt` en código es obligatoria y no decorativa: delegar la expiración solo en el índice abriría una ventana de hasta un minuto para reutilizar un state caducado.

- **Rate limit compartido entre todos los usuarios.** El límite de Spotify se calcula por aplicación, no por usuario, con una ventana móvil de unos 30 segundos y cifras exactas sin documentar. En esta spec el volumen es bajo, pero la lógica de `Retry-After` que se escribe aquí es la que sostendrá el matching masivo de la spec 03. Un fallo silencioso en el backoff no se notará hasta entonces, y allí será difícil de atribuir.

- **Refresco concurrente entre varias instancias.** La caché de promesa es en proceso. Con dos instancias del backend, ambas pueden refrescar a la vez y la segunda invalidar el token de la primera, provocando 401 intermitentes difíciles de reproducir. Hoy no aplica porque el backend corre en una sola instancia. Debe revisarse antes de escalar horizontalmente.

- **`DELETE /spotify/connection` no revoca nada en Spotify.** Borra la fila local y el usuario deja de estar conectado en Totify, pero el permiso sigue vivo en su cuenta hasta que lo retire en spotify.com/account/apps. Spotify no ofrece endpoint de revocación. Es un riesgo de expectativa, no técnico: el usuario cree que ha cortado el acceso del todo. La UI de la spec 05 del frontend debe decirlo con claridad.

- **El `code` y los tokens son fáciles de filtrar al depurar.** Están a mano en el handler del callback y meterlos en la query o en un `logger.info` es la vía rápida para ver qué pasa. Un `code` en una URL queda en el historial del navegador y en cualquier log intermedio. Mitigación: dos criterios de aceptación explícitos, uno sobre la URL de destino y otro sobre los logs de Winston.

- **`prisma migrate` contra el pooler equivocado falla de forma confusa.** `prisma.config.ts` usa `DIRECT_URL`; lanzarlo contra el pooler de transacciones da un error que no apunta a la causa. Ya está documentado en `CLAUDE.md`, pero es el paso 4 del plan y conviene tenerlo presente.

- **El JWT de Totify sigue en `localStorage`.** Esta spec reduce el radio de explosión de un XSS, porque los tokens de Spotify nunca llegan al navegador, pero un JWT robado permite manejar el Spotify del usuario a través de tu propia API mientras el token siga vivo. `TokenService.accessExpiresTime` es `'1d'`, largo para un bearer en `localStorage`. Heredado de la spec 03 del frontend y no resuelto aquí.

- **`POST /users` está roto y te lo vas a encontrar probando.** `router/user.router.js:8` lo protege con `checkRole(['ADMIN'])` mientras el `registerUser` del frontend postea ahí sin autenticar. Es preexistente y ajeno a esta spec, pero bloquea crear una cuenta nueva para probar el flujo completo. Si te topas con ello, no es culpa de este trabajo.

## Lo que **no** entra en esta spec

- Cualquier cambio en `frontend/`. El banner de Landing sigue mintiendo.
- Rellenar el stub `services/playlist/playlist.js` de la spec 01.
- Listar, crear y leer playlists.
- Matching de tracks, scorer y búsqueda.
- Alta masiva de tracks.
- Caché de búsquedas.
- Rotación de la clave de cifrado.
- Ampliación de cuota de Spotify.

Cada uno de ellos, cuando llegue, va en su propia spec.

## Verificación

### Automática

```bash
cd backend
npm test                    # suite completa, incluidos los *.spec.js nuevos
npm test -- --coverage      # branches, functions, lines y statements >= 90
npm start                   # arranca sin warnings nuevos
```

En `frontend/`, comprobar que la spec no se ha desbordado:

```bash
cd frontend
git status --short          # sin cambios nuevos atribuibles a esta spec
npm run test:e2e            # 14 baselines pasan sin regenerarse
```

### Manual — recorrido completo

1. Aplicar la migración y arrancar el backend:

   ```bash
   cd backend
   ./node_modules/.bin/prisma migrate dev --name add_spotify_account
   npm start
   ```

2. Obtener un JWT de Totify haciendo login con una cuenta real, y pedir la URL de autorización:

   ```bash
   curl -s -X POST http://localhost:3000/spotify/auth-url \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" -d '{}'
   ```

3. Abrir la `authorizeUrl` devuelta en el navegador y aprobar el consentimiento. Debe terminar en `http://localhost:5173/?spotify=connected`. La página del frontend todavía no hace nada con ese parámetro — es lo esperado hasta la spec 05.

4. Comprobar en Supabase que existe una fila en `SpotifyAccount` y que `accessTokenEnc` y `refreshTokenEnc` empiezan por `v1:` y no son legibles.

5. Consultar el estado:

   ```bash
   curl -s http://localhost:3000/spotify/status -H "Authorization: Bearer $JWT"
   ```

   Debe devolver `connected: true` con `displayName` y `country` poblados.

6. Forzar un refresco: poner `accessTokenExpiresAt` en el pasado a mano en la base y repetir cualquier llamada. Debe recuperarse en silencio y dejar la fecha actualizada.

7. Revocar Totify en spotify.com/account/apps y repetir la llamada. Debe dejar `needsReconnect: true` y **no** responder 401. Este paso es el que valida la decisión del 409.

8. Desconectar y verificar:

   ```bash
   curl -s -X DELETE http://localhost:3000/spotify/connection -H "Authorization: Bearer $JWT" -i
   curl -s http://localhost:3000/spotify/status -H "Authorization: Bearer $JWT"
   ```

   El primero devuelve 204, el segundo `connected: false`.

9. Revisar los logs de Winston del recorrido completo y confirmar que no aparece ningún `code` ni token.
