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
      onBackupTopology: () => backupCurrentRegionToCloud()
    });

    // Setup Mode Switcher (Demand vs Pressure)
    setupModeSwitcher();

    // 3. Inisialisasi Klien Supabase & Realtime Listener
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

    // OPTIMASI PERFORMA TAHAP 2: Stale-While-Revalidate (SWR)
    // 3. Render langsung menggunakan data cache lokal agar instan tanpa lag jaringan
    recalculateAndRender(true);
    
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
   *   2. Supabase Cloud topology (fallback jika cache kosong)
   *   3. Jika keduanya kosong — tampilkan panduan upload manual
   *
   * Catatan: Fetch file JSON bundel dari server DIHAPUS agar aplikasi ringan.
   * Data jaringan wajib diinput manual via Upload JSON atau Supabase Cloud.
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

      networkData = null;
      UIController.showToast("Belum ada data jaringan untuk " + region.name + ", silakan upload JSON.", "warning");
      return;
    } catch (err) {
      networkData = null;
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

    // 7. Simpan lokal saja
    saveCustomRegion(regionId, netName, networkData.nodes.length, networkData.pipes.length);
    saveTopologyToCache(regionId, networkData);
    currentRegionId = regionId;
    try { localStorage.setItem(REGION_STORAGE_KEY, regionId); } catch(e){}

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

    
  }

  /**
   * Muat Skenario Uji Lapangan Awal
   */
  function loadSampleData() {
    nodeMeasurements = generateRealisticSampleMeasurements();
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
