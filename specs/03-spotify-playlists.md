# 03 — Playlists de Spotify: listar, crear y elegir destino

**Estado:** Approved
**Depende de:** `backend/specs/02-spotify-oauth.md` (Implementado, PR #25)
**Relacionado:** `frontend/specs/06-spotify-playlist-destino.md` (consume estos endpoints)
**Fecha:** 2026-08-24

**Objetivo:** Exponer tres endpoints que permitan al usuario listar sus playlists de Spotify escribibles, crear una nueva y fijar cuál es su playlist destino persistente.

## Context

La spec 02 dejó el OAuth completo: el backend es dueño del flujo Authorization Code, cifra ambos tokens en reposo y expone `auth-url`, `callback`, `status` y `connection`. La spec 05 del frontend conectó la UI a esos cuatro endpoints, así que hoy el usuario puede conectar su cuenta de Spotify y ver el banner decir la verdad.

Lo que no puede hacer es decir **a dónde** quiere que vayan sus canciones. `PlaylistPanel` (`frontend/src/pages/Landing/PlaylistPanel.tsx`) dice "Spotify Playlist" sin saber cuál, y su botón de refresco gira un spinner 1200 ms sin consultar nada.

Esta spec cubre esa pieza en el backend: listar las playlists en las que el usuario puede escribir, crear una nueva, y recordar cuál eligió. Es la fase 3 del plan de integración (`frontend/docs/spotify-integration-plan.md`), recortada según lo que el usuario decidió al especificarla.

**La API de Spotify cambió desde que se escribió el plan.** La migración de febrero de 2026 eliminó los endpoints `/users/{id}/...` y renombró el campo `tracks` de una playlist a `items`. El plan usaba `POST /v1/users/{spotifyUserId}/playlists`, que ya no existe. Esta spec va contra la API actual.

## Scope

**Incluido:**

- Migración de Prisma: columna `defaultPlaylistId String?` en `SpotifyAccount`.
- `GET /spotify/playlists?limit&offset` — lista las playlists del usuario sobre `GET /v1/me/playlists`, filtradas en servidor a `owner.id === spotifyUserId`.
- `POST /spotify/playlists` — body `{ name }`, crea sobre `POST /v1/me/playlists` con `public: false` fijo. Devuelve la playlist ya en la forma del listado.
- `PUT /spotify/default-playlist` — body `{ playlistId }`, guarda el destino. `{ playlistId: null }` lo borra.
- `GET /spotify/status` gana `defaultPlaylistId` en su respuesta.
- Validación Joi para los dos bodies, espejo de `spotify-schema.validation.js`.
- Tests de Jest manteniendo el 90 % de cobertura, con `jest.spyOn(global, 'fetch')`.

**NO incluido (specs futuras):**

- **Leer los tracks de una playlist.** El plan original lo tenía (endpoint 9); se cae porque el panel derecho no va a listar la playlist entera.
- Buscar canciones en Spotify y decidir qué track corresponde a cada una → `backend/specs/04`.
- Escribir canciones en la playlist → `backend/specs/05`.
- Renombrar, borrar o cambiar la visibilidad de una playlist desde Totify.
- Playlists colaborativas y subida de imagen de portada.
- Paginación automática: `limit` y `offset` se pasan tal cual a Spotify.
- Caché de playlists en base o en memoria.
- Comprobar en cada arranque que `defaultPlaylistId` sigue existiendo en Spotify.

## Modelo de datos

### Prisma — cambio en `SpotifyAccount`

```prisma
model SpotifyAccount {
  // ... campos de la spec 02, sin tocar

  defaultPlaylistId String?   // ID de Spotify de la playlist destino
}
```

Migración: `add_default_playlist_id`. Es una columna nullable, así que no rompe las filas existentes ni obliga a reconectar a nadie.

### Forma que devuelve el backend

Un solo tipo, usado por el listado y por la creación. No se reenvía la respuesta cruda de Spotify: se recorta a lo que la UI pinta.

```js
// SpotifyPlaylistDTO
{
  id: 'string',            // playlist.id
  name: 'string',          // playlist.name
  description: 'string',   // playlist.description ?? ''
  trackCount: 0,           // ver nota de la migración de febrero 2026
  public: false,           // playlist.public
  imageUrl: 'string|null', // playlist.images[0]?.url ?? null
  url: 'string',           // playlist.external_urls.spotify
}
```

**Nota sobre `trackCount`.** La migración de febrero de 2026 renombró el campo `tracks` de una playlist a `items`. Durante la transición Spotify devuelve los dos. Se lee defensivamente y en un solo sitio:

```js
const trackCount = playlist.items?.total ?? playlist.tracks?.total ?? 0;
```

### Contratos

```
GET /spotify/playlists?limit=20&offset=0        auth
200: { items: SpotifyPlaylistDTO[], total, limit, offset }
409: { code: 'SPOTIFY_NOT_CONNECTED' }
409: { code: 'SPOTIFY_REAUTH_REQUIRED' }

POST /spotify/playlists                         auth + Joi
body: { name: string(1..100) }
201:  SpotifyPlaylistDTO
400:  ValidationError con la forma existente

PUT /spotify/default-playlist                   auth + Joi
body: { playlistId: string|null }
200:  { defaultPlaylistId: string|null }

GET /spotify/status                             auth
200: { ...campos de la spec 02, defaultPlaylistId: string|null }
```

Convenciones:

- `total` es el total de Spotify **antes** del filtro por `owner`, así que una página puede devolver menos elementos que `limit`. Es lo honesto: la paginación la marca Spotify, no nosotros.
- `PUT /spotify/default-playlist` **no** comprueba contra Spotify que la playlist exista ni que sea tuya. Guarda el string. Ver Riesgos.

## Plan de implementación

1. **Migración.** Añadir `defaultPlaylistId String?` a `SpotifyAccount` y correr `./node_modules/.bin/prisma db push` seguido de `prisma generate`. `db push` y no `migrate dev`: la base no tiene historial de migraciones, tal como documentó la spec 02 en `CLAUDE.md`. Prueba: la columna aparece en Supabase y las filas existentes siguen ahí.

2. **`services/spotify/playlist.mapper.js`.** Función pura `toPlaylistDTO(playlist)` con la lectura defensiva de `trackCount`. Va en módulo aparte porque en este backend los "services" son handlers de Express y la lógica pura se aísla para poder testearla contra el umbral del 90 %. Prueba: `npm test` con un test que cubra `items`, `tracks` y ninguno de los dos.

3. **`listPlaylists` en `services/spotify/spotify.playlists.js`.** Handler sobre `spotifyFetch(userId, '/v1/me/playlists?...')`, filtro por `owner.id`, mapeo. Montarlo en `router/spotify.router.js` como `GET /spotify/playlists`. Prueba manual: `curl` con un JWT real y ver tus playlists.

4. **Joi.** Dos esquemas nuevos en `middlewares/spotify-schema.validation.js`: `createPlaylistSchema` (`name` requerido, 1..100) y `defaultPlaylistSchema` (`playlistId` string o `null`). Prueba: un POST sin `name` devuelve 400 con la forma de error existente.

5. **`createPlaylist`.** Handler sobre `POST /v1/me/playlists` con `public: false` fijo. Devuelve 201 con el DTO. Prueba manual: crear una y verla en el cliente de Spotify, privada.

6. **`setDefaultPlaylist` y `defaultPlaylistId` en el status.** El handler escribe la columna; `getStatus` la añade a su respuesta. Prueba manual: PUT, luego GET `/spotify/status` y ver el id.

7. **Tests unitarios** en `spotify.playlists.spec.js` con `jest.spyOn(global, 'fetch')`: listado vacío, filtro por owner, 409 sin conexión, 429 con `Retry-After`.

8. **Tests de integración** en `spotify.router.integration.spec.js`, siguiendo los que la spec 02 ya dejó ahí.

9. **Documentar en `backend/CLAUDE.md`:** los tres endpoints, que `public: false` es deliberado, y la nota de la migración de febrero de 2026 (`/users/{id}/...` eliminado, `tracks` → `items`).

Los 409 (`SPOTIFY_NOT_CONNECTED`, `SPOTIFY_REAUTH_REQUIRED`), los 429 y los 5xx **no se implementan aquí**. `spotifyFetch` ya los resuelve desde la spec 02; estos handlers solo lo llaman.

## Criterios de aceptación

- [x] `SpotifyAccount` tiene la columna `defaultPlaylistId` y las filas que existían antes de la migración siguen ahí, sin reconectar.
- [x] `GET /spotify/playlists` sin conexión de Spotify devuelve 409 con `code: 'SPOTIFY_NOT_CONNECTED'`, no 401 ni 500.
- [x] `GET /spotify/playlists` de un usuario conectado devuelve solo playlists cuyo `owner.id` es su `spotifyUserId`. Seguir una playlist ajena y volver a llamar no la incluye.
- [x] La respuesta del listado no contiene ningún campo crudo de Spotify fuera de los siete del `SpotifyPlaylistDTO`.
- [x] `trackCount` es correcto tanto si Spotify devuelve `items.total` como si devuelve solo `tracks.total`, y es `0` si no llega ninguno de los dos.
- [x] `POST /spotify/playlists` sin `name` devuelve 400 con la misma forma de error que los endpoints de la spec 02.
- [ ] `POST /spotify/playlists` con `name` crea la playlist y `public` es `false` en la respuesta y en el cliente real de Spotify. **Verificado solo en la respuesta (tests); pendiente de prueba manual contra el cliente real de Spotify.**
- [ ] La playlist recién creada aparece en la siguiente llamada a `GET /spotify/playlists`. **Se sigue del comportamiento documentado de la API de Spotify y del filtro por owner; no verificado end-to-end contra Spotify real.**
- [x] `PUT /spotify/default-playlist` guarda el id, y `GET /spotify/status` lo devuelve en `defaultPlaylistId`.
- [x] `PUT /spotify/default-playlist` con `{ playlistId: null }` lo borra y el status devuelve `null`.
- [x] Un token de Spotify revocado hace que `GET /spotify/playlists` y `POST /spotify/playlists` devuelvan 409 `SPOTIFY_REAUTH_REQUIRED`. **`PUT /spotify/default-playlist` queda fuera de este criterio**: por diseño (ver "Decisiones tomadas y descartadas") no llama a Spotify, así que nunca puede detectar un token revocado; siempre devuelve 200 y guarda el string.
- [x] Ningún log de Winston contiene tokens ni el `code` de OAuth.
- [x] `npm test` pasa y la cobertura sigue en 90 % o más.
- [x] Los cuatro endpoints de la spec 02 siguen respondiendo igual que antes.

## Decisiones tomadas y descartadas

- **`POST /v1/me/playlists`, no `POST /v1/users/{spotifyUserId}/playlists`.** El plan original (`frontend/docs/spotify-integration-plan.md`) usaba la segunda, que la migración de febrero de 2026 eliminó junto con el resto de `/users/{id}/...`. El plan se escribió contra la API anterior. Consecuencia agradable: ya no hace falta el `spotifyUserId` para crear, aunque se conserva para el filtro por `owner`.

- **`public: false` fijo, no configurable desde la UI.** El default de Spotify es `public: true`: crear "lo más sencillo posible" mandando solo `name` publicaría la playlist en el perfil del usuario al instante. En una herramienta de importación eso es un efecto sorpresa inaceptable. Descartado exponer el flag: un campo más que decidir en cada creación, a cambio de un caso de uso que nadie pidió. Matiz que hay que saber: `public: false` significa "no aparece en tu perfil", **no** "secreta" — sigue siendo accesible por URL.

- **El body de creación solo lleva `name`.** Descartada la descripción: es el único campo que el usuario pidió, Spotify la deja vacía sin quejarse, y se puede editar desde el propio Spotify.

- **El filtro por `owner.id` va en servidor.** Ofrecer como destino una playlist en la que no puedes escribir convierte un error de permisos en un fallo al final del flujo, cuando ya seleccionaste canciones. Descartado devolver todo y filtrar en el cliente: el frontend tendría que conocer el `spotifyUserId`.

- **`total` es el de Spotify, sin descontar el filtro.** La alternativa es pedir páginas hasta juntar `limit` propias, lo que multiplica las llamadas por un factor que depende de cuántas playlists ajenas sigas. Con el buscador del selector, 50 de golpe cubre el caso normal.

- **`defaultPlaylistId` vive en el servidor, no en el cliente.** Sobrevive al logout y al cambio de dispositivo. Descartado `localStorage`: no sobrevive al cambio de navegador y añade otro estado que puede contradecir al servidor, justo el problema que la spec 05 acaba de resolver con `isSpotifyConnected`.

- **Endpoint dedicado `PUT /spotify/default-playlist`.** Descartado un `PATCH` sobre `/spotify/connection`: ese recurso hoy solo tiene `DELETE` y mezclar la desconexión con la edición de preferencias en la misma ruta invita a errores.

- **No hay endpoint para leer los tracks de una playlist.** El plan lo tenía (endpoint 9). El usuario decidió que el panel derecho no muestre la playlist entera, sino solo lo que él mandó, así que ese endpoint no tiene consumidor. Si el spec 08 lo necesita para deduplicar antes de escribir, se añade allí.

- **`PUT /spotify/default-playlist` no valida contra Spotify.** Validar significa una llamada extra en cada cambio de selector para prevenir un caso raro (elegir una playlist que acabas de borrar en otro dispositivo). Se guarda el string y el fallo aflora al escribir. Ver Riesgos.

- **Sin caché de playlists.** El listado se pide cuando el usuario abre el selector o pulsa refresh, que es un puñado de llamadas por sesión. Cachear obliga a decidir cuándo invalidar, y la queja real sería justo la contraria: "creé una playlist en el móvil y no aparece".

- **`prisma db push`, no `migrate dev`.** La base no tiene historial de migraciones porque se montó con `db push`; `migrate dev` detecta drift y pide resetear. Ya documentado en `CLAUDE.md` por la spec 02.

- **`toPlaylistDTO` en `playlist.mapper.js`, no dentro del handler.** En este backend los "services" son handlers de Express y no se pueden testear en aislamiento sin montar `req`/`res`. La lógica pura vive aparte para poder cubrirla contra el umbral del 90 %.

## Riesgos identificados

- **`defaultPlaylistId` puede quedar huérfano.** El usuario elige una playlist y luego la borra desde Spotify. La columna sigue apuntando ahí. No se valida al guardar ni al arrancar, así que el fallo aflora cuando el spec 08 intente escribir y Spotify devuelva 404. Mitigación mínima: que el spec 08 traduzca ese 404 a "la playlist destino ya no existe, elige otra" y limpie la columna, en vez de mostrar un error genérico.

- **La migración de febrero de 2026 sigue en transición.** Spotify devuelve hoy `items` y `tracks` a la vez, pero `tracks` va a desaparecer sin que nadie nos avise. Toda la lectura pasa por `toPlaylistDTO`, así que el día que pase, el arreglo es una línea en un solo archivo. Si esa lectura se replica en los handlers, este riesgo se vuelve caro.

- **`owner.id` frente a `account_id`.** El changelog de mayo de 2026 añadió `account_id` a `GET /me` y recomienda usarlo en vez de `id` para enlazar cuentas, porque `id` no es estable. `SpotifyAccount.spotifyUserId` guarda `id`, que es lo que la spec 02 implementó. Si Spotify llega a cambiar `owner.id` por el identificador nuevo, el filtro dejaría de casar y **el listado saldría vacío sin ningún error** — un fallo silencioso, que es el peor tipo. Vigilar el changelog; migrar a `account_id` merece su propia spec porque afecta a filas ya escritas.

- **Las playlists colaborativas ajenas quedan fuera.** En una playlist colaborativa puedes escribir aunque no seas el dueño, pero el filtro por `owner.id` la excluye. Es un falso negativo consciente: incluirlas obliga a distinguir "colaborativa donde participo" de "colaborativa que solo sigo", y ese scope (`playlist-read-collaborative`) está fuera desde la spec 02.

- **El rate limit de Spotify se cuenta por app, no por usuario.** Con el límite de 25 usuarios del modo desarrollo, varias personas abriendo el selector a la vez comparten ventana. Un listado son 1–2 llamadas, así que el riesgo es bajo aquí; se vuelve serio en el spec 04 (matching), donde cada canción son 1–2 búsquedas.

- **Sigue vigente el límite de 25 usuarios en lista blanca.** Heredado de la spec 02 y sin cambios: cada persona que pruebe debe estar dada de alta por email exacto en el dashboard.

## Lo que **no** entra en esta spec

- Leer los tracks de una playlist.
- Buscar canciones en Spotify y decidir qué track corresponde a cada una.
- Escribir canciones en una playlist.
- Renombrar, borrar o cambiar la visibilidad de playlists desde Totify.
- Playlists colaborativas y ajenas.
- Caché de playlists y paginación automática.
- Migrar `spotifyUserId` de `id` a `account_id`.

Cada uno, cuando llegue, en su propia spec.
