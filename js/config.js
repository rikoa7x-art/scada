/**
 * Konfigurasi Peta dan Pengaturan Aplikasi Monitoring Debit SPAM PDAM
 */

const AppConfig = {
  // Pengaturan Tampilan Awal Peta
  map: {
    defaultCenter: [-6.663, 107.688],
    defaultZoom: 15,
    minZoom: 12,
    maxZoom: 20,
    tileLayers: {
      googleHybrid: {
        name: 'Google Hybrid (Satelit + Jalan)',
        url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        attribution: '&copy; Google Maps',
        maxZoom: 20
      },
      openStreetMap: {
        name: 'OpenStreetMap Standard',
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      },
      googleSatellite: {
        name: 'Google Satellite (Murni)',
        url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        attribution: '&copy; Google Maps',
        maxZoom: 20
      },
      googleStreets: {
        name: 'Google Streets',
        url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        attribution: '&copy; Google Maps',
        maxZoom: 20
      }
    }
  },

  // Pengaturan Visualisasi Pipa
  pipeStyle: {
    defaultWeight: 5,
    hoverWeight: 8,
    selectedWeight: 9,
    colors: {
      unmeasured: '#94a3b8', // Abu-abu
      lowVelocity: '#38bdf8', // Biru muda
      normalVelocity: '#10b981', // Hijau toska ideal
      warningVelocity: '#f59e0b', // Oranye waspada
      criticalVelocity: '#ef4444' // Merah kritis
    },
    diameterWeights: {
      160: 7,
      110: 5,
      100: 5,
      90: 4,
      63: 3
    }
  },

  // Pengaturan Visualisasi Node (Junction / Reservoir / Pump)
  nodeStyle: {
    junction: {
      radius: 7,
      measuredFill: '#10b981',     // Hijau (Sudah diinput tekanan)
      unmeasuredFill: '#f59e0b',   // Kuning (Belum diinput)
      estimatedFill: '#6366f1',    // Indigo (Diestimasi solver)
      border: '#ffffff',
      weight: 2
    },
    reservoir: {
      radius: 11,
      fill: '#2563eb', // Biru laut
      border: '#ffffff',
      weight: 3
    },
    pump: {
      radius: 9,
      fill: '#8b5cf6', // Ungu
      border: '#ffffff',
      weight: 2
    }
  },

  // Konfigurasi Koneksi Supabase SCADA Server
  supabase: {
    url: 'https://nbjfxzulzxxujudntdab.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5iamZ4enVsenh4dWp1ZG50ZGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTE2MzIsImV4cCI6MjEwNDc4NzYzMn0.LlIr9TLE3sE7X9xsohQcFrsU0OM8lisy1ymUvV-kdLo',
    tableName: 'scada_telemetry',
    defaultOfficer: 'Petugas Lapangan PDAM'
  },

  // Katalog Wilayah SPAM PDAM Kabupaten Subang
  // Catatan: Tidak ada properti 'file' — data jaringan dimuat dari localStorage cache
  // atau diunggah manual via tombol Upload JSON → otomatis tersimpan ke localStorage.
  regions: [
    {
      id: 'bunihayu',
      name: 'SPAM Bunihayu',
      badge: '17 Simpul • 16 Pipa',
      defaultCenter: [-6.6637, 107.6882],
      defaultZoom: 15,
      defaultSource: {
        systemMode: 'pump',
        pump: { head: 50.0, flow: 10.0, status: 'on' },
        reservoir: { elevation: 535.0, flow: 10.0 }
      }
    },
    {
      id: 'cisalak',
      name: 'SPAM Cisalak',
      badge: '203 Simpul • 202 Pipa',
      defaultCenter: [-6.7149, 107.7648],
      defaultZoom: 14,
      defaultSource: {
        systemMode: 'pump',
        pump: { head: 45.0, flow: 20.0, status: 'on' },
        reservoir: { elevation: 560.0, flow: 20.0 }
      }
    },
    {
      id: 'jalancagak',
      name: 'SPAM Jalancagak (Ciseuti)',
      badge: '35 Simpul • 33 Pipa',
      defaultCenter: [-6.6772, 107.6815],
      defaultZoom: 15,
      defaultSource: {
        systemMode: 'pump',
        pump: { head: 60.0, flow: 28.0, status: 'on' },
        reservoir: { elevation: 580.0, flow: 28.0 }
      }
    },
    {
      id: 'kasomalang',
      name: 'SPAM Kasomalang',
      badge: '91 Simpul • 90 Pipa',
      defaultCenter: [-6.6814, 107.7357],
      defaultZoom: 15,
      defaultSource: {
        systemMode: 'pump',
        pump: { head: 80.0, flow: 35.0, status: 'on' },
        reservoir: { elevation: 550.0, flow: 35.0 }
      }
    },
    {
      id: 'pabuaran',
      name: 'SPAM Pabuaran',
      badge: '290 Simpul • 290 Pipa',
      defaultCenter: [-6.4072, 107.5858],
      defaultZoom: 14,
      defaultSource: {
        systemMode: 'pump',
        pump: { head: 70.0, flow: 40.0, status: 'on' },
        reservoir: { elevation: 120.0, flow: 40.0 }
      }
    },
    {
      id: 'sagalaherang',
      name: 'SPAM Sagalaherang',
      badge: '211 Simpul • 217 Pipa (Gravitasi)',
      defaultCenter: [-6.6680, 107.6492],
      defaultZoom: 14,
      defaultSource: {
        systemMode: 'gravity',
        pump: { head: 0, flow: 25.0, status: 'off' },
        reservoir: { elevation: 620.0, flow: 25.0 }
      }
    },
    {
      id: 'subang',
      name: 'SPAM Subang Kota',
      badge: '314 Simpul • 321 Pipa',
      defaultCenter: [-6.5521, 107.7855],
      defaultZoom: 14,
      defaultSource: {
        systemMode: 'pump',
        pump: { head: 50.0, flow: 50.0, status: 'on' },
        reservoir: { elevation: 110.0, flow: 50.0 }
      }
    },
    {
      id: 'tambakan',
      name: 'SPAM Tambakan',
      badge: '13 Simpul • 11 Pipa',
      defaultCenter: [-6.6681, 107.7020],
      defaultZoom: 16,
      defaultSource: {
        systemMode: 'pump',
        pump: { head: 30.0, flow: 30.0, status: 'on' },
        reservoir: { elevation: 510.0, flow: 30.0 }
      }
    },
    {
      id: 'tanjungsiang',
      name: 'SPAM Tanjungsiang',
      badge: '272 Simpul • 279 Pipa (Gravitasi)',
      defaultCenter: [-6.7308, 107.8154],
      defaultZoom: 14,
      defaultSource: {
        systemMode: 'gravity',
        pump: { head: 0, flow: 30.0, status: 'off' },
        reservoir: { elevation: 640.0, flow: 30.0 }
      }
    }
  ]
};
