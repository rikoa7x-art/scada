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
      },
      cartoLight: {
        name: 'CartoDB Light (Kontras Bersih)',
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; CartoDB',
        maxZoom: 19
      },
      cartoDark: {
        name: 'CartoDB Dark (Mode Malam)',
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; CartoDB',
        maxZoom: 19
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

  // Skenario Data Uji Lapangan Konsisten EPANET (Pada Debit Pompa 10 L/s)
  sampleFieldMeasurements: {
    '4d432f14-ea0c-4c60-a73c-ebb8e2003ed5': { pressure: 4.90, unit: 'bar' }, // J66 (Head: 585.00m, Elev: 535m)
    'e9ca15c2-2ad5-4532-b51b-966129d3dc52': { pressure: 6.15, unit: 'bar' }, // J46 (Head: 584.72m, Elev: 522m, hf: 0.28m, Q: 10 L/s)
    '4c6eb5c9-bbdc-4fc7-b29a-a5045b48d829': { pressure: 7.12, unit: 'bar' }, // J47 (Head: 583.57m, Elev: 511m, hf: 1.14m, Q: 10 L/s)
    '6091ca2a-c2e2-4660-ab1e-07f67a07564a': { pressure: 8.32, unit: 'bar' }, // J48 (Head: 582.84m, Elev: 498m, hf: 0.74m, Q: 10 L/s)
    'c050b469-4d7f-4b49-8e78-142356877ca1': { pressure: 8.46, unit: 'bar' }, // J49 (Head: 582.30m, Elev: 496m, hf: 0.53m, Q: 10 L/s)
    'b223d3e7-a625-4080-8b3f-f22eb5ca7bb8': { pressure: 7.43, unit: 'bar' }, // J50 (Head: 575.81m, Elev: 500m, hf: 6.50m, Q: 10 L/s)
    '9ed2dbf0-747d-45a5-aede-554e5c56e590': { pressure: 6.45, unit: 'bar' }, // J51 (Head: 571.81m, Elev: 506m, hf: 4.00m, Q: 10 L/s)
    '4d3d91ae-6e06-4a3d-abb8-2105fdd0ca39': { pressure: 6.67, unit: 'bar' }, // J60 (Head: 568.98m, Elev: 501m, Q: 1.62 L/s)
    '62756c9d-a03d-43d8-8c9b-ee1b0f1a9c96': { pressure: 5.14, unit: 'bar' }, // J54 (Head: 566.38m, Elev: 514m)
    '0d39211f-43c5-41a7-9b19-6a4db19343fe': { pressure: 5.24, unit: 'bar' }, // J52 (Head: 566.40m, Elev: 513m, Demand: 8 L/s)
    '9f08c84a-093d-41db-981c-435f94c93451': { pressure: 5.92, unit: 'bar' }, // J53 (Head: 566.40m, Elev: 506m, Dead End)
    'c834078f-45f9-4755-93a8-3550467a280d': { pressure: 5.62, unit: 'bar' }, // J57 (Head: 566.33m, Elev: 509m, Q: 2 L/s)
    'b19ee0ac-c4c9-4022-bff8-566f9df956fe': { pressure: 4.84, unit: 'bar' }, // J58 (Head: 566.33m, Elev: 517m, Dead End)
    '787ddb48-0fa4-416d-86aa-cc114d79c8f2': { pressure: 5.70, unit: 'bar' }, // J55 (Head: 566.12m, Elev: 508m, Q: 2 L/s)
    '9253adcd-12d5-45f5-ad94-c71872e906b7': { pressure: 4.52, unit: 'bar' }, // J56 (Head: 566.12m, Elev: 520m, Dead End)
    'c70fdc26-52bf-4662-88c6-0eabbdd79af2': { pressure: 6.29, unit: 'bar' }  // J59 (Head: 566.12m, Elev: 502m, Dead End)
  },

  // Konfigurasi Koneksi Supabase SCADA Server
  supabase: {
    url: 'https://nbjfxzulzxxujudntdab.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5iamZ4enVsenh4dWp1ZG50ZGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTE2MzIsImV4cCI6MjEwNDc4NzYzMn0.LlIr9TLE3sE7X9xsohQcFrsU0OM8lisy1ymUvV-kdLo',
    tableName: 'scada_telemetry',
    defaultOfficer: 'Petugas Lapangan PDAM'
  },

  // Katalog Wilayah SPAM PDAM Kabupaten Subang
  regions: [
    {
      id: 'bunihayu',
      name: 'SPAM Bunihayu',
      file: 'epanet_bunihayu.json',
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
      file: 'epanet_cisalak.json',
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
      file: 'epanet_jalancagak.json',
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
      file: 'epanet_kasomalang.json',
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
      file: 'epanet_pabuaran.json',
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
      file: 'epanet_sagalaherang.json',
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
      file: 'epanet_subang.json',
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
      file: 'epanet_tambakan.json',
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
      file: 'epanet_tanjungsiang.json',
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
