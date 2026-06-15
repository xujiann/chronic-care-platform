# Deployment

## Local Development

```powershell
cd "C:\Users\drxuj\OneDrive\3.信息化\0.高质量发展 信息化\chronic-care-platform"
npm.cmd run dev
```

Open:

```text
http://localhost:5173/
```

Citizen app:

```text
http://localhost:5173/citizen.html
```

Mobile preview:

```text
http://localhost:5173/mobile-preview.html
```

## GitHub Pages

GitHub Pages can host the static pages:

- `index.html`
- `citizen.html`
- `mobile-preview.html`
- CSS and JS assets

In GitHub Pages mode, no Node.js API runs. The citizen app can still use browser `localStorage` for static demos, but shared data persistence is not available.

## API Deployment

The Node.js API is in `server.js`.

Current endpoints:

```text
GET  /api/health
GET  /api/state
PUT  /api/state
POST /api/reset
GET  /api/personal-records
POST /api/personal-records
PATCH /api/personal-records/:id
```

For a production-style deployment, deploy the API to a Node-capable platform and replace the local JSON store with SQLite or PostgreSQL.

## Recommended Split

Current MVP can stay in one repository first:

```text
chronic-care-platform
```

Later split into:

```text
chronic-care-admin
chronic-care-citizen
chronic-care-api
```

See `GITHUB_PUBLISH.md` for publishing from this Windows machine.
