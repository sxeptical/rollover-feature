# Audit Rollover Automation (Frontend + Backend)

This repository now contains both parts of the rollover system:

- `src/`, `public/`, `vite.config.js`: React frontend (Vite)
- `backend/`: Node.js + Express backend that runs the Python rollover script

## Project Structure

```text
.
├── backend
│   ├── controllers
│   ├── routes
│   ├── scripts
│   ├── services
│   ├── utils
│   ├── package.json
│   └── server.js
├── src
├── public
├── package.json
└── vite.config.js
```

## Prerequisites

- Node.js (frontend + backend)
- Python 3.13 (for `backend/scripts/rollover.py`)
- Dropbox app access token with required scopes

## Environment Variables

Frontend (root `.env`):

```env
VITE_DEFAULT_CLIENT_NAME=ABC
VITE_DEFAULT_FINANCIAL_YEAR=FY 2025-2026
```

Backend (`backend/.env`):

```env
PORT=3000
DROPBOX_ACCESS_TOKEN=your_dropbox_token
DROPBOX_ARCHIVE_BASE=/ABC-v2/ABC
DROPBOX_CLIENTS_BASE=/ABC-v2/CLIENTS
LOG_LEVEL=info
```

## Run Locally

1. Install frontend deps:
```bash
npm install
```

2. Install backend deps:
```bash
cd backend
npm install
cd ..
```

3. Start backend:
```bash
cd backend
npm run dev
```

4. Start frontend (separate terminal):
```bash
npm run dev
```

Frontend runs on `http://localhost:5173` and proxies `/api` to backend `http://localhost:3000`.
