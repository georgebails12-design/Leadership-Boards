# Leadership Boards

Report pages for leadership, built from monday.com data (synced nightly through n8n). Served from the
company VPS at **https://boards.pandawd.online/** (same setup as the PO app).

| Report | Page | Folder |
|---|---|---|
| Job Milestone Report | `/job-milestones/` | [`public/job-milestones/`](public/job-milestones/) |

## How it works

- **n8n keeps the data.** The n8n workflow *Leadership Boards - Job Milestones
  Sync* pulls jobs from monday.com into the n8n data table **Job Milestones**
  (one row per Shop Updates job, keyed by item id). It runs every night at
  00:05 for jobs completed in the last 45 days, so new completions are added
  and later dates (deliveries, final invoice) get filled in. Run its
  *Backfill 2026* trigger by hand to reload the whole year.
- *Leadership Boards - Jobs API* (n8n) serves the stored jobs:
  `GET https://n8n.pandawd.online/webhook/leadership-boards/jobs?from=YYYY-MM-DD&to=YYYY-MM-DD`
  with the `X-Boards-Key` header.
- `server.js` is a small Node.js server (no npm dependencies). It serves
  `public/`, signs people in with a shared team password, and answers
  `GET /api/jobs?from&to` by calling that n8n API with the key it keeps on the
  server. Page loads never query monday.com.
- If `MONDAY_API_TOKEN` is also set on the server, `POST /api/monday` forwards
  **read-only** GraphQL queries to monday.com for pages that need live data
  (mutations are refused). It is off by default.
- Secrets live only on the VPS in `/etc/leadership-boards.env` and in n8n
  credentials. Nothing secret is in this repository.
- Responses are cached for 5 minutes.

### Changing the job rules

The milestone/station rules live in `public/job-milestones/report.js`. n8n
runs the same code: after changing `jobRow()` or anything it uses, run
`node n8n/build-workflows.js` and copy the *Build Job Rows* code from
`n8n/job-milestones-sync.sdk.js` into the n8n workflow (then run the backfill so
stored jobs pick up the change).

## Adding a board

1. Add a folder under `public/` (e.g. `public/sales-pipeline/index.html`).
2. Prefer a data table + nightly sync in n8n and an `/api/...` route in
   `server.js`, as for the job milestones. For live data, set
   `MONDAY_API_TOKEN` and call `POST /api/monday` with `{query, variables}`.
3. Add a card for it to `public/index.html`.
4. Push to `main`. The VPS picks it up within 2 minutes.

## Deployment (VPS)

One-time, as root in the VPS terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/georgebails12-design/Leadership-Boards/main/deploy/install.sh | bash
```

It installs Node.js if needed, asks for the n8n API key and the team
password, runs the app as the `leadership-boards` service on 127.0.0.1:8040,
installs an updater timer that deploys new commits on `main` every 2 minutes
(with a health check and automatic rollback), and adds `boards.pandawd.online`
to nginx with an HTTPS certificate (or to Caddy).

- Change the key or password: re-run with `bash -s -- --reset-secrets`.
- Logs: `journalctl -u leadership-boards` and `journalctl -u leadership-boards-update`.
- The DNS record `boards.pandawd.online → 45.82.73.224` is in Hostinger DNS.

## Running locally

```bash
N8N_API_KEY=... REPORT_PASSWORD=... SESSION_SECRET=anything-long PORT=3000 node server.js
```

Then open http://localhost:3000/.
