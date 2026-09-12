/**
 * SCADA Backend Server & Telemetry Gateway PDAM Kota Subang
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
const SUBANG_NETWORK_FILE = path.join(__dirname, 'epanet_subang.json');

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

server.listen(PORT, '0.0.0.0', () => {
  console.log('================================================================');
  console.log(`🌊 SCADA MONITORING PDAM KOTA SUBANG BERJALAN PADA:`);
  console.log(`📡 Akses Lokal PC:     http://localhost:${PORT}`);
  console.log(`📱 Akses Smartphone:  http://<IP_KOMPUTER_ANDA>:${PORT}`);
  console.log(`🤖 AI Engine:          meta/llama-3.2-11b-vision-instruct (NVIDIA NIM)`);
  console.log(`🔑 API Key:            ${NVIDIA_API_KEY ? '✅ Terdeteksi' : '❌ Belum diatur (cek .env)'}`);
  console.log('================================================================');

  if (process.argv.includes('--open')) {
    const { exec } = require('child_process');
    exec(`start http://localhost:${PORT}`);
  }
});
