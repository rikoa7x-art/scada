/**
 * SupabaseClient - Manajemen Komunikasi Cloud & Real-time Database SCADA PDAM
 * Terhubung ke Supabase REST API & Realtime WebSocket
 */

const SupabaseClient = (() => {
  let client = null;
  let isInitialized = false;
  let connectionStatus = 'initializing'; // 'connected' | 'offline' | 'syncing' | 'error'
  let statusListeners = [];
  let realtimeChannel = null;

  /**
   * Inisialisasi Klien Supabase
   */
  function init() {
    const config = AppConfig.supabase;
    if (!config || !config.url || !config.anonKey) {
      console.warn('SupabaseClient: Konfigurasi Supabase tidak ditemukan.');
      setStatus('offline');
      return false;
    }

    try {
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        client = window.supabase.createClient(config.url, config.anonKey, {
          auth: { persistSession: false }
        });
        console.log('SupabaseClient: SDK Resmi Supabase berhasil diinisialisasi.');
      } else {
        console.warn('SupabaseClient: Library CDN tidak tersedia, menggunakan REST Fetch Fallback.');
      }

      // Uji konektivitas awal
      testConnection();
      isInitialized = true;
      return true;
    } catch (err) {
      console.error('SupabaseClient: Gagal inisialisasi:', err);
      setStatus('error');
      return false;
    }
  }

  /**
   * Daftarkan listener perubahan status koneksi
   */
  function onStatusChange(callback) {
    if (typeof callback === 'function') {
      statusListeners.push(callback);
      callback(connectionStatus);
    }
  }

  function setStatus(newStatus) {
    connectionStatus = newStatus;
    statusListeners.forEach(cb => {
      try { cb(connectionStatus); } catch (e) { console.error(e); }
    });
  }

  function getStatus() {
    return connectionStatus;
  }

  /**
   * Uji koneksi ke Supabase REST API
   */
  async function testConnection() {
    const config = AppConfig.supabase;
    try {
      setStatus('syncing');
      const res = await fetch(`${config.url}/rest/v1/${config.tableName}?select=node_id&limit=1`, {
        method: 'GET',
        headers: {
          'apikey': config.anonKey,
          'Authorization': `Bearer ${config.anonKey}`
        }
      });

      if (res.ok) {
        setStatus('connected');
        return true;
      } else {
        console.warn('SupabaseClient: Respon HTTP gagal:', res.status);
        setStatus('error');
        return false;
      }
    } catch (err) {
      console.warn('SupabaseClient: Koneksi internet/server offline:', err);
      setStatus('offline');
      return false;
    }
  }

  /**
   * Ambil semua data telemetry untuk daftar node_id wilayah aktif
   */
  async function getTelemetryForRegion(nodeIds = []) {
    const config = AppConfig.supabase;
    try {
      setStatus('syncing');
      let url = `${config.url}/rest/v1/${config.tableName}?select=*`;
      
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': config.anonKey,
          'Authorization': `Bearer ${config.anonKey}`
        }
      });

      if (!res.ok) {
        throw new Error(`Gagal membaca data telemetry: status ${res.status}`);
      }

      const rows = await res.json();
      setStatus('connected');

      // Filter atau petakan ke objek nodeMeasurements dan demands
      const resultMap = {};
      const demandMap = {};
      const nodeIdSet = new Set(nodeIds);

      // Periksa apakah ada katalog demand khusus wilayah
      const catalogDemandRow = rows.find(r => r.node_id === `__SCADA_DEMANDS_${regionId.toUpperCase()}__`);
      if (catalogDemandRow && catalogDemandRow.notes) {
        try {
          const parsed = JSON.parse(catalogDemandRow.notes);
          if (parsed && typeof parsed === 'object') {
            Object.assign(demandMap, parsed);
          }
        } catch (e) {}
      }

      rows.forEach(row => {
        // Abaikan baris metadata khusus
        if (row.node_id && row.node_id.startsWith('__SCADA_')) return;

        // Jika nodeIds ditentukan, hanya ambil yang relevan
        if (nodeIdSet.size > 0 && !nodeIdSet.has(row.node_id)) return;

        // Ekstrak demand jika tersimpan di JSON notes
        if (row.notes) {
          try {
            if (row.notes.startsWith('{') && row.notes.endsWith('}')) {
              const parsedNotes = JSON.parse(row.notes);
              if (parsedNotes && parsedNotes.demand !== undefined && parsedNotes.demand !== null) {
                demandMap[row.node_id] = Number(parsedNotes.demand);
              }
            }
          } catch (e) {}
        }

        if (row.pressure_bar !== null && !isNaN(row.pressure_bar)) {
          resultMap[row.node_id] = {
            pressure: Number(row.pressure_bar),
            unit: 'bar',
            pressureMeters: Number(row.pressure_m) || (Number(row.pressure_bar) * 10.19716),
            officer: row.officer_name || 'Petugas Lapangan',
            notes: row.notes || '',
            timestamp: row.updated_at || new Date().toISOString()
          };
        }
      });

      return {
        measurements: resultMap,
        demands: demandMap
      };
    } catch (err) {
      console.warn('SupabaseClient.getTelemetryForRegion error:', err);
      setStatus('offline');
      return null;
    }
  }

  /**
   * Upsert (Simpan/Perbarui) data telemetry & demand junction ke Supabase
   */
  async function upsertTelemetry(nodeId, nodeLabel, pressureBar, officerName = null, notes = null, demand = null) {
    const config = AppConfig.supabase;
    const pBar = pressureBar !== null && !isNaN(pressureBar) ? Number(pressureBar) : 0;
    const pMeters = Math.round(pBar * 10.19716 * 100) / 100;
    const officer = officerName || config.defaultOfficer || 'Petugas Lapangan PDAM';
    const noteText = notes || 'Input Manual Petugas Lapangan';
    const nowIso = new Date().toISOString();

    let notePayload = noteText;
    if (demand !== null && demand !== undefined) {
      notePayload = JSON.stringify({
        demand: Number(demand) || 0,
        text: typeof noteText === 'string' ? noteText : 'Input Petugas'
      });
    }

    const payload = {
      node_id: nodeId,
      node_label: nodeLabel || nodeId,
      pressure_bar: pBar,
      pressure_m: pMeters,
      confidence: 1.0,
      officer_name: officer,
      gauge_type: 'manual',
      notes: notePayload,
      updated_at: nowIso
    };

    try {
      setStatus('syncing');

      // Prioritaskan client SDK jika ada
      if (client) {
        const { error } = await client
          .from(config.tableName)
          .upsert(payload, { onConflict: 'node_id' });
        
        if (error) throw error;
      } else {
        // REST Fetch fallback
        const res = await fetch(`${config.url}/rest/v1/${config.tableName}`, {
          method: 'POST',
          headers: {
            'apikey': config.anonKey,
            'Authorization': `Bearer ${config.anonKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: Gagal menyimpan ke Supabase`);
        }
      }

      setStatus('connected');
      return { success: true, data: payload };
    } catch (err) {
      console.warn('SupabaseClient.upsertTelemetry error:', err);
      setStatus('offline');
      return { success: false, error: err };
    }
  }

  /**
   * Hapus telemetry junction dari Supabase
   */
  async function deleteTelemetry(nodeId) {
    const config = AppConfig.supabase;
    try {
      setStatus('syncing');
      if (client) {
        const { error } = await client
          .from(config.tableName)
          .delete()
          .eq('node_id', nodeId);
        if (error) throw error;
      } else {
        const res = await fetch(`${config.url}/rest/v1/${config.tableName}?node_id=eq.${encodeURIComponent(nodeId)}`, {
          method: 'DELETE',
          headers: {
            'apikey': config.anonKey,
            'Authorization': `Bearer ${config.anonKey}`
          }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      setStatus('connected');
      return true;
    } catch (err) {
      console.warn('SupabaseClient.deleteTelemetry error:', err);
      setStatus('offline');
      return false;
    }
  }

  /**
   * Aktifkan Real-Time Listener untuk perubahan data telemetry di Supabase
   */
  function subscribeToTelemetry(callback) {
    if (!client) {
      console.warn('SupabaseClient: Realtime listener memerlukan Supabase JS SDK.');
      return null;
    }

    try {
      if (realtimeChannel) {
        client.removeChannel(realtimeChannel);
      }

      realtimeChannel = client
        .channel('scada_telemetry_live_channel')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: AppConfig.supabase.tableName
          },
          payload => {
            console.log('Supabase Realtime Update:', payload);
            if (typeof callback === 'function') {
              callback(payload);
            }
          }
        )
        .subscribe((status) => {
          console.log('Supabase Realtime Channel Status:', status);
          if (status === 'SUBSCRIBED') {
            setStatus('connected');
          }
        });

      return realtimeChannel;
    } catch (err) {
      console.warn('Gagal menghubungkan Realtime channel:', err);
      return null;
    }
  }

  /**
   * Simpan topologi jaringan suatu wilayah ke Supabase Cloud
   */
  async function saveRegionTopology(regionId, networkData) {
    const config = AppConfig.supabase;
    const safeRegion = (regionId || 'bunihayu').toString().toUpperCase();
    const specialNodeId = `__SCADA_NETWORK_${safeRegion}__`;
    const payload = {
      node_id: specialNodeId,
      node_label: `JARINGAN_${safeRegion}`,
      pressure_bar: 0,
      pressure_m: 0,
      confidence: 1.0,
      officer_name: 'Sistem SCADA Cloud',
      gauge_type: 'network_topology',
      notes: JSON.stringify(networkData),
      updated_at: new Date().toISOString()
    };

    try {
      setStatus('syncing');
      const res = await fetch(`${config.url}/rest/v1/${config.tableName}`, {
        method: 'POST',
        headers: {
          'apikey': config.anonKey,
          'Authorization': `Bearer ${config.anonKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('connected');
      return true;
    } catch (err) {
      console.warn('SupabaseClient.saveRegionTopology error:', err);
      setStatus('offline');
      return false;
    }
  }

  /**
   * Ambil topologi jaringan wilayah dari Supabase Cloud jika ada
   */
  async function fetchRegionTopology(regionId) {
    const config = AppConfig.supabase;
    const safeRegion = (regionId || 'bunihayu').toString().toUpperCase();
    const specialNodeId = `__SCADA_NETWORK_${safeRegion}__`;

    try {
      const res = await fetch(`${config.url}/rest/v1/${config.tableName}?node_id=eq.${encodeURIComponent(specialNodeId)}&select=notes`, {
        method: 'GET',
        headers: {
          'apikey': config.anonKey,
          'Authorization': `Bearer ${config.anonKey}`
        }
      });

      if (!res.ok) return null;
      const rows = await res.json();
      if (rows && rows.length > 0 && rows[0].notes) {
        return JSON.parse(rows[0].notes);
      }
      return null;
    } catch (err) {
      console.warn('SupabaseClient.fetchRegionTopology error:', err);
      return null;
    }
  }

  /**
   * Simpan katalog demand seluruh simpul wilayah ke Supabase Cloud
   */
  async function saveRegionDemands(regionId, demandsMap) {
    const config = AppConfig.supabase;
    const safeRegion = (regionId || 'bunihayu').toString().toUpperCase();
    const specialNodeId = `__SCADA_DEMANDS_${safeRegion}__`;
    const payload = {
      node_id: specialNodeId,
      node_label: `DEMAND_${safeRegion}`,
      pressure_bar: 0,
      pressure_m: 0,
      confidence: 1.0,
      officer_name: 'Sistem SCADA Cloud',
      gauge_type: 'demands_catalog',
      notes: JSON.stringify(demandsMap),
      updated_at: new Date().toISOString()
    };

    try {
      setStatus('syncing');
      const res = await fetch(`${config.url}/rest/v1/${config.tableName}`, {
        method: 'POST',
        headers: {
          'apikey': config.anonKey,
          'Authorization': `Bearer ${config.anonKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('connected');
      return true;
    } catch (err) {
      console.warn('SupabaseClient.saveRegionDemands error:', err);
      setStatus('offline');
      return false;
    }
  }

  /**
   * Ambil katalog demand wilayah dari Supabase Cloud
   */
  async function fetchRegionDemands(regionId) {
    const config = AppConfig.supabase;
    const safeRegion = (regionId || 'bunihayu').toString().toUpperCase();
    const specialNodeId = `__SCADA_DEMANDS_${safeRegion}__`;

    try {
      const res = await fetch(`${config.url}/rest/v1/${config.tableName}?node_id=eq.${encodeURIComponent(specialNodeId)}&select=notes`, {
        method: 'GET',
        headers: {
          'apikey': config.anonKey,
          'Authorization': `Bearer ${config.anonKey}`
        }
      });

      if (!res.ok) return null;
      const rows = await res.json();
      if (rows && rows.length > 0 && rows[0].notes) {
        return JSON.parse(rows[0].notes);
      }
      return null;
    } catch (err) {
      console.warn('SupabaseClient.fetchRegionDemands error:', err);
      return null;
    }
  }

  return {
    init,
    onStatusChange,
    getStatus,
    testConnection,
    getTelemetryForRegion,
    upsertTelemetry,
    deleteTelemetry,
    subscribeToTelemetry,
    saveRegionTopology,
    fetchRegionTopology,
    saveRegionDemands,
    fetchRegionDemands
  };
})();
