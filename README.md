# Devin Event Automation

Event-driven bug remediation pipeline. When a GitHub issue is created, Devin autonomously fixes it and opens a PR.

## How it works

```
GitHub Issue Created → Webhook → Devin Session → PR with Fix
PR Merged/Closed    → Webhook → Dashboard Updated (real-time via WebSocket)
```

1. GitHub webhook fires on `issues.opened`
2. Server verifies webhook signature (HMAC SHA-256)
3. Creates a Devin session with the issue context
4. Devin reads the code, fixes the bug, opens a PR
5. When the PR is merged/closed, GitHub fires another webhook
6. Dashboard at `/` updates in real-time via WebSocket push
7. All sessions persist to SQLite — survives restarts

## Setup

```bash
cp .env.example .env
# Fill in your Devin API key, org ID, and webhook secret
bun install
```

## Connect to GitHub

```bash
# 1. Start the server
bun run dev

# 2. Expose it (in another terminal)
ngrok http 3000

# 3. Register the webhook on your repo (issues + pull_request events)
./setup.sh <owner/repo> <your-ngrok-url>/webhook
```

## Run with Docker

```bash
docker compose up --build
```

## Run tests

```bash
bash test.sh
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Live dashboard (WebSocket-powered) |
| WS | `/ws` | Real-time status updates |
| POST | `/webhook` | GitHub webhook receiver (issues + PRs) |
| GET | `/status?range=1w` | Pipeline metrics JSON |
| GET | `/health` | Health check |

### Status response

```json
{
  "range": "1w",
  "summary": {
    "total_issues": 5,
    "prs_opened": 4,
    "prs_merged": 3,
    "prs_closed": 1,
    "success_rate": "75%",
    "active": 1,
    "failed": 0
  },
  "sessions": [...]
}
```

Range options: `1d`, `1w` (default), `1m`, `all`

## Architecture

```
src/
├── server.ts       # Bun HTTP + WebSocket server (Hono routes + pub/sub)
├── devin.ts        # Devin API client + session lifecycle
├── db.ts           # SQLite persistence (bun:sqlite)
└── dashboard.html  # Live UI (Tailwind, real-time via WebSocket)
```

~550 lines total. Bun native WebSocket for real-time updates, SQLite for persistence, Hono for routing.
