/**
 * Hotel VMS - Full Backend Server
 * Compatible with both Mobile App and Self Check-in Web
 * 
 * Deploy to Railway with PostgreSQL database
 */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '50mb' }));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Initialize database tables
async function initDatabase() {
  const client = await pool.connect();
  try {
    // App Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(64) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(16) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Visitor Records table
    await client.query(`
      CREATE TABLE IF NOT EXISTS visitor_records (
        id SERIAL PRIMARY KEY,
        record_id VARCHAR(64) UNIQUE NOT NULL,
        photo_uri TEXT,
        full_name VARCHAR(255) NOT NULL,
        type VARCHAR(32) DEFAULT 'visitor' CHECK (type IN ('visitor', 'casual', 'organizer', 'contractor')),
        id_number VARCHAR(64),
        phone VARCHAR(32),
        company VARCHAR(255),
        visitor_card_photo_uri TEXT,
        id_card_photo_uri TEXT,
        purpose TEXT,
        access_area VARCHAR(255),
        notes TEXT,
        vehicle_plate VARCHAR(64),
        check_in_time TIMESTAMP DEFAULT NOW(),
        check_out_time TIMESTAMP,
        status VARCHAR(8) DEFAULT 'IN' CHECK (status IN ('IN', 'OUT')),
        recorded_by VARCHAR(64) NOT NULL,
        consent_type VARCHAR(16) DEFAULT 'checkbox' CHECK (consent_type IN ('signature', 'checkbox')),
        consent_time TIMESTAMP DEFAULT NOW(),
        consent_signature TEXT,
        qr_code TEXT,
        qr_expiry TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Audit Logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        record_id VARCHAR(64),
        user_id VARCHAR(64) NOT NULL,
        action VARCHAR(32) NOT NULL,
        details TEXT,
        timestamp TIMESTAMP DEFAULT NOW()
      )
    `);

    // App Settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(64) UNIQUE NOT NULL,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Error Logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS error_logs (
        id SERIAL PRIMARY KEY,
        type VARCHAR(64) NOT NULL,
        message TEXT NOT NULL,
        source VARCHAR(64) NOT NULL,
        metadata TEXT,
        resolved BOOLEAN DEFAULT false,
        resolved_at TIMESTAMP,
        resolved_by VARCHAR(64),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Initialize default users
    const usersResult = await client.query('SELECT COUNT(*) FROM app_users');
    if (parseInt(usersResult.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO app_users (username, password_hash, name, role, is_active)
        VALUES 
          ('admin', 'admin123', 'Administrator', 'admin', true),
          ('user', 'user123', 'Staff User', 'user', true)
      `);
      console.log('[Database] Default users created');
    }

    console.log('[Database] Tables initialized');
  } finally {
    client.release();
  }
}

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected', error: error.message });
  }
});

// ============================================
// tRPC-compatible API endpoints
// ============================================

// Helper to wrap response in tRPC batch format
function trpcResponse(data) {
  return [{ result: { data: { json: data } } }];
}

function trpcError(error) {
  return [{ error: { message: error, code: 'BAD_REQUEST' } }];
}

// Parse tRPC batch request
function parseTrpcInput(req) {
  if (req.method === 'POST' && req.body && req.body['0']) {
    return req.body['0'].json || req.body['0'];
  }
  if (req.query.input) {
    try {
      const parsed = JSON.parse(req.query.input);
      return parsed['0']?.json || parsed['0'] || parsed;
    } catch {
      return {};
    }
  }
  return {};
}

// ============================================
// App Users Routes
// ============================================

// Login
app.post('/api/trpc/appUsers.login', async (req, res) => {
  try {
    const input = parseTrpcInput(req);
    const { username, password } = input;

    if (!username || !password) {
      return res.json(trpcResponse({ success: false, error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' }));
    }

    const result = await pool.query(
      'SELECT * FROM app_users WHERE username = $1 AND password_hash = $2 AND is_active = true',
      [username, password]
    );

    if (result.rows.length === 0) {
      return res.json(trpcResponse({ success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }));
    }

    const user = result.rows[0];

    // Log login
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
      [user.username, 'USER_LOGIN', `User ${user.username} logged in`]
    );

    res.json(trpcResponse({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        isActive: user.is_active,
      }
    }));
  } catch (error) {
    console.error('[appUsers.login] Error:', error);
    res.json(trpcResponse({ success: false, error: 'เกิดข้อผิดพลาด' }));
  }
});

// List users
app.get('/api/trpc/appUsers.list', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM app_users ORDER BY created_at DESC');
    const users = result.rows.map(u => ({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      isActive: u.is_active,
      createdAt: u.created_at?.toISOString(),
    }));
    res.json(trpcResponse(users));
  } catch (error) {
    console.error('[appUsers.list] Error:', error);
    res.json(trpcResponse([]));
  }
});

// Create user
app.post('/api/trpc/appUsers.create', async (req, res) => {
  try {
    const input = parseTrpcInput(req);
    const { username, password, name, role = 'user' } = input;

    // Check if exists
    const existing = await pool.query('SELECT id FROM app_users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.json(trpcResponse({ success: false, error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' }));
    }

    const result = await pool.query(
      'INSERT INTO app_users (username, password_hash, name, role, is_active) VALUES ($1, $2, $3, $4, true) RETURNING id',
      [username, password, name, role]
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
      ['system', 'USER_CREATED', `User ${username} created`]
    );

    res.json(trpcResponse({ success: true, id: result.rows[0].id }));
  } catch (error) {
    console.error('[appUsers.create] Error:', error);
    res.json(trpcResponse({ success: false, error: 'เกิดข้อผิดพลาด' }));
  }
});

// Update user
app.post('/api/trpc/appUsers.update', async (req, res) => {
  try {
    const input = parseTrpcInput(req);
    const { id, name, password, role, isActive } = input;

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (password !== undefined) {
      updates.push(`password_hash = $${paramIndex++}`);
      values.push(password);
    }
    if (role !== undefined) {
      updates.push(`role = $${paramIndex++}`);
      values.push(role);
    }
    if (isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(isActive);
    }

    if (updates.length > 0) {
      values.push(id);
      await pool.query(
        `UPDATE app_users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex}`,
        values
      );
    }

    res.json(trpcResponse({ success: true }));
  } catch (error) {
    console.error('[appUsers.update] Error:', error);
    res.json(trpcResponse({ success: false, error: 'เกิดข้อผิดพลาด' }));
  }
});

// Delete user
app.post('/api/trpc/appUsers.delete', async (req, res) => {
  try {
    const input = parseTrpcInput(req);
    const { id } = input;

    await pool.query('DELETE FROM app_users WHERE id = $1', [id]);
    res.json(trpcResponse({ success: true }));
  } catch (error) {
    console.error('[appUsers.delete] Error:', error);
    res.json(trpcResponse({ success: false, error: 'เกิดข้อผิดพลาด' }));
  }
});

// ============================================
// Visitors Routes (for Mobile App)
// ============================================

// List all visitors
app.get('/api/trpc/visitors.list', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM visitor_records ORDER BY check_in_time DESC');
    const records = result.rows.map(r => ({
      id: r.record_id,
      dbId: r.id,
      hasPhoto: !!r.photo_uri,
      fullName: r.full_name,
      type: r.type,
      idNumber: r.id_number,
      phone: r.phone,
      company: r.company,
      hasVisitorCardPhoto: !!r.visitor_card_photo_uri,
      hasIdCardPhoto: !!r.id_card_photo_uri,
      purpose: r.purpose,
      accessArea: r.access_area,
      notes: r.notes,
      vehiclePlate: r.vehicle_plate,
      checkInTime: r.check_in_time?.toISOString(),
      checkOutTime: r.check_out_time?.toISOString(),
      status: r.status,
      recordedBy: r.recorded_by,
      consentType: r.consent_type,
      consentTime: r.consent_time?.toISOString(),
      hasConsentSignature: !!r.consent_signature,
      qrCode: r.qr_code,
      qrExpiry: r.qr_expiry?.toISOString(),
    }));
    res.json(trpcResponse(records));
  } catch (error) {
    console.error('[visitors.list] Error:', error);
    res.json(trpcResponse([]));
  }
});

// Get active visitors
app.get('/api/trpc/visitors.active', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM visitor_records WHERE status = 'IN' ORDER BY check_in_time DESC"
    );
    const records = result.rows.map(r => ({
      id: r.record_id,
      dbId: r.id,
      fullName: r.full_name,
      type: r.type,
      checkInTime: r.check_in_time?.toISOString(),
      status: r.status,
    }));
    res.json(trpcResponse(records));
  } catch (error) {
    console.error('[visitors.active] Error:', error);
    res.json(trpcResponse([]));
  }
});

// Get visitor by ID
app.get('/api/trpc/visitors.byId', async (req, res) => {
  try {
    const input = parseTrpcInput(req);
    const recordId = input.recordId || req.query.recordId;

    const result = await pool.query('SELECT * FROM visitor_records WHERE record_id = $1', [recordId]);
    
    if (result.rows.length === 0) {
      return res.json(trpcResponse(null));
    }

    const r = result.rows[0];
    res.json(trpcResponse({
      id: r.record_id,
      dbId: r.id,
      photoUri: r.photo_uri,
      fullName: r.full_name,
      type: r.type,
      idNumber: r.id_number,
      phone: r.phone,
      company: r.company,
      visitorCardPhotoUri: r.visitor_card_photo_uri,
      idCardPhotoUri: r.id_card_photo_uri,
      purpose: r.purpose,
      accessArea: r.access_area,
      notes: r.notes,
      vehiclePlate: r.vehicle_plate,
      checkInTime: r.check_in_time?.toISOString(),
      checkOutTime: r.check_out_time?.toISOString(),
      status: r.status,
      recordedBy: r.recorded_by,
      consentType: r.consent_type,
      consentTime: r.consent_time?.toISOString(),
      consentSignature: r.consent_signature,
      qrCode: r.qr_code,
      qrExpiry: r.qr_expiry?.toISOString(),
    }));
  } catch (error) {
    console.error('[visitors.byId] Error:', error);
    res.json(trpcResponse(null));
  }
});

// Check-in visitor (from Mobile App)
app.post('/api/trpc/visitors.checkIn', async (req, res) => {
  try {
    const input = parseTrpcInput(req);
    const {
      recordId, photoUri, fullName, type, idNumber, phone, company,
      visitorCardPhotoUri, idCardPhotoUri, purpose, accessArea, notes,
      vehiclePlate, recordedBy, consentType, consentSignature, qrCode, qrExpiry
    } = input;

    const result = await pool.query(`
      INSERT INTO visitor_records (
        record_id, photo_uri, full_name, type, id_number, phone, company,
        visitor_card_photo_uri, id_card_photo_uri, purpose, access_area, notes,
        vehicle_plate, recorded_by, consent_type, consent_signature, qr_code, qr_expiry, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'IN')
      RETURNING id
    `, [
      recordId, photoUri, fullName, type || 'visitor', idNumber, phone, company,
      visitorCardPhotoUri, idCardPhotoUri, purpose, accessArea, notes,
      vehiclePlate, recordedBy, consentType || 'checkbox', consentSignature, qrCode, qrExpiry
    ]);

    await pool.query(
      'INSERT INTO audit_logs (record_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
      [recordId, recordedBy, 'CHECK_IN', `${fullName} checked in`]
    );

    res.json(trpcResponse({ success: true, id: result.rows[0].id, recordId }));
  } catch (error) {
    console.error('[visitors.checkIn] Error:', error);
    res.json(trpcResponse({ success: false, error: 'เกิดข้อผิดพลาด' }));
  }
});

// Check-out visitor
app.post('/api/trpc/visitors.checkOut', async (req, res) => {
  try {
    const input = parseTrpcInput(req);
    const { recordId, userId } = input;

    await pool.query(
      "UPDATE visitor_records SET status = 'OUT', check_out_time = NOW() WHERE record_id = $1",
      [recordId]
    );

    await pool.query(
      'INSERT INTO audit_logs (record_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
      [recordId, userId, 'CHECK_OUT', `Visitor checked out`]
    );

    res.json(trpcResponse({ success: true }));
  } catch (error) {
    console.error('[visitors.checkOut] Error:', error);
    res.json(trpcResponse({ success: false, error: 'เกิดข้อผิดพลาด' }));
  }
});

// Update visitor
app.post('/api/trpc/visitors.update', async (req, res) => {
  try {
    const input = parseTrpcInput(req);
    const { recordId, userId, ...updateData } = input;

    const fieldMap = {
      fullName: 'full_name',
      idNumber: 'id_number',
      phone: 'phone',
      company: 'company',
      purpose: 'purpose',
      accessArea: 'access_area',
      notes: 'notes',
      vehiclePlate: 'vehicle_plate',
      type: 'type',
    };

    const updates = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, dbField] of Object.entries(fieldMap)) {
      if (updateData[key] !== undefined) {
        updates.push(`${dbField} = $${paramIndex++}`);
        values.push(updateData[key]);
      }
    }

    if (updates.length > 0) {
      values.push(recordId);
      await pool.query(
        `UPDATE visitor_records SET ${updates.join(', ')}, updated_at = NOW() WHERE record_id = $${paramIndex}`,
        values
      );

      await pool.query(
        'INSERT INTO audit_logs (record_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
        [recordId, userId, 'EDIT_RECORD', 'Record updated']
      );
    }

    res.json(trpcResponse({ success: true }));
  } catch (error) {
    console.error('[visitors.update] Error:', error);
    res.json(trpcResponse({ success: false, error: 'เกิดข้อผิดพลาด' }));
  }
});

// Delete visitor
app.post('/api/trpc/visitors.delete', async (req, res) => {
  try {
    const input = parseTrpcInput(req);
    const { recordId, userId } = input;

    await pool.query('DELETE FROM visitor_records WHERE record_id = $1', [recordId]);

    await pool.query(
      'INSERT INTO audit_logs (record_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
      [recordId, userId, 'DELETE_RECORD', 'Record deleted']
    );

    res.json(trpcResponse({ success: true }));
  } catch (error) {
    console.error('[visitors.delete] Error:', error);
    res.json(trpcResponse({ success: false, error: 'เกิดข้อผิดพลาด' }));
  }
});

// ============================================
// Self Check-in Routes (for Web)
// ============================================

// Get consent text
app.get('/api/trpc/selfCheckIn.getConsent', async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM app_settings WHERE key = 'consentText'");
    const consentText = result.rows[0]?.value || 'ข้าพเจ้ายินยอมให้เก็บข้อมูลส่วนบุคคลเพื่อวัตถุประสงค์ด้านความปลอดภัย';
    res.json(trpcResponse({ consentText }));
  } catch (error) {
    console.error('[selfCheckIn.getConsent] Error:', error);
    res.json(trpcResponse({ consentText: 'ข้าพเจ้ายินยอมให้เก็บข้อมูลส่วนบุคคลเพื่อวัตถุประสงค์ด้านความปลอดภัย' }));
  }
});

// Submit self check-in
app.post('/api/trpc/selfCheckIn.submit', async (req, res) => {
  try {
    const input = parseTrpcInput(req);
    const {
      fullName, type = 'visitor', idNumber, phone, company,
      purpose, accessArea, notes, photoData, lockerNumber,
      consentAccepted, visitorType
    } = input;

    // Support both 'type' and 'visitorType' field names
    const visitorTypeValue = type || visitorType || 'visitor';

    // Validate required fields
    if (!fullName) {
      return res.json(trpcResponse({ success: false, error: 'กรุณากรอกชื่อ-นามสกุล' }));
    }

    // Generate unique record ID
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const recordId = `SELF-${timestamp}-${randomSuffix}`;

    // Generate QR code data
    const qrData = `VMS:${recordId}:${Buffer.from(recordId).toString('base64').substring(0, 12)}:${timestamp + 86400000}`;
    const qrExpiry = new Date(timestamp + 86400000); // 24 hours

    // Insert record
    const result = await pool.query(`
      INSERT INTO visitor_records (
        record_id, full_name, type, id_number, phone, company,
        purpose, access_area, notes, vehicle_plate, photo_uri,
        recorded_by, consent_type, qr_code, qr_expiry, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'IN')
      RETURNING id, check_in_time
    `, [
      recordId, fullName, visitorTypeValue, idNumber, phone, company,
      purpose, accessArea, notes, lockerNumber, photoData,
      'self-checkin', 'checkbox', qrData, qrExpiry
    ]);

    await pool.query(
      'INSERT INTO audit_logs (record_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
      [recordId, 'self-checkin', 'SELF_CHECK_IN', `${fullName} self checked in via web`]
    );

    res.json(trpcResponse({
      success: true,
      recordId,
      qrData,
      qrCode: qrData,
      checkInTime: result.rows[0].check_in_time.toISOString(),
      message: 'ลงทะเบียนสำเร็จ',
    }));
  } catch (error) {
    console.error('[selfCheckIn.submit] Error:', error);
    res.json(trpcResponse({ success: false, error: 'เกิดข้อผิดพลาดในการลงทะเบียน' }));
  }
});

// Get all self check-in records (for compatibility)
app.get('/api/trpc/selfCheckIn.getAll', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM visitor_records ORDER BY check_in_time DESC');
    res.json(trpcResponse({
      success: true,
      records: result.rows.map(r => ({
        id: r.id,
        record_id: r.record_id,
        full_name: r.full_name,
        type: r.type,
        id_number: r.id_number,
        phone: r.phone,
        company: r.company,
        purpose: r.purpose,
        locker_number: r.vehicle_plate,
        department: null,
        work_area: r.access_area,
        qr_code: r.qr_code,
        qr_expiry: r.qr_expiry?.toISOString(),
        check_in_time: r.check_in_time?.toISOString(),
        check_out_time: r.check_out_time?.toISOString(),
        status: r.status === 'IN' ? 'checked_in' : 'checked_out',
        created_at: r.created_at?.toISOString(),
      }))
    }));
  } catch (error) {
    console.error('[selfCheckIn.getAll] Error:', error);
    res.json(trpcResponse({ success: true, records: [] }));
  }
});

// ============================================
// Settings Routes
// ============================================

app.get('/api/trpc/settings.get', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM app_settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    
    res.json(trpcResponse({
      consentText: settings.consentText || 'ข้าพเจ้ายินยอมให้เก็บข้อมูลส่วนบุคคลเพื่อวัตถุประสงค์ด้านความปลอดภัย',
      retentionDays: parseInt(settings.retentionDays || '90'),
      notificationTime: settings.notificationTime || '00:00',
    }));
  } catch (error) {
    console.error('[settings.get] Error:', error);
    res.json(trpcResponse({
      consentText: 'ข้าพเจ้ายินยอมให้เก็บข้อมูลส่วนบุคคลเพื่อวัตถุประสงค์ด้านความปลอดภัย',
      retentionDays: 90,
      notificationTime: '00:00',
    }));
  }
});

app.post('/api/trpc/settings.update', async (req, res) => {
  try {
    const input = parseTrpcInput(req);
    const { consentText, retentionDays, notificationTime, userId } = input;

    if (consentText !== undefined) {
      await pool.query(
        'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        ['consentText', consentText]
      );
    }
    if (retentionDays !== undefined) {
      await pool.query(
        'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        ['retentionDays', retentionDays.toString()]
      );
    }
    if (notificationTime !== undefined) {
      await pool.query(
        'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        ['notificationTime', notificationTime]
      );
    }

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
      [userId || 'system', 'SETTINGS_UPDATED', 'App settings updated']
    );

    res.json(trpcResponse({ success: true }));
  } catch (error) {
    console.error('[settings.update] Error:', error);
    res.json(trpcResponse({ success: false, error: 'เกิดข้อผิดพลาด' }));
  }
});

// ============================================
// Audit Logs Routes
// ============================================

app.get('/api/trpc/auditLogs.list', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 500');
    res.json(trpcResponse(result.rows.map(log => ({
      id: log.id,
      recordId: log.record_id,
      userId: log.user_id,
      action: log.action,
      details: log.details,
      timestamp: log.timestamp?.toISOString(),
    }))));
  } catch (error) {
    console.error('[auditLogs.list] Error:', error);
    res.json(trpcResponse([]));
  }
});

// ============================================
// Error Logs Routes
// ============================================

app.get('/api/trpc/errorLog.list', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT 100');
    res.json(trpcResponse(result.rows.map(log => ({
      id: log.id,
      type: log.type,
      message: log.message,
      source: log.source,
      metadata: log.metadata ? JSON.parse(log.metadata) : null,
      resolved: log.resolved,
      resolvedAt: log.resolved_at?.toISOString(),
      resolvedBy: log.resolved_by,
      createdAt: log.created_at?.toISOString(),
    }))));
  } catch (error) {
    console.error('[errorLog.list] Error:', error);
    res.json(trpcResponse([]));
  }
});

app.post('/api/trpc/errorLog.create', async (req, res) => {
  try {
    const input = parseTrpcInput(req);
    const { type, message, source, metadata } = input;

    const result = await pool.query(
      'INSERT INTO error_logs (type, message, source, metadata) VALUES ($1, $2, $3, $4) RETURNING id',
      [type, message, source, metadata ? JSON.stringify(metadata) : null]
    );

    res.json(trpcResponse({ success: true, id: result.rows[0].id }));
  } catch (error) {
    console.error('[errorLog.create] Error:', error);
    res.json(trpcResponse({ success: false, error: 'เกิดข้อผิดพลาด' }));
  }
});

// ============================================
// Statistics
// ============================================

app.get('/api/trpc/stats.today', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await pool.query('SELECT * FROM visitor_records WHERE check_in_time >= $1', [today]);
    const records = result.rows;

    const todayIn = records.length;
    const todayOut = records.filter(r => r.status === 'OUT').length;
    const pending = records.filter(r => r.status === 'IN').length;

    res.json(trpcResponse({ todayIn, todayOut, pending }));
  } catch (error) {
    console.error('[stats.today] Error:', error);
    res.json(trpcResponse({ todayIn: 0, todayOut: 0, pending: 0 }));
  }
});

// ============================================
// Start Server
// ============================================

async function startServer() {
  try {
    await initDatabase();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[Server] Hotel VMS Backend running on port ${PORT}`);
      console.log(`[Server] Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

startServer();
