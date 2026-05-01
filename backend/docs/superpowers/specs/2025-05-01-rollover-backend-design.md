# Rollover Backend — Design Spec

**Date:** 2025-05-01  
**Status:** Approved  
**Author:** OpenCode  

---

## 1. Purpose

Provide a production-grade Node.js/Express backend for the Audit Automation Rollover Module. The backend exposes REST endpoints to trigger a Python script that processes Dropbox-based audit files, copying and updating them from a previous financial year to a new one.

---

## 2. Architecture

**Pattern:** Asynchronous Job Queue with Polling  
**Rationale:** The Python script may run for 30–120 seconds ( Dropbox download → process → upload). Blocking the HTTP request risks gateway timeouts and provides poor UX. An async job model with polling is the simplest production-grade solution.

---

## 3. Data Flow

```
Frontend POST /api/rollover
    │ Body: { clientName, newFinancialYear }
    ▼
Backend validates input
    │
    ▼
Backend creates jobId (UUID v4)
    │ Stores in JobStore with status="pending"
    ▼
Backend spawns rollover.py via child_process.spawn
    │ Passes DROPBOX_ACCESS_TOKEN as env var
    │ status → "running"
    ▼
Frontend polls GET /api/rollover/status/:jobId  (every 2–5s)
    │
    ▼
Python finishes → status="completed" + result JSON
    │
    ▼
Frontend displays success + summary
```

**Failure path:** If Python exits non-zero or times out → status="failed" + error message + captured stderr.

---

## 4. API Contract

### POST /api/rollover
**Description:** Trigger a rollover job.

**Request Body:**
```json
{
  "clientName": "Acme Corp",
  "newFinancialYear": "FY 2025-2026"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "jobId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Validation Errors (400 Bad Request):**
- `clientName` missing or empty
- `newFinancialYear` missing or not matching expected format

**Server Errors (500 Internal Server Error):**
- Failed to spawn Python process
- DROPBOX_ACCESS_TOKEN not configured

---

### GET /api/rollover/status/:jobId
**Description:** Check the status of a rollover job.

**Response (200 OK) — Pending/Running:**
```json
{
  "success": true,
  "jobId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "running",
  "logs": ["Downloading AUDIT PROGRAMME...", "Processing Excel files..."],
  "result": null,
  "error": null
}
```

**Response (200 OK) — Completed:**
```json
{
  "success": true,
  "jobId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "completed",
  "logs": [...],
  "result": {
    "status": "ok",
    "source_year": "FY 2024-2025",
    "target_year": "FY 2025-2026",
    "folders_copied": ["AUDIT PROGRAMME", "AWP", "REPORT"],
    "files_processed": {
      "excel": 12,
      "word": 3,
      "removed": 5
    }
  },
  "error": null
}
```

**Response (200 OK) — Failed:**
```json
{
  "success": true,
  "jobId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "failed",
  "logs": [...],
  "result": null,
  "error": "Dropbox API error: path not found"
}
```

**Response (404 Not Found):**
- `jobId` does not exist (or has been cleaned up after 24h)

---

## 5. File Structure

```
rollover-backend/
├── server.js                          # Express app entry point
├── routes/
│   └── rolloverRoutes.js              # POST /rollover, GET /status/:jobId
├── controllers/
│   └── rolloverController.js          # Input validation + response formatting
├── services/
│   ├── pythonRunner.js                # child_process.spawn wrapper with env & timeout
│   └── jobStore.js                    # In-memory Map for job state tracking
├── scripts/
│   └── rollover.py                    # Existing Python Dropbox script (unchanged)
├── utils/
│   └── logger.js                      # Winston: console + file logs
└── package.json
```

---

## 6. Component Specifications

### 6.1 jobStore.js
- **Storage:** In-memory `Map<string, Job>`
- **Job shape:** `{ jobId, status, createdAt, updatedAt, logs: string[], result?: object, error?: string }`
- **States:** `pending` → `running` → `completed` | `failed`
- **Methods:**
  - `create(clientName, newFinancialYear)` → returns `jobId`
  - `get(jobId)` → returns `Job | undefined`
  - `update(jobId, partialJob)` → merges updates
  - `appendLog(jobId, logLine)` → pushes to logs array
- **Cleanup:** Auto-delete jobs older than 24 hours on any `get()` call (memory leak prevention)

### 6.2 pythonRunner.js
- **Function:** `runRollover(jobId, clientName, newFinancialYear)` → returns `Promise<void>`
- **Spawn command:** Uses the virtualenv Python:
  ```
  /Users/steventok/Documents/code/rollover-backend/rollover-backend/bin/python scripts/rollover.py --client "<name>" --year "<year>"
  ```
- **Environment:** `DROPBOX_ACCESS_TOKEN` passed via `env` option
- **Timeout:** 10 minutes (600,000 ms). On timeout, kill process and mark job failed.
- **Output handling:**
  - stdout appended to job logs line-by-line
  - Last line of stdout parsed as JSON → stored in `result`
  - stderr appended to job logs; on non-zero exit, stored in `error`
- **Process tracking:** Store `ChildProcess` reference in a Map keyed by `jobId` (for forced cancellation if needed)

### 6.3 rolloverController.js
- **Method:** `createRollover(req, res)`
  1. Validate `clientName` (non-empty string)
  2. Validate `newFinancialYear` (matches `/^(FY\s*)?\d{4}\s*[-–]\s*\d{4}$/i`)
  3. Create job via `jobStore.create()`
  4. Call `pythonRunner.runRollover()` — **do NOT await** (fire-and-forget)
  5. Respond with `201` + `{ jobId }`
- **Method:** `getStatus(req, res)`
  1. Read `jobId` from params
  2. Fetch job via `jobStore.get()`
  3. If not found → `404`
  4. Respond with `200` + job object

### 6.4 logger.js (Winston)
- **Levels:** `error`, `warn`, `info`, `debug`
- **Transports:**
  - Console (colorized, simple format for dev)
  - File: `logs/combined.log` (all levels, JSON format)
  - File: `logs/error.log` (level `error` only)
- **Usage:** Every controller action and service method logs its entry point, parameters, and outcome.

### 6.5 Error Handling
- **Input validation:** Joi or manual validation in controller → `400` with `{ success: false, message }`
- **Python errors:** Captured stderr → job status `failed` → frontend displays error
- **Timeout:** Process killed after 10 min → job status `failed`
- **Uncaught errors:** Express global error handler middleware returns `500` with generic message (detailed log on server only)

---

## 7. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: 3000) |
| `DROPBOX_ACCESS_TOKEN` | Yes | Dropbox API token passed to Python script |
| `PYTHON_PATH` | No | Path to Python executable (default: venv python) |
| `LOG_LEVEL` | No | Winston log level (default: `info`) |

---

## 8. Security Considerations

- `DROPBOX_ACCESS_TOKEN` stored in environment variables, never logged or returned to client
- Input validation prevents injection via `clientName` or `newFinancialYear`
- Python process spawned with controlled arguments (no shell interpolation)
- JobStore does not expose internal file paths or tokens in API responses

---

## 9. Dependencies

```json
{
  "express": "^4.18.0",
  "winston": "^3.11.0",
  "uuid": "^9.0.0",
  "dotenv": "^16.3.0"
}
```

---

## 10. Open Questions / Future Work

- **Authentication:** Currently no auth on API endpoints. Add JWT middleware for production.
- **Persistence:** JobStore is in-memory only. For multi-instance deployment, switch to Redis or PostgreSQL.
- **Cancellation:** No endpoint to cancel a running job. Could add `DELETE /api/rollover/:jobId` to kill the process.
- **Progress:** Currently logs are text only. Could add structured progress percentage in Python stdout for a progress bar on the frontend.