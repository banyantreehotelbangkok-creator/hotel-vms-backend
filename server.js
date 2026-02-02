const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize database table
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS checkin_records (
        id SERIAL PRIMARY KEY,
        record_id VARCHAR(100) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        id_number VARCHAR(50) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        company VARCHAR(255),
        purpose TEXT,
        locker_number VARCHAR(50),
        department VARCHAR(255),
        work_area VARCHAR(255),
        qr_code TEXT,
        qr_expiry TIMESTAMP,
        check_in_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        check_out_time TIMESTAMP,
        status VARCHAR(20) DEFAULT 'checked_in',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error.message);
    // Continue without database - will use in-memory storage
  }
}

// In-memory storage as fallback
const inMemoryRecords = [];

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Generate unique record ID
function generateRecordId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `SELF-${timestamp}-${random}`;
}

// Generate QR code string
function generateQRCode(recordId) {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 1); // Valid for 24 hours
  
  const signature = Buffer.from(recordId + '-' + expiry.getTime()).toString('base64').slice(0, 8);
  const qrCode = `VMS:${recordId}:${signature}:${expiry.getTime()}`;
  
  return { qrCode, qrExpiry: expiry.toISOString() };
}

// tRPC-style API endpoint for self check-in
app.post('/api/trpc/selfCheckIn.submit', async (req, res) => {
  try {
    console.log('Received check-in request:', JSON.stringify(req.body));
    
    // Handle batched tRPC format: { "0": { "json": {...} } }
    let formData;
    if (req.body['0'] && req.body['0'].json) {
      formData = req.body['0'].json;
    } else if (req.body.json) {
      formData = req.body.json;
    } else {
      formData = req.body;
    }
    
    const { fullName, type, idNumber, phone, company, purpose, lockerNumber, department, workArea } = formData;
    
    // Validate required fields
    if (!fullName || !type || !idNumber || !phone) {
      return res.json([{
        result: {
          data: {
            json: {
              success: false,
              error: 'กรุณากรอกข้อมูลให้ครบถ้วน'
            }
          }
        }
      }]);
    }
    
    const recordId = generateRecordId();
    const { qrCode, qrExpiry } = generateQRCode(recordId);
    
    // Try to save to database
    try {
      if (process.env.DATABASE_URL) {
        await pool.query(`
          INSERT INTO checkin_records 
          (record_id, full_name, type, id_number, phone, company, purpose, locker_number, department, work_area, qr_code, qr_expiry)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [recordId, fullName, type, idNumber, phone, company, purpose, lockerNumber, department, workArea, qrCode, qrExpiry]);
        console.log('Record saved to database:', recordId);
      } else {
        // Save to in-memory storage
        inMemoryRecords.push({
          recordId,
          fullName,
          type,
          idNumber,
          phone,
          company,
          purpose,
          lockerNumber,
          department,
          workArea,
          qrCode,
          qrExpiry,
          checkInTime: new Date().toISOString(),
          status: 'checked_in'
        });
        console.log('Record saved to memory:', recordId);
      }
    } catch (dbError) {
      console.error('Database save error:', dbError.message);
      // Continue - record ID is still valid
    }
    
    // Return success response in tRPC batched format
    res.json([{
      result: {
        data: {
          json: {
            success: true,
            recordId: recordId,
            qrCode: qrCode,
            qrExpiry: qrExpiry,
            message: 'ลงทะเบียนสำเร็จ'
          }
        }
      }
    }]);
    
  } catch (error) {
    console.error('Check-in error:', error);
    res.json([{
      result: {
        data: {
          json: {
            success: false,
            error: 'เกิดข้อผิดพลาดในการลงทะเบียน: ' + error.message
          }
        }
      }
    }]);
  }
});

// Get all records (for admin/app)
app.get('/api/trpc/selfCheckIn.getAll', async (req, res) => {
  try {
    let records;
    if (process.env.DATABASE_URL) {
      const result = await pool.query('SELECT * FROM checkin_records ORDER BY created_at DESC');
      records = result.rows;
    } else {
      records = inMemoryRecords;
    }
    
    res.json([{
      result: {
        data: {
          json: {
            success: true,
            records: records
          }
        }
      }
    }]);
  } catch (error) {
    console.error('Get records error:', error);
    res.json([{
      result: {
        data: {
          json: {
            success: false,
            error: error.message
          }
        }
      }
    }]);
  }
});

// Check-out endpoint
app.post('/api/trpc/selfCheckIn.checkOut', async (req, res) => {
  try {
    let data;
    if (req.body['0'] && req.body['0'].json) {
      data = req.body['0'].json;
    } else {
      data = req.body;
    }
    
    const { recordId } = data;
    
    if (process.env.DATABASE_URL) {
      await pool.query(`
        UPDATE checkin_records 
        SET status = 'checked_out', check_out_time = CURRENT_TIMESTAMP 
        WHERE record_id = $1
      `, [recordId]);
    } else {
      const record = inMemoryRecords.find(r => r.recordId === recordId);
      if (record) {
        record.status = 'checked_out';
        record.checkOutTime = new Date().toISOString();
      }
    }
    
    res.json([{
      result: {
        data: {
          json: {
            success: true,
            message: 'Check-out สำเร็จ'
          }
        }
      }
    }]);
  } catch (error) {
    console.error('Check-out error:', error);
    res.json([{
      result: {
        data: {
          json: {
            success: false,
            error: error.message
          }
        }
      }
    }]);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    database: process.env.DATABASE_URL ? 'connected' : 'in-memory',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    name: 'Hotel VMS Backend API',
    version: '1.0.0',
    endpoints: [
      'POST /api/trpc/selfCheckIn.submit',
      'GET /api/trpc/selfCheckIn.getAll',
      'POST /api/trpc/selfCheckIn.checkOut',
      'GET /health'
    ]
  });
});

// Initialize and start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Hotel VMS Backend running on port ${PORT}`);
    console.log(`Database: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'In-Memory'}`);
  });
});
