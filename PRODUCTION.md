# Production Architecture Guide

## Architecture Overview

```
Mobile App (Expo)
   │
   ▼
API Server (Express) ──enqueue──▶ Redis (BullMQ)
   │                                    │
   ▼                                    ▼
PostgreSQL (users, history, analytics)  Worker Pool
                                           │
                                           ▼
                                    LibreOffice + Tesseract
                                           │
                                           ▼
                                    S3 / Cloudinary (signed URLs)
```

## Quick Start (Docker)

```bash
cd backend
cp .env.example .env
docker compose up --build
docker compose exec api node src/db/migrate.js
```

Services:
- API: `http://localhost:4000`
- Redis: `6379`
- Postgres: `5432`

## Run Locally (without Docker)

Terminal 1:
```bash
cd backend && npm install && npm run migrate && npm run dev
```

Terminal 2:
```bash
cd backend && npm run worker
```

Terminal 3:
```bash
npm install && npm run start
```

## New API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /auth/register` | Create account |
| `POST /auth/login` | JWT login |
| `GET /auth/me` | Current user |
| `GET /jobs/:jobId` | Poll conversion job |
| `GET /history` | Server-side history (auth) |
| `DELETE /history/:id` | Delete history entry |
| `GET /history/:id/download` | Fresh signed URL |
| `GET /ocr/languages` | OCR language list |
| `POST /ocr/extract` | OCR job (queued) |
| `POST /ocr/extract-sync` | Immediate OCR JSON |
| `POST /billing/checkout` | Stripe checkout |
| `POST /billing/webhook` | Stripe webhook |
| `GET /analytics/dashboard` | Usage stats |

All `/convert/*` and `/pdf/*` routes now return `202` with `{ jobId, historyId }`.

## Environment Variables

See `backend/.env.example` and `.env.example` (mobile).

## Mobile Features

- **OCR**: Converter → OCR tab
- **History stack**: delete + re-download (local + server when logged in)
- **Offline queue**: failed network jobs queued in AsyncStorage
- **Notifications**: conversion complete/fail alerts
- **Dark mode**: theme toggle on converter home
- **Scan-to-PDF**: Dashboard camera flow (existing)

## Security

- JWT auth on protected routes
- Rate limiting (global + upload)
- MIME/extension validation
- Virus scan hook (`ENABLE_VIRUS_SCAN`)
- Dangerous file types blocked

## Monetization

- Free plan: `FREE_DAILY_LIMIT` conversions/day
- Watermark on PDF outputs for free users
- Stripe Pro checkout via `/billing/checkout`
- Header: `x-premium-user: true` bypasses limits (legacy)

## Deployment

### Railway
- Deploy `backend/` using `railway.json`
- Add Redis + Postgres plugins
- Deploy worker as separate service using `Dockerfile.worker`

### Render
- Use `render.yaml` for web + worker + Redis + Postgres

## Example: Poll Job

```bash
# 1. Upload
curl -X POST http://localhost:4000/convert/pdf-to-word \
  -H "Authorization: Bearer TOKEN" \
  -F "file=@doc.pdf"

# Response: { "jobId": "1", "historyId": "..." }

# 2. Poll
curl http://localhost:4000/jobs/1
```

## OCR JSON Response

```json
{
  "ocr": {
    "text": "Extracted content...",
    "confidence": 92.5,
    "language": "eng",
    "source": "tesseract-ocr",
    "pages": [{ "page": 1, "text": "...", "confidence": 92 }]
  }
}
```
