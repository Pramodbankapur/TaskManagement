# Task & Client Complaint Management App

Production-style implementation using React + TypeScript frontend and Node.js + Express + TypeScript backend with SQL (SQLite).

## Implemented Features

- Public client complaint form (no login) with optional attachment upload.
- Separate public and internal routes:
  - Public: `/client/complaint`
  - Internal: `/internal/login`, `/internal/dashboard`
- SQL data storage for users, clients, complaints, tasks, task updates, notifications.
- Auth with email/password, bcrypt hashing, JWT cookie session.
- Role-based access:
  - OWNER: full access
  - MANAGER: assign, view, reports
  - EMPLOYEE: only own tasks, status updates, remarks, proof upload
- Task lifecycle:
  - Complaint -> Task conversion
  - Assignment to employee
  - Unassign task back to complaint queue
  - Deadline + status tracking
  - Close task
- Notifications:
  - In-app notifications
  - Email hooks (SMTP or console simulated)
  - Optional SMS/WhatsApp via Twilio (or simulated logs)
- Role dashboards with summary metrics.
- Clickable metric cards + calendar date filter for task/complaint views.
- Priority color badges (LOW/MEDIUM/HIGH/CRITICAL).
- Audit trail: every key change is logged in SQL `audit_logs`.
- Google Form integration endpoint for external form workflows.

## Demo Credentials

- owner@demo.com / Owner@123
- manager@demo.com / Manager@123
- employee1@demo.com / Employee@123

## Local Run

1. Server
```bash
cd server
cp .env.example .env
npm install
npm run dev
```

2. Client
```bash
cd client
cp .env.example .env
npm install
npm run dev
```

Client: http://localhost:5173
Server: http://localhost:4000

## Local Build Validation

```bash
npm --prefix server run build
npm --prefix client run build
```

## Google Form Integration

- Backend endpoint: `POST /api/public/google-form`
- Required body fields:
  - secret
  - organizationName
  - contactName
  - email
  - phone
  - description
- Set `GOOGLE_FORM_SHARED_SECRET` in `server/.env`.
- Use Apps Script bridge sample: `docs/google-form-apps-script.js`

## Twilio SMS/WhatsApp Integration

Set these in `server/.env` to enable real messaging:

- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_SMS_FROM
- TWILIO_WHATSAPP_FROM

If not set, logs are simulated and application still works.

## Free Email Testing (Implemented)

- `EMAIL_MODE=ETHEREAL` (default in `.env.example`) gives free test inbox previews.
- Owner dashboard shows mail mode and latest preview link.
- No paid provider needed for local testing.

## Docker Deployment

1. Create env:
```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

2. Build and run:
```bash
docker compose up --build
```

3. Access app:
- Web: http://localhost
- API health: http://localhost:4000/health

## Pro Checklist (How to Verify)

1. Submit complaint on public form.
2. Login as OWNER and confirm complaint appears in dashboard list.
3. Create task from complaint and assign to employee.
4. Login as EMPLOYEE and confirm only own tasks are visible.
5. Employee updates status and adds remarks/proof.
6. Login as OWNER/MANAGER and confirm task status/report metrics update.
7. Open notifications panel and confirm alert entries.
8. Configure SMTP and validate real email send.
9. Configure Twilio and validate SMS/WhatsApp send.
