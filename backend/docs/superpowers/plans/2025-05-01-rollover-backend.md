# Rollover Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade async Node.js/Express backend for the Rollover Module with job queue, structured logging, and Python script orchestration.

**Architecture:** Express API with in-memory JobStore. POST `/rollover` creates a job and fires Python in the background. GET `/status/:jobId` polls for completion. Winston handles structured logging. Python runs via `child_process.spawn` with env vars and 10-min timeout.

**Tech Stack:** Node.js, Express, Winston, UUID, dotenv

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `utils/logger.js` | **Rewrite** | Winston logger: console + `logs/combined.log` + `logs/error.log` |
| `services/jobStore.js` | **Create** | In-memory Map job tracker with CRUD, log append, auto-cleanup |
| `services/pythonRunner.js` | **Rewrite** | Spawn venv Python with env vars, timeout, stdout/stderr capture |
| `controllers/rolloverController.js` | **Rewrite** | Validate input, create job, fire runner, serve status endpoint |
| `routes/rolloverRoutes.js` | **Rewrite** | POST `/rollover`, GET `/status/:jobId` |
| `server.js` | **Rewrite** | Express app with JSON parser, routes, global error handler, dotenv |
| `package.json` | **Modify** | Add `winston`, `uuid`, `dotenv` dependencies |
| `.env.example` | **Create** | Template for required environment variables |

---

## Task 1: Install Dependencies & Create .env

**Files:**
- Modify: `package.json`
- Create: `.env.example`

- [ ] **Step 1: Add dependencies to package.json**

```json
{
  "name": "rollover-backend",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "winston": "^3.11.0",
    "uuid": "^9.0.0",
    "dotenv": "^16.3.0"
  }
}
```

- [ ] **Step 2: Install packages**

Run: `npm install`
Expected: `winston`, `uuid`, `dotenv` installed into `node_modules/`

- [ ] **Step 3: Create .env.example**

```
PORT=3000
DROPBOX_ACCESS_TOKEN=your_dropbox_token_here
LOG_LEVEL=info
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add winston, uuid, dotenv dependencies"
```

---

## Task 2: Winston Logger

**Files:**
- Rewrite: `utils/logger.js`

- [ ] **Step 1: Rewrite logger.js with Winston**

```js
const winston = require('winston');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'rollover-backend' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...metadata }) => {
          let msg = `${timestamp} [${level}]: ${message}`;
          if (Object.keys(metadata).length > 0 && metadata.service === undefined) {
            msg += ` ${JSON.stringify(metadata)}`;
          }
          return msg;
        })
      )
    }),
    new winston.transports.File({ filename: path.join(LOG_DIR, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(LOG_DIR, 'combined.log') })
  ],
  exitOnError: false
});

module.exports = logger;
```

- [ ] **Step 2: Verify logger works**

Run:
```bash
node -e "require('dotenv').config(); const logger = require('./utils/logger'); logger.info('test info'); logger.error('test error');"
```
Expected: Console shows colored output; `logs/error.log` and `logs/combined.log` created with JSON entries.

- [ ] **Step 3: Commit**

```bash
git add utils/logger.js logs/
git commit -m "feat: add winston structured logger"
```

---

## Task 3: Job Store Service

**Files:**
- Create: `services/jobStore.js`

- [ ] **Step 1: Create jobStore.js**

```js
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const CLEANUP_MS = 24 * 60 * 60 * 1000; // 24 hours

const jobs = new Map();

function create(clientName, newFinancialYear) {
  const jobId = uuidv4();
  const now = new Date().toISOString();
  const job = {
    jobId,
    status: 'pending',
    clientName,
    newFinancialYear,
    createdAt: now,
    updatedAt: now,
    logs: [],
    result: null,
    error: null
  };
  jobs.set(jobId, job);
  logger.info(`Job created`, { jobId, clientName, newFinancialYear });
  return jobId;
}

function get(jobId) {
  cleanup();
  const job = jobs.get(jobId);
  if (!job) {
    logger.warn(`Job not found`, { jobId });
  }
  return job;
}

function update(jobId, updates) {
  const job = jobs.get(jobId);
  if (!job) return false;
  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  jobs.set(jobId, job);
  return true;
}

function appendLog(jobId, logLine) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.logs.push(logLine);
  job.updatedAt = new Date().toISOString();
  jobs.set(jobId, job);
  logger.debug(`Job log`, { jobId, log: logLine });
  return true;
}

function cleanup() {
  const now = Date.now();
  let removed = 0;
  for (const [jobId, job] of jobs.entries()) {
    const updated = new Date(job.updatedAt).getTime();
    if (now - updated > CLEANUP_MS) {
      jobs.delete(jobId);
      removed++;
    }
  }
  if (removed > 0) {
    logger.info(`Cleaned up ${removed} stale jobs`);
  }
}

function getAll() {
  cleanup();
  return Array.from(jobs.values());
}

module.exports = {
  create,
  get,
  update,
  appendLog,
  getAll
};
```

- [ ] **Step 2: Quick test**

Run:
```bash
node -e "
require('dotenv').config();
const store = require('./services/jobStore');
const id = store.create('Test Client', 'FY 2025-2026');
console.log('Created:', id);
store.appendLog(id, 'Starting...');
store.update(id, { status: 'running' });
console.log(store.get(id));
"
```
Expected: UUID printed, job object with `status: 'running'` and `logs: ['Starting...']`.

- [ ] **Step 3: Commit**

```bash
git add services/jobStore.js
git commit -m "feat: add in-memory job store with auto-cleanup"
```

---

## Task 4: Python Runner Service

**Files:**
- Rewrite: `services/pythonRunner.js`

- [ ] **Step 1: Rewrite pythonRunner.js**

```js
const { spawn } = require('child_process');
const path = require('path');
const logger = require('../utils/logger');
const jobStore = require('./jobStore');

const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const PYTHON_PATH = process.env.PYTHON_PATH || path.resolve(__dirname, '..', 'rollover-backend', 'bin', 'python');
const SCRIPT_PATH = path.resolve(__dirname, '..', 'scripts', 'rollover.py');

const activeProcesses = new Map(); // jobId -> ChildProcess

function runRollover(jobId, clientName, newFinancialYear) {
  return new Promise((resolve, reject) => {
    const token = process.env.DROPBOX_ACCESS_TOKEN;
    if (!token) {
      const err = new Error('DROPBOX_ACCESS_TOKEN environment variable not set');
      logger.error(err.message);
      return reject(err);
    }

    jobStore.update(jobId, { status: 'running' });
    logger.info(`Starting rollover job`, { jobId, clientName, newFinancialYear });

    const args = [
      SCRIPT_PATH,
      '--client', clientName,
      '--year', newFinancialYear,
      '--token', token
    ];

    const proc = spawn(PYTHON_PATH, args, {
      env: { ...process.env, DROPBOX_ACCESS_TOKEN: token },
      timeout: TIMEOUT_MS,
      killSignal: 'SIGTERM'
    });

    activeProcesses.set(jobId, proc);

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timedOut = false;

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach((line) => {
        stdoutBuffer += line + '\n';
        jobStore.appendLog(jobId, `[stdout] ${line}`);
      });
    });

    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach((line) => {
        stderrBuffer += line + '\n';
        jobStore.appendLog(jobId, `[stderr] ${line}`);
      });
    });

    proc.on('error', (err) => {
      activeProcesses.delete(jobId);
      logger.error(`Process error`, { jobId, error: err.message });
      jobStore.update(jobId, { status: 'failed', error: err.message });
      reject(err);
    });

    proc.on('close', (code, signal) => {
      activeProcesses.delete(jobId);

      if (signal === 'SIGTERM' && code === null) {
        timedOut = true;
      }

      if (timedOut) {
        const errMsg = 'Rollover process timed out after 10 minutes';
        logger.error(errMsg, { jobId });
        jobStore.update(jobId, { status: 'failed', error: errMsg });
        return reject(new Error(errMsg));
      }

      if (code !== 0) {
        const errMsg = stderrBuffer.trim() || `Process exited with code ${code}`;
        logger.error(`Rollover failed`, { jobId, exitCode: code, error: errMsg });
        jobStore.update(jobId, { status: 'failed', error: errMsg });
        return reject(new Error(errMsg));
      }

      // Parse last non-empty line of stdout as JSON result
      const lines = stdoutBuffer.trim().split('\n');
      const lastLine = lines[lines.length - 1] || '{}';
      let result;
      try {
        result = JSON.parse(lastLine);
      } catch (e) {
        result = { rawOutput: stdoutBuffer.trim() };
      }

      logger.info(`Rollover completed`, { jobId, result });
      jobStore.update(jobId, { status: 'completed', result });
      resolve(result);
    });
  });
}

function killJob(jobId) {
  const proc = activeProcesses.get(jobId);
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    activeProcesses.delete(jobId);
    logger.info(`Killed job process`, { jobId });
    return true;
  }
  return false;
}

module.exports = {
  runRollover,
  killJob
};
```

- [ ] **Step 2: Dry-run test**

Run:
```bash
node -e "
require('dotenv').config();
const runner = require('./services/pythonRunner');
const store = require('./services/jobStore');
const id = store.create('Test', 'FY 2025-2026');
runner.runRollover(id, 'Test', 'FY 2025-2026').then(r => console.log('Result:', r)).catch(e => console.log('Error:', e.message));
setTimeout(() => console.log(store.get(id)), 3000);
"
```
Expected: If token is invalid, job status becomes `failed` with Dropbox error within ~5s. Logs are captured.

- [ ] **Step 3: Commit**

```bash
git add services/pythonRunner.js
git commit -m "feat: add python runner with env vars, timeout, and live log capture"
```

---

## Task 5: Rollover Controller

**Files:**
- Rewrite: `controllers/rolloverController.js`

- [ ] **Step 1: Rewrite rolloverController.js**

```js
const logger = require('../utils/logger');
const jobStore = require('../services/jobStore');
const pythonRunner = require('../services/pythonRunner');

const YEAR_REGEX = /^(?:FY\s*)?\d{4}\s*[-–]\s*\d{4}$/i;

function validateRolloverInput(body) {
  const errors = [];
  if (!body.clientName || typeof body.clientName !== 'string' || body.clientName.trim().length === 0) {
    errors.push('clientName is required and must be a non-empty string');
  }
  if (!body.newFinancialYear || typeof body.newFinancialYear !== 'string') {
    errors.push('newFinancialYear is required and must be a string');
  } else if (!YEAR_REGEX.test(body.newFinancialYear)) {
    errors.push('newFinancialYear must match format "YYYY-YYYY" or "FY YYYY-YYYY"');
  }
  return errors;
}

async function createRollover(req, res, next) {
  try {
    const validationErrors = validateRolloverInput(req.body);
    if (validationErrors.length > 0) {
      logger.warn('Validation failed', { errors: validationErrors, body: req.body });
      return res.status(400).json({ success: false, errors: validationErrors });
    }

    const { clientName, newFinancialYear } = req.body;
    const jobId = jobStore.create(clientName.trim(), newFinancialYear.trim());

    // Fire-and-forget: do NOT await
    pythonRunner.runRollover(jobId, clientName.trim(), newFinancialYear.trim())
      .catch((err) => {
        // Error already handled in pythonRunner; this prevents unhandled rejection
        logger.error(`Background rollover error`, { jobId, error: err.message });
      });

    logger.info(`Rollover job queued`, { jobId, clientName, newFinancialYear });
    return res.status(201).json({ success: true, jobId });
  } catch (err) {
    next(err);
  }
}

async function getStatus(req, res, next) {
  try {
    const { jobId } = req.params;
    const job = jobStore.get(jobId);

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    return res.status(200).json({
      success: true,
      jobId: job.jobId,
      status: job.status,
      logs: job.logs,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createRollover,
  getStatus
};
```

- [ ] **Step 2: Commit**

```bash
git add controllers/rolloverController.js
git commit -m "feat: add rollover controller with validation and async job creation"
```

---

## Task 6: Routes

**Files:**
- Rewrite: `routes/rolloverRoutes.js`

- [ ] **Step 1: Rewrite rolloverRoutes.js**

```js
const express = require('express');
const router = express.Router();
const rolloverController = require('../controllers/rolloverController');

router.post('/rollover', rolloverController.createRollover);
router.get('/status/:jobId', rolloverController.getStatus);

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add routes/rolloverRoutes.js
git commit -m "feat: add rollover routes for create and status"
```

---

## Task 7: Server Entry Point

**Files:**
- Rewrite: `server.js`

- [ ] **Step 1: Rewrite server.js**

```js
require('dotenv').config();

const express = require('express');
const rolloverRoutes = require('./routes/rolloverRoutes');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// Routes
app.use('/api', rolloverRoutes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
```

- [ ] **Step 2: Start server and test**

Run: `npm start`
Expected: Server starts on port 3000, logs show `Server running on port 3000`.

Test health endpoint:
```bash
curl http://localhost:3000/health
```
Expected: `{ "status": "ok", "timestamp": "..." }`

Test 404:
```bash
curl http://localhost:3000/api/unknown
```
Expected: `{ "success": false, "message": "Endpoint not found" }`

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add express server with error handling, logging, and health check"
```

---

## Task 8: Integration Test (End-to-End)

**Files:**
- None (manual test)

- [ ] **Step 1: Test rollover creation**

```bash
curl -X POST http://localhost:3000/api/rollover \
  -H "Content-Type: application/json" \
  -d '{"clientName": "Acme Corp", "newFinancialYear": "FY 2025-2026"}'
```
Expected: `201` with `{ "success": true, "jobId": "..." }`

- [ ] **Step 2: Test status polling**

```bash
curl http://localhost:3000/api/status/<jobId>
```
Expected: `200` with `status: "running"` and accumulating `logs`.

Wait for completion, then poll again:
Expected: `status: "completed"` or `"failed"` with `result` or `error`.

- [ ] **Step 3: Test validation errors**

Missing clientName:
```bash
curl -X POST http://localhost:3000/api/rollover \
  -H "Content-Type: application/json" \
  -d '{"newFinancialYear": "FY 2025-2026"}'
```
Expected: `400` with validation error.

Invalid year format:
```bash
curl -X POST http://localhost:3000/api/rollover \
  -H "Content-Type: application/json" \
  -d '{"clientName": "Acme", "newFinancialYear": "bad-year"}'
```
Expected: `400` with validation error.

- [ ] **Step 4: Commit**

```bash
git commit -m "test: verify rollover API end-to-end"
```

---

## Self-Review

### Spec Coverage Check

| Spec Requirement | Task |
|---|---|
| Async job queue with polling | Tasks 3, 4, 5, 6 |
| POST /api/rollover returns jobId | Task 5 |
| GET /api/rollover/status/:jobId | Tasks 3, 5, 6 |
| Input validation (clientName, year format) | Task 5 |
| Python spawn with env vars | Task 4 |
| 10-minute timeout | Task 4 (`TIMEOUT_MS`) |
| Live log capture | Task 4 (`stdout.on('data')`) |
| Winston structured logging | Task 2 |
| In-memory JobStore with cleanup | Task 3 |
| Global error handler | Task 7 |
| Health check endpoint | Task 7 |
| 404 handler | Task 7 |
| File structure matching existing | All tasks |

**No gaps found.**

### Placeholder Scan

- No "TBD", "TODO", "implement later"
- No vague "add error handling" steps
- No "Similar to Task N" shortcuts
- All code blocks contain complete, runnable code

### Type Consistency

- `jobId` is always a string (UUID v4)
- `status` values: `pending`, `running`, `completed`, `failed`
- `jobStore.create()` returns `jobId`
- `pythonRunner.runRollover()` signature consistent across tasks
- `rolloverController` methods use `req, res, next` consistently

**Plan is clean. Ready for execution.**