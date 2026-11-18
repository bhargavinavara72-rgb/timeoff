# Timeoff Pro — Employment Leave Management System (Full Stack)

Frontend (HTML/CSS/JavaScript) + **Node.js backend** with a REST API, hashed passwords, token login,
role-based access and server-side validation. **No `npm install` is needed** — the backend uses only Node's built-in modules.

```
timeoff-pro/
├── backend/
│   ├── server.js          HTTP server (API + serves the frontend)
│   ├── src/api.js         All API routes, validation and business rules
│   ├── src/auth.js        Password hashing (scrypt) + signed login tokens
│   ├── src/db.js          JSON-file database (data/db.json, saved on every change)
│   ├── src/seed.js        Demo users, employees and requests (created on first start)
│   ├── src/dates.js       Working-day / overlap helpers
│   ├── test/api.test.js   Automated API tests (npm test)
│   └── .env.example       Settings you can change
└── frontend/              index.html, css/, js/, pages/ (employee, manager, admin)
```

## Run it (2 steps)
1. Install **Node.js 18 or newer** (https://nodejs.org).
2. Open a terminal in the `backend` folder and run:
   ```bash
   npm start
   ```
   Then open **http://localhost:3000** in your browser. (Do not double-click `index.html` any more — the pages must be opened through the server.)

The first start creates `backend/data/db.json` with the demo data. To reset everything, stop the server and delete the `backend/data` folder.

## Demo accounts (username or email + password)
| Role | Username | Password |
|---|---|---|
| Administrator | `lakshmi.prasanna` | `Lakshmi@2026` |
| Manager (Product & Technology, People Ops) | `venkata.ramana` | `Ramana@2026` |
| Manager (Finance) | `suresh.babu` | `Suresh@2026` |
| Employee | `sai.kiran` | `SaiKiran@2026` |
| Employee | `priya.menon` | `Priya@2026` |
| Employee | `rohan.shah` | `Rohan@2026` |
| Employee | `ananya.kumar` | `Ananya@2026` |
| Employee | `divya.chowdary` | `Divya@2026` |
| Employee | `karthik.varma` | `Karthik@2026` |

Emails use `@timeoffpro.in` (for example `sai.kiran@timeoffpro.in`). Only these accounts exist until the admin creates more
(Admin dashboard → "Add an employee", choose Employee or Manager). Every user can change their password from the sidebar.

## What the backend does
- **Login:** `POST /api/auth/login` checks the scrypt-hashed password and returns a signed token (valid 8 hours). Failed logins are rate-limited (10 per 15 minutes per IP).
- **Role-based access:** employees see only their own data, managers only their team, admins everything. Wrong role → `403`, missing/expired token → `401`.
- **Leave rules enforced on the server:** valid dates, no past start, weekends and company holidays are not counted, no overlapping requests, balance check (pending days count too), manager can only decide for their own team, rejection needs a reason, approval re-checks balance and overlaps.
- **Admin tools:** create employees/managers, activate/deactivate accounts (a deactivated person is logged out immediately), manage holidays, read the audit log.
- **Notifications and audit log** are created by the server for every action.

## API reference
All endpoints are under `/api`. Send `Authorization: Bearer <token>` except for login and health.

| Method & path | Who | Purpose |
|---|---|---|
| `GET /health` | public | Server check |
| `POST /auth/login` `{identity,password}` | public | Sign in → `{token,user}` |
| `POST /auth/logout` | any | Records logout in audit log |
| `GET /auth/me` | any | Current user |
| `POST /auth/change-password` `{currentPassword,newPassword}` | any | Change own password |
| `GET /bootstrap` | any | Everything the dashboard needs for the signed-in role |
| `GET /leave-types`, `GET /holidays` | any | Policy data |
| `GET /employees`, `GET /requests?status=`, `GET /notifications` | any (scoped by role) | Lists |
| `POST /notifications/read` | any | Mark own notifications read |
| `POST /requests` `{leaveType,startDate,endDate,reason}` | employee | Apply for leave |
| `POST /requests/:id/cancel` | employee | Cancel own pending request |
| `POST /requests/:id/decision` `{decision:"approved"\|"rejected",reason}` | manager | Decide on a team request |
| `POST /employees` `{role,name,email,department,designation,managerId,password}` | admin | Create employee or manager |
| `PATCH /employees/:id/status` `{active}` | admin | Activate / deactivate |
| `GET /managers`, `GET /audit` | admin | Manager list, audit log |
| `POST /holidays` `{date,name}`, `DELETE /holidays/:date` | admin | Manage holidays |

Run the automated tests with `npm test` (inside `backend`). They use a temporary folder, so your data is not touched.

## Settings (environment variables)
See `backend/.env.example`. Most useful: `PORT`, `JWT_SECRET` (set a long random value in production), `DATA_DIR`, `ALLOWED_ORIGINS`.

## Deploying online
The backend serves the frontend too, so you deploy **one** Node app.

**Render.com (free):** push this folder to GitHub → New → Web Service → pick the repo →
Root Directory `backend` · Build Command (leave empty or `echo ok`) · Start Command `npm start` →
add environment variable `JWT_SECRET` (any long random text). Render gives you a live `https://…onrender.com` link.

**Railway / Fly.io / a VPS** work the same way: run `npm start` in `backend` with `PORT` provided by the host.

**Important about data on free hosts:** data is stored in `backend/data/db.json`. Free plans usually have a temporary disk, so
the demo data can reset when the app restarts or redeploys. For permanent storage, attach a persistent disk and set `DATA_DIR` to it,
or replace `src/db.js` with a real database (PostgreSQL/MySQL/MongoDB). Free Render apps also "sleep" when idle — the first visit may take ~30 seconds.

**Frontend hosted separately (e.g. GitHub Pages):** set `window.TIMEOFF_API_BASE = "https://your-backend.onrender.com"` in `frontend/js/config.js`
and set `ALLOWED_ORIGINS=https://your-username.github.io` on the backend.

## Security notes
Passwords are hashed with scrypt, tokens are HMAC-signed, inputs are validated on the server and the frontend escapes all displayed text.
For a real company deployment also use HTTPS only (hosts above provide it), a strong `JWT_SECRET`, regular backups of the data folder, and a proper database.
