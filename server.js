/**
 * SCADA Backend Server & Telemetry Gateway Prodist Scada
 * - Melayani Antarmuka SCADA Web
 * - Proxy Aman ke NVIDIA NIM API (Llama-3.2-11b-vision-instruct) bebas CORS
 * - Manajemen Data Telemetri & Kalkulasi Debit
 */

// Load environment variables dari file .env
try { require('dotenv').config(); } catch (e) { /* dotenv opsional */ }

const http = require('http');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { analyzePressureGauge } = require('./ai_vision_reader.js');

const PORT = process.env.PORT || 3000;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';
const TELEMETRY_FILE = path.join(__dirname, 'telemetry_subang.json');
const CUSTOM_NODES_FILE = path.join(__dirname, 'custom_nodes_subang.json');
const SUBANG_NETWORK_FILE = path.join(__dirname, 'epanet_subang.json');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nbjfxzulzxxujudntdab.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5iamZ4enVsenh4dWp1ZG50ZGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTE2MzIsImV4cCI6MjEwNDc4NzYzMn0.LlIr9TLE3sE7X9xsohQcFrsU0OM8lisy1ymUvV-kdLo';

// Helper sinkronisasi data telemetri ke Supabase Cloud REST API
async function syncTelemetryToSupabase(reading) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    const payload = {
      node_id: reading.nodeId,
      node_label: reading.nodeLabel || reading.nodeId,
      pressure_bar: Number(reading.pressure_bar),
      pressure_m: Number(reading.pressure_m || (reading.pressure_bar * 10.197)),
      confidence: Number(reading.confidence || 1.0),
      officer_name: reading.officerName || 'Petugas Lapangan',
      gauge_type: reading.gauge_type || 'manual',
      notes: reading.notes || '',
      updated_at: reading.timestamp || new Date().toISOString()
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/scada_telemetry?on_conflict=node_id`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      console.log(`⚡ [Server] Sinkron titik ${reading.nodeLabel || reading.nodeId} ke Supabase Cloud sukses.`);
    } else {
      console.warn(`[Server] Supabase sync response: ${res.status}`);
    }
  } catch (err) {
    console.warn('[Server] Supabase sync gagal:', err.message);
  }
}

async function deleteTelemetryFromSupabase(nodeId) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    // Saat reset_all (nodeId = null): hapus semua row telemetri KECUALI katalog __SCADA_CUSTOM_NODES__
    const url = nodeId
      ? `${SUPABASE_URL}/rest/v1/scada_telemetry?node_id=eq.${encodeURIComponent(nodeId)}`
      : `${SUPABASE_URL}/rest/v1/scada_telemetry?node_id=neq.__SCADA_CUSTOM_NODES__`;
    await fetch(url, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    console.log(`🗑️ [Server] Hapus data telemetri di Supabase: ${nodeId || 'RESET_ALL'}`);
  } catch (err) {
    console.warn('[Server] Supabase delete error:', err.message);
  }
}

async function pullTelemetrySnapshotFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/scada_telemetry?select=*`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const readings = {};
        const history = [];
        rows.forEach(r => {
          if (r.node_id === '__SCADA_CUSTOM_NODES__' || r.gauge_type === 'custom_nodes_catalog' || r.gauge_type === 'custom_junction') {
            return; // Lewati record katalog kustom & placeholder titik kustom
          }
          readings[r.node_id] = {
            nodeId: r.node_id,
            nodeLabel: r.node_label || r.node_id,
            pressure_bar: Number(r.pressure_bar),
            pressure_m: Number(r.pressure_m || (r.pressure_bar * 10.197)),
            confidence: Number(r.confidence || 1.0),
            officerName: r.officer_name || 'Petugas Lapangan',
            gauge_type: r.gauge_type || 'manual',
            notes: r.notes || '',
            timestamp: r.updated_at || new Date().toISOString()
          };
          history.push({
            id: 'TEL-' + r.node_id,
            nodeId: r.node_id,
            nodeLabel: r.node_label || r.node_id,
            pressure_bar: Number(r.pressure_bar),
            officerName: r.officer_name || 'Petugas Lapangan',
            notes: r.notes || '',
            timestamp: r.updated_at || new Date().toISOString()
          });
        });
        return {
          lastUpdated: new Date().toISOString(),
          readings,
          history
        };
      }
    }
  } catch (err) {
    console.warn('[Server] Gagal memuat snapshot awal dari Supabase:', err.message);
  }
  return null;
}

// ================= SUPABASE SYNC UNTUK TITIK JUNCTION KUSTOM =================
async function syncCustomNodesCatalogToSupabase(customNodes) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    const catalogRow = {
      node_id: '__SCADA_CUSTOM_NODES__',
      node_label: 'DAFTAR_TITIK_KUSTOM',
      pressure_bar: 0,
      pressure_m: 0,
      confidence: 1,
      officer_name: 'Sistem SCADA',
      gauge_type: 'custom_nodes_catalog',
      notes: JSON.stringify(customNodes),
      updated_at: new Date().toISOString()
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/scada_telemetry`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(catalogRow)
    });

    if (res.ok) {
      console.log(`⚡ [Server] Sinkron katalog ${customNodes.length} titik junction kustom ke Supabase Cloud sukses.`);
    } else {
      console.warn(`[Server] Supabase custom nodes sync response: ${res.status}`);
    }
  } catch (err) {
    console.warn('[Server] Supabase custom nodes sync gagal:', err.message);
  }
}

async function deleteCustomNodeFromSupabase(nodeId, remainingCustomNodes) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    // 1. Hapus baris spesifik node dari Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/scada_telemetry?node_id=eq.${encodeURIComponent(nodeId)}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    // 2. Perbarui katalog __SCADA_CUSTOM_NODES__ di Supabase
    await syncCustomNodesCatalogToSupabase(remainingCustomNodes);
    console.log(`🗑️ [Server] Hapus titik junction kustom di Supabase: ${nodeId}`);
  } catch (err) {
    console.warn('[Server] Supabase custom node delete error:', err.message);
  }
}

async function pullCustomNodesSnapshotFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/scada_telemetry?node_id=eq.__SCADA_CUSTOM_NODES__`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0 && rows[0].notes) {
        const parsed = JSON.parse(rows[0].notes);
        if (Array.isArray(parsed)) return parsed;
      }
    }
  } catch (err) {
    console.warn('[Server] Gagal memuat snapshot custom nodes dari Supabase:', err.message);
  }
  return null;
}

// Periksa API key saat startup
if (!NVIDIA_API_KEY) {
  console.warn('⚠️  NVIDIA_API_KEY belum diatur! Buat file .env dengan isi: NVIDIA_API_KEY=nvapi-xxxxx');
  console.warn('   Fitur AI Vision Reader tidak akan berfungsi tanpa API key.');
}

// Inisialisasi Database Telemetri jika belum ada
if (!fs.existsSync(TELEMETRY_FILE)) {
  fs.writeFileSync(TELEMETRY_FILE, JSON.stringify({
    lastUpdated: new Date().toISOString(),
    readings: {},
    history: []
  }, null, 2), 'utf8');
}

// Inisialisasi Database Titik Junction Kustom jika belum ada
if (!fs.existsSync(CUSTOM_NODES_FILE)) {
  fs.writeFileSync(CUSTOM_NODES_FILE, JSON.stringify([], null, 2), 'utf8');
}

async function readCustomNodesSafe() {
  try {
    const content = await fsPromises.readFile(CUSTOM_NODES_FILE, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    console.error('Error membaca file custom nodes:', err.message);
    return [];
  }
}

async function writeCustomNodesSafe(nodes) {
  const tempFile = CUSTOM_NODES_FILE + '.tmp';
  await fsPromises.writeFile(tempFile, JSON.stringify(nodes, null, 2), 'utf8');
  await fsPromises.rename(tempFile, CUSTOM_NODES_FILE);
}

// Simple file lock untuk mencegah race condition penulisan
let isWritingTelemetry = false;
const writeQueue = [];

async function writeTelemetrySafe(data) {
  return new Promise((resolve, reject) => {
    const doWrite = async () => {
      isWritingTelemetry = true;
      try {
        // Tulis ke file temporary dulu, lalu rename (atomic write)
        const tempFile = TELEMETRY_FILE + '.tmp';
        await fsPromises.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
        await fsPromises.rename(tempFile, TELEMETRY_FILE);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        isWritingTelemetry = false;
        if (writeQueue.length > 0) {
          const next = writeQueue.shift();
          next();
        }
      }
    };

    if (isWritingTelemetry) {
      writeQueue.push(doWrite);
    } else {
      doWrite();
    }
  });
}

async function readTelemetrySafe() {
  try {
    const content = await fsPromises.readFile(TELEMETRY_FILE, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    // Hanya kembalikan data kosong jika file belum ada (ENOENT)
    // Untuk error lain (EBUSY, EPERM, parse error), lempar error agar tidak menimpa data
    if (err.code === 'ENOENT') {
      console.warn('File telemetri belum ada, mengembalikan data kosong.');
      return { lastUpdated: new Date().toISOString(), readings: {}, history: [] };
    }
    console.error('Error membaca file telemetri:', err.message);
    throw err;
  }
}

// Helper membaca body request
function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      // Proteksi max payload 25MB (untuk foto HD)
      if (body.length > 25 * 1024 * 1024) {
        req.destroy(); // Hentikan stream segera
        reject(new Error('Payload terlalu besar (Maksimal 25MB)'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', err => reject(err));
  });
}

// Helper MIME type
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.kml': 'application/vnd.google-earth.kml+xml; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8'
};

// Helper parse JSON dengan error 400
function parseJsonBody(rawBody) {
  try {
    return JSON.parse(rawBody);
  } catch (e) {
    const err = new Error('Format JSON tidak valid: ' + e.message);
    err.statusCode = 400;
    throw err;
  }
}

const server = http.createServer(async (req, res) => {
  // CORS Headers - batasi ke localhost dan jaringan lokal
  const origin = req.headers.origin || '';
  const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
  // Izinkan juga akses dari IP lokal (LAN)
  if (allowedOrigins.includes(origin) || origin.match(/^http:\/\/(192\.168|10\.\d+|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+:\d+$/) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;

  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  console.log(`[${new Date().toLocaleTimeString('id-ID')}] ${req.method} ${pathname}`);

  try {
    // ----------------------------------------------------
    // API ROUTE 1: Scan Foto Manometer dengan AI Vision
    // ----------------------------------------------------
    if (pathname === '/api/read-gauge' && req.method === 'POST') {
      if (!NVIDIA_API_KEY) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'NVIDIA_API_KEY belum diatur di server. Tambahkan ke file .env' }));
        return;
      }

      const rawBody = await getRequestBody(req);
      const payload = parseJsonBody(rawBody);

      if (!payload.imageBase64) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Foto manometer (imageBase64) wajib dikirimkan.' }));
        return;
      }

      console.log('🤖 Mengirim foto ke NVIDIA Llama-3.2-11b-vision-instruct...');
      const startTime = Date.now();
      const aiResult = await analyzePressureGauge(payload.imageBase64, NVIDIA_API_KEY);
      const elapsedMs = Date.now() - startTime;
      console.log(`✅ Sukses membaca tekanan: ${aiResult.pressure_bar} bar (${elapsedMs} ms)`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: aiResult,
        elapsedMs
      }));
      return;
    }

    // ----------------------------------------------------
    // API ROUTE 2: Ambil Data Jaringan Subang (Auto-Load)
    // ----------------------------------------------------
    if (pathname === '/api/subang-network' && req.method === 'GET') {
      try {
        const content = await fsPromises.readFile(SUBANG_NETWORK_FILE, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(content);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File epanet_subang.json tidak ditemukan' }));
      }
      return;
    }

    // ----------------------------------------------------
    // API ROUTE 3: Telemetri (GET, POST, DELETE)
    // ----------------------------------------------------
    if (pathname === '/api/telemetry') {
      if (req.method === 'GET') {
        const teleData = await readTelemetrySafe();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(teleData));
        return;
      }

      if (req.method === 'POST') {
        const rawBody = await getRequestBody(req);
        const newReading = parseJsonBody(rawBody);

        if (!newReading.nodeId || newReading.pressure_bar === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'nodeId dan pressure_bar wajib diisi' }));
          return;
        }

        // Validasi nilai numerik
        const pressureVal = Number(newReading.pressure_bar);
        if (isNaN(pressureVal)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'pressure_bar harus berupa angka valid' }));
          return;
        }

        const teleData = await readTelemetrySafe();
        
        // Simpan titik bacaan aktif
        teleData.readings[newReading.nodeId] = {
          nodeId: newReading.nodeId,
          nodeLabel: newReading.nodeLabel || newReading.nodeId,
          pressure_bar: pressureVal,
          pressure_m: Math.round(pressureVal * 10.197 * 100) / 100,
          confidence: newReading.confidence || 0.9,
          gauge_type: newReading.gauge_type || 'analog',
          notes: newReading.notes || '',
          officerName: newReading.officerName || 'Petugas Lapangan',
          photoThumbnail: newReading.photoThumbnail || null,
          timestamp: new Date().toISOString()
        };

        // Tambahkan ke histori riwayat
        teleData.history.unshift({
          id: 'TEL-' + Date.now(),
          nodeId: newReading.nodeId,
          nodeLabel: newReading.nodeLabel || newReading.nodeId,
          pressure_bar: pressureVal,
          officerName: newReading.officerName || 'Petugas Lapangan',
          notes: newReading.notes || '',
          timestamp: new Date().toISOString()
        });

        // Batasi histori 100 catatan terakhir
        if (teleData.history.length > 100) {
          teleData.history = teleData.history.slice(0, 100);
        }
        teleData.lastUpdated = new Date().toISOString();

        await writeTelemetrySafe(teleData);

        // Teruskan asinkron ke Supabase Cloud
        syncTelemetryToSupabase(teleData.readings[newReading.nodeId]).catch(() => {});

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: `Data telemetri titik ${newReading.nodeLabel || newReading.nodeId} berhasil disimpan`,
          telemetry: teleData.readings[newReading.nodeId]
        }));
        return;
      }

      if (req.method === 'DELETE') {
        const nodeId = reqUrl.searchParams.get('nodeId');
        const action = reqUrl.searchParams.get('action');
        const teleData = await readTelemetrySafe();

        if (nodeId) {
          // Hapus satu node spesifik
          if (teleData.readings && teleData.readings[nodeId]) {
            delete teleData.readings[nodeId];
            teleData.lastUpdated = new Date().toISOString();
            await writeTelemetrySafe(teleData);
          }
          deleteTelemetryFromSupabase(nodeId).catch(() => {});
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: `Data telemetri ${nodeId} berhasil dihapus` }));
          return;
        }

        // Reset semua hanya jika ada parameter action=reset_all secara eksplisit
        if (action === 'reset_all') {
          const resetData = {
            lastUpdated: new Date().toISOString(),
            readings: {},
            history: []
          };
          await writeTelemetrySafe(resetData);
          deleteTelemetryFromSupabase(null).catch(() => {});
          // Pastikan katalog custom nodes tetap utuh dan tersinkron ke Supabase Cloud
          const currentNodes = await readCustomNodesSafe();
          if (currentNodes && currentNodes.length > 0) {
            syncCustomNodesCatalogToSupabase(currentNodes).catch(() => {});
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Semua data telemetri berhasil di-reset' }));
          return;
        }

        // Jika tidak ada parameter, tolak untuk mencegah penghapusan tidak sengaja
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Sertakan parameter nodeId untuk hapus spesifik, atau action=reset_all untuk reset semua data' }));
        return;
      }
    }

    // ----------------------------------------------------
    // API ROUTE 4: Titik Junction Kustom (GET, POST, DELETE)
    // ----------------------------------------------------
    if (pathname === '/api/custom-nodes') {
      if (req.method === 'GET') {
        const nodes = await readCustomNodesSafe();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(nodes));
        return;
      }

      if (req.method === 'POST') {
        const rawBody = await getRequestBody(req);
        const newNode = parseJsonBody(rawBody);

        if (!newNode.label || newNode.lat === undefined || newNode.lng === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'label, lat, dan lng wajib diisi' }));
          return;
        }

        const nodes = await readCustomNodesSafe();
        const existingIdx = nodes.findIndex(n => n.id === newNode.id);

        const nodeObj = {
          id: newNode.id || 'custom-node-' + Date.now(),
          lat: Number(newNode.lat),
          lng: Number(newNode.lng),
          elevation: Number(newNode.elevation || 0),
          type: 'junction',
          label: String(newNode.label).trim(),
          demand: 0,
          accessories: [],
          pressure: 0,
          headloss: 0,
          isMonitoringPoint: true,
          category: 'custom_junction',
          categoryLabel: newNode.categoryLabel || '⭐ Titik Pantau Kustom Lapangan',
          monitoringReason: newNode.monitoringReason || newNode.notes || 'Titik Manometer Tambahan Lapangan',
          zone: 'custom',
          zoneLabel: newNode.zoneLabel || '⭐ Titik Pantau Kustom Lapangan',
          nearestPipeInfo: newNode.nearestPipeInfo || null,
          isCustom: true,
          createdAt: newNode.createdAt || new Date().toISOString()
        };

        if (existingIdx >= 0) {
          nodes[existingIdx] = nodeObj;
        } else {
          nodes.push(nodeObj);
        }

        await writeCustomNodesSafe(nodes);
        // Teruskan asinkron ke Supabase Cloud
        syncCustomNodesCatalogToSupabase(nodes).catch(() => {});

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, node: nodeObj }));
        return;
      }

      if (req.method === 'DELETE') {
        const nodeId = reqUrl.searchParams.get('id') || reqUrl.searchParams.get('nodeId');
        if (!nodeId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Parameter id atau nodeId wajib disertakan' }));
          return;
        }

        let nodes = await readCustomNodesSafe();
        nodes = nodes.filter(n => n.id !== nodeId);
        await writeCustomNodesSafe(nodes);
        // Hapus dari Supabase Cloud
        deleteCustomNodeFromSupabase(nodeId, nodes).catch(() => {});

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: `Titik kustom ${nodeId} berhasil dihapus` }));
        return;
      }
    }

    // ----------------------------------------------------
    // STATIC FILES SERVING (scada.html, epanet.html, dll)
    // ----------------------------------------------------

    // Blokir akses ke file sensitif (dotfiles, node_modules)
    const pathBasename = path.basename(pathname);
    if (pathBasename.startsWith('.') || pathname.includes('/node_modules/')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    let filePath = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(path.join(__dirname, filePath));

    // Pastikan tidak path traversal - tambahkan path.sep untuk keamanan
    if (!safePath.startsWith(__dirname + path.sep) && safePath !== __dirname) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    try {
      const stats = await fsPromises.stat(safePath);
      if (stats.isFile()) {
        const ext = path.extname(safePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const fileStream = fs.createReadStream(safePath);
        
        // Tambah error handler untuk file stream
        fileStream.on('error', (err) => {
          console.error('Error membaca file:', err.message);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Error membaca berkas');
          }
        });
        
        res.writeHead(200, { 'Content-Type': contentType });
        fileStream.pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Berkas tidak ditemukan: ' + pathname);
      }
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Berkas tidak ditemukan: ' + pathname);
    }

  } catch (error) {
    console.error('Server error:', error);
    const statusCode = error.statusCode || 500;
    if (!res.headersSent) {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message || 'Internal Server Error' }));
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} sudah digunakan oleh aplikasi lain!`);
    console.error(`   Tutup aplikasi tersebut atau ubah PORT di file .env`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log('================================================================');
  console.log(`🌊 PRODIST SCADA MONITORING BERJALAN PADA:`);
  console.log(`📡 Akses Lokal PC:     http://localhost:${PORT}`);
  console.log(`📱 Akses Smartphone:  http://<IP_KOMPUTER_ANDA>:${PORT}`);
  console.log(`🤖 AI Engine:          meta/llama-3.2-11b-vision-instruct (NVIDIA NIM)`);
  console.log(`🔑 API Key:            ${NVIDIA_API_KEY ? '✅ Terdeteksi' : '❌ Belum diatur (cek .env)'}`);
  console.log(`⚡ Supabase Cloud:     ${SUPABASE_URL ? '✅ Aktif (' + SUPABASE_URL + ')' : '❌ Belum diatur'}`);
  console.log('================================================================');

  // Jika telemetri lokal kosong, coba muat snapshot dari Supabase Cloud
  try {
    const localTele = await readTelemetrySafe();
    if (!localTele.readings || Object.keys(localTele.readings).length === 0) {
      console.log('📡 Mengecek cadangan data di Supabase Cloud...');
      const cloudSnapshot = await pullTelemetrySnapshotFromSupabase();
      if (cloudSnapshot && Object.keys(cloudSnapshot.readings).length > 0) {
        await writeTelemetrySafe(cloudSnapshot);
        console.log(`✅ Berhasil memuat ${Object.keys(cloudSnapshot.readings).length} titik telemetri dari Supabase Cloud ke server lokal.`);
      }
    }
  } catch (e) {
    console.warn('[Server] Gagal cek snapshot awal Supabase:', e.message);
  }

  // Jika data titik junction kustom lokal kosong, coba muat snapshot dari Supabase Cloud
  try {
    const localNodes = await readCustomNodesSafe();
    if (!localNodes || localNodes.length === 0) {
      console.log('📡 Mengecek cadangan titik junction kustom di Supabase Cloud...');
      const cloudNodes = await pullCustomNodesSnapshotFromSupabase();
      if (cloudNodes && cloudNodes.length > 0) {
        await writeCustomNodesSafe(cloudNodes);
        console.log(`✅ Berhasil memuat ${cloudNodes.length} titik junction kustom dari Supabase Cloud ke server lokal.`);
      }
    }
  } catch (e) {
    console.warn('[Server] Gagal cek snapshot custom nodes Supabase:', e.message);
  }

  if (process.argv.includes('--open')) {
    const { exec } = require('child_process');
    exec(`start http://localhost:${PORT}`);
  }
});
