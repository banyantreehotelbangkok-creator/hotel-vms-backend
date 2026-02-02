# Hotel VMS Full Backend

Backend API เต็มรูปแบบสำหรับ Hotel Visitor Management System

## Features

- **Authentication**: Login/Logout ด้วย username/password
- **User Management**: จัดการผู้ใช้ (Admin/User roles)
- **Visitor Records**: บันทึกข้อมูลผู้เข้าพัก Check-in/Check-out
- **Self Check-in**: API สำหรับหน้า Self Check-in Web
- **Statistics**: สถิติการเข้า-ออก
- **Settings**: ตั้งค่าระบบ
- **Email Reports**: ตั้งค่ารายงานอีเมล
- **Audit Logs**: บันทึกการใช้งาน
- **Error Logs**: บันทึก Error

## API Endpoints

### Authentication
- `POST /api/trpc/appUsers.login` - เข้าสู่ระบบ

### User Management
- `GET /api/trpc/appUsers.list` - รายชื่อผู้ใช้ทั้งหมด
- `POST /api/trpc/appUsers.create` - สร้างผู้ใช้ใหม่
- `POST /api/trpc/appUsers.update` - แก้ไขผู้ใช้
- `POST /api/trpc/appUsers.delete` - ลบผู้ใช้

### Visitor Records
- `GET /api/trpc/visitors.list` - รายการผู้เข้าพักทั้งหมด
- `GET /api/trpc/visitors.active` - รายการผู้ที่ยังอยู่
- `POST /api/trpc/visitors.byId` - ดูรายละเอียดผู้เข้าพัก
- `POST /api/trpc/visitors.checkIn` - Check-in
- `POST /api/trpc/visitors.checkOut` - Check-out
- `POST /api/trpc/visitors.forceCheckOut` - Force Check-out
- `POST /api/trpc/visitors.update` - แก้ไขข้อมูล
- `POST /api/trpc/visitors.delete` - ลบข้อมูล
- `GET /api/trpc/visitors.stats` - สถิติ

### Self Check-in (Public)
- `GET /api/trpc/selfCheckIn.getConsent` - ข้อความ consent
- `POST /api/trpc/selfCheckIn.submit` - ลงทะเบียน
- `GET /api/trpc/selfCheckIn.getAll` - รายการทั้งหมด
- `POST /api/trpc/selfCheckIn.checkOut` - Check-out ด้วย QR

### Settings
- `GET /api/trpc/settings.get` - ดูการตั้งค่า
- `POST /api/trpc/settings.update` - อัปเดตการตั้งค่า

### Email
- `GET /api/trpc/email.getSettings` - ดูการตั้งค่าอีเมล
- `POST /api/trpc/email.updateSettings` - อัปเดตการตั้งค่าอีเมล

### Logs
- `GET /api/trpc/auditLogs.list` - รายการ audit logs
- `POST /api/trpc/errorLog.create` - สร้าง error log
- `GET /api/trpc/errorLog.list` - รายการ error logs
- `GET /api/trpc/errorLog.unresolved` - error logs ที่ยังไม่แก้ไข
- `POST /api/trpc/errorLog.resolve` - แก้ไข error log

## Default Users

| Username | Password | Role |
|----------|----------|------|
| admin | admin123 | admin |
| user | user123 | user |

## Deploy to Railway

### วิธีที่ 1: Deploy ผ่าน GitHub

1. สร้าง Repository ใหม่บน GitHub
2. Push โค้ดนี้ไปยัง Repository
3. ไปที่ [Railway](https://railway.app)
4. เลือก "New Project" > "Deploy from GitHub repo"
5. เลือก Repository ที่สร้าง
6. เพิ่ม PostgreSQL Database:
   - คลิก "New" > "Database" > "PostgreSQL"
   - Railway จะสร้าง DATABASE_URL ให้อัตโนมัติ
7. Deploy จะเริ่มทำงานอัตโนมัติ

### วิธีที่ 2: อัปเดต Backend ที่มีอยู่

ถ้าคุณมี `hotel-vms-backend` บน Railway อยู่แล้ว:

1. ไปที่ project `hotel-vms-backend` บน Railway
2. คลิก "Settings" > "Source"
3. เลือก "Connect GitHub" และเชื่อมต่อ Repository ใหม่
4. หรือใช้ Railway CLI:
   ```bash
   railway login
   railway link <project-id>
   railway up
   ```

### Environment Variables

Railway จะสร้างให้อัตโนมัติเมื่อเพิ่ม PostgreSQL:
- `DATABASE_URL` - Connection string สำหรับ PostgreSQL

## อัปเดต Self Check-in Web

หลังจาก deploy Backend ใหม่แล้ว ให้อัปเดต API_URL ใน Self Check-in Web:

```javascript
const API_URL = 'https://hotel-vms-backend-production.up.railway.app';
```

## อัปเดต Mobile App

อัปเดต environment variable ใน Mobile App:

```
EXPO_PUBLIC_API_BASE_URL=https://hotel-vms-backend-production.up.railway.app
```

## Testing

ทดสอบ API:

```bash
# Health check
curl https://your-backend-url.up.railway.app/health

# Login
curl -X POST https://your-backend-url.up.railway.app/api/trpc/appUsers.login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'

# Get visitors
curl https://your-backend-url.up.railway.app/api/trpc/visitors.list
```
