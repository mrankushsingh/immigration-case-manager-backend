# Immigration Case Manager - Backend API

Backend API server for the Immigration Case Manager application.

## Features

- RESTful API for case templates, clients, users, reminders, and settings
- Firebase Authentication integration
- File upload support (local filesystem or Railway Bucket)
- PostgreSQL or file-based database storage
- CORS enabled for cross-origin requests

## Tech Stack

- **Runtime:** Node.js with TypeScript
- **Framework:** Express.js
- **Database:** PostgreSQL (production) or JSON files (development)
- **Storage:** Railway Bucket (S3-compatible) or local filesystem
- **Authentication:** Firebase Admin SDK

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL (optional, for production)
- Firebase project with service account (optional, for authentication)

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   Create a `.env` file in the backend directory:
   ```env
   # Server
   PORT=4000
   NODE_ENV=development

   # CORS (set to your frontend URL in production)
   CORS_ORIGIN=http://localhost:5173

   # Database (optional - uses file-based storage if not set)
   DATABASE_URL=postgresql://user:password@localhost:5432/dbname

   # Firebase (optional - authentication disabled if not set)
   FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}

   # Railway Bucket Storage (optional - uses local filesystem if not set)
   RAILWAY_BUCKET_ENDPOINT=https://your-bucket-endpoint.com
   RAILWAY_BUCKET_NAME=your-bucket-name
   RAILWAY_BUCKET_ACCESS_KEY=your-access-key
   RAILWAY_BUCKET_SECRET_KEY=your-secret-key
   RAILWAY_BUCKET_REGION=auto
   ```

3. **Run in development mode:**
   ```bash
   npm run dev
   ```

4. **Build for production:**
   ```bash
   npm run build
   npm start
   ```

## API Endpoints

### Health Check
- `GET /health` - Server and database status

### Case Templates
- `GET /api/case-templates` - Get all templates
- `POST /api/case-templates` - Create template
- `GET /api/case-templates/:id` - Get template
- `PUT /api/case-templates/:id` - Update template
- `DELETE /api/case-templates/:id` - Delete template

### Clients
- `GET /api/clients` - Get all clients
- `POST /api/clients` - Create client
- `GET /api/clients/:id` - Get client
- `PUT /api/clients/:id` - Update client
- `DELETE /api/clients/:id` - Delete client
- `POST /api/clients/:id/documents/:code` - Upload document
- `POST /api/clients/:id/additional-documents` - Add additional document
- And more...

### Users
- `GET /api/users` - Get all users
- `GET /api/users/me` - Get current user
- `POST /api/users` - Create user (admin only)
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user (admin only)

### Settings
- `GET /api/settings/payment-passcode` - Get passcode status
- `POST /api/settings/payment-passcode` - Set passcode
- `POST /api/settings/payment-passcode/verify` - Verify passcode

### Reminders
- `GET /api/reminders` - Get all reminders
- `POST /api/reminders` - Create reminder
- `PUT /api/reminders/:id` - Update reminder
- `DELETE /api/reminders/:id` - Delete reminder

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Server port | No | 4000 |
| `NODE_ENV` | Environment mode | No | development |
| `CORS_ORIGIN` | Allowed CORS origin | No | * (dev) / false (prod) |
| `DATABASE_URL` | PostgreSQL connection string | No | File-based storage |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account JSON | No | Auth disabled |
| `RAILWAY_BUCKET_*` | Railway bucket credentials | No | Local filesystem |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather | No | Telegram reports disabled |
| `TELEGRAM_CHAT_ID` | Chat/group ID to receive reports | No | Telegram reports disabled |
| `PAYTRACK_DAILY_TELEGRAM_HOUR` | Local hour (0–23) for daily 24h PDF | No | `9` |
| `PAYTRACK_DAILY_TELEGRAM_TZ` | Timezone for daily send | No | `Europe/Madrid` |
| `PAYTRACK_DAILY_TELEGRAM_ENABLED` | Set `false` to disable daily auto-send | No | enabled when Telegram is configured |
| `INACTIVE_CLIENT_TELEGRAM_ENABLED` | Set `false` to disable 2-week inactive client alerts | No | enabled when Telegram is configured |
| `INACTIVE_CLIENT_TELEGRAM_HOUR` | Hour for inactive-client check (falls back to PayTrack hour) | No | `9` |
| `INACTIVE_CLIENT_TELEGRAM_TZ` | Timezone for inactive-client check | No | `Europe/Madrid` |

### PayTrack → Telegram

With `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` set:

1. **Manual:** `POST /api/paytrack-reports/send-telegram` with `{ "period": "daily" | "monthly" | "all" }` (auth required) sends a text summary + PDF.
2. **Daily:** every day at `PAYTRACK_DAILY_TELEGRAM_HOUR` in `PAYTRACK_DAILY_TELEGRAM_TZ`, the server sends the last-24-hours PayTrack report (notification + PDF).

### Inactive new clients → Telegram

Every day (same hour by default), the server finds clients created **14+ days ago** with **no case template** and **no uploaded documents**, and sends a Telegram reminder. Each client is notified once when they first qualify, then again every 14 days while still inactive.

Get your chat ID by messaging the bot, then calling `https://api.telegram.org/bot<TOKEN>/getUpdates`.

The backend supports two storage modes:

1. **PostgreSQL** (production): Set `DATABASE_URL` environment variable
2. **File-based** (development): Automatically used if `DATABASE_URL` is not set

Tables are automatically created on first run when using PostgreSQL.

## File Storage

The backend supports two file storage modes:

1. **Railway Bucket** (production): Set Railway bucket environment variables
2. **Local filesystem** (development): Automatically used if bucket is not configured

## Development

```bash
# Run with hot reload
npm run dev

# Type check
npm run type-check

# Build
npm run build
```

## Deployment

### Railway

1. Connect your repository to Railway
2. Set environment variables in Railway dashboard
3. Railway will auto-detect and deploy

### Render

1. Create a new Web Service
2. Set build command: `npm run build`
3. Set start command: `npm start`
4. Add environment variables

### Other Platforms

The backend is a standard Express.js application and can be deployed to any Node.js hosting platform.

## Notes

- The backend is API-only and does not serve frontend files
- CORS must be configured to allow requests from your frontend domain
- Authentication is optional but recommended for production
- File uploads are limited to 50MB per file

