# 04 — Matching de canciones y escritura en la playlist

**Estado:** Implemented
**Depende de:** `backend/specs/03-spotify-playlists.md` (Implementado, PR #27)
**Relacionado:** `frontend/specs/07-spotify-guardado-en-playlist.md` (consume estos endpoints)
**Fecha:** 2026-08-25

**Objetivo:** Traducir canciones sueltas a tracks de Spotify con una puntuación de confianza, y escribir en la playlist destino solo lo aprobado, sin duplicados.

## Context

La spec 03 dejó al usuario capaz de elegir una playlist destino real y guardarla en `SpotifyAccount.defaultPlaylistId`. Lo que todavía no existe es el puente entre lo que Totify tiene y lo que Spotify necesita.

Lo que Totify tiene, después de leer un screenshot, es texto: `{ title: "Cruel Summer", artist: "Taylor Swift", duration: "2:58" }`. Lo que Spotify necesita para escribir en una playlist es un `spotify:track:1BxfuPKGuaTgP7aM0Bbdwr`. Nadie salva esa distancia hoy: no hay ningún `/v1/search` en código de producción, y `POST /songs/playlist` (`services/playlist/playlist.js:3-7`) es un stub que responde `202 not-implemented` leyendo una playlist global de la env var `SPOTIFY_PLAYLIST_ID` — ni siquiera la del usuario.

Esta spec fusiona las fases 4 y 5 del plan de integración (`frontend/docs/spotify-integration-plan.md`) porque están genuinamente acopladas: no hay guardado sin búsqueda previa.

### Lo que la API de Spotify hace con los duplicados

Investigado al escribir esta spec, porque condiciona todo el diseño de la escritura:

**Añadir una canción que ya está en la playlist no da error.** Spotify la añade otra vez, devuelve `201` con un `snapshot_id` nuevo, y la playlist queda con la canción duplicada. Los únicos errores documentados del endpoint son `401`, `403` y `429`; no existe ningún código de "duplicado". **La deduplicación es responsabilidad nuestra.**

Corolario importante: un `Promise.allSettled` sobre las canciones **no sirve** como mecanismo de dedupe, porque las repetidas volverían `fulfilled` igual que las nuevas. Y además es la forma equivocada de llamar a esta API — el endpoint acepta 100 URIs por petición, así que un `allSettled` sobre 50 canciones son 50 peticiones donde debería haber 1. El rate limit de Spotify se cuenta **por app, no por usuario**, y con el límite de 25 usuarios del modo desarrollo todos comparten la misma ventana.

### La migración de febrero de 2026 también movió estos endpoints

| Antes | Ahora |
|---|---|
| `POST /v1/playlists/{id}/tracks` | `POST /v1/playlists/{id}/items` |
| `GET /v1/playlists/{id}/tracks` (`limit` máx. 50) | `GET /v1/playlists/{id}/items` (`limit` máx. 100) |
| cada fila traía `track` | ahora trae `item` |

El endpoint nuevo **duplica el tamaño de página**, lo que abarata mucho la lectura para deduplicar: una playlist de 2000 canciones son 20 peticiones, no 40.

## Scope

**Incluido:**

- `POST /spotify/match` — busca en Spotify cada canción del lote y devuelve el mejor candidato con su confianza, más los alternativos.
- `GET /spotify/search` — búsqueda libre, para que el usuario corrija un match a mano.
- `POST /spotify/playlists/:playlistId/items` — deduplica contra la playlist destino y escribe en lotes de 100.
- `services/spotify/matching.js`: normalización y puntuación **puras**, unit-testeables.
- `utils/concurrency.js`: limitador de concurrencia puro, para no lanzar 50 búsquedas a la vez.
- Dos esquemas Joi nuevos en `middlewares/spotify-schema.validation.js`.
- **Borrado** del stub: `services/playlist/`, la ruta `POST /songs/playlist`, y la env var `SPOTIFY_PLAYLIST_ID`.
- Tests de Jest manteniendo el 90 % de cobertura, con `jest.spyOn(global, 'fetch')`.

**NO incluido (specs futuras):**

- **Caché de resultados de búsqueda.** Rematchear las mismas canciones populares es el patrón dominante y una tabla `SpotifyTrackCache` se lo comería, pero obliga a decidir invalidación. Va a una spec de endurecimiento.
- **Persistir el historial de envíos.** No se guarda en base qué se mandó ni cuándo; la respuesta del endpoint es lo único que hay.
- Quitar canciones de una playlist desde Totify.
- Escribir en una posición concreta o reordenar (`position` no se usa; todo se anexa al final).
- Episodios de podcast. Solo `type=track`.
- ISRC de verdad. La rama se deja escrita, pero hoy ninguna fuente aporta ISRC.
- Reemplazar el matching por un modelo de IA. Esto es puntuación determinista.

## Modelo de datos

Esta spec **no añade tablas ni columnas**. No persiste nada: todo el matching es en memoria y por petición.

### `TrackMatch` — lo que devuelven `match` y `search`

```js
{
  uri: 'spotify:track:1BxfuPKGuaTgP7aM0Bbdwr',
  id: '1BxfuPKGuaTgP7aM0Bbdwr',
  title: 'Cruel Summer',
  artists: ['Taylor Swift'],
  album: 'Lover',
  durationMs: 178426,
  isrc: 'USUG11901473',       // externals_ids.isrc ?? null
  explicit: false,
  popularity: 94,             // 0..100
  imageUrl: 'https://…',      // album.images[0]?.url ?? null
  previewUrl: null,
  confidence: 96,             // 0..100, calculado por matching.js
  reasons: ['exact-title', 'exact-artist', 'duration-2s'],
}
```

`reasons` es un array de etiquetas cortas que explican la puntuación. Existe para poder diagnosticar un falso positivo tres meses después sin reproducir la búsqueda.

### `MatchResult` — una entrada por canción de entrada

```js
{
  sourceId: 'd1',                          // el id que mandó el cliente, se devuelve tal cual
  status: 'matched' | 'ambiguous' | 'not_found',
  best: TrackMatch | null,
  candidates: TrackMatch[],                // hasta 5, ordenados por confidence desc
}
```

`candidates` viaja siempre, incluso en `matched`. Así el diálogo de corrección del frontend no necesita una petición extra para ofrecer alternativas.

### Contratos

```
POST /spotify/match                                auth + Joi
body: { songs: [{ id, title, artist, duration?, confidence? }] }   // 1..50
200:  { results: MatchResult[], partial: boolean }
409:  { code: 'SPOTIFY_NOT_CONNECTED' }
409:  { code: 'SPOTIFY_REAUTH_REQUIRED' }
429:  { retryAfter } con cabecera Retry-After

GET  /spotify/search?q=<texto>&limit=10            auth
200:  { items: TrackMatch[] }        // confidence = null, no hay origen contra el que puntuar
400:  q vacío

POST /spotify/playlists/:playlistId/items          auth + Joi
body: { uris: string[] }                            // 1..100
200:  { added, skippedDuplicates, failed, snapshotId }
404:  { code: 'SPOTIFY_PLAYLIST_NOT_FOUND' }
409:  { code: 'SPOTIFY_NOT_CONNECTED' | 'SPOTIFY_REAUTH_REQUIRED' }
```

Forma de la respuesta de escritura:

```js
{
  added: ['spotify:track:aaa', 'spotify:track:bbb'],
  skippedDuplicates: ['spotify:track:ccc'],   // ya estaban en la playlist
  failed: [{ uri: 'spotify:track:ddd', reason: 'batch-failed' }],
  snapshotId: 'AAABBBCCC',                    // el del último lote escrito
}
```

Convenciones:

- `partial: true` cuando alguna búsqueda falló pero el resto salió bien. La petición **no** se cae entera porque una canción rara reviente.
- `uris` valida contra `/^spotify:track:[A-Za-z0-9]{22}$/`. Un URI de álbum o de episodio se rechaza con 400 antes de llegar a Spotify.
- `confidence` en `GET /spotify/search` es `null`, no `0`: no hay canción de origen contra la que puntuar, y devolver `0` se leería como "malísimo match".

## Plan de implementación

1. **`utils/concurrency.js`.** `mapWithConcurrency(items, limit, fn)` puro: recorre con como mucho `limit` promesas en vuelo y devuelve los resultados en el orden de entrada. Prueba: test unitario que verifica el orden y que nunca hay más de `limit` simultáneas.

2. **`services/spotify/matching.js` — normalización.** `normalizeTitle`, `normalizeArtist`, `splitFeaturedArtists`, `parseDurationToMs`. Todo puro. Prueba: tabla de casos con acentos, comillas tipográficas, `- Remastered 2011`, `(Deluxe Edition)`, `(feat. Post Malone)`, `"2:58"` → `178000`, y `null`.

3. **`services/spotify/matching.js` — puntuación.** `scoreCandidate(source, candidate)` y `pickBest(source, candidates)` con la fórmula, las penalizaciones y los umbrales de abajo. Prueba: la tabla gorda de casos (Taylor's Version, versión live, karaoke, empate de duración, sin duración de origen).

4. **`services/spotify/spotify.match.js` — búsqueda.** `buildQueries(source)` y la llamada a `/v1/search` vía `spotifyFetch`. Handler `matchTracks` que orquesta: carga la cuenta (para `country`), construye queries, busca con concurrencia 5, puntúa. Montar `POST /spotify/match`. Prueba manual: `curl` con dos canciones reales y mirar las confianzas.

5. **`searchTracks`.** Handler de `GET /spotify/search`, sobre el mismo mapeo a `TrackMatch` pero sin puntuar. Prueba manual: buscar "espresso" y ver 10 resultados.

6. **Joi.** `matchSongsSchema` y `addTracksSchema` en `middlewares/spotify-schema.validation.js`, mismo patrón que los tres que ya viven ahí. Prueba: 51 canciones devuelve 400; un URI de álbum devuelve 400.

7. **`services/spotify/spotify.tracks.js` — lectura para dedupe.** `readPlaylistUris(userId, playlistId)`: pagina `/v1/playlists/{id}/items` con `fields=items(item(uri),track(uri)),next,total&limit=100` y devuelve un `Set`. Lectura defensiva `row.item?.uri ?? row.track?.uri` en un solo sitio. Prueba: mock de dos páginas y verificar que pagina hasta agotar `next`.

8. **`addTracks` — escritura.** Filtra contra el `Set` y contra sí mismo, trocea en 100, `POST` secuencial **sin reintento de 5xx**, y arma el reporte de éxito parcial. Montar `POST /spotify/playlists/:playlistId/items`. Prueba manual: mandar 2 canciones, verlas en el cliente de Spotify, volver a mandarlas y comprobar que salen en `skippedDuplicates`.

9. **Traducir el 404 de Spotify.** Si la playlist ya no existe, responder `404 SPOTIFY_PLAYLIST_NOT_FOUND` y poner `defaultPlaylistId` a `null`. Recoge el riesgo que la spec 03 dejó anotado.

10. **Borrar el stub.** Eliminar `services/playlist/` entero, la ruta `POST /songs/playlist` de `router/songs.router.js`, `middlewares/song-selection.validation.js` si no lo usa nadie más, y `SPOTIFY_PLAYLIST_ID` de `.env.example`. Prueba: `npm test` sigue verde y `grep -r SPOTIFY_PLAYLIST_ID` no devuelve nada.

11. **Tests de integración** en `spotify.router.integration.spec.js`, siguiendo los que dejaron las specs 02 y 03.

12. **Documentar en `backend/CLAUDE.md`:** los tres endpoints, que la dedupe es nuestra porque Spotify no la hace, y que la escritura no reintenta 5xx a propósito.

Los 409, 429 y el refresh de token no se implementan aquí: `spotifyFetch` ya los resuelve desde la spec 02. La única excepción es el reintento automático de 5xx, que hay que **desactivar** para la escritura (ver Riesgos).

### Construcción de la query

En orden, parando al primer acierto fuerte:

1. Si hay ISRC: `q=isrc:<ISRC>&type=track&limit=5`. Un acierto por ISRC es definitivo → confianza 100. Hoy ninguna fuente aporta ISRC; la rama se deja escrita.
2. Con filtros de campo: `q=track:"<normTitle>" artist:"<normArtist>"&type=track&limit=10&market=<country>`.
3. Fallback de texto libre: `q=<normTitle> <normArtist>&type=track&limit=20&market=<country>`. Recoge los casos donde el artista viene como `"Taylor Swift feat. Post Malone"` y el filtro de campo no encuentra nada.

`market` sale siempre de `SpotifyAccount.country`. Sin él, `/v1/search` puede devolver tracks no reproducibles en la región del usuario.

### Normalización

Compartida entre la construcción de la query y la puntuación — deben ser la misma función, o el matching puntúa contra un texto distinto del que buscó.

- Unicode NFKD y quitar diacríticos; minúsculas; comillas tipográficas a rectas.
- Quitar sufijos: `- Remastered 2011`, `(Deluxe Edition)`, `(Bonus Track)`, `- Radio Edit`, `(Original Motion Picture Soundtrack)`.
- Extraer y **guardar aparte** `(feat. X)` / `ft. X` / `with X`: pasan a ser tokens de artista, no ruido de título.
- Quitar puntuación, colapsar espacios, quitar artículos iniciales solo para la comparación por tokens.

### Puntuación

```
score = 0.45*titleSim + 0.30*artistSim + 0.20*durationScore + 0.05*popularityNudge - penalizaciones
```

- **`titleSim`** — similitud de conjuntos de tokens (Dice de bigramas) sobre títulos normalizados. Igualdad normalizada exacta → 1.0.
- **`artistSim`** — máximo sobre el producto cruzado `{artistas de origen incl. feat.} × {artistas del candidato}`; coincidencia exacta del artista principal pone suelo en 0.9.
- **`durationScore`** — `|Δ| ≤ 2s → 1.0`, decaimiento lineal hasta `0` en `15s`. Sin duración de origen se elimina el término y se **renormalizan los pesos a 0.56 / 0.38 / 0.06**.
- **`popularityNudge`** — `popularity/100`. **Solo desempate**; con más peso preferirías sistemáticamente el single de éxito sobre el corte de álbum correcto.
- **Penalizaciones** — aquí es donde mueren los falsos positivos:
  - `-0.15` si el título del candidato contiene `live|karaoke|tribute|cover|instrumental|sped up|slowed|8d|remix` y el de origen no.
  - `-0.10` si el álbum del candidato es recopilatorio o `Various Artists` y existe un candidato no-recopilatorio a menos de 0.05.
  - `-0.05` por desajuste de `explicit`.

Umbrales, sobre `score * 100`:

| Rango | `status` | Efecto |
|---|---|---|
| `≥ 85` | `matched` | El frontend lo escribe sin preguntar. |
| `60–84` | `ambiguous` | Se preselecciona el mejor, pero **el usuario confirma**. |
| `< 60` | `not_found` | `best: null`. Se devuelven candidatos igual, para que elija. |

**Forzar `ambiguous` cuando los dos mejores estén a menos de 0.04 entre sí**, sea cual sea la puntuación absoluta. Los casi-empates son exactamente donde "Taylor's Version" contra el original sale mal.

**Además, un `confidence` de origen bajo fuerza `ambiguous`.** Si la IA que leyó el screenshot solo confía al 60 % en que dice "Cruel Summer", da igual que el match puntúe 95: se está puntuando contra un texto posiblemente equivocado. El umbral es `confidence < 70` del origen.

### Escritura, paso a paso

1. Cargar `SpotifyAccount`. Sin fila → `409 SPOTIFY_NOT_CONNECTED`.
2. Leer la playlist entera paginando `/v1/playlists/{id}/items`, con `fields` y `limit=100`. Construir un `Set` de URIs.
3. Filtrar los URIs entrantes contra ese `Set` (duplicados en Spotify) **y contra sí mismos** (el lote puede traer el mismo track dos veces).
4. Trocear lo que quede en lotes de 100 y hacer `POST` **secuencial**, nunca en paralelo.
5. Un fallo a mitad es **éxito parcial**: los lotes que entraron van a `added`, los que no a `failed` con su motivo. No es todo-o-nada.
6. Si Spotify devuelve 404, traducir a `SPOTIFY_PLAYLIST_NOT_FOUND` y limpiar `defaultPlaylistId`.

## Criterios de aceptación

- [x] `POST /spotify/match` sin conexión de Spotify devuelve 409 `SPOTIFY_NOT_CONNECTED`, no 401 ni 500.
- [x] `POST /spotify/match` con 51 canciones devuelve 400 con la forma de error existente.
- [x] Una canción con título y artista exactos devuelve `status: 'matched'` con `confidence ≥ 85`.
- [x] Buscar una canción cuya única coincidencia es una versión karaoke o live **no** devuelve `matched`.
- [x] Dos candidatos a menos de 0.04 devuelven `ambiguous` aunque el mejor pase de 85.
- [x] Una canción con `confidence` de origen menor que 70 devuelve `ambiguous` aunque el match puntúe alto.
- [x] Una canción sin `duration` se puntúa con los pesos renormalizados y no se penaliza por ello.
- [x] `candidates` viaja también cuando el `status` es `matched`.
- [x] Que una búsqueda falle deja `partial: true` y no tumba el resto del lote.
- [x] Las búsquedas nunca superan 6 peticiones simultáneas a Spotify.
- [x] `GET /spotify/search` con `q` vacío devuelve 400.
- [x] `POST /spotify/playlists/:id/items` con un URI de álbum devuelve 400 sin llamar a Spotify.
- [x] Mandar un URI que ya está en la playlist lo devuelve en `skippedDuplicates` y **no** lo escribe: el `trackCount` de la playlist no cambia.
- [x] Mandar el mismo URI dos veces en el mismo body lo escribe una sola vez.
- [x] Mandar 150 URIs nuevos genera exactamente 2 peticiones `POST` a Spotify, secuenciales.
- [x] Si el segundo lote falla, el primero sigue reportado en `added` y el segundo en `failed`.
- [x] La escritura **no** reintenta ante un 5xx de Spotify.
- [x] Una playlist borrada devuelve 404 `SPOTIFY_PLAYLIST_NOT_FOUND` y deja `defaultPlaylistId` en `null`.
- [x] `grep -r "SPOTIFY_PLAYLIST_ID"` no devuelve nada, y `services/playlist/` ya no existe.
- [x] `POST /songs/playlist` devuelve 404: la ruta ya no está montada.
- [x] Ningún log de Winston contiene tokens.
- [x] `npm test` pasa y la cobertura sigue en 90 % o más.
- [x] Los siete endpoints de las specs 02 y 03 siguen respondiendo igual que antes.

## Decisiones tomadas y descartadas

- **La deduplicación se hace leyendo la playlist, porque Spotify no la hace.** Añadir una canción que ya está devuelve `201` y la duplica en silencio; no hay ningún código de error de duplicado que capturar. Descartado confiar en la API: no hay nada en lo que confiar. Descartado también `Promise.allSettled` por canción, que era la intuición de partida — las repetidas volverían `fulfilled` igual que las nuevas, así que no distingue nada, y convierte 1 petición en 50 sobre un rate limit que se cuenta por app.

- **Se lee la playlist entera antes de cada escritura.** Con `limit=100` en el endpoint nuevo, una playlist de 2000 canciones son 20 peticiones. Descartado leer solo si la playlist es pequeña: el comportamiento cambiaría según el tamaño, que es difícil de explicar y peor de testear. Descartado no deduplicar: reenviar el mismo screenshot dos veces te dejaría la playlist duplicada entera y sin aviso.

- **La escritura no reintenta los 5xx.** `spotifyFetch` reintenta una vez por defecto (`spotify.client.js:95-102`), lo cual es correcto para lecturas e inocuo para todo lo que hicieron las specs 02 y 03. En la escritura no: un 500 puede significar que la escritura **sí** ocurrió y la respuesta se perdió, y el reintento duplicaría justo lo que esta spec existe para evitar. Se prefiere reportar el lote como `failed` y que el usuario reintente sabiendo que la dedupe lo protege.

- **Lotes secuenciales, no paralelos.** Cuatro `POST` a la vez sobre la misma playlist es pedir una condición de carrera en el `snapshot_id` y multiplicar el riesgo de 429 en la operación que menos se puede permitir reintentar.

- **`matching.js` es puro y vive aparte.** En este backend los "services" son handlers de Express y no se pueden testear sin montar `req`/`res`. La puntuación es exactamente el tipo de lógica que necesita una tabla gorda de casos, así que va en su propio módulo — mismo motivo que `playlist.mapper.js` en la spec 03.

- **Los umbrales son 85 / 60 y no se autoañade nada por debajo.** Meter en silencio "Anti-Hero (Sped Up)" o una versión karaoke en la playlist de alguien es peor que no meter nada: el error es invisible hasta que suena, y limpiarlo es manual. Descartado un umbral único.

- **Las dos confianzas no se fusionan.** `DetectedSong.confidence` es cuánto confía la IA en que el screenshot dice eso; `TrackMatch.confidence` es cuánto confía el matcher en que ese track es esa canción. La fiabilidad efectiva es aproximadamente su producto: un OCR al 60 % con match al 95 % sigue siendo una moneda al aire. Por eso un `confidence` de origen bajo fuerza `ambiguous` aunque el match puntúe alto, y por eso el frontend las muestra por separado.

- **`popularity` pesa 0.05 y solo desempata.** Con más peso, el matcher preferiría sistemáticamente el single de éxito sobre el corte de álbum correcto, que es un falso positivo especialmente difícil de detectar porque el título coincide.

- **`candidates` viaja siempre, también en `matched`.** Cuesta unos cientos de bytes y ahorra una petición entera cuando el usuario quiere corregir un match que el sistema creía seguro.

- **El stub `POST /songs/playlist` se borra en vez de rellenarse.** La spec 01 lo dejó como sitio a rellenar, pero el destino, el token, el `country` y el manejo de 409/429 viven todos en el dominio `spotify`. Rellenarlo obligaría a que `songs` importara medio `services/spotify/`. Se borra también `SPOTIFY_PLAYLIST_ID`, que apuntaba a una playlist global y quedó sin sentido desde que la spec 03 guardó un destino por usuario.

- **`reasons[]` en cada `TrackMatch`.** Cuando alguien reporte "me metió la canción equivocada", la única forma de diagnosticarlo sin reproducir la búsqueda es que la decisión venga explicada.

- **Sin caché de búsquedas en esta spec.** Es la optimización obvia y rematchear canciones populares es el patrón dominante, pero obliga a decidir invalidación y a añadir una tabla. Va a una spec de endurecimiento, con el problema ya medido.

## Riesgos identificados

- **Los falsos positivos son el riesgo reputacional del proyecto.** Añadir en silencio una versión karaoke, un cover o un "sped up" a la playlist de alguien es peor que fallar y decirlo. Defensas acumuladas: umbral de 85, penalización explícita por palabras clave, `ambiguous` forzado en casi-empates, `ambiguous` forzado por OCR bajo, nada se escribe sin confirmación, y `reasons[]` para diagnosticar después. Aun así, ninguna es infalible.

- **La documentación de Spotify se contradice sobre `limit`.** La tabla de parámetros de `GET /v1/playlists/{id}/items` dice `Maximum: 100`; un párrafo de la misma página dice "range of 1 to 50". Están en plena transición de la migración de febrero. Hay que probar `limit=100` contra la API real en el paso 7 y caer a 50 si lo rechaza. Si se cae a 50, la lectura para deduplicar cuesta el doble de peticiones.

- **No está verificado si la migración renombró también la respuesta de `/v1/search`.** Se confirmó el renombrado de `tracks` → `items` en los objetos de playlist, no en la envoltura de la búsqueda, que hoy devuelve `{ tracks: { items: [...] } }`. Leerlo defensivamente en un solo sitio, igual que `trackCount` en `playlist.mapper.js`, y verificarlo contra la API real al implementar.

- **El rate limit se cuenta por app, no por usuario.** Cada canción son 1–2 búsquedas, así que un lote de 50 son hasta 100 peticiones. Con 25 usuarios en modo desarrollo matcheando a la vez, colisionan entre sí. Mitigaciones: tope de 50 por lote, concurrencia 5, y honrar `Retry-After` (que `spotifyFetch` ya hace). Si se vuelve un problema real, la solución es la caché de búsquedas.

- **Un 429 durante la escritura es el peor momento posible.** `spotifyFetch` reintenta los 429 hasta dos veces, lo cual es seguro aquí porque un 429 significa que la petición **no** se procesó. El caso peligroso es el 5xx, y por eso se desactiva ese reintento concreto. Conviene no confundir los dos al implementar.

- **`durationScore` parte de un dato ya degradado.** `Song.duration` es un string `"m:ss"`, así que arrastra ±0.5 s de error de truncado antes de empezar a comparar. La ventana de ±2 s para puntuación 1.0 lo absorbe, pero significa que la duración nunca va a ser un desempate fino.

- **Leer la playlist y escribir no son atómicos.** Entre que se lee el `Set` de URIs y se escribe, alguien puede añadir esa misma canción desde el móvil. La ventana es de segundos y el resultado es un duplicado, no un error. Aceptado: cerrarlo exigiría usar `snapshot_id` como control de concurrencia optimista y reintentar, lo que complica mucho para un caso raro.

- **Nada limita el tamaño de la playlist que se lee.** Una playlist de 10 000 canciones son 100 peticiones antes de escribir nada, y probablemente un 429. No se acota en esta spec porque el caso no se ha visto; si aparece, el arreglo es un tope con aviso al usuario.

## Lo que **no** entra en esta spec

- Caché de resultados de búsqueda.
- Persistir el historial de envíos.
- Quitar canciones de una playlist desde Totify.
- Escribir en una posición concreta o reordenar.
- Episodios de podcast.
- Matching con un modelo de IA en vez de puntuación determinista.
- Migrar `spotifyUserId` de `id` a `account_id` (heredado de la spec 03).

Cada uno, cuando llegue, en su propia spec.
