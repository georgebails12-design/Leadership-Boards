# Leadership Boards

Report pages for leadership, backed by live monday.com data. Served from the
company VPS at **https://boards.pandawd.online/** (same setup as the PO app).

| Report | Page | Folder |
|---|---|---|
| Job Milestone Report | `/job-milestones/` | [`public/job-milestones/`](public/job-milestones/) |

## How it works

- `server.js` is a small Node.js server (no npm dependencies). It serves
  `public/`, signs people in with a shared team password, and forwards
  **read-only** GraphQL queries to monday.com with the API token it keeps on the
  server. Pages call `POST /api/monday` with a query; mutations are refused.
- The monday token and team password live only on the VPS in
  `/etc/leadership-boards.env`. Nothing secret is in this repository.
- Identical monday queries are cached for 5 minutes.

## Adding a board

1. Add a folder under `public/` (e.g. `public/sales-pipeline/index.html`).
2. Fetch data from the page with
   `fetch("/api/monday", {method: "POST", credentials: "same-origin", headers: {"Content-Type": "application/json"}, body: JSON.stringify({query, variables})})`.
   See `public/job-milestones/report.js` for paging through items.
3. Add a card for it to `public/index.html`.
4. Push to `main`. The VPS picks it up within 2 minutes.

## Deployment (VPS)

One-time, as root in the VPS terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/georgebails12-design/Leadership-Boards/main/deploy/install.sh | bash
```

It installs Node.js if needed, asks for the monday.com API token and the team
password, runs the app as the `leadership-boards` service on 127.0.0.1:8040,
installs an updater timer that deploys new commits on `main` every 2 minutes
(with a health check and automatic rollback), and adds `boards.pandawd.online`
to nginx with an HTTPS certificate (or to Caddy).

- Change the token or password: re-run with `bash -s -- --reset-secrets`.
- Logs: `journalctl -u leadership-boards` and `journalctl -u leadership-boards-update`.
- The DNS record `boards.pandawd.online → 45.82.73.224` is in Hostinger DNS.

## Running locally

```bash
MONDAY_API_TOKEN=... REPORT_PASSWORD=... SESSION_SECRET=anything-long PORT=3000 node server.js
```

Then open http://localhost:3000/.
