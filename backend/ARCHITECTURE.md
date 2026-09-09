# Document Converter SaaS Backend

## Folder Structure

```text
backend/
  Dockerfile              # API image, Express only
  Dockerfile.worker       # Worker image, LibreOffice/Tesseract conversion runtime
  docker-compose.yml      # API, worker, Redis, optional Postgres, shared temp/output volumes
  src/
    app.js                # Express app and API routes
    index.js              # API process entrypoint + Socket.IO event bridge
    worker.js             # Worker process entrypoint, no Express routes
    config/               # env, Postgres, Redis, Winston logger
    controllers/          # auth, async job submission/status, notifications
    db/                   # SQL schema and migration runner
    jobs/                 # conversion processor
    middleware/           # auth, upload validation, rate limiting, virus scan hook
    routes/               # /auth, /convert, /jobs, /history, /files, /health
    services/             # queue, storage, history, OCR/PDF/Office conversion, sockets
    utils/                # filename/path helpers and validators
```

## Services

`api` runs `node src/index.js`. It handles auth, uploads, job metadata, Redis enqueue, job polling, signed downloads, history, Socket.IO subscriptions, and health checks.

`worker` runs `node src/worker.js`. It has no Express server. It consumes BullMQ jobs from Redis, runs PDF/Office/OCR work, writes output to local/S3/Cloudinary storage, updates progress, and exits cleanly on signals.

`redis` stores BullMQ state: queued, active, delayed, retrying, completed, failed, and dead-letter jobs.

`postgres` stores users, conversion history, conversion job state, file metadata, analytics, auth tokens, and push tokens.

## Queue Lifecycle

BullMQ queue: `document-conversions`

Dead-letter queue: `document-conversions-dlq`

Default behavior:
- `attempts`: `JOB_ATTEMPTS`, default `3`
- `backoff`: exponential, starts at `3000ms`
- `timeout`: `JOB_TIMEOUT_MS`, default `300000ms`
- final failed jobs are copied to the dead-letter queue with the original payload and failure reason

The API returns immediately:

```json
{
  "success": true,
  "message": "Conversion queued.",
  "data": {
    "jobId": "42",
    "historyId": "uuid",
    "status": "queued"
  }
}
```

## Realtime Events

Socket.IO emits `job:update` to `job:{jobId}` and authenticated `user:{userId}` rooms.

Payload:

```json
{
  "jobId": "42",
  "historyId": "uuid",
  "conversionType": "pdf-to-word",
  "status": "processing",
  "progress": 40,
  "retryCount": 1,
  "processingTimeMs": null,
  "result": null,
  "error": null
}
```

Frontend subscription:

```js
socket.emit("job:subscribe", jobId);
socket.on("job:update", (event) => console.log(event));
```

## File Handling

Uploads are written to:

```text
/tmp/uploads/{userId-or-anonymous}/{uploadId}/
```

Outputs are written to:

```text
/tmp/outputs/
```

Local downloads use signed URLs:

```text
GET /files/:fileName?exp=:unixTimestamp&sig=:hmac
```

Cleanup runs hourly and deletes temp/output files older than `FILE_TTL_HOURS` (default 24). S3 and Cloudinary storage can be enabled with `STORAGE_PROVIDER`.

## API Examples

Upload a PDF to Word:

```bash
curl -X POST http://localhost:4000/convert/pdf-to-word \
  -H "Authorization: Bearer $JWT" \
  -F "file=@contract.pdf"
```

Merge PDFs:

```bash
curl -X POST http://localhost:4000/convert/pdf-merge \
  -H "Authorization: Bearer $JWT" \
  -F "files=@a.pdf" \
  -F "files=@b.pdf"
```

Run OCR:

```bash
curl -X POST http://localhost:4000/convert/ocr \
  -H "Authorization: Bearer $JWT" \
  -F "file=@scan.png" \
  -F "language=eng" \
  -F "exportFormat=txt"
```

Poll status:

```bash
curl http://localhost:4000/jobs/42 -H "Authorization: Bearer $JWT"
```

Health check:

```bash
curl http://localhost:4000/health
```

## Docker

Run the stack:

```bash
cd backend
cp .env.example .env
npm run migrate
docker compose up --build
```

Scale workers:

```bash
docker compose up --scale worker=3
```

The API image intentionally does not install LibreOffice/Tesseract. Conversion tooling lives only in the worker image.

## Environment

Core variables:

```text
NODE_ENV=production
SERVICE_NAME=document-converter-api
LOG_LEVEL=info
PORT=4000
API_BASE_URL=https://api.example.com
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=...
JWT_REFRESH_SECRET=...
UPLOAD_DIR=/tmp/uploads
OUTPUT_DIR=/tmp/outputs
MAX_FILE_SIZE_MB=25
FILE_TTL_HOURS=24
QUEUE_CONCURRENCY=3
JOB_ATTEMPTS=3
JOB_TIMEOUT_MS=300000
DEAD_LETTER_QUEUE_NAME=document-conversions-dlq
STORAGE_PROVIDER=local
```

S3 variables:

```text
STORAGE_PROVIDER=s3
AWS_REGION=us-east-1
S3_BUCKET=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

## Deployment Notes

Railway/Render:
- deploy `Dockerfile` as the API service
- deploy `Dockerfile.worker` as a background worker service
- provision Redis and Postgres add-ons
- set the same `DATABASE_URL`, `REDIS_URL`, `JWT_*`, and storage env vars on both API and worker
- run `npm run migrate` once during release

AWS ECS:
- run API and worker as separate task definitions
- attach Redis/ElastiCache and RDS Postgres
- mount EFS for local shared storage or use S3 for production storage
- scale worker desired count independently from API desired count

## Observability

Winston emits JSON logs for API errors, queue lifecycle events, worker completions/failures, retries, and dead-letter moves. Sentry can be added inside `config/logger.js` or the process entrypoints without changing queue or route code.
