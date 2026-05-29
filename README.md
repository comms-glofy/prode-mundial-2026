# 🏆 Prode Mundial 2026 — Glofy × Don Gestión

Sitio interno de prode para el Mundial 2026. Deployado en GitHub Pages con backend en Supabase y resultados automáticos vía API-Football.

---

## ⚙️ Stack

| Capa | Tecnología | Costo |
|------|-----------|-------|
| Hosting | GitHub Pages | Gratis |
| Base de datos | Supabase (PostgreSQL) | Gratis hasta 500MB |
| Resultados automáticos | API-Football (RapidAPI) | Gratis hasta 100 req/día |
| Frontend | HTML + JS vanilla | — |

---

## 🚀 Setup en 4 pasos

### 1. Crear base de datos en Supabase

1. Entrar a [supabase.com](https://supabase.com) → crear cuenta → nuevo proyecto
2. Ir a **SQL Editor** y ejecutar el contenido de `supabase/schema.sql`
3. En **Settings → API** copiar:
   - `Project URL` → reemplazar `SUPABASE_URL` en `js/config.js`
   - `anon public key` → reemplazar `SUPABASE_ANON_KEY` en `js/config.js`

### 2. Configurar API-Football (resultados automáticos)

1. Entrar a [rapidapi.com](https://rapidapi.com/api-sports/api/api-football) → suscribirse al plan gratuito
2. Copiar la API Key → reemplazar `RAPIDAPI_KEY` en `js/config.js`

### 3. Subir a GitHub Pages

```bash
# En tu repo de GitHub:
# Settings → Pages → Source: "Deploy from branch" → branch: main → folder: / (root)
```

### 4. (Opcional) Automatizar resultados con GitHub Actions

El archivo `.github/workflows/update-results.yml` ya está configurado.
Corre cada hora durante el Mundial y actualiza los resultados automáticamente.
Solo necesitás agregar `RAPIDAPI_KEY` y `SUPABASE_SERVICE_KEY` como **Repository Secrets** en GitHub.

---

## 📁 Estructura del proyecto

```
prode-mundial-2026/
├── index.html              ← App principal
├── admin.html              ← Panel de admin (resultados manuales)
├── js/
│   ├── config.js           ← 🔑 Credenciales (NO commitear con datos reales)
│   ├── app.js              ← Lógica principal
│   ├── supabase.js         ← Conexión a base de datos
│   ├── api-football.js     ← Resultados automáticos
│   └── scoring.js          ← Sistema de puntuación
├── css/
│   └── style.css           ← Estilos (identidad Glofy × Don Gestión)
├── supabase/
│   └── schema.sql          ← SQL para crear las tablas
├── .github/
│   └── workflows/
│       └── update-results.yml  ← Auto-actualización de resultados
└── README.md
```

---

## 🔐 Seguridad

- `js/config.js` contiene la `anon key` de Supabase → es pública por diseño (Supabase usa Row Level Security)
- La `service_role key` NUNCA va en el frontend → solo en GitHub Secrets para las Actions
- El panel `/admin.html` está protegido por contraseña simple (configurable en `config.js`)

---

## 📊 Sistema de puntos

| Resultado | Puntos |
|-----------|--------|
| Resultado exacto | 3 pts |
| Ganador / Empate correcto | 1 pt |
| Incorrecto | 0 pts |
| Bonus Argentina (eliminatoria) | ×2 |

---

## 🏅 Premios

| Puesto | Premio |
|--------|--------|
| 🥇 1° | $150.000 |
| 🥈 2° | $100.000 |
| 🥉 3° | $50.000 |

---

*Iniciativa cultural interna · Glofy × Don Gestión · Mundial USA·México·Canadá 2026*
