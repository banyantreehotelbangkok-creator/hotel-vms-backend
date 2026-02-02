/**
 * Hotel VMS Full Backend API
 * Complete backend for Hotel Visitor Management System
 * Supports both Self Check-in Web and Mobile App
 */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const QRCode = require('qrcode');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
        role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Visitor Records table
    await client.query(`
      CREATE TABLE IF NOT EXISTS visitor_records (
        id SERIAL PRIMARY KEY,
        record_id VARCHAR(64) UNIQUE NOT NULL,
        photo_uri TEXT,
        full_name VARCHAR(255) NOT NULL,
        type VARCHAR(20) DEFAULT 'visitor' CHECK (type IN ('visitor', 'casual', 'organizer', 'contractor')),
        id_number VARCHAR(64),
        phone VARCHAR(32),
        company VARCHAR(255),
        visitor_card_photo_uri TEXT,
        id_card_photo_uri TEXT,
        purpose TEXT,
        access_area VARCHAR(255),
        notes TEXT,
        vehicle_plate VARCHAR(64),
        check_in_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        check_out_time TIMESTAMP,
        status VARCHAR(10) DEFAULT 'IN' CHECK (status IN ('IN', 'OUT')),
        recorded_by VARCHAR(64) NOT NULL,
        consent_type VARCHAR(20) DEFAULT 'checkbox' CHECK (consent_type IN ('signature', 'checkbox')),
        consent_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        consent_signature TEXT,
        qr_code TEXT,
        qr_expiry TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Audit Logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        record_id VARCHAR(64),
        user_id VARCHAR(64) NOT NULL,
        action VARCHAR(50) NOT NULL,
        details TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // App Settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(64) UNIQUE NOT NULL,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default users if not exist
    const userCheck = await client.query('SELECT COUNT(*) FROM app_users');
    if (parseInt(userCheck.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO app_users (username, password_hash, name, role, is_active)
        VALUES 
          ('admin', 'admin123', 'Administrator', 'admin', true),
          ('user', 'user123', 'Staff User', 'user', true)
      `);
      console.log('[Database] Default users created');
    }

    // Insert default settings if not exist
    const settingsCheck = await client.query('SELECT COUNT(*) FROM app_settings');
    if (parseInt(settingsCheck.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO app_settings (key, value)
        VALUES 
          ('consentText', 'ข้าพเจ้ายินยอมให้เก็บข้อมูลส่วนบุคคลเพื่อวัตถุประสงค์ด้านความปลอดภัย'),
          ('retentionDays', '90'),
          ('notificationTime', '00:00'),
          ('emailEnabled', 'false'),
          ('emailRecipient', ''),
          ('emailSendTime', '08:00'),
          ('emailIncludeDetails', 'true')
      `);
      console.log('[Database] Default settings created');
    }

    console.log('[Database] Tables initialized successfully');
  } catch (error) {
    console.error('[Database] Error initializing tables:', error);
  } finally {
    client.release();
  }
}

// ============================================
// Health Check
// ============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// Authentication APIs
// ============================================
app.post('/api/trpc/appUsers.login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const result = await pool.query(
      'SELECT * FROM app_users WHERE username = $1 AND is_active = true',
      [username]
    );
    
    if (result.rows.length === 0 || result.rows[0].password_hash !== password) {
      return res.json({ success: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
    
    const user = result.rows[0];
    
    // Log login action
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
      [user.username, 'USER_LOGIN', `User ${user.username} logged in`]
    );
    
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        isActive: user.is_active
      }
    });
  } catch (error) {
    console.error('[Login] Error:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ' });
  }
});

// ============================================
// User Management APIs
// ============================================
app.get('/api/trpc/appUsers.list', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM app_users ORDER BY created_at DESC');
    res.json(result.rows.map(u => ({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      isActive: u.is_active,
      createdAt: u.created_at
    })));
  } catch (error) {
    console.error('[Users] Error listing:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

app.post('/api/trpc/appUsers.create', async (req, res) => {
  try {
    const { username, password, name, role = 'user' } = req.body;
    
    // Check if username exists
    const existing = await pool.query('SELECT id FROM app_users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.json({ success: false, error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' });
    }
    
    const result = await pool.query(
      'INSERT INTO app_users (username, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [username, password, name, role]
    );
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
      ['system', 'USER_CREATED', `User ${username} created`]
    );
    
    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('[Users] Error creating:', error);
    res.status(500).json({ success: false, error: 'Failed to create user' });
  }
});

app.post('/api/trpc/appUsers.update', async (req, res) => {
  try {
    const { id, name, password, role, isActive } = req.body;
    
    let query = 'UPDATE app_users SET updated_at = CURRENT_TIMESTAMP';
    const values = [];
    let paramIndex = 1;
    
    if (name !== undefined) {
      query += `, name = $${paramIndex++}`;
      values.push(name);
    }
    if (password !== undefined) {
      query += `, password_hash = $${paramIndex++}`;
      values.push(password);
    }
    if (role !== undefined) {
      query += `, role = $${paramIndex++}`;
      values.push(role);
    }
    if (isActive !== undefined) {
      query += `, is_active = $${paramIndex++}`;
      values.push(isActive);
    }
    
    query += ` WHERE id = $${paramIndex}`;
    values.push(id);
    
    await pool.query(query, values);
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
      ['system', 'USER_UPDATED', `User ID ${id} updated`]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Users] Error updating:', error);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

app.post('/api/trpc/appUsers.delete', async (req, res) => {
  try {
    const { id } = req.body;
    
    const user = await pool.query('SELECT username, name FROM app_users WHERE id = $1', [id]);
    if (user.rows.length === 0) {
      return res.json({ success: false, error: 'ไม่พบผู้ใช้ที่ต้องการลบ' });
    }
    
    await pool.query('DELETE FROM app_users WHERE id = $1', [id]);
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
      ['admin', 'USER_DELETED', `User ${user.rows[0].username} (${user.rows[0].name}) deleted`]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Users] Error deleting:', error);
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

// ============================================
// Visitor Records APIs
// ============================================
app.get('/api/trpc/visitors.list', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM visitor_records ORDER BY check_in_time DESC');
    res.json(result.rows.map(r => ({
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
      checkInTime: r.check_in_time,
      checkOutTime: r.check_out_time,
      status: r.status,
      recordedBy: r.recorded_by,
      consentType: r.consent_type,
      consentTime: r.consent_time,
      hasConsentSignature: !!r.consent_signature,
      qrCode: r.qr_code,
      qrExpiry: r.qr_expiry
    })));
  } catch (error) {
    console.error('[Visitors] Error listing:', error);
    res.status(500).json({ error: 'Failed to list visitors' });
  }
});

app.get('/api/trpc/visitors.active', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM visitor_records WHERE status = 'IN' ORDER BY check_in_time DESC"
    );
    res.json(result.rows.map(r => ({
      id: r.record_id,
      dbId: r.id,
      fullName: r.full_name,
      type: r.type,
      checkInTime: r.check_in_time,
      status: r.status
    })));
  } catch (error) {
    console.error('[Visitors] Error getting active:', error);
    res.status(500).json({ error: 'Failed to get active visitors' });
  }
});

app.post('/api/trpc/visitors.byId', async (req, res) => {
  try {
    const { recordId } = req.body;
    const result = await pool.query('SELECT * FROM visitor_records WHERE record_id = $1', [recordId]);
    
    if (result.rows.length === 0) {
      return res.json(null);
    }
    
    const r = result.rows[0];
    res.json({
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
      checkInTime: r.check_in_time,
      checkOutTime: r.check_out_time,
      status: r.status,
      recordedBy: r.recorded_by,
      consentType: r.consent_type,
      consentTime: r.consent_time,
      consentSignature: r.consent_signature,
      qrCode: r.qr_code,
      qrExpiry: r.qr_expiry
    });
  } catch (error) {
    console.error('[Visitors] Error getting by ID:', error);
    res.status(500).json({ error: 'Failed to get visitor' });
  }
});

app.post('/api/trpc/visitors.checkIn', async (req, res) => {
  try {
    const {
      recordId, photoUri, fullName, type, idNumber, phone, company,
      visitorCardPhotoUri, idCardPhotoUri, purpose, accessArea, notes,
      vehiclePlate, recordedBy, consentType, consentSignature, qrCode, qrExpiry
    } = req.body;
    
    const result = await pool.query(`
      INSERT INTO visitor_records (
        record_id, photo_uri, full_name, type, id_number, phone, company,
        visitor_card_photo_uri, id_card_photo_uri, purpose, access_area, notes,
        vehicle_plate, recorded_by, consent_type, consent_signature, qr_code, qr_expiry
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING id
    `, [
      recordId, photoUri, fullName, type, idNumber, phone, company,
      visitorCardPhotoUri, idCardPhotoUri, purpose, accessArea, notes,
      vehiclePlate, recordedBy, consentType, consentSignature, qrCode, qrExpiry
    ]);
    
    await pool.query(
      'INSERT INTO audit_logs (record_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
      [recordId, recordedBy, 'CHECK_IN', `${fullName} checked in`]
    );
    
    res.json({ success: true, id: result.rows[0].id, recordId });
  } catch (error) {
    console.error('[Visitors] Error checking in:', error);
    res.status(500).json({ success: false, error: 'Failed to check in' });
  }
});

app.post('/api/trpc/visitors.checkOut', async (req, res) => {
  try {
    const { recordId, userId } = req.body;
    
    await pool.query(
      "UPDATE visitor_records SET status = 'OUT', check_out_time = CURRENT_TIMESTAMP WHERE record_id = $1",
      [recordId]
    );
    
    const visitor = await pool.query('SELECT full_name FROM visitor_records WHERE record_id = $1', [recordId]);
    const fullName = visitor.rows[0]?.full_name || 'Unknown';
    
    await pool.query(
      'INSERT INTO audit_logs (record_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
      [recordId, userId, 'CHECK_OUT', `${fullName} checked out`]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Visitors] Error checking out:', error);
    res.status(500).json({ success: false, error: 'Failed to check out' });
  }
});

app.post('/api/trpc/visitors.forceCheckOut', async (req, res) => {
  try {
    const { recordId, userId, reason } = req.body;
    
    await pool.query(
      "UPDATE visitor_records SET status = 'OUT', check_out_time = CURRENT_TIMESTAMP WHERE record_id = $1",
      [recordId]
    );
    
    const visitor = await pool.query('SELECT full_name FROM visitor_records WHERE record_id = $1', [recordId]);
    const fullName = visitor.rows[0]?.full_name || 'Unknown';
    
    await pool.query(
      'INSERT INTO audit_logs (record_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
      [recordId, userId, 'FORCE_CHECK_OUT', `${fullName} force checked out. Reason: ${reason || 'N/A'}`]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Visitors] Error force checking out:', error);
    res.status(500).json({ success: false, error: 'Failed to force check out' });
  }
});

app.post('/api/trpc/visitors.update', async (req, res) => {
  try {
    const { dbId, fullName, type, idNumber, phone, company, purpose, accessArea, notes, vehiclePlate, userId } = req.body;
    
    await pool.query(`
      UPDATE visitor_records SET
        full_name = COALESCE($1, full_name),
        type = COALESCE($2, type),
        id_number = COALESCE($3, id_number),
        phone = COALESCE($4, phone),
        company = COALESCE($5, company),
        purpose = COALESCE($6, purpose),
        access_area = COALESCE($7, access_area),
        notes = COALESCE($8, notes),
        vehicle_plate = COALESCE($9, vehicle_plate),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
    `, [fullName, type, idNumber, phone, company, purpose, accessArea, notes, vehiclePlate, dbId]);
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
      [userId || 'system', 'EDIT_RECORD', `Record ID ${dbId} updated`]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Visitors] Error updating:', error);
    res.status(500).json({ success: false, error: 'Failed to update visitor' });
  }
});

app.post('/api/trpc/visitors.delete', async (req, res) => {
  try {
    const { dbId, userId } = req.body;
    
    const visitor = await pool.query('SELECT full_name FROM visitor_records WHERE id = $1', [dbId]);
    const fullName = visitor.rows[0]?.full_name || 'Unknown';
    
    await pool.query('DELETE FROM visitor_records WHERE id = $1', [dbId]);
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
      [userId || 'system', 'DELETE_RECORD', `Record ${fullName} deleted`]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Visitors] Error deleting:', error);
    res.status(500).json({ success: false, error: 'Failed to delete visitor' });
  }
});

// ============================================
// Self Check-in APIs (Public - No Auth Required)
// ============================================
app.get('/api/trpc/selfCheckIn.getConsent', async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM app_settings WHERE key = 'consentText'");
    res.json({
      consentText: result.rows[0]?.value || 'ข้าพเจ้ายินยอมให้เก็บข้อมูลส่วนบุคคลเพื่อวัตถุประสงค์ด้านความปลอดภัย'
    });
  } catch (error) {
    console.error('[SelfCheckIn] Error getting consent:', error);
    res.json({ consentText: 'ข้าพเจ้ายินยอมให้เก็บข้อมูลส่วนบุคคลเพื่อวัตถุประสงค์ด้านความปลอดภัย' });
  }
});

app.post('/api/trpc/selfCheckIn.submit', async (req, res) => {
  try {
    const { fullName, type, idNumber, phone, company, purpose, accessArea, notes, photoData, lockerNumber, consentAccepted } = req.body;
    
    if (!consentAccepted) {
      return res.json({ success: false, error: 'กรุณายอมรับข้อตกลงการเก็บข้อมูล' });
    }
    
    // Generate unique record ID
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const recordId = `SELF-${timestamp}-${randomSuffix}`;
    
    // Generate QR code
    const qrCode = `VMS-${recordId}`;
    const qrExpiry = new Date();
    qrExpiry.setHours(qrExpiry.getHours() + 24);
    
    // Store photo as Base64 directly
    let photoUri = null;
    if (photoData && photoData.startsWith('data:image/')) {
      photoUri = photoData;
      console.log('[SelfCheckIn] Photo stored as Base64, size:', Math.round(photoData.length / 1024), 'KB');
    }
    
    // Create visitor record
    const result = await pool.query(`
      INSERT INTO visitor_records (
        record_id, full_name, type, id_number, phone, company, purpose, access_area, notes,
        vehicle_plate, photo_uri, recorded_by, consent_type, qr_code, qr_expiry
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id
    `, [
      recordId, fullName, type, idNumber, phone, company, purpose, accessArea, notes,
      lockerNumber, photoUri, 'self-checkin', 'checkbox', qrCode, qrExpiry
    ]);
    
    await pool.query(
      'INSERT INTO audit_logs (record_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
      [recordId, 'self-checkin', 'SELF_CHECK_IN', `${fullName} self checked in via web`]
    );
    
    res.json({
      success: true,
      recordId,
      qrCode,
      checkInTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('[SelfCheckIn] Error:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการลงทะเบียน' });
  }
});

app.get('/api/trpc/selfCheckIn.getAll', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM visitor_records ORDER BY check_in_time DESC');
    res.json(result.rows.map(r => ({
      id: r.record_id,
      fullName: r.full_name,
      type: r.type,
      company: r.company,
      purpose: r.purpose,
      checkInTime: r.check_in_time,
      checkOutTime: r.check_out_time,
      status: r.status,
      qrCode: r.qr_code
    })));
  } catch (error) {
    console.error('[SelfCheckIn] Error getting all:', error);
    res.status(500).json({ error: 'Failed to get records' });
  }
});

app.post('/api/trpc/selfCheckIn.checkOut', async (req, res) => {
  try {
    const { qrCode } = req.body;
    
    const result = await pool.query('SELECT * FROM visitor_records WHERE qr_code = $1', [qrCode]);
    
    if (result.rows.length === 0) {
      return res.json({ success: false, error: 'ไม่พบข้อมูลการลงทะเบียน' });
    }
    
    const record = result.rows[0];
    
    if (record.status === 'OUT') {
      return res.json({ success: false, error: 'ท่านได้ทำการ Check-out ไปแล้ว' });
    }
    
    await pool.query(
      "UPDATE visitor_records SET status = 'OUT', check_out_time = CURRENT_TIMESTAMP WHERE qr_code = $1",
      [qrCode]
    );
    
    await pool.query(
      'INSERT INTO audit_logs (record_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
      [record.record_id, 'self-checkout', 'CHECK_OUT', `${record.full_name} self checked out via QR`]
    );
    
    res.json({
      success: true,
      fullName: record.full_name,
      checkOutTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('[SelfCheckIn] Error checking out:', error);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดในการ Check-out' });
  }
});

// ============================================
// Statistics APIs
// ============================================
app.get('/api/trpc/visitors.stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const result = await pool.query('SELECT * FROM visitor_records');
    const records = result.rows;
    
    const todayIn = records.filter(r => {
      const checkIn = new Date(r.check_in_time);
      return checkIn >= today;
    }).length;
    
    const todayOut = records.filter(r => {
      if (!r.check_out_time) return false;
      const checkOut = new Date(r.check_out_time);
      return checkOut >= today;
    }).length;
    
    const pending = records.filter(r => r.status === 'IN').length;
    
    res.json({ todayIn, todayOut, pending });
  } catch (error) {
    console.error('[Stats] Error:', error);
    res.status(500).json({ todayIn: 0, todayOut: 0, pending: 0 });
  }
});

// ============================================
// Settings APIs
// ============================================
app.get('/api/trpc/settings.get', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM app_settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    
    res.json({
      consentText: settings.consentText || 'ข้าพเจ้ายินยอมให้เก็บข้อมูลส่วนบุคคลเพื่อวัตถุประสงค์ด้านความปลอดภัย',
      retentionDays: parseInt(settings.retentionDays || '90'),
      notificationTime: settings.notificationTime || '00:00'
    });
  } catch (error) {
    console.error('[Settings] Error getting:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

app.post('/api/trpc/settings.update', async (req, res) => {
  try {
    const { consentText, retentionDays, notificationTime, userId } = req.body;
    
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
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Settings] Error updating:', error);
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

// ============================================
// Email Settings APIs
// ============================================
app.get('/api/trpc/email.getSettings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM app_settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    
    res.json({
      enabled: settings.emailEnabled === 'true',
      recipientEmail: settings.emailRecipient || '',
      sendTime: settings.emailSendTime || '08:00',
      includeDetails: settings.emailIncludeDetails === 'true'
    });
  } catch (error) {
    console.error('[Email] Error getting settings:', error);
    res.status(500).json({ error: 'Failed to get email settings' });
  }
});

app.post('/api/trpc/email.updateSettings', async (req, res) => {
  try {
    const { enabled, recipientEmail, sendTime, includeDetails, userId } = req.body;
    
    await pool.query(
      'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['emailEnabled', enabled.toString()]
    );
    await pool.query(
      'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['emailRecipient', recipientEmail]
    );
    await pool.query(
      'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['emailSendTime', sendTime]
    );
    await pool.query(
      'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['emailIncludeDetails', includeDetails.toString()]
    );
    
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
      [userId || 'system', 'EMAIL_SETTINGS_UPDATED', `Email settings updated: enabled=${enabled}, time=${sendTime}`]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Email] Error updating settings:', error);
    res.status(500).json({ success: false, error: 'Failed to update email settings' });
  }
});

// ============================================
// Audit Logs APIs
// ============================================
app.get('/api/trpc/auditLogs.list', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 500');
    res.json(result.rows.map(log => ({
      id: log.id,
      recordId: log.record_id,
      userId: log.user_id,
      action: log.action,
      details: log.details,
      timestamp: log.timestamp
    })));
  } catch (error) {
    console.error('[AuditLogs] Error listing:', error);
    res.status(500).json({ error: 'Failed to list audit logs' });
  }
});

// ============================================
// Error Logs APIs
// ============================================
app.post('/api/trpc/errorLog.create', async (req, res) => {
  try {
    const { type, message, source, metadata } = req.body;
    
    const result = await pool.query(
      'INSERT INTO error_logs (type, message, source, metadata) VALUES ($1, $2, $3, $4) RETURNING id',
      [type, message, source, metadata ? JSON.stringify(metadata) : null]
    );
    
    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    console.error('[ErrorLog] Error creating:', error);
    res.status(500).json({ success: false, error: 'Failed to create error log' });
  }
});

app.get('/api/trpc/errorLog.list', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM error_logs ORDER BY created_at DESC');
    res.json(result.rows.map(log => ({
      id: log.id,
      type: log.type,
      message: log.message,
      source: log.source,
      metadata: log.metadata ? JSON.parse(log.metadata) : null,
      resolved: log.resolved,
      resolvedAt: log.resolved_at,
      resolvedBy: log.resolved_by,
      createdAt: log.created_at
    })));
  } catch (error) {
    console.error('[ErrorLog] Error listing:', error);
    res.status(500).json({ error: 'Failed to list error logs' });
  }
});

app.get('/api/trpc/errorLog.unresolved', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM error_logs WHERE resolved = false ORDER BY created_at DESC');
    res.json(result.rows.map(log => ({
      id: log.id,
      type: log.type,
      message: log.message,
      source: log.source,
      metadata: log.metadata ? JSON.parse(log.metadata) : null,
      createdAt: log.created_at
    })));
  } catch (error) {
    console.error('[ErrorLog] Error getting unresolved:', error);
    res.status(500).json({ error: 'Failed to get unresolved error logs' });
  }
});

app.post('/api/trpc/errorLog.resolve', async (req, res) => {
  try {
    const { id, resolvedBy } = req.body;
    
    await pool.query(
      'UPDATE error_logs SET resolved = true, resolved_at = CURRENT_TIMESTAMP, resolved_by = $1 WHERE id = $2',
      [resolvedBy, id]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('[ErrorLog] Error resolving:', error);
    res.status(500).json({ success: false, error: 'Failed to resolve error log' });
  }
});

// ============================================
// Start Server
// ============================================
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`[Server] Hotel VMS Backend running on port ${PORT}`);
    console.log(`[Server] Health check: http://localhost:${PORT}/health`);
  });
}).catch(error => {
  console.error('[Server] Failed to initialize database:', error);
  process.exit(1);
});
