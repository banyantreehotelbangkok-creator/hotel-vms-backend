# Hotel VMS Backend API

Backend API สำหรับระบบ Self Check-in ของ Hotel VMS

## Features
- รับข้อมูลการลงทะเบียน (Self Check-in)
- สร้าง QR Code สำหรับ Check-out
- บันทึกข้อมูลลง PostgreSQL Database
- รองรับ tRPC format (เข้ากันได้กับแอป Hotel VMS)

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/trpc/selfCheckIn.submit` | ลงทะเบียน Check-in |
| GET | `/api/trpc/selfCheckIn.getAll` | ดึงข้อมูลทั้งหมด |
| POST | `/api/trpc/selfCheckIn.checkOut` | Check-out |
| GET | `/health` | ตรวจสอบสถานะ |

## Deploy บน Railway

### ขั้นตอนที่ 1: สร้าง GitHub Repository ใหม่
1. ไปที่ https://github.com/new
2. ตั้งชื่อ repo เช่น `hotel-vms-backend`
3. เลือก Public หรือ Private
4. คลิก "Create repository"

### ขั้นตอนที่ 2: Upload ไฟล์
1. คลิก "Add file" > "Upload files"
2. ลากไฟล์ทั้งหมดใส่ (package.json, server.js, README.md)
3. คลิก "Commit changes"

### ขั้นตอนที่ 3: Deploy บน Railway
1. ไปที่ https://railway.app
2. คลิก "New Project"
3. เลือก "Deploy from GitHub repo"
4. เลือก repo `hotel-vms-backend`
5. Railway จะ deploy อัตโนมัติ

### ขั้นตอนที่ 4: เพิ่ม Database (Optional)
1. ใน Railway project คลิก "New"
2. เลือก "Database" > "PostgreSQL"
3. Railway จะเพิ่ม `DATABASE_URL` อัตโนมัติ

### ขั้นตอนที่ 5: อัปเดต Self Check-in
1. ไปที่ Railway project `hotel-self-checkin`
2. คลิก "Variables"
3. เปลี่ยน `API_URL` เป็น URL ของ Backend ใหม่
   - เช่น `https://hotel-vms-backend-production.up.railway.app`

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Port number (Railway sets automatically) | No |
| `DATABASE_URL` | PostgreSQL connection string | No (uses in-memory if not set) |

## Local Development

```bash
npm install
npm start
```

Server จะรันที่ http://localhost:3000
