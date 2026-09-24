# web/ — React Professor Dashboard (Owner C)

Owner **C** — also owns `../infra/` and root shared config.

## Stack
React 18 + Vite + TypeScript + Zustand (shadcn/ui to be added by C).

## Run (local)
```bash
cd web
npm install
npm run dev          # http://localhost:5173
```
Dev server proxies `/api/*` → backend `http://localhost:8000`.

## Build
```bash
npm run build        # tsc -b && vite build -> dist/
```

## Boundaries
- Reads the API contract from `../contracts/` (READ-ONLY).
- Does not edit `backend/`, `mobile/`, `contracts/`.
