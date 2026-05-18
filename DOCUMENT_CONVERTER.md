# Document Converter Feature

Full-stack document conversion for the Document Scanner app: **Expo React Native frontend** + **Node.js/Express backend**.

## 1. Backend folder structure

```
backend/
├── package.json
├── .env.example
├── .gitignore
└── src/
    ├── index.js
    ├── app.js
    ├── config/env.js
    ├── middleware/
    │   ├── upload.js
    │   ├── errorHandler.js
    │   └── premiumGate.js
    ├── routes/
    │   ├── convert.routes.js
    │   ├── pdf.routes.js
    │   ├── files.routes.js
    │   └── health.routes.js
    ├── controllers/
    │   ├── convertController.js
    │   └── pdfController.js
    ├── services/
    │   ├── conversionQueue.js
    │   ├── pdfService.js
    │   ├── officeService.js
    │   ├── imageService.js
    │   └── cleanupService.js
    └── utils/
        ├── fileUtils.js
        ├── validators.js
        └── analytics.js
```

## 2. Frontend structure

```
src/
├── constants/conversions.js
├── theme/ (dark mode)
├── services/ (api, conversion, history)
├── components/converter/
├── screens/converter/
└── navigation/ConverterStack.js
```

## 3. API routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/health` | Health check |
| POST | `/convert/pdf-to-word` | PDF → DOCX |
| POST | `/convert/pdf-to-excel` | PDF → XLSX |
| POST | `/convert/word-to-pdf` | Word → PDF |
| POST | `/convert/excel-to-pdf` | Excel → PDF |
| POST | `/convert/image-to-pdf` | Images → PDF |
| POST | `/pdf/merge` | Merge PDFs |
| POST | `/pdf/split` | Split PDF by pages |
| POST | `/pdf/compress` | Compress PDF |
| GET | `/files/:fileName` | Download converted file |

## 4. Example API requests

### PDF to Word

```bash
curl -X POST http://localhost:4000/convert/pdf-to-word \
  -F "file=@./sample.pdf"
```

### Merge PDFs

```bash
curl -X POST http://localhost:4000/pdf/merge \
  -F "files=@./a.pdf" \
  -F "files=@./b.pdf"
```

### Split PDF

```bash
curl -X POST http://localhost:4000/pdf/split \
  -F "file=@./sample.pdf" \
  -F "pages=1-3,5"
```

### Success response

```json
{
  "success": true,
  "message": "Conversion completed successfully.",
  "data": {
    "fileName": "uuid.docx",
    "downloadUrl": "http://localhost:4000/files/uuid.docx",
    "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "fallback": false
  }
}
```

## 5. Installation commands

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

**LibreOffice required** for best Word/Excel/PDF office conversions:

- macOS: `brew install --cask libreoffice`
- Ubuntu: `sudo apt install libreoffice`

Without LibreOffice, PDF→Word/Excel use text-extraction fallbacks (`pdf-parse` + `docx`/`xlsx`).

### Frontend

```bash
# project root
npm install
```

Create `.env` in project root (optional):

```env
EXPO_PUBLIC_API_URL=http://YOUR_LOCAL_IP:4000
```

> Use your machine LAN IP (not `localhost`) when testing on a physical device.

```bash
npm run start
```

## 6. Environment variables

### Backend (`backend/.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4000` | API port |
| `API_BASE_URL` | `http://localhost:4000` | Public download URL base |
| `MAX_FILE_SIZE_MB` | `25` | Upload limit |
| `FILE_TTL_MINUTES` | `60` | Auto-delete old files |
| `QUEUE_CONCURRENCY` | `2` | Parallel conversions |
| `ENABLE_PREMIUM_GATE` | `false` | Require `x-premium-user: true` header |
| `ENABLE_OCR` | `false` | OCR placeholder flag |
| `CORS_ORIGIN` | `*` | CORS allowed origins |

### Frontend

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_API_URL` | Backend base URL |

## 7. Features implemented

- Upload UI with tap-to-pick zone (mobile drag-and-drop style)
- Upload + conversion progress bars
- Success/error banners
- Conversion history (AsyncStorage)
- File size validation (25MB default)
- Dark mode toggle
- Preview, download, and share converted files
- Multer secure uploads + MIME validation
- Conversion queue
- Temp file cleanup scheduler
- Rate limiting + Helmet
- Analytics logging (`[analytics]` console)
- Premium gate middleware (optional)

## 8. Bonus (stubs / ready to extend)

- **OCR**: set `ENABLE_OCR=true`, integrate Tesseract or cloud OCR in `officeService`
- **Cloud storage**: add AWS SDK, upload output in `fileUtils.buildPublicUrl`
- **Premium**: enable `ENABLE_PREMIUM_GATE`, send header from app
- **Watermark**: add post-processing in `pdfService` for free users

## 9. Deployment recommendations

### Backend

- Deploy to **Railway**, **Render**, **Fly.io**, or **AWS EC2**
- Install LibreOffice in the container image
- Mount ephemeral disk for `uploads/`
- Put API behind HTTPS reverse proxy (Nginx/Caddy)
- Use Redis + BullMQ for production queue at scale
- Store outputs in S3 with signed URLs

### Mobile

- Set `EXPO_PUBLIC_API_URL` to production API
- Use EAS Build for iOS/Android releases
- Configure iOS `NSAppTransportSecurity` / Android cleartext only for dev

## 10. Troubleshooting

| Issue | Fix |
|-------|-----|
| `env: node: No such file or directory` | Install/fix Node via `nvm` or Homebrew |
| Network error on device | Use LAN IP in `EXPO_PUBLIC_API_URL` |
| Word/Excel conversion fails | Install LibreOffice on backend host |
| 402 Premium required | Set `ENABLE_PREMIUM_GATE=false` or pass `x-premium-user: true` |
