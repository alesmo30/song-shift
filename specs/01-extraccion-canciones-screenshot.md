# 01 — Extracción de canciones desde screenshots (Groq Llama 4 Scout)

**Estado:** Implementado
**Depende de:** ninguna (primera spec del backend)
**Fecha:** 2026-08-24

**Objetivo:** Exponer `POST /songs/extract`, que recibe hasta 5 screenshots de Apple Music y devuelve la lista deduplicada de canciones que la visión de Groq lee en ellas.

## Context

El backend hoy es un servicio de auth y nada más: `server.js` monta `helmet`, `cors`, `express.json()`, `cookieParser`, Passport JWT y dos routers (`authRouter`, `userRouter`). No hay subida de ficheros, ni cliente de ningún modelo, ni integración con Spotify o Apple Music.

El frontend ya tiene la pestaña "Upload Photo" (`frontend/src/pages/Landing/UploadPanel.tsx`), pero es un mock: llama a `onValidateWithAI`, lo ignora, y tras un `setTimeout` de 1.2s pinta `MOCK_DETECTED_SONGS`. Esta spec construye el endpoint real que sustituye ese mock.

Se elige Groq con `meta-llama/llama-4-scout-17b-16e-instruct` por precio (~$0.11/M tokens de entrada) y porque soporta `response_format: json_schema`, lo que elimina el parseo de texto libre: el modelo está obligado a devolver el esquema o la petición falla.

Esta spec no habla con Spotify. Define el contrato de `POST /songs/playlist` como stub para que el frontend pueda programar contra él, y una spec posterior rellena el cuerpo.

## Scope

**Incluido:**

- Dependencia nueva: `multer`. Groq se llama con el `fetch` global de Node (v26), sin SDK.
- `middlewares/upload.middleware.js`: `multer.memoryStorage()`, `limits: { fileSize: 4 * 1024 * 1024, files: 5 }`, `fileFilter` que acepta `image/png`, `image/jpeg`, `image/webp`. Campo del formulario: `screenshots`.
- Traducción de `MulterError` y de `req.files` vacío a `ValidationError` (`utils/errors.js`), para que `middlewares/error.handler.js` los formatee como cualquier otro 400.
- `services/groq/groq.client.js`: función `extractSongsFromImage(base64, mimeType)` contra `https://api.groq.com/openai/v1/chat/completions`, con `temperature: 0` y `response_format: json_schema` estricto.
- Reintento con backoff (2 intentos) solo para 429 y 5xx. Cualquier otro fallo termina en `AppError('Groq extraction failed', 502)`.
- `utils/song-normalizer.js`: `normalizeSong`, `dedupeSongs`, `buildSongId`.
- `services/songs/song-extraction.js`: handler `extractSongs` que procesa los N ficheros con `Promise.allSettled`, normaliza, deduplica y devuelve `200 { songs, processed, failed }`.
- `services/playlist/playlist.js`: handler `sendToPlaylist`, **stub**, devuelve `202 { playlistId, accepted, status: 'not-implemented' }`.
- `middlewares/song-selection.validation.js`: esquema Joi para el cuerpo de `/songs/playlist`.
- `router/songs.router.js` con las dos rutas, ambas detrás de `auth`. Montado en la raíz, sin prefijo `/api`, igual que `authRouter` y `userRouter`.
- Variables de entorno nuevas y un `.env.example` (hoy no existe y `.env` está commiteado).
- Tests unitarios e integración hasta el umbral de cobertura del 90% que ya impone `jest.config.js`.

**NO incluido:**

- **Spotify entero:** OAuth, búsqueda de tracks, resolución de URIs, escritura real en la playlist. `POST /songs/playlist` no llama a ninguna API externa.
- Persistir las extracciones. No hay modelo nuevo ni en Prisma ni en Mongoose; el endpoint es sin estado y la lista vive en el cliente.
- Historial de subidas, reintento de un screenshot suelto, o procesamiento en background con cola.
- Rate limiting sobre la ruta de Groq. Existió un `middlewares/rate-limiter.js` en un commit anterior y se borró; recuperarlo es su propia spec.
- Guardar las imágenes en disco o en un bucket. El buffer vive en memoria y muere al terminar la petición.
- Búsqueda por texto en Apple Music (la pestaña "Search" del frontend sigue mock).
- Cache de resultados por hash de imagen.

## Modelo de datos

No hay tablas ni colecciones nuevas. Lo único que se define es el contrato HTTP.

Esquema que se le impone a Groq y que también describe la respuesta:

```js
// response_format.json_schema.schema
{
  type: 'object',
  additionalProperties: false,
  required: ['songs'],
  properties: {
    songs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'artist', 'duration', 'confidence'],
        properties: {
          title: { type: 'string' },
          artist: { type: 'string' },
          duration: { type: ['string', 'null'] }, // "3:24" o null
          confidence: { type: 'number', minimum: 0, maximum: 100 },
        },
      },
    },
  },
}
```

Respuesta de `POST /songs/extract`:

```js
// 200
{
  songs: [{ id, title, artist, duration, confidence }], // id lo añade el backend
  processed: 2, // screenshots que Groq leyó bien
  failed: 0,    // screenshots que fallaron y se descartaron
}
```

Cuerpo de `POST /songs/playlist`:

```js
{ songs: [{ id, title, artist, duration }] } // 1..100
```

Convenciones:

- `id` es el sha1 de la clave de deduplicación (título y artista en minúsculas, sin acentos, unidos por `|`), truncado a 16 caracteres. Determinista, para que resubir el mismo screenshot no genere ids nuevos.
- `duration` es `null`, nunca cadena vacía.
- `confidence` es la estimación de legibilidad del propio modelo. No está calibrada: es una pista visual, no una probabilidad.

## Plan de implementación

1. `npm i multer`. Añadir `GROQ_API_KEY`, `GROQ_VISION_MODEL`, `FRONTEND_URL` y `SPOTIFY_PLAYLIST_ID` a `.env`, y crear `.env.example` con las mismas claves vacías. Prueba manual: `npm start` sigue arrancando.
2. Crear `utils/song-normalizer.js` con las tres funciones puras y su `utils/song-normalizer.spec.js`. Prueba: `npm test -- song-normalizer` en verde.
3. Crear `services/groq/groq.client.js`. Prueba manual: un script suelto en el scratchpad que le pase un screenshot real y saque el JSON por consola.
4. Añadir `services/groq/groq.client.spec.js` mockeando `global.fetch`: éxito, JSON malformado en el `content`, 429 que reintenta y acierta, 500 que acaba en `AppError` 502.
5. Crear `middlewares/upload.middleware.js` y su spec. Prueba: petición sin ficheros devuelve `ValidationError`.
6. Crear `services/songs/song-extraction.js` y su spec (con el cliente de Groq mockeado): dos ficheros que se fusionan, uno que falla y no tumba la petición, resultado vacío.
7. Crear `middlewares/song-selection.validation.js` y su spec, copiando la forma de `middlewares/login-schema.validation.js` (`abortEarly: false`, `throw` síncrono, `req.body = value`).
8. Crear `services/playlist/playlist.js` y `services/playlist/const/playlist.constants.js` con el stub.
9. Crear `router/songs.router.js` y montarlo en `server.js` antes de `errorHandler`.
10. Añadir `router/songs.router.integration.spec.js` con supertest y `.attach()`, copiando literalmente el bloque `jest.mock('jsonwebtoken')` de `router/user.router.integration.spec.js:19-34` (su `verify` usa la firma de callback que passport-jwt necesita) más `jest.mock('../lib/prisma')`.

## Criterios de aceptación

- [x] `POST /songs/extract` sin cabecera `Authorization` devuelve 401.
- [x] `POST /songs/extract` con token válido y dos screenshots devuelve 200 con al menos una canción por screenshot legible.
- [x] Una canción que aparece en los dos screenshots sale una sola vez en la respuesta.
- [x] El mismo screenshot subido dos veces produce exactamente los mismos `id`.
- [x] `POST /songs/extract` sin ficheros devuelve 400 con `status: 'error'` y `message: 'Validation Error'`.
- [x] Un fichero de 5MB devuelve 400, no 500.
- [x] Un `.pdf` enviado en el campo `screenshots` devuelve 400.
- [x] Con dos screenshots y uno de ellos provocando error en Groq, la respuesta es 200 con `failed: 1` y las canciones del otro.
- [x] Con `GROQ_API_KEY` inválida, la respuesta es 502, no 500.
- [x] `POST /songs/playlist` con `songs: []` devuelve 400; con 1..100 canciones devuelve 202 y `status: 'not-implemented'`.
- [x] `npm run test:coverage` pasa el umbral global del 90% en las cuatro métricas.
- [x] Ningún fichero se escribe en disco durante la petición.

## Decisiones tomadas y descartadas

- **`multipart/form-data` con `multer`, no base64 en JSON.** El frontend ya produce data URLs con `FileReader`, así que mandar JSON habría sido gratis en el cliente — pero obliga a subir el límite de `express.json()` a ~25MB para todo el servidor, no solo para esta ruta, y el base64 pesa un 33% más en el cable. Con `multer` los límites de tamaño y tipo se declaran donde tocan y `express.json()` se queda en sus 100kb por defecto.

- **`fetch` global en lugar de `groq-sdk`.** Node 26 ya trae `fetch`, y la llamada es un único POST. Añadir un SDK por eso mete una dependencia con su propia cadena transitiva a cambio de ahorrar unas quince líneas. Contra: el reintento hay que escribirlo a mano. Se asume; son cinco líneas y así se controla exactamente qué códigos se reintentan.

- **`response_format: json_schema` estricto en lugar de parsear texto.** Sin el esquema hay que aceptar que el modelo devuelva markdown, comillas raras o un preámbulo, y escribir un parser defensivo que se rompe cada vez que el modelo cambia de humor. Con el esquema, la respuesta o cumple o la petición falla, y el fallo es visible. Descartado también `response_format: json_object` (JSON válido pero de forma libre): resuelve las comillas, no la forma.

- **`temperature: 0`.** Es OCR: la misma imagen debe dar el mismo texto. Cualquier temperatura por encima de cero convierte un bug reproducible en uno intermitente.

- **`Promise.allSettled` en vez de `Promise.all`.** Con `all`, un screenshot borroso que hace fallar a Groq tira la petición entera y el usuario pierde los otros cuatro. Con `allSettled` se devuelve lo que sí se pudo leer y se informa del recuento en `failed`.

- **Deduplicación en el backend, no en el cliente.** Los screenshots de una playlist larga se solapan casi siempre — el usuario baja un poco y vuelve a capturar. Deduplicar aquí significa que cualquier cliente futuro (móvil, CLI) hereda el comportamiento, y que la clave de dedup vive en el mismo sitio que la generación de `id`.

- **`id` determinista por hash, no `uuid()`.** Un uuid nuevo en cada subida rompe el "esta canción ya está en Selected" y hace que React remonte filas que no cambiaron. El hash de título y artista es estable entre peticiones y entre sesiones. Contra: dos canciones distintas con el mismo título y artista colisionan; se acepta, porque en ese caso son la misma canción a efectos de esta app.

- **Se conserva `confidence`, pero nunca filtra.** La confianza autodeclarada de un LLM no está calibrada, así que usarla como umbral descartaría canciones reales con un número en el que no se puede confiar. Se queda como señal visual (el frontend ya la colorea) y la decisión la toma el usuario. Descartado filtrar por debajo de 60 en el backend.

- **Límite de 5 ficheros por 4MB.** 4MB es el techo práctico de Groq para una imagen en base64. 5 acota una petición a 5 llamadas concurrentes al modelo, que es donde empiezan los 429. Descartado subir a 10 (más 429 y una petición notablemente más lenta) y descartado 1 por petición (mejor feedback incremental, pero N round trips y N verificaciones de JWT).

- **Los servicios son los handlers de Express, sin capa de controladores.** Es el patrón que ya usan `services/users/user.js` y `services/auth/auth.js`. Introducir controladores solo en esta feature dejaría el repo con dos arquitecturas.

- **Se envía el stub de `POST /songs/playlist` en esta spec.** Cuesta veinte líneas y fija el contrato contra el que el frontend programa hoy; cuando llegue la spec de Spotify se rellena el cuerpo sin tocar el cliente. Descartado dejar el botón como acción puramente local: obligaría a recablear el frontend después.

- **Sin persistencia.** El usuario revisa y decide en la misma sesión; guardar la extracción exige elegir base (Postgres vía Prisma o Mongo vía Mongoose, el repo usa las dos), modelar el ciclo de vida y limpiar. Nada de eso aporta a la primera versión. Si aparece la necesidad de historial, es su propia spec.

## Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| Groq lee mal títulos con tipografía pequeña o fondos con poco contraste. | `temperature: 0` y un prompt que describe explícitamente la estructura de fila de Apple Music. `confidence` marca las dudosas y el usuario confirma antes de añadir. No hay mitigación automática: la revisión humana **es** la mitigación. |
| El modelo confunde el álbum con el artista. Apple Music muestra a veces "Artista — Álbum" bajo el título. | El prompt lo indica y pide quedarse con el artista. Riesgo residual real; se detecta en la revisión manual del criterio de aceptación. |
| `confidence` alta en una lectura equivocada. El número no está calibrado. | Documentado aquí y en la spec del frontend: es una pista, no una garantía. Nunca se filtra por él. |
| 429 de Groq con 5 screenshots a la vez. | Reintento con backoff para 429 y 5xx. Si aun así falla, ese screenshot cuenta en `failed` y los demás se devuelven. |
| `GROQ_API_KEY` ausente o inválida en producción. | El cliente lanza `AppError` 502 con mensaje propio, distinguible de un 500 genérico. Añadida a `.env.example` para que no se olvide al desplegar. |
| Coste por petición sin control. Cada screenshot es una llamada facturada y la ruta no tiene rate limit. | Aceptado a sabiendas para la primera versión: la ruta exige JWT, así que no es anónima. Recuperar `middlewares/rate-limiter.js` antes de exponerla públicamente. |
| Imágenes en memoria: 5 por 4MB en cada petición concurrente. | `memoryStorage` con límites duros. Con concurrencia alta habría que pasar a disco o a streaming; fuera de alcance mientras el uso sea de un usuario a la vez. |
| Screenshots con datos personales pasan por un tercero (Groq). | La imagen no se guarda ni en el backend ni, por contrato de Groq, para entrenamiento. Debe constar si la app llega a tener usuarios reales. |
| `.env` está commiteado en el repo. Añadir `GROQ_API_KEY` ahí filtra la clave. | Se crea `.env.example` con las claves vacías y se verifica `.gitignore` antes de escribir la clave real. **Bloqueante: comprobar en el paso 1.** |

## Lo que **no** entra en esta spec

- Spotify: OAuth, búsqueda, escritura real en playlist.
- Persistir extracciones o historial de subidas.
- Rate limiting.
- Búsqueda por texto en Apple Music.
- Cache de resultados por imagen.

Cada una, si llega, en su propia spec.
