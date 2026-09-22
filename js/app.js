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

    // 4. Deteksi Wilayah Terakhir yang Dibuka Pengguna
    try {
      const savedRegionId = localStorage.getItem(REGION_STORAGE_KEY);
      if (savedRegionId && AppConfig.regions?.some(r => r.id === savedRegionId)) {
        currentRegionId = savedRegionId;
      }
    } catch (e) {}

    // 5. Muat Wilayah Aktif
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
   * Muat Topologi Jaringan Wilayah
   */
  async function loadRegionalTopology(region) {
    try {
      // 1. Periksa apakah ada topologi khusus yang dicadangkan di Supabase
      const cloudTopology = await SupabaseClient.fetchRegionTopology(region.id);
      if (cloudTopology && cloudTopology.nodes && cloudTopology.pipes) {
        console.log(`Memuat topologi ${region.name} dari Supabase Cloud.`);
        networkData = cloudTopology;
      } else {
        // 2. Muat file JSON lokal
        const response = await fetch(region.file);
        if (!response.ok) {
          throw new Error(`Gagal memuat ${region.file} (HTTP ${response.status})`);
        }
        networkData = await response.json();
      }

      // Inisialisasi demand awal dari JSON jika belum diubah
      networkData.nodes.forEach(node => {
        if (userDemands[node.id] === undefined) {
          userDemands[node.id] = Number(node.demand) || 0;
        } else {
          node.demand = userDemands[node.id];
        }
      });

      // Sinkronkan parameter sumber dari data jaringan atau preset wilayah
      initSourceConfigFromNetwork(region);
    } catch (err) {
      console.error(`Gagal memuat data jaringan untuk wilayah ${region.name}:`, err);
      UIController.showToast(`Gagal memuat jaringan ${region.name}: ${err.message}`, 'error');
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
      // Terapkan setting tersimpan ke objek network
      if (networkData.pumps && networkData.pumps.length > 0) {
        networkData.pumps[0].designHead = sourceConfig.pump.head;
        networkData.pumps[0].designFlow = sourceConfig.pump.flow;
        networkData.pumps[0].status = sourceConfig.pump.status;
      }
      const res = networkData.nodes.find(n => n.type === 'reservoir');
      if (res) {
        res.elevation = sourceConfig.reservoir.elevation;
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
   * Tangani JSON kustom yang diunggah pengguna
   */
  function handleCustomJSON(data, fileName = '') {
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

    // 3. Perbarui tampilan judul wilayah & subtitle
    const netName = data.projectName || (fileName ? fileName.replace(/\.json$/i, '') : 'Jaringan Kustom');
    UIController.setActiveRegionDisplay('custom', netName);

    // 4. Update badge sumber
    UIController.updateSourceBadge(sourceConfig);

    // 5. Simpan dan render ulang
    saveMeasurementsToStorage();
    recalculateAndRender();

    // 6. Zoom otomatis ke batas jaringan baru
    setTimeout(() => {
      MapManager.fitNetworkBounds();
    }, 250);

    UIController.showToast(`✅ File JSON "${netName}" (${networkData.nodes.length} Simpul, ${networkData.pipes.length} Pipa) berhasil dimuat!`, 'success');
  }

  /**
   * Hitung Ulang Hidrolika dan Perbarui Semua Komponen UI
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

    // 4. Render Tabel Pipa
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

    // 7. Update Grafik Profil HGL jika terlihat
    refreshProfileChart();
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
      if (networkData.pumps && networkData.pumps.length > 0) {
        networkData.pumps[0].designHead = sourceConfig.pump.head;
        networkData.pumps[0].designFlow = sourceConfig.pump.flow;
        networkData.pumps[0].status = sourceConfig.pump.status;
      }
      const res = networkData.nodes.find(n => n.type === 'reservoir');
      if (res) {
        res.elevation = sourceConfig.reservoir.elevation;
      }
    }

    saveMeasurementsToStorage();
    recalculateAndRender();
    UIController.showToast('Pengaturan sumber hidrolika berhasil disimpan.', 'success');
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
    switchRegion,
    syncCurrentRegionTelemetry,
    backupCurrentRegionToCloud,
    getCurrentRegion,
    getNetworkData: () => networkData
  };
})();

// Expose global
window.App = App;

// Jalankan aplikasi saat DOM siap
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
