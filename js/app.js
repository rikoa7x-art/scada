/**
 * App - Orkestrasi Aplikasi Utama Monitoring Debit Air SPAM PDAM
 * Mendukung Multi-Wilayah Terpadu (9 Wilayah SPAM PDAM Subang) & Sinkronisasi Supabase Real-Time
 */

const App = (() => {
  let networkData = null;
  let nodeMeasurements = {};
  let userDemands = {};
  let currentMode = 'demand'; // 'demand' (EPANET standard) atau 'pressure' (Manometer Lapangan)
  let currentHydraulicResult = null;
  let currentRegionId = 'bunihayu';

  // Konfigurasi Parameter Sumber (Pompa & Reservoir Gravitasi)
  let sourceConfig = {
    systemMode: 'pump', // 'pump' (Sistem Pemompaan) atau 'gravity' (Sistem Gravitasi)
    pump: {
      id: 'pump_default',
      label: 'Pompa Utama',
      head: 50.0,
      flow: 10.0,
      flowUnit: 'lps',
      status: 'on'
    },
    reservoir: {
      id: 'reservoir_default',
      label: 'Reservoir',
      elevation: 535.0,
      flow: 10.0,
      flowUnit: 'lps'
    }
  };

  const REGION_STORAGE_KEY = 'pdam_spam_current_region';
  const CUSTOM_REGIONS_STORAGE_KEY = 'pdam_spam_custom_regions_v1'; // Daftar wilayah kustom yang diupload user

  // === CACHE TOPOLOGI JSON ===
  // Topologi jaringan (nodes, pipes, pumps) disimpan di localStorage agar tidak
  // perlu fetch ulang dari server setiap kali aplikasi dibuka.
  // CACHE_VERSION: naikkan angka ini jika ada perubahan pada file JSON di server
  // agar cache lama di HP pengguna otomatis diperbarui.
  const TOPOLOGY_CACHE_PREFIX = 'pdam_topo_v2_';
  const CACHE_VERSION = '2026.09.25'; // Format: YYYY.MM.DD — update jika JSON berubah

  /**
   * Helper Dapatkan Konfigurasi Wilayah Aktif
   */
  function getCurrentRegion() {
    return AppConfig.regions?.find(r => r.id === currentRegionId) || AppConfig.regions?.[0] || {
      id: 'bunihayu',
      name: 'SPAM Bunihayu',
      file: 'epanet_bunihayu.json'
    };
  }

  /**
   * Helper Kunci LocalStorage per Wilayah
   */
  function getStorageKey(type, regionId = currentRegionId) {
    return `pdam_spam_${type}_${regionId}`;
  }

  // =========================================================
  // MANAJEMEN WILAYAH KUSTOM (Upload JSON → Simpan ke Cloud)
  // =========================================================

  /**
   * Baca semua wilayah kustom dari localStorage
   * @returns {Array} Array of { id, name, nodeCount, pipeCount, savedAt }
   */
  function loadCustomRegions() {
    try {
      const raw = localStorage.getItem(CUSTOM_REGIONS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Simpan wilayah kustom baru ke localStorage dan inject ke AppConfig.regions + dropdown
   */
  function saveCustomRegion(id, name, nodeCount, pipeCount) {
    try {
      const regions = loadCustomRegions();
      // Update jika ID sudah ada, atau tambahkan baru
      const existing = regions.findIndex(r => r.id === id);
      const entry = { id, name, nodeCount, pipeCount, isCustom: true, savedAt: new Date().toISOString() };
      if (existing >= 0) {
        regions[existing] = entry;
      } else {
        regions.push(entry);
      }
      localStorage.setItem(CUSTOM_REGIONS_STORAGE_KEY, JSON.stringify(regions));
      // Inject ke AppConfig.regions dan UI dropdown
      injectCustomRegionToAppConfig(entry);
      injectCustomRegionsToUI();
    } catch (e) {
      console.warn('Gagal menyimpan wilayah kustom ke localStorage:', e);
    }
  }

  /**
   * Hapus wilayah kustom dari localStorage, dropdown, dan Supabase Cache
   */
  async function deleteCustomRegionAndRefresh(id) {
    if (!confirm('Yakin ingin menghapus wilayah kustom ini dari perangkat?')) return;

    try {
      const regions = loadCustomRegions().filter(r => r.id !== id);
      localStorage.setItem(CUSTOM_REGIONS_STORAGE_KEY, JSON.stringify(regions));
      
      // Hapus dari AppConfig.regions
      const idx = AppConfig.regions?.findIndex(r => r.id === id);
      if (idx >= 0) AppConfig.regions.splice(idx, 1);
      
      injectCustomRegionsToUI();
      
      // Hapus cache topologi
      clearTopologyCache(id);
      
      UIController.showToast('Wilayah kustom berhasil dihapus dari perangkat', 'success');

      // Refresh isi modal
      UIController.openManageRegionsModal();

      // Jika yang dihapus adalah wilayah yang sedang aktif, switch ke wilayah default (index 0)
      if (currentRegionId === id) {
        UIController.closeManageRegionsModal();
        await switchRegion(AppConfig.regions[0].id, true);
      }
    } catch (e) {
      console.warn('Gagal menghapus wilayah kustom:', e);
      UIController.showToast('Gagal menghapus wilayah kustom', 'error');
    }
  }

  /**
   * Masukkan satu wilayah kustom ke AppConfig.regions (jika belum ada)
   */
  function injectCustomRegionToAppConfig(entry) {
    if (!AppConfig.regions) AppConfig.regions = [];
    const exists = AppConfig.regions.some(r => r.id === entry.id);
    if (!exists) {
      AppConfig.regions.push({
        id: entry.id,
        name: entry.name,
        file: null,          // Tidak punya file lokal — fetch dari Supabase
        isCustom: true,
        badge: `${entry.nodeCount} Simpul • ${entry.pipeCount} Pipa`,
        defaultCenter: [-6.663, 107.688],
        defaultZoom: 14,
        defaultSource: {
          systemMode: 'pump',
          pump: { head: 50.0, flow: 10.0, status: 'on' },
          reservoir: { elevation: 500.0, flow: 10.0 }
        }
      });
    }
  }

  /**
   * Inject semua wilayah kustom ke kedua dropdown selector (desktop & mobile)
   */
  function injectCustomRegionsToUI() {
    const customRegions = loadCustomRegions();
    const selectors = ['selectRegion', 'selectRegionMobile'];

    selectors.forEach(selId => {
      const sel = document.getElementById(selId);
      if (!sel) return;

      // Hapus semua option kustom lama (data-custom="true")
      sel.querySelectorAll('option[data-custom="true"]').forEach(o => o.remove());

      if (customRegions.length === 0) return;

      // Tambahkan separator
      const sep = document.createElement('option');
      sep.disabled = true;
      sep.textContent = '── Wilayah Kustom ──';
      sep.setAttribute('data-custom', 'true');
      sel.appendChild(sep);

      // Tambahkan setiap wilayah kustom
      customRegions.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = `${r.name} (${r.nodeCount} Simpul)`;
        opt.setAttribute('data-custom', 'true');
        sel.appendChild(opt);
      });
    });
  }

  /**
   * Inisialisasi Aplikasi saat Dokumen Siap
   */
  async function init() {
    // 1. Inisialisasi Peta GIS
    MapManager.init('map');
    MapManager.setCallbacks({
      onNodeClick: (node, nodeState) => {
        if (node.type === 'reservoir') {
          UIController.openSourceSettingsModal('reservoir');
          return;
        }
        UIController.openPressureModal(node, nodeState);
      },
      onPipeClick: (pipe, pipeCalc, startNode, endNode) => {
        UIController.showPipeDetailCard(pipe, pipeCalc, startNode, endNode);
      },
      onPumpClick: () => {
        UIController.openSourceSettingsModal('pump');
      }
    });

    // 2. Inisialisasi UI Controller
    UIController.init({
      onSavePressure: saveNodeData,
      onDeletePressure: deletePressure,
      onResetData: resetData,
      onLoadSampleData: loadSampleData,
      onSolveNetwork: solveFullNetwork,
      onExportCSV: exportToCSV,
      onUploadJSON: handleCustomJSON,
      onSaveSourceConfig: saveSourceConfig,
      onSelectRegion: (regionId) => switchRegion(regionId, true),
      onSyncCloud: () => syncCurrentRegionTelemetry(true),
      onBackupTopology: () => backupCurrentRegionToCloud()
    });

    // Setup Mode Switcher (Demand vs Pressure)
    setupModeSwitcher();

    // 3. Inisialisasi Klien Supabase & Realtime Listener
    initSupabase();

    // 4. Muat & inject wilayah kustom dari localStorage ke AppConfig + dropdown
    loadCustomRegions().forEach(entry => injectCustomRegionToAppConfig(entry));
    injectCustomRegionsToUI();

    // 5. Deteksi Wilayah Terakhir yang Dibuka Pengguna
    try {
      const savedRegionId = localStorage.getItem(REGION_STORAGE_KEY);
      // Cek di semua region (termasuk kustom yang sudah di-inject)
      if (savedRegionId && AppConfig.regions?.some(r => r.id === savedRegionId)) {
        currentRegionId = savedRegionId;
      }
    } catch (e) {}

    // 6. Muat Wilayah Aktif
    await switchRegion(currentRegionId, true);
  }

  /**
   * Inisialisasi Supabase Cloud & Realtime Handler
   */
  function initSupabase() {
    SupabaseClient.init();

    // Sinkronkan badge status koneksi ke UI
    SupabaseClient.onStatusChange((status) => {
      UIController.updateCloudStatus(status);
    });

    // Langganan pembaruan telemetry secara real-time
    SupabaseClient.subscribeToTelemetry((payload) => {
      handleRealtimeTelemetryUpdate(payload);
    });
  }

  /**
   * Handler Saat Ada Pembaruan Telemetry Realtime dari Supabase
   */
  function handleRealtimeTelemetryUpdate(payload) {
    if (!networkData || !networkData.nodes) return;
    const { eventType, new: newRow, old: oldRow } = payload;
    const nodeIdsMap = new Map(networkData.nodes.map(n => [n.id, n]));

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      const safeCurrentRegion = (currentRegionId || 'bunihayu').toString().toUpperCase();
      // 1. Cek apakah ini pembaruan katalog demand wilayah
      if (newRow && newRow.node_id === `__SCADA_DEMANDS_${safeCurrentRegion}__`) {
        if (newRow.notes) {
          try {
            const parsed = JSON.parse(newRow.notes);
            if (parsed && typeof parsed === 'object') {
              Object.assign(userDemands, parsed);
              if (networkData && networkData.nodes) {
                networkData.nodes.forEach(n => {
                  if (parsed[n.id] !== undefined) {
                    n.demand = parsed[n.id];
                  }
                });
              }
              saveMeasurementsToStorage();
              recalculateAndRender();
              UIController.showToast('📡 Pembaruan Demand Wilayah disinkronkan secara Real-Time!', 'info');
              return;
            }
          } catch (e) {}
        }
      }

      // 2. Pembaruan titik simpul individual
      if (newRow && newRow.node_id && nodeIdsMap.has(newRow.node_id)) {
        const node = nodeIdsMap.get(newRow.node_id);
        const incomingPressure = Number(newRow.pressure_bar);
        let demandUpdated = false;

        // Ekstrak demand jika ada di notes
        if (newRow.notes) {
          try {
            if (newRow.notes.startsWith('{') && newRow.notes.endsWith('}')) {
              const parsedNotes = JSON.parse(newRow.notes);
              if (parsedNotes && parsedNotes.demand !== undefined && parsedNotes.demand !== null) {
                const incomingDemand = Number(parsedNotes.demand);
                if (userDemands[newRow.node_id] !== incomingDemand) {
                  userDemands[newRow.node_id] = incomingDemand;
                  if (node) node.demand = incomingDemand;
                  demandUpdated = true;
                }
              }
            }
          } catch (e) {}
        }

        const localCurrent = nodeMeasurements[newRow.node_id]?.pressure;
        const pressureChanged = localCurrent === undefined || Math.abs(localCurrent - incomingPressure) > 0.001;

        if (pressureChanged || demandUpdated) {
          if (incomingPressure > 0 || !nodeMeasurements[newRow.node_id]) {
            nodeMeasurements[newRow.node_id] = {
              pressure: incomingPressure,
              unit: 'bar',
              pressureMeters: Number(newRow.pressure_m) || (incomingPressure * 10.19716),
              officer: newRow.officer_name || 'Petugas',
              timestamp: newRow.updated_at || new Date().toISOString()
            };
          }

          saveMeasurementsToStorage();
          recalculateAndRender();

          const info = [];
          if (demandUpdated) info.push(`Demand: ${userDemands[newRow.node_id]} L/s`);
          if (pressureChanged && incomingPressure > 0) info.push(`Tekanan: ${incomingPressure} bar`);
          UIController.showToast(`📡 Telemetry Live: Simpul ${newRow.node_label || node.label} diperbarui (${info.join(', ') || 'OK'})`, 'info');
        }
      }
    } else if (eventType === 'DELETE') {
      if (oldRow && oldRow.node_id && nodeIdsMap.has(oldRow.node_id)) {
        delete nodeMeasurements[oldRow.node_id];
        saveMeasurementsToStorage();
        recalculateAndRender();
      }
    }
  }

  /**
   * Ganti Wilayah SPAM Aktif
   */
  async function switchRegion(regionId, doFitBounds = true) {
    const region = AppConfig.regions?.find(r => r.id === regionId);
    if (!region) {
      console.warn('Wilayah tidak ditemukan:', regionId);
      return;
    }

    currentRegionId = regionId;
    try {
      localStorage.setItem(REGION_STORAGE_KEY, regionId);
    } catch (e) {}

    // Perbarui judul dan pilihan di UI
    UIController.setActiveRegionDisplay(region.id, region.name);

    // 1. Muat parameter tersimpan untuk wilayah ini
    loadSavedMeasurementsForRegion(regionId, region);

    // 2. Muat Topologi Jaringan (Cloud Supabase atau File JSON Lokal)
    await loadRegionalTopology(region);

    // 3. Tarik Telemetry Lapangan Terkini dari Supabase Cloud
    await syncCurrentRegionTelemetry(false);

    // 4. Hitung Ulang Hidrolika dan Render
    recalculateAndRender();

    // 5. Posisikan Peta ke Batas Jaringan Wilayah
    if (doFitBounds) {
      setTimeout(() => {
        MapManager.fitNetworkBounds();
      }, 350);
    }
  }

  /**
   * Simpan topologi wilayah ke localStorage cache
   * @param {string} regionId - ID wilayah
   * @param {Object} data - Data topologi (nodes, pipes, pumps)
   */
  function saveTopologyToCache(regionId, data) {
    try {
      const cacheKey = TOPOLOGY_CACHE_PREFIX + regionId;
      const payload = JSON.stringify({ version: CACHE_VERSION, data });
      localStorage.setItem(cacheKey, payload);
      console.log(`💾 Cache topologi ${regionId} disimpan (${(payload.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      // localStorage penuh — hapus cache wilayah lain yang tidak aktif
      console.warn('localStorage penuh, membersihkan cache lama...', e);
      _evictOldTopologyCaches(regionId);
      try {
        const cacheKey = TOPOLOGY_CACHE_PREFIX + regionId;
        localStorage.setItem(cacheKey, JSON.stringify({ version: CACHE_VERSION, data }));
      } catch (e2) {
        console.warn('Cache tidak bisa disimpan (storage penuh):', e2);
      }
    }
  }

  /**
   * Muat topologi wilayah dari localStorage cache
   * @param {string} regionId - ID wilayah
   * @returns {Object|null} Data topologi jika cache valid, null jika tidak ada atau expired
   */
  function loadTopologyFromCache(regionId) {
    try {
      const cacheKey = TOPOLOGY_CACHE_PREFIX + regionId;
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Validasi versi — jika CACHE_VERSION berubah, cache lama dianggap kadaluarsa
      if (parsed.version !== CACHE_VERSION) {
        console.log(`🗑️ Cache ${regionId} kadaluarsa (v${parsed.version}), akan diperbarui.`);
        localStorage.removeItem(cacheKey);
        return null;
      }
      if (!parsed.data?.nodes || !parsed.data?.pipes) return null;
      console.log(`⚡ Cache topologi ${regionId} ditemukan — skip fetch jaringan`);
      return parsed.data;
    } catch (e) {
      return null;
    }
  }

  /**
   * Hapus semua cache topologi (kecuali wilayah aktif) untuk bebaskan ruang
   */
  function _evictOldTopologyCaches(keepRegionId) {
    AppConfig.regions?.forEach(r => {
      if (r.id !== keepRegionId) {
        localStorage.removeItem(TOPOLOGY_CACHE_PREFIX + r.id);
      }
    });
  }

  /**
   * Hapus cache satu wilayah (untuk force-refresh)
   */
  function clearTopologyCache(regionId) {
    localStorage.removeItem(TOPOLOGY_CACHE_PREFIX + (regionId || currentRegionId));
  }

  /**
   * Muat Topologi Jaringan Wilayah
   * Urutan prioritas:
   *   1. localStorage cache (paling cepat — tidak butuh network)
   *   2. Supabase Cloud topology (wajib untuk wilayah kustom, opsional untuk wilayah default)
   *   3. Fetch file JSON dari server (fallback — hanya untuk wilayah bawaan, bukan kustom)
   */
  async function loadRegionalTopology(region) {
    try {
      // === 1. Cek localStorage cache terlebih dahulu ===
      const cached = loadTopologyFromCache(region.id);
      if (cached) {
        networkData = cached;
        // Inisialisasi demand dari cache
        networkData.nodes.forEach(node => {
          if (userDemands[node.id] === undefined) {
            userDemands[node.id] = Number(node.demand) || 0;
          } else {
            node.demand = userDemands[node.id];
          }
        });
        initSourceConfigFromNetwork(region);
        UIController.showToast(`⚡ Jaringan ${region.name} dimuat dari cache lokal`, 'info');
        return; // Selesai — tidak perlu fetch ke server
      }

      // === 2. Cek Supabase Cloud topology ===
      UIController.showToast(`📡 Mengunduh data jaringan ${region.name}...`, 'info');
      const cloudTopology = await SupabaseClient.fetchRegionTopology(region.id);
      if (cloudTopology && cloudTopology.nodes && cloudTopology.pipes) {
        console.log(`Memuat topologi ${region.name} dari Supabase Cloud.`);
        networkData = cloudTopology;
      } else if (region.isCustom || !region.file) {
        // === Wilayah kustom WAJIB ada di Supabase — jika tidak ada, tampilkan error ===
        throw new Error(
          `Data jaringan "${region.name}" tidak ditemukan di Supabase Cloud.\n` +
          `Kemungkinan belum pernah disimpan atau terhapus. ` +
          `Silakan upload ulang file JSON dan simpan kembali ke Cloud.`
        );
      } else {
        // === 3. Fetch file JSON dari server (fallback — hanya wilayah bawaan) ===
        const response = await fetch(region.file);
        if (!response.ok) {
          throw new Error(`Gagal memuat ${region.file} (HTTP ${response.status})`);
        }
        networkData = await response.json();
      }

      // Inisialisasi demand awal dari JSON
      networkData.nodes.forEach(node => {
        if (userDemands[node.id] === undefined) {
          userDemands[node.id] = Number(node.demand) || 0;
        } else {
          node.demand = userDemands[node.id];
        }
      });

      initSourceConfigFromNetwork(region);

      // === Simpan ke localStorage cache untuk load berikutnya ===
      saveTopologyToCache(region.id, networkData);
      UIController.showToast(`✅ Data jaringan ${region.name} berhasil diunduh & dicache`, 'success');

    } catch (err) {
      console.error(`Gagal memuat data jaringan untuk wilayah ${region.name}:`, err);
      UIController.showToast(`❌ Gagal memuat jaringan ${region.name}: ${err.message}`, 'error');
    }
  }

  /**
   * Inisialisasi Konfigurasi Sumber (Pompa / Gravitasi) untuk Wilayah
   */
  function initSourceConfigFromNetwork(region) {
    const savedSource = localStorage.getItem(getStorageKey('source'));
    if (!savedSource) {
      // Gunakan default dari preset region atau data file JSON
      const defSource = region.defaultSource || {};
      sourceConfig.systemMode = defSource.systemMode || (networkData.pumps && networkData.pumps.length > 0 ? 'pump' : 'gravity');

      if (networkData.pumps && networkData.pumps.length > 0) {
        const p = networkData.pumps[0];
        sourceConfig.pump.id = p.id;
        sourceConfig.pump.label = p.label || 'Pompa Wilayah';
        sourceConfig.pump.head = Number(p.designHead) || defSource.pump?.head || 50;
        sourceConfig.pump.flow = Number(p.designFlow) || defSource.pump?.flow || 10;
        sourceConfig.pump.status = p.status || defSource.pump?.status || 'on';
      } else {
        sourceConfig.pump.head = defSource.pump?.head || 0;
        sourceConfig.pump.flow = defSource.pump?.flow || 10;
        sourceConfig.pump.status = 'off';
      }

      const res = networkData.nodes.find(n => n.type === 'reservoir');
      if (res) {
        sourceConfig.reservoir.id = res.id;
        sourceConfig.reservoir.label = res.label || 'Reservoir Wilayah';
        sourceConfig.reservoir.elevation = Number(res.elevation) || defSource.reservoir?.elevation || 500;
        sourceConfig.reservoir.flow = defSource.reservoir?.flow || 10;
      }
    } else {
      // Terapkan setting tersimpan ke objek network & sourceConfig
      try {
        const parsed = JSON.parse(savedSource);
        if (parsed) {
          sourceConfig = { ...sourceConfig, ...parsed };
        }
      } catch (e) {}

      if (networkData.pumps && networkData.pumps.length > 0) {
        networkData.pumps[0].designHead = Number(sourceConfig.pump.head) || 50;
        networkData.pumps[0].designFlow = Number(sourceConfig.pump.flow) || 10;
        networkData.pumps[0].status = sourceConfig.pump.status;
      }
      const res = networkData.nodes?.find(n => n.type === 'reservoir');
      if (res) {
        res.elevation = Number(sourceConfig.reservoir.elevation) || res.elevation;
      }
    }
  }

  /**
   * Tarik Telemetry & Demand Lapangan Terkini dari Supabase Cloud
   */
  async function syncCurrentRegionTelemetry(showFeedback = true) {
    if (!networkData || !networkData.nodes) return;

    if (showFeedback) {
      UIController.showToast('Menghubungkan ke Supabase Cloud...', 'info');
    }

    try {
      const nodeIds = networkData.nodes.map(n => n.id);
      const cloudResult = await SupabaseClient.getTelemetryForRegion(nodeIds, currentRegionId);

      if (cloudResult) {
        let count = 0;
        if (cloudResult.measurements && Object.keys(cloudResult.measurements).length > 0) {
          Object.assign(nodeMeasurements, cloudResult.measurements);
          count += Object.keys(cloudResult.measurements).length;
        }
        if (cloudResult.demands && Object.keys(cloudResult.demands).length > 0) {
          Object.assign(userDemands, cloudResult.demands);
          if (networkData && networkData.nodes) {
            networkData.nodes.forEach(n => {
              if (cloudResult.demands[n.id] !== undefined) {
                n.demand = cloudResult.demands[n.id];
              }
            });
          }
          count += Object.keys(cloudResult.demands).length;
        }

        if (count > 0) {
          saveMeasurementsToStorage();
          recalculateAndRender();

          if (showFeedback) {
            UIController.showToast(`✅ Berhasil menyinkronkan data tekanan & demand dari Supabase Cloud!`, 'success');
          }
        } else {
          if (showFeedback) {
            UIController.showToast(`Server terhubung. Belum ada data baru untuk ${getCurrentRegion().name}.`, 'info');
          }
        }
      }
    } catch (err) {
      console.warn('syncCurrentRegionTelemetry error:', err);
      if (showFeedback) {
        UIController.showToast('Gagal menarik data dari Supabase. Menggunakan data cache lokal.', 'warning');
      }
    }
  }

  /**
   * Cadangkan Topologi Jaringan Wilayah Aktif ke Cloud
   */
  async function backupCurrentRegionToCloud() {
    if (!networkData) {
      alert('Tidak ada data jaringan yang aktif.');
      return;
    }

    UIController.showToast(`Mencadangkan topologi ${getCurrentRegion().name} ke Supabase...`, 'info');
    const success = await SupabaseClient.saveRegionTopology(currentRegionId, networkData);
    if (success) {
      UIController.showToast(`✅ Topologi jaringan ${getCurrentRegion().name} berhasil dicadangkan ke Supabase Cloud!`, 'success');
    } else {
      UIController.showToast('Gagal mencadangkan topologi ke Supabase. Periksa koneksi internet.', 'error');
    }
  }

  /**
   * Konfirmasi simpan jaringan yang baru diunggah ke Supabase dengan nama wilayah dari modal
   */
  async function confirmSaveNetworkToCloud() {
    if (!networkData) {
      UIController.showToast('Tidak ada data jaringan aktif.', 'error');
      return;
    }

    const { name, id } = UIController.getSaveNetworkModalValues();

    if (!name) {
      const elName = document.getElementById('inputSaveNetworkName');
      elName?.focus();
      elName?.classList.add('ring-2', 'ring-red-400', 'border-red-400');
      setTimeout(() => elName?.classList.remove('ring-2', 'ring-red-400', 'border-red-400'), 2000);
      UIController.showToast('⚠️ Nama wilayah tidak boleh kosong!', 'warning');
      return;
    }

    if (!id) {
      UIController.showToast('⚠️ ID wilayah tidak boleh kosong!', 'warning');
      return;
    }

    // Disable tombol saat proses berlangsung
    const btn = document.getElementById('btnConfirmSaveNetwork');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Menyimpan...';
    }

    UIController.showToast(`⏳ Menyimpan "${name}" ke Supabase Cloud...`, 'info');

    // Simpan topologi jaringan ke Supabase dengan regionId dari input user
    const success = await SupabaseClient.saveRegionTopology(id, networkData);

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><polyline points="12 13 12 9 10 11"/><polyline points="12 9 14 11"/></svg> Simpan ke Supabase Cloud`;
    }

    if (success) {
      currentRegionId = id;
      try {
        localStorage.setItem(REGION_STORAGE_KEY, id);
      } catch (e) {}
      // Simpan info wilayah kustom ke localStorage agar muncul di dropdown saat app dibuka ulang
      saveCustomRegion(id, name, networkData.nodes.length, networkData.pipes.length);
      saveTopologyToCache(id, networkData);
      saveMeasurementsToStorage();
      UIController.setActiveRegionDisplay(id, name);
      UIController.closeSaveNetworkModal();
      UIController.showToast(`✅ Jaringan "${name}" (ID: ${id}) berhasil disimpan ke Supabase Cloud & terdaftar di aplikasi!`, 'success');
    } else {
      UIController.showToast('❌ Gagal menyimpan ke Supabase. Periksa koneksi internet dan coba lagi.', 'error');
    }
  }

  /**
   * Setup Mode Switcher (Input Demand EPANET vs Input Tekanan Manometer)
   */
  function setupModeSwitcher() {
    const btnDemand = document.getElementById('btnModeDemand');
    const btnPressure = document.getElementById('btnModePressure');

    btnDemand?.addEventListener('click', () => {
      currentMode = 'demand';
      btnDemand.classList.add('bg-emerald-600', 'text-white', 'shadow-xs');
      btnDemand.classList.remove('text-slate-400');
      btnPressure.classList.remove('bg-emerald-600', 'text-white', 'shadow-xs');
      btnPressure.classList.add('text-slate-400');
      recalculateAndRender();
    });

    btnPressure?.addEventListener('click', () => {
      currentMode = 'pressure';
      btnPressure.classList.add('bg-emerald-600', 'text-white', 'shadow-xs');
      btnPressure.classList.remove('text-slate-400');
      btnDemand.classList.remove('bg-emerald-600', 'text-white', 'shadow-xs');
      btnDemand.classList.add('text-slate-400');
      recalculateAndRender();
    });
  }

  /**
   * Tangani JSON kustom yang diunggah pengguna — otomatis simpan ke Supabase Cloud
   */
  async function handleCustomJSON(data, fileName = '') {
    if (!data || !data.nodes || !data.pipes) {
      alert('Format JSON tidak sesuai: Harus memiliki array "nodes" dan "pipes" (Standar EPANET / PDAM).');
      return;
    }

    networkData = data;
    nodeMeasurements = {};
    userDemands = {};

    // 1. Ekstrak demand awal dari setiap simpul (junction)
    networkData.nodes.forEach(node => {
      userDemands[node.id] = Number(node.demand) || 0;
    });

    // 2. Deteksi parameter sumber (pompa / reservoir gravitasi)
    if (networkData.pumps && networkData.pumps.length > 0) {
      const p = networkData.pumps[0];
      sourceConfig.systemMode = 'pump';
      sourceConfig.pump.id = p.id;
      sourceConfig.pump.label = p.label || 'Pompa Utama';
      sourceConfig.pump.head = Number(p.designHead) || 50;
      sourceConfig.pump.flow = Number(p.designFlow) || 10;
      sourceConfig.pump.status = p.status || 'on';
    } else {
      sourceConfig.systemMode = 'gravity';
    }

    const res = networkData.nodes.find(n => n.type === 'reservoir');
    if (res) {
      sourceConfig.reservoir.id = res.id;
      sourceConfig.reservoir.label = res.label || 'Reservoir';
      sourceConfig.reservoir.elevation = Number(res.elevation) || 500;
      sourceConfig.reservoir.flow = Number(res.demand) || 10;
    }

    // 3. Generate nama & ID wilayah otomatis dari nama file / projectName
    const netName = data.projectName || (fileName ? fileName.replace(/\.json$/i, '') : 'Jaringan Kustom');
    const regionId = netName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .substring(0, 40) || 'jaringan_kustom';

    // 4. Perbarui tampilan judul wilayah & badge sumber
    UIController.setActiveRegionDisplay(regionId, netName);
    UIController.updateSourceBadge(sourceConfig);

    // 5. Simpan lokal & render
    saveMeasurementsToStorage();
    recalculateAndRender();

    // 6. Zoom otomatis ke batas jaringan baru
    setTimeout(() => {
      MapManager.fitNetworkBounds();
    }, 250);

    UIController.showToast(`✅ File JSON "${netName}" (${networkData.nodes.length} Simpul, ${networkData.pipes.length} Pipa) berhasil dimuat!`, 'success');

    // 7. Auto-simpan ke Supabase Cloud tanpa modal konfirmasi
    UIController.showToast(`⏳ Menyimpan "${netName}" ke Supabase Cloud...`, 'info');
    const success = await SupabaseClient.saveRegionTopology(regionId, networkData);

    if (success) {
      currentRegionId = regionId;
      try { localStorage.setItem(REGION_STORAGE_KEY, regionId); } catch (e) {}
      saveCustomRegion(regionId, netName, networkData.nodes.length, networkData.pipes.length);
      saveTopologyToCache(regionId, networkData);
      saveMeasurementsToStorage();
      UIController.setActiveRegionDisplay(regionId, netName);
      UIController.showToast(`☁️ Jaringan "${netName}" (ID: ${regionId}) berhasil tersimpan otomatis ke Supabase Cloud!`, 'success');
    } else {
      UIController.showToast(`⚠️ Gagal menyimpan "${netName}" ke Supabase. Jaringan tetap aktif di sesi ini — coba cadangkan manual nanti.`, 'warning');
    }
  }

  /**
   * [OPTIMASI MOBILE] Tracking tab aktif
   */
  let activeTabId = 'tabMap';

  /**
   * Dipanggil oleh UIController saat user pindah tab
   */
  function onTabActivated(tabId) {
    activeTabId = tabId;
    if (tabId === 'tabProfile') {
      refreshProfileChart();
    }
  }

  /**
   * Hitung Ulang Hidrolika dan Perbarui Komponen UI
   * [OPTIMASI MOBILE] Pipa menggunakan pagination 20 kartu, Chart.js di-lazy load hanya saat tab profil aktif
   */
  function recalculateAndRender() {
    if (!networkData) return;

    // 1. Eksekusi engine sesuai mode aktif dan konfigurasi sumber (pompa/gravitasi)
    if (currentMode === 'demand') {
      currentHydraulicResult = HydraulicEngine.solveNetworkByDemand(networkData, userDemands, sourceConfig);
    } else {
      currentHydraulicResult = HydraulicEngine.solveNetworkHydraulics(networkData, nodeMeasurements, sourceConfig, userDemands);
    }

    if (!currentHydraulicResult) return;

    // 2. Render Peta GIS
    MapManager.renderNetwork(networkData, currentHydraulicResult.nodes, currentHydraulicResult.pipes, sourceConfig);

    // 3. Update Ringkasan KPI & Badge Sumber
    UIController.updateSummaryCards(
      currentHydraulicResult.summary,
      currentHydraulicResult.nodes,
      currentHydraulicResult.pipes
    );
    UIController.updateSourceBadge(sourceConfig);

    // 4. Render Tabel Pipa (Ringan: sudah dioptimasi dengan pagination 20 kartu mobile)
    UIController.renderPipesTable(
      networkData,
      currentHydraulicResult.nodes,
      currentHydraulicResult.pipes
    );

    // 5. Render Daftar Batch Input di Sidebar
    UIController.renderJunctionsSidebarTable(
      networkData,
      currentHydraulicResult.nodes,
      sourceConfig
    );

    // 6. Susun dan Render Skema Alur Hidrolis Berurutan (Reservoir -> Ujung)
    const sequenceSteps = HydraulicEngine.buildSequentialNetworkFlow(
      networkData,
      currentHydraulicResult.nodes,
      currentHydraulicResult.pipes,
      sourceConfig
    );
    UIController.renderSequentialFlowTable(sequenceSteps);

    // 7. Update Grafik Profil HGL hanya jika tab profil sedang dibuka (Chart.js lazy-loaded)
    if (activeTabId === 'tabProfile') {
      refreshProfileChart();
    }
  }


  /**
   * Simpan Pengaturan Sumber (Pompa & Reservoir Gravitasi)
   */
  function saveSourceConfig(newConfig) {
    sourceConfig = {
      ...sourceConfig,
      ...newConfig,
      pump: { ...sourceConfig.pump, ...(newConfig.pump || {}) },
      reservoir: { ...sourceConfig.reservoir, ...(newConfig.reservoir || {}) }
    };

    // Sinkronkan ke networkData
    if (networkData) {
      if (!networkData.pumps) networkData.pumps = [];
      if (networkData.pumps.length > 0) {
        networkData.pumps[0].designHead = Number(sourceConfig.pump.head) || 50;
        networkData.pumps[0].designFlow = Number(sourceConfig.pump.flow) || 10;
        networkData.pumps[0].status = sourceConfig.pump.status;
      }
      const res = networkData.nodes?.find(n => n.type === 'reservoir');
      if (res) {
        res.elevation = Number(sourceConfig.reservoir.elevation) || res.elevation;
      }

      // Perbarui cache topologi di perangkat
      saveTopologyToCache(currentRegionId, networkData);

      // Jika wilayah kustom, sinkronkan juga perubahan pompa/reservoir ke Supabase Cloud
      const reg = getCurrentRegion();
      if (reg?.isCustom) {
        SupabaseClient.saveRegionTopology(currentRegionId, networkData).then(ok => {
          if (ok) console.log(`☁️ Perubahan pompa/sumber wilayah ${currentRegionId} tersinkron ke Cloud.`);
        }).catch(err => {
          console.warn('Gagal sinkronisasi sumber ke Supabase:', err);
        });
      }
    }

    saveMeasurementsToStorage();
    recalculateAndRender();
    UIController.showToast('✅ Pengaturan kapasitas pompa & sumber berhasil disimpan!', 'success');
  }

  /**
   * Simpan Tekanan dan Demand pada Junction (Otomatis Sync ke Supabase)
   */
  async function saveNodeData(nodeId, pressure, unit = 'bar', demand = 0) {
    try {
      const dVal = Number(demand) || 0;
      userDemands[nodeId] = dVal;

      const node = networkData?.nodes.find(n => n.id === nodeId);
      if (node) {
        node.demand = dVal;
      }
      const nodeLabel = node ? node.label : nodeId;

      let pNum = null;
      let pBar = null;

      if (pressure !== null && !isNaN(pressure)) {
        pNum = Number(pressure);
        pBar = unit === 'm' ? (pNum / 10.19716) : pNum;
        nodeMeasurements[nodeId] = {
          pressure: pNum,
          unit: unit,
          timestamp: new Date().toISOString()
        };
      } else if (nodeMeasurements[nodeId]) {
        pNum = nodeMeasurements[nodeId].pressure;
        pBar = nodeMeasurements[nodeId].unit === 'm' ? (pNum / 10.19716) : pNum;
      }

      // 1. Simpan lokal
      saveMeasurementsToStorage();
      try {
        recalculateAndRender();
      } catch (calcErr) {
        console.warn('recalculateAndRender warning:', calcErr);
      }

      // 2. Sinkronkan ke Supabase Cloud (Demand + Tekanan)
      const officer = localStorage.getItem('pdam_officer_name') || AppConfig.supabase?.defaultOfficer || 'Petugas Lapangan';
      const safeRegion = currentRegionId || 'bunihayu';
      const currentRegionObj = getCurrentRegion();
      const noteText = `Wilayah: ${currentRegionObj?.name || safeRegion}`;

      SupabaseClient.upsertTelemetry(nodeId, nodeLabel, pBar !== null ? pBar : 0, officer, noteText, dVal)
        .then(res => {
          if (res?.success) {
            const info = [];
            if (dVal > 0) info.push(`Demand: ${dVal} L/s`);
            if (pBar !== null) info.push(`Tekanan: ${pBar.toFixed(2)} bar`);
            UIController.showToast(`✅ ${nodeLabel} tersimpan & tersinkron ke Supabase Cloud (${info.join(', ') || 'OK'})`, 'success');
          }
        })
        .catch(err => {
          console.warn('Gagal sinkron ke Supabase:', err);
        });

      // 3. Cadangkan katalog demand wilayah ke Supabase Cloud
      SupabaseClient.saveRegionDemands(safeRegion, userDemands).catch(err => {
        console.warn('Gagal simpan katalog demand ke Supabase:', err);
      });

      return { success: true, demand: dVal, pressure: pBar };
    } catch (err) {
      console.error('saveNodeData error:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Simpan Tekanan pada Junction (kompatibilitas)
   */
  function savePressure(nodeId, pressure, unit = 'bar') {
    saveNodeData(nodeId, pressure, unit, userDemands[nodeId] || 0);
  }

  /**
   * Simpan Tekanan dari Input Inline di Sidebar
   */
  function saveInlinePressure(nodeId) {
    const input = document.getElementById(`inline-pressure-${nodeId}`);
    const unitSelect = document.getElementById(`inline-unit-${nodeId}`);
    if (!input || !unitSelect) return;

    const val = parseFloat(input.value);
    if (isNaN(val) || val < 0) {
      alert('Mohon masukkan angka tekanan yang valid.');
      return;
    }

    savePressure(nodeId, val, unitSelect.value);
  }

  /**
   * Hapus Tekanan pada Junction (Otomatis Sync ke Supabase)
   */
  async function deletePressure(nodeId) {
    const node = networkData?.nodes.find(n => n.id === nodeId);
    const nodeLabel = node ? node.label : nodeId;

    delete nodeMeasurements[nodeId];
    saveMeasurementsToStorage();
    recalculateAndRender();

    // Hapus dari Supabase Cloud
    SupabaseClient.deleteTelemetry(nodeId).then(ok => {
      if (ok) {
        UIController.showToast(`🗑️ Data telemetry ${nodeLabel} dihapus dari Supabase Cloud`, 'info');
      }
    });
  }

  /**
   * Muat Skenario Uji Lapangan Awal
   */
  function loadSampleData() {
    if (currentRegionId === 'bunihayu') {
      nodeMeasurements = { ...AppConfig.sampleFieldMeasurements };
    } else {
      // Buat data uji realistis berdasarkan elevasi simpul dan tekanan sumber
      nodeMeasurements = generateRealisticSampleMeasurements();
    }
    saveMeasurementsToStorage();
    recalculateAndRender();
    UIController.showToast(`Data uji lapangan dimuat untuk ${getCurrentRegion().name}`, 'info');
  }

  /**
   * Generator Data Uji Otomatis untuk Wilayah yang Belum Memiliki Pengukuran
   */
  function generateRealisticSampleMeasurements() {
    if (!networkData) return {};
    const result = {};
    const resNode = networkData.nodes.find(n => n.type === 'reservoir');
    const sourceHead = (resNode ? Number(resNode.elevation) : 500) + 
      (sourceConfig.systemMode === 'pump' && sourceConfig.pump.status === 'on' ? Number(sourceConfig.pump.head) : 0);

    networkData.nodes.forEach((node, idx) => {
      if (node.type === 'reservoir') return;
      // Perkiraan head loss bertahap sepanjang jaringan (0.05m - 0.2m per simpul)
      const estimatedLoss = Math.min(15, (idx + 1) * 0.15);
      const estTotalHead = sourceHead - estimatedLoss;
      const pressureM = Math.max(2, estTotalHead - Number(node.elevation));
      const pressureBar = Math.round((pressureM / 10.19716) * 100) / 100;

      result[node.id] = {
        pressure: pressureBar,
        unit: 'bar',
        timestamp: new Date().toISOString()
      };
    });

    return result;
  }

  /**
   * Reset Semua Pengukuran Lapangan
   */
  function resetData() {
    if (confirm(`Apakah Anda yakin ingin menghapus data tekanan lapangan untuk wilayah ${getCurrentRegion().name}?`)) {
      nodeMeasurements = {};
      saveMeasurementsToStorage();
      recalculateAndRender();
      UIController.showToast(`Data tekanan wilayah ${getCurrentRegion().name} dikosongkan.`, 'info');
    }
  }

  /**
   * Jalankan Simulasi Jaringan Penuh (Estimasi titik yang belum terukur)
   */
  function solveFullNetwork() {
    if (!networkData) return;
    const measuredCount = Object.keys(nodeMeasurements).length;
    if (measuredCount === 0) {
      if (confirm('Belum ada data tekanan yang diinput. Ingin memuat data uji lapangan untuk melihat simulasi lengkap?')) {
        loadSampleData();
        return;
      }
    }
    recalculateAndRender();
    UIController.showToast('Simulasi hidrolika jaringan telah diperbarui.', 'success');
  }

  /**
   * Ekspor Hasil Pengukuran dan Debit ke CSV
   */
  function exportToCSV() {
    if (!networkData || !currentHydraulicResult) return;

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += '=== LAPORAN MONITORING DEBIT AIR SPAM PDAM ===\n';
    csvContent += `Wilayah: ${getCurrentRegion().name}\n`;
    csvContent += `Waktu Cetak: ${new Date().toLocaleString('id-ID')}\n`;
    csvContent += `Sistem Pengaliran: ${sourceConfig.systemMode === 'gravity' ? 'Sistem Gravitasi Murni' : 'Sistem Pemompaan'}\n`;
    csvContent += `Kapasitas Head Pompa: ${sourceConfig.pump.head} m | Debit Pompa: ${sourceConfig.pump.flow} L/s | Status: ${sourceConfig.pump.status}\n`;
    csvContent += `Muka Air Reservoir: ${sourceConfig.reservoir.elevation} m | Setting Debit Reservoir: ${sourceConfig.reservoir.flow} L/s\n\n`;

    // Data Junction
    csvContent += 'DATA TEKANAN JUNCTION (TITIK SIMPUL)\n';
    csvContent += 'Label,Tipe,Elevasi (m),Tekanan (bar),Tekanan (mH2O),Total Head (m),Status\n';

    networkData.nodes.forEach(node => {
      const state = currentHydraulicResult.nodes.get(node.id);
      const isMeasured = state?.isMeasured;
      const pBar = state?.pressureHeadMeters !== null ? (state.pressureHeadMeters / 10.19716).toFixed(2) : '-';
      const pM = state?.pressureHeadMeters !== null ? state.pressureHeadMeters.toFixed(2) : '-';
      const totH = state?.totalHead !== null ? state.totalHead.toFixed(2) : '-';
      const status = isMeasured ? 'Terukur' : (state?.isEstimated ? 'Estimasi' : 'Belum');

      csvContent += `"${node.label}","${node.type || 'junction'}",${node.elevation},${pBar},${pM},${totH},"${status}"\n`;
    });

    // Data Pipa
    csvContent += '\nHASIL ANALISA DEBIT PIPA (HAZEN-WILLIAMS)\n';
    csvContent += 'No,Pipa,Diameter (mm),Panjang (m),Kekasaran (C),Head Loss (m),Debit (L/s),Debit (m3/jam),Kecepatan (m/s),Status Kecepatan,Arah Aliran\n';

    networkData.pipes.forEach((pipe, idx) => {
      const calc = currentHydraulicResult.pipes.get(pipe.id)?.calculation;
      const startNode = currentHydraulicResult.nodes.get(pipe.startNodeId);
      const endNode = currentHydraulicResult.nodes.get(pipe.endNodeId);

      const isCalc = calc && calc.status === 'calculated';
      const pLabel = `${startNode?.label || 'N/A'} -> ${endNode?.label || 'N/A'}`;
      const hf = isCalc ? calc.headLoss.toFixed(2) : '-';
      const qLps = isCalc ? calc.flowRateLps.toFixed(2) : '-';
      const qM3h = isCalc ? calc.flowRateM3h.toFixed(1) : '-';
      const vel = isCalc ? calc.velocity.toFixed(2) : '-';
      const vStatus = isCalc ? calc.velocityStatus : 'BELUM_TERHITUNG';
      const dir = isCalc && calc.direction !== 'none' 
        ? (calc.direction === 'forward' ? `${startNode?.label} ke ${endNode?.label}` : `${endNode?.label} ke ${startNode?.label}`)
        : '-';

      csvContent += `${idx + 1},"${pLabel}",${pipe.diameter},${pipe.length},${pipe.roughness || 140},${hf},${qLps},${qM3h},${vel},"${vStatus}","${dir}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Laporan_Debit_${currentRegionId}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Arahkan Peta ke Node
   */
  function locateNode(nodeId) {
    if (!networkData) return;
    const node = networkData.nodes.find(n => n.id === nodeId);
    if (node) {
      document.getElementById('btn-tabMap')?.click();
      if (window.innerWidth < 640) {
        UIController.closeSidebar?.();
      }
      MapManager.panToNode(node.lat, node.lng, 18);
      if (node.type !== 'reservoir') {
        const state = currentHydraulicResult?.nodes.get(node.id);
        UIController.openPressureModal(node, state);
      } else {
        UIController.openSourceSettingsModal('reservoir');
      }
    }
  }

  /**
   * Arahkan Peta ke Pipa dan Buka Kartu Detail
   */
  function locatePipe(pipeId) {
    if (!networkData || !currentHydraulicResult) return;
    const pipe = networkData.pipes.find(p => p.id === pipeId);
    if (pipe) {
      const calc = currentHydraulicResult.pipes.get(pipe.id)?.calculation;
      const startNode = currentHydraulicResult.nodes.get(pipe.startNodeId);
      const endNode = currentHydraulicResult.nodes.get(pipe.endNodeId);

      document.getElementById('btn-tabMap')?.click();

      if (startNode && endNode) {
        const midLat = (startNode.lat + endNode.lat) / 2;
        const midLng = (startNode.lng + endNode.lng) / 2;
        MapManager.panToNode(midLat, midLng, 17);
      }

      MapManager.highlightPipe(pipe.id);
      UIController.showPipeDetailCard(pipe, calc, startNode, endNode);
    }
  }

  /**
   * Perbarui Grafik Profil
   */
  function refreshProfileChart() {
    if (networkData && currentHydraulicResult) {
      const sequenceSteps = HydraulicEngine.buildSequentialNetworkFlow(
        networkData,
        currentHydraulicResult.nodes,
        currentHydraulicResult.pipes,
        sourceConfig
      );
      ChartController.renderProfileChart('profileChartCanvas', networkData, currentHydraulicResult.nodes, sequenceSteps);
    }
  }

  // Helper Simpan & Muat LocalStorage per Wilayah
  function saveMeasurementsToStorage() {
    try {
      localStorage.setItem(getStorageKey('measurements'), JSON.stringify(nodeMeasurements));
      localStorage.setItem(getStorageKey('demands'), JSON.stringify(userDemands));
      localStorage.setItem(getStorageKey('source'), JSON.stringify(sourceConfig));
    } catch (e) {
      console.error('Gagal menyimpan ke LocalStorage:', e);
    }
  }

  function loadSavedMeasurementsForRegion(regionId, region) {
    try {
      const raw = localStorage.getItem(getStorageKey('measurements', regionId));
      if (raw) {
        nodeMeasurements = JSON.parse(raw);
      } else if (regionId === 'bunihayu') {
        nodeMeasurements = { ...AppConfig.sampleFieldMeasurements };
      } else {
        nodeMeasurements = {};
      }

      const rawDemands = localStorage.getItem(getStorageKey('demands', regionId));
      if (rawDemands) {
        userDemands = JSON.parse(rawDemands);
      } else {
        userDemands = {};
      }

      const rawSource = localStorage.getItem(getStorageKey('source', regionId));
      if (rawSource) {
        sourceConfig = JSON.parse(rawSource);
      } else if (region && region.defaultSource) {
        sourceConfig = JSON.parse(JSON.stringify(region.defaultSource));
      }
    } catch (e) {
      console.error('Gagal membaca LocalStorage:', e);
      nodeMeasurements = {};
    }
  }

  return {
    init,
    savePressure,
    saveInlinePressure,
    deletePressure,
    saveSourceConfig,
    getSourceConfig: () => sourceConfig,
    loadSampleData,
    resetData,
    solveFullNetwork,
    exportToCSV,
    locateNode,
    locatePipe,
    refreshProfileChart,
    onTabActivated,
    switchRegion,
    syncCurrentRegionTelemetry,
    backupCurrentRegionToCloud,
    confirmSaveNetworkToCloud,
    deleteCustomRegionAndRefresh,
    getCurrentRegion,
    getNetworkData: () => networkData,
    // Cache management — digunakan oleh UI untuk force-refresh dari server
    clearTopologyCache,
    forceRefreshTopology: async () => {
      clearTopologyCache(currentRegionId);
      await switchRegion(currentRegionId, true);
    }
  };
})();

// Expose global
window.App = App;

// Jalankan aplikasi saat DOM siap
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
