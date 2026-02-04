# Hotel VMS - Full Backend Server

Backend API เต็มรูปแบบสำหรับ Hotel VMS ที่รองรับทั้ง **Mobile App** และ **Self Check-in Web**

## Features

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| **App Users** | | |
| `/api/trpc/appUsers.login` | POST | Login with username/password |
| `/api/trpc/appUsers.list` | GET | List all users |
| `/api/trpc/appUsers.create` | POST | Create new user |
| `/api/trpc/appUsers.update` | POST | Update user |
| `/api/trpc/appUsers.delete` | POST | Delete user |
| **Visitors (Mobile App)** | | |
| `/api/trpc/visitors.list` | GET | List all visitor records |
| `/api/trpc/visitors.active` | GET | List active (checked-in) visitors |
| `/api/trpc/visitors.byId` | GET | Get visitor by record ID |
| `/api/trpc/visitors.checkIn` | POST | Check-in new visitor |
| `/api/trpc/visitors.checkOut` | POST | Check-out visitor |
| `/api/trpc/visitors.update` | POST | Update visitor record |
| `/api/trpc/visitors.delete` | POST | Delete visitor record |
| **Self Check-in (Web)** | | |
| `/api/trpc/selfCheckIn.getConsent` | GET | Get consent text |
| `/api/trpc/selfCheckIn.submit` | POST | Submit self check-in |
| `/api/trpc/selfCheckIn.getAll` | GET | List all self check-in records |
| **Settings** | | |
| `/api/trpc/settings.get` | GET | Get app settings |
| `/api/trpc/settings.update` | POST | Update app settings |
| **Logs** | | |
| `/api/trpc/auditLogs.list` | GET | List audit logs |
| `/api/trpc/errorLog.list` | GET | List error logs |
| `/api/trpc/errorLog.create` | POST | Create error log |
| **Statistics** | | |
| `/api/trpc/stats.today` | GET | Get today's statistics |

### Default Users

| Username | Password | Role |
|----------|----------|------|
| admin | admin123 | admin |
| user | user123 | user |

## Deploy to Railway

### Step 1: Create GitHub Repository

1. Create a new repository on GitHub (e.g., `hotel-vms-backend`)
2. Upload these files to the repository:
   - `server.js`
   - `package.json`
   - `README.md`

### Step 2: Deploy on Railway

1. Go to [Railway](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Add PostgreSQL database:
   - Click "New" → "Database" → "PostgreSQL"
   - Railway will automatically set `DATABASE_URL`
5. Railway will auto-deploy

### Step 3: Update Self Check-in Web

Update the `API_URL` in your Self Check-in HTML to point to the new Railway backend:

```javascript
const API_URL = 'https://your-backend.up.railway.app';
```

### Step 4: Update Mobile App

Set the environment variable in your Mobile App:

```
EXPO_PUBLIC_API_BASE_URL=https://your-backend.up.railway.app
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (auto-set by Railway) |
| `PORT` | Server port (default: 3000) |
| `NODE_ENV` | Environment (production/development) |

## Database Schema

The server automatically creates these tables on startup:

- `app_users` - User accounts
- `visitor_records` - Visitor check-in/check-out records
- `audit_logs` - Activity logs
- `app_settings` - Application settings
- `error_logs` - Error tracking

## API Response Format

All API responses follow tRPC batch format:

```json
[{
  "result": {
    "data": {
      "json": { ... }
    }
  }
}]
```

## Notes

- This backend uses PostgreSQL (Railway provides this)
- All passwords are stored as plain text (for demo purposes)
- In production, use proper password hashing (bcrypt)
- CORS is enabled for all origins
