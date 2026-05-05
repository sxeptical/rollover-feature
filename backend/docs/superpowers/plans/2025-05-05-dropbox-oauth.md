# Dropbox OAuth Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `DROPBOX_ACCESS_TOKEN` environment variable with per-session Dropbox OAuth 2.0 authentication, allowing users to log in via the React frontend.

**Architecture:** Server-side sessions (`express-session`) store the Dropbox access token. The backend handles the full OAuth 2.0 authorization code flow. The frontend redirects to `/auth/dropbox` and includes `credentials: 'include'` on all API requests.

**Tech Stack:** Express, express-session, React, Vite, Dropbox OAuth 2.0

**Project Root:** `rollover-feature/`
**Backend Path:** `rollover-feature/backend/`
**Frontend Path:** `rollover-feature/src/`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/package.json` | Modify | Add `express-session` dependency |
| `backend/controllers/authController.js` | Create | OAuth initiation, callback, logout, me endpoint |
| `backend/middleware/auth.js` | Create | `requireAuth` middleware for protected routes |
| `backend/routes/authRoutes.js` | Create | Auth route definitions |
| `backend/server.js` | Modify | Add session middleware, mount auth routes |
| `backend/controllers/rolloverController.js` | Modify | Read token from session, pass to pythonRunner |
| `backend/services/pythonRunner.js` | Modify | Accept `token` as parameter instead of env var |
| `src/App.jsx` | Modify | Auth state, login/logout UI, credentials on fetch |
| `vite.config.js` | Modify | Proxy `/auth` to backend dev server |
| `backend/.env.example` | Modify | Replace DROPBOX_ACCESS_TOKEN with OAuth vars |
| `.env` | Modify | Update frontend env if needed |

---

## Task 1: Install Backend Dependency

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install express-session**

```bash
cd rollover-feature/backend
npm install express-session
```

Expected: `express-session` added to `dependencies` in `package.json`.

- [ ] **Step 2: Verify installation**

```bash
ls node_modules/express-session
```

Expected: Directory exists.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add express-session for OAuth session management"
```

---

## Task 2: Create Auth Controller

**Files:**
- Create: `backend/controllers/authController.js`

- [ ] **Step 1: Write auth controller**

Create `backend/controllers/authController.js` with this exact content:

```js
const crypto = require('crypto');
const logger = require('../utils/logger');

const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY;
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET;
const DROPBOX_REDIRECT_URI = process.env.DROPBOX_REDIRECT_URI || 'http://localhost:3000/auth/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function generateRandomState() {
  return crypto.randomBytes(32).toString('hex');
}

function startOAuth(req, res) {
  if (!DROPBOX_APP_KEY) {
    logger.error('DROPBOX_APP_KEY not configured');
    return res.status(500).json({ success: false, message: 'OAuth not configured' });
  }

  const state = generateRandomState();
  req.session.oauthState = state;

  const authorizeUrl = new URL('https://www.dropbox.com/oauth2/authorize');
  authorizeUrl.searchParams.set('client_id', DROPBOX_APP_KEY);
  authorizeUrl.searchParams.set('redirect_uri', DROPBOX_REDIRECT_URI);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('state', state);

  logger.info('Redirecting to Dropbox OAuth');
  res.redirect(authorizeUrl.toString());
}

async function handleCallback(req, res) {
  const { code, state, error: dropboxError } = req.query;

  if (dropboxError) {
    logger.warn('Dropbox OAuth error', { error: dropboxError });
    return res.redirect(`${FRONTEND_URL}?error=${encodeURIComponent(dropboxError)}`);
  }

  if (!code) {
    logger.warn('OAuth callback missing code');
    return res.redirect(`${FRONTEND_URL}?error=missing_code`);
  }

  const storedState = req.session.oauthState;
  if (!storedState || storedState !== state) {
    logger.warn('OAuth state mismatch', { storedState, receivedState: state });
    return res.redirect(`${FRONTEND_URL}?error=invalid_state`);
  }

  delete req.session.oauthState;

  try {
    const tokenResponse = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: DROPBOX_APP_KEY,
        client_secret: DROPBOX_APP_SECRET,
        redirect_uri: DROPBOX_REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      logger.error('Token exchange failed', { error: tokenData });
      return res.redirect(`${FRONTEND_URL}?error=token_exchange_failed`);
    }

    req.session.dropboxToken = tokenData.access_token;
    logger.info('Dropbox OAuth successful');
    res.redirect(FRONTEND_URL);
  } catch (err) {
    logger.error('OAuth callback error', { error: err.message });
    res.redirect(`${FRONTEND_URL}?error=token_exchange_failed`);
  }
}

function logout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      logger.error('Session destroy error', { error: err.message });
      return res.status(500).json({ success: false, message: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'Logged out' });
  });
}

function getMe(req, res) {
  res.json({
    authenticated: !!req.session.dropboxToken,
  });
}

module.exports = {
  startOAuth,
  handleCallback,
  logout,
  getMe,
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/controllers/authController.js
git commit -m "feat: add auth controller for Dropbox OAuth flow"
```

---

## Task 3: Create Auth Middleware

**Files:**
- Create: `backend/middleware/auth.js`

- [ ] **Step 1: Write auth middleware**

Create `backend/middleware/auth.js` with this exact content:

```js
function requireAuth(req, res, next) {
  if (!req.session || !req.session.dropboxToken) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please connect to Dropbox.',
    });
  }
  next();
}

module.exports = { requireAuth };
```

- [ ] **Step 2: Commit**

```bash
git add backend/middleware/auth.js
git commit -m "feat: add requireAuth middleware for protected routes"
```

---

## Task 4: Create Auth Routes

**Files:**
- Create: `backend/routes/authRoutes.js`

- [ ] **Step 1: Write auth routes**

Create `backend/routes/authRoutes.js` with this exact content:

```js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/dropbox', authController.startOAuth);
router.get('/callback', authController.handleCallback);
router.post('/logout', authController.logout);
router.get('/me', authController.getMe);

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add backend/routes/authRoutes.js
git commit -m "feat: add auth routes for OAuth endpoints"
```

---

## Task 5: Update Server.js

**Files:**
- Modify: `backend/server.js`

- [ ] **Step 1: Add express-session import and middleware**

Replace the top of `backend/server.js` (lines 1-18) with:

```js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const session = require('express-session');
const rolloverRoutes = require('./routes/rolloverRoutes');
const authRoutes = require('./routes/authRoutes');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));

// Middleware
app.use(express.json());
```

- [ ] **Step 2: Add auth routes**

After the existing `app.use('/api', rolloverRoutes);` line, add:

```js
app.use('/auth', authRoutes);
```

So the routes section becomes:

```js
// Routes
app.use('/api', rolloverRoutes);
app.use('/auth', authRoutes);
```

- [ ] **Step 3: Verify full server.js**

The complete `backend/server.js` should look like:

```js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const express = require('express');
const session = require('express-session');
const rolloverRoutes = require('./routes/rolloverRoutes');
const authRoutes = require('./routes/authRoutes');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

// Middleware
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// Routes
app.use('/api', rolloverRoutes);
app.use('/auth', authRoutes);

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

- [ ] **Step 4: Commit**

```bash
git add backend/server.js
git commit -m "feat: add session middleware and auth routes to server"
```

---

## Task 6: Update Rollover Controller

**Files:**
- Modify: `backend/controllers/rolloverController.js`

- [ ] **Step 1: Import requireAuth and update createRollover**

Add import at the top of `backend/controllers/rolloverController.js`:

```js
const { requireAuth } = require('../middleware/auth');
```

Replace the `createRollover` function with:

```js
async function createRollover(req, res, next) {
  try {
    const validationErrors = validateRolloverInput(req.body);
    if (validationErrors.length > 0) {
      logger.warn('Validation failed', { errors: validationErrors, body: req.body });
      return res.status(400).json({ success: false, errors: validationErrors });
    }

    const token = req.session.dropboxToken;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Dropbox not connected' });
    }

    const { clientName, newFinancialYear } = req.body;
    const jobId = jobStore.create(clientName.trim(), newFinancialYear.trim());

    // Fire-and-forget: do NOT await
    pythonRunner.runRollover(jobId, clientName.trim(), newFinancialYear.trim(), token)
      .catch((err) => {
        logger.error(`Background rollover error`, { jobId, error: err.message });
      });

    logger.info(`Rollover job queued`, { jobId, clientName, newFinancialYear });
    return res.status(201).json({ success: true, jobId });
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 2: Export requireAuth with controller**

Update the module.exports at the bottom to:

```js
module.exports = {
  createRollover,
  getStatus,
  requireAuth,
};
```

- [ ] **Step 3: Apply requireAuth to rollover route**

In `backend/routes/rolloverRoutes.js`, update to:

```js
const express = require('express');
const router = express.Router();
const rolloverController = require('../controllers/rolloverController');

router.post('/rollover', rolloverController.requireAuth, rolloverController.createRollover);
router.get('/status/:jobId', rolloverController.getStatus);

module.exports = router;
```

- [ ] **Step 4: Commit**

```bash
git add backend/controllers/rolloverController.js backend/routes/rolloverRoutes.js
git commit -m "feat: protect rollover endpoint and use session token"
```

---

## Task 7: Update Python Runner

**Files:**
- Modify: `backend/services/pythonRunner.js`

- [ ] **Step 1: Update runRollover signature and token handling**

Replace the `runRollover` function definition (line 14) from:

```js
function runRollover(jobId, clientName, newFinancialYear) {
```

to:

```js
function runRollover(jobId, clientName, newFinancialYear, token) {
```

- [ ] **Step 2: Remove env token check**

Remove lines 16-23 (the token env var check):

```js
  const token = process.env.DROPBOX_ACCESS_TOKEN;
  const archiveBase = process.env.DROPBOX_ARCHIVE_BASE;
  const clientsBase = process.env.DROPBOX_CLIENTS_BASE;
  if (!token) {
    const err = new Error('DROPBOX_ACCESS_TOKEN environment variable not set');
    logger.error(err.message);
    return reject(err);
  }
```

Replace with:

```js
  const archiveBase = process.env.DROPBOX_ARCHIVE_BASE;
  const clientsBase = process.env.DROPBOX_CLIENTS_BASE;
  if (!token) {
    const err = new Error('Dropbox token not provided');
    logger.error(err.message);
    return reject(err);
  }
```

- [ ] **Step 3: Verify the spawn env**

The spawn call should still pass the token via `--token` arg (already does this). Make sure the `env` spread in spawn doesn't override anything important:

The existing line:
```js
  const proc = spawn(PYTHON_PATH, args, {
    env: { ...process.env, DROPBOX_ACCESS_TOKEN: token },
    timeout: TIMEOUT_MS,
    killSignal: 'SIGTERM'
  });
```

This is fine — it passes the token to the Python script via both CLI arg and env var.

- [ ] **Step 4: Commit**

```bash
git add backend/services/pythonRunner.js
git commit -m "feat: accept dropbox token as parameter in pythonRunner"
```

---

## Task 8: Update Frontend App.jsx

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Replace App.jsx with auth-aware version**

Replace the entire contents of `src/App.jsx` with:

```jsx
import { useRef, useState, useEffect } from 'react'
import './App.css'

function App() {
  const [clientName, setClientName] = useState(import.meta.env.VITE_DEFAULT_CLIENT_NAME || 'ABC')
  const [financialYear, setFinancialYear] = useState(import.meta.env.VITE_DEFAULT_FINANCIAL_YEAR || 'FY 2025-2026')
  const [jobId, setJobId] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [auth, setAuth] = useState({ isAuthenticated: false, loading: true })
  const pollerRef = useRef(null)

  // Check auth status on mount
  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setAuth({ isAuthenticated: data.authenticated, loading: false }))
      .catch(() => setAuth({ isAuthenticated: false, loading: false }))
  }, [])

  // Handle OAuth errors from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const errorParam = params.get('error')
    if (errorParam) {
      setError(`Authentication error: ${errorParam}`)
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [])

  const stopPolling = () => {
    if (pollerRef.current) {
      clearInterval(pollerRef.current)
      pollerRef.current = null
    }
  }

  const pollStatus = (id) => {
    stopPolling()
    pollerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${id}`, { credentials: 'include' })
        const data = await res.json()
        if (!data.success) {
          setError(data.message || 'Failed to fetch status')
          stopPolling()
          return
        }
        setStatus(data)
        if (data.status === 'completed' || data.status === 'failed') {
          stopPolling()
        }
      } catch (err) {
        setError(err.message)
        stopPolling()
      }
    }, 2000)
  }

  const handleRollover = async () => {
    setLoading(true)
    setError(null)
    setJobId(null)
    setStatus(null)
    stopPolling()

    try {
      const res = await fetch('/api/rollover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ clientName, newFinancialYear: financialYear }),
      })
      const data = await res.json()
      if (!data.success) {
        if (res.status === 401) {
          setAuth({ isAuthenticated: false, loading: false })
        }
        setError(data.errors ? data.errors.join(', ') : data.message || 'Request failed')
        return
      }

      setJobId(data.jobId)
      pollStatus(data.jobId)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
      setAuth({ isAuthenticated: false, loading: false })
      stopPolling()
      setJobId(null)
      setStatus(null)
      setError(null)
    } catch (err) {
      setError('Logout failed: ' + err.message)
    }
  }

  if (auth.loading) {
    return (
      <main className="tester-screen">
        <section className="tester-card">
          <p>Loading...</p>
        </section>
      </main>
    )
  }

  if (!auth.isAuthenticated) {
    return (
      <main className="tester-screen">
        <section className="tester-card">
          <h1>Rollover Test Console</h1>
          <p className="subtext">Connect your Dropbox account to get started.</p>
          <a href="/auth/dropbox" className="rollover-btn">
            Connect to Dropbox
          </a>
          {error ? <p className="rollover-error">{error}</p> : null}
        </section>
      </main>
    )
  }

  return (
    <main className="tester-screen">
      <section className="tester-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>Rollover Test Console</h1>
          <button type="button" className="rollover-btn" onClick={handleLogout} style={{ width: 'auto', padding: '8px 16px' }}>
            Disconnect
          </button>
        </div>
        <p className="subtext">Run the backend rollover against your Dropbox sample data.</p>

        <div className="rollover-form">
          <label>
            Client Name
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. ABC"
            />
          </label>
          <label>
            Financial Year
            <input
              type="text"
              value={financialYear}
              onChange={(e) => setFinancialYear(e.target.value)}
              placeholder="e.g. FY 2025-2026"
            />
          </label>
        </div>

        <button
          type="button"
          className="rollover-btn"
          onClick={handleRollover}
          disabled={loading || !clientName.trim() || !financialYear.trim()}
        >
          {loading ? 'Starting...' : 'Run Rollover'}
        </button>

        {error ? <p className="rollover-error">{error}</p> : null}

        {jobId ? (
          <div className="rollover-status">
            <p><strong>Job ID:</strong> {jobId}</p>
            <p><strong>Status:</strong> {status?.status || 'queued'}</p>
            {status?.error ? <p className="rollover-error">{status.error}</p> : null}
            {status?.logs?.length ? <pre className="rollover-logs">{status.logs.join('\n')}</pre> : null}
            {status?.result ? <pre className="rollover-logs">{JSON.stringify(status.result, null, 2)}</pre> : null}
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default App
```

- [ ] **Step 2: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add Dropbox OAuth login/logout to frontend"
```

---

## Task 9: Update Vite Config

**Files:**
- Modify: `vite.config.js`

- [ ] **Step 1: Add /auth proxy**

Replace the proxy section in `vite.config.js` with:

```js
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
    },
  },
```

The full `vite.config.js` should be:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
    },
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add vite.config.js
git commit -m "feat: proxy /auth endpoints to backend dev server"
```

---

## Task 10: Update Environment Files

**Files:**
- Modify: `backend/.env.example`
- Modify: `backend/.env` (if it exists)

- [ ] **Step 1: Update backend .env.example**

Replace the contents of `backend/.env.example` with:

```
PORT=3000
DROPBOX_APP_KEY=your_dropbox_app_key
DROPBOX_APP_SECRET=your_dropbox_app_secret
DROPBOX_REDIRECT_URI=http://localhost:3000/auth/callback
DROPBOX_ARCHIVE_BASE=/ABC-v2/ABC
DROPBOX_CLIENTS_BASE=/ABC-v2/CLIENTS
SESSION_SECRET=change_this_to_a_random_string
LOG_LEVEL=info
```

- [ ] **Step 2: Update backend .env**

If `backend/.env` exists, update it to match `.env.example` (replace the old DROPBOX_ACCESS_TOKEN with the new OAuth variables). **Do NOT commit the actual .env file** — it contains secrets.

- [ ] **Step 3: Commit .env.example only**

```bash
git add backend/.env.example
git commit -m "chore: update env example for OAuth configuration"
```

---

## Task 11: Manual Testing

**Prerequisites:**
- You have a Dropbox app registered at https://www.dropbox.com/developers/apps
- You have the App Key and App Secret
- Your Dropbox app has the redirect URI `http://localhost:3000/auth/callback` configured
- Your backend `.env` is populated with the correct values

- [ ] **Step 1: Start backend**

```bash
cd rollover-feature/backend
npm start
```

Expected: `Server running on port 3000`

- [ ] **Step 2: Start frontend**

```bash
cd rollover-feature
npm run dev
```

Expected: Vite dev server running on `http://localhost:5173`

- [ ] **Step 3: Test unauthenticated access**

Open `http://localhost:5173` in a browser.

Expected: See "Connect to Dropbox" button. No rollover form.

- [ ] **Step 4: Test auth endpoint directly**

```bash
curl -s http://localhost:3000/auth/me | cat
```

Expected: `{"authenticated":false}`

- [ ] **Step 5: Test OAuth flow**

Click "Connect to Dropbox" in the browser.

Expected:
1. Redirected to Dropbox login/authorization page
2. After approving, redirected back to `http://localhost:5173`
3. Frontend now shows rollover form + "Disconnect" button

- [ ] **Step 6: Verify session token stored**

```bash
curl -s http://localhost:3000/auth/me -b "connect.sid=<cookie_from_browser>" | cat
```

Or check browser dev tools → Application → Cookies → `connect.sid` exists.

Expected: `{"authenticated":true}`

- [ ] **Step 7: Test rollover while authenticated**

Fill in client name and financial year, click "Run Rollover".

Expected: Job starts, polling begins, status updates appear.

- [ ] **Step 8: Test unauthorized rollover**

In a new incognito window (no session), run:

```bash
curl -s -X POST http://localhost:3000/api/rollover \
  -H "Content-Type: application/json" \
  -d '{"clientName":"ABC","newFinancialYear":"FY 2025-2026"}' | cat
```

Expected: `{"success":false,"message":"Authentication required. Please connect to Dropbox."}` with HTTP 401.

- [ ] **Step 9: Test logout**

Click "Disconnect" in the browser.

Expected:
1. UI returns to "Connect to Dropbox" screen
2. `GET /auth/me` returns `{"authenticated":false}`
3. Session cookie is cleared

- [ ] **Step 10: Test OAuth error handling**

Simulate an error by visiting:
`http://localhost:3000/auth/callback?error=access_denied`

Expected: Redirected to frontend with `?error=access_denied` shown as an error message.

---

## Spec Coverage Check

| Spec Requirement | Implementing Task |
|------------------|-------------------|
| Server-side sessions | Task 5 |
| OAuth authorization code flow | Task 2 |
| Auth routes (/auth/dropbox, /callback, /logout, /me) | Task 4 |
| requireAuth middleware | Task 3 |
| Protected rollover endpoint | Task 6 |
| Token passed to pythonRunner | Task 7 |
| Frontend auth state | Task 8 |
| credentials: 'include' on fetches | Task 8 |
| Login/logout UI | Task 8 |
| Vite proxy for /auth | Task 9 |
| Environment variable updates | Task 10 |
| Error handling (state mismatch, missing code, token exchange) | Task 2 |
| Session security (httpOnly, sameSite, secure) | Task 5 |
| Manual testing steps | Task 11 |

---

## Placeholder Scan

- [x] No "TBD", "TODO", or "implement later" found
- [x] No vague "add error handling" without specifics
- [x] No "similar to Task N" references
- [x] All code blocks contain complete, copy-pasteable code
- [x] All file paths are exact and verified against project structure

---

## Type Consistency Check

- [x] `req.session.dropboxToken` — used in authController (Task 2), auth middleware (Task 3), rolloverController (Task 6)
- [x] `req.session.oauthState` — used in authController startOAuth and handleCallback
- [x] `runRollover(jobId, clientName, newFinancialYear, token)` — signature updated in Task 7, called in Task 6
- [x] `credentials: 'include'` — used in all frontend fetch calls (Task 8)
- [x] Cookie name `connect.sid` — consistent in logout (Task 2) and testing (Task 11)

---

**Plan complete.** All tasks are independent where possible and can be executed sequentially. Each task produces a working, testable increment.
