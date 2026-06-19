# Prisma Client — Instanciación correcta

## El problema con instanciar en cada archivo

`PrismaClient` gestiona un **pool de conexiones** a la base de datos. Si creas una instancia por archivo o por request, terminas con múltiples pools abiertos simultáneamente.

Supabase free tier tiene un límite de ~60 conexiones. Con múltiples instancias lo agotás rápido.

```js
// ❌ Mal — instancia por archivo
const { PrismaClient } = require('../../generated/prisma')
const prisma = new PrismaClient() // cada módulo abre su propio pool
```

---

## La solución: singleton compartido

Crea un archivo `lib/prisma.js` en la raíz del proyecto y exporta una sola instancia que toda la app comparte.

```js
// lib/prisma.js
const { PrismaClient } = require('./generated/prisma')

const prisma = global.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma
}

module.exports = prisma
```

El guard con `global.prisma` es para **nodemon**: cuando recarga el proceso en desarrollo, evita que se acumulen instancias huérfanas.

---

## Uso en servicios

```js
// services/auth/auth.js
const prisma = require('../../lib/prisma')

const getAuthToken = async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { email: req.body.email }
  })
  // ...
}
```

---

## Comparativa

| | Singleton `lib/prisma.js` | Instancia por archivo |
|---|---|---|
| Pools de conexión | 1 compartido | N (uno por módulo) |
| Límite Supabase free | No lo alcanzás | Lo agotás rápido |
| Compatibilidad con nodemon | Con guard de `global` | Mismo problema |
| Mantenimiento | Un solo lugar | Configuración duplicada |
