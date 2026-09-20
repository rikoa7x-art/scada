/**
 * App - Orkestrasi Aplikasi Utama Monitoring Debit Air SPAM PDAM
 */

const App = (() => {
  let networkData = null;
  let nodeMeasurements = {};
  let userDemands = {};
  let currentMode = 'demand'; // Default: 'demand' (EPANET standard) atau 'pressure' (Manometer Lapangan)
  let currentHydraulicResult = null;

  // Konfigurasi Parameter Sumber (Pompa & Reservoir Gravitasi)
  let sourceConfig = {
    systemMode: 'pump', // 'pump' (Sistem Pemompaan) atau 'gravity' (Sistem Gravitasi)
    pump: {
      id: 'c49cf912-b713-48a7-93a8-3164489b9471',
      label: 'PMP4',
      head: 50.0,
      flow: 10.0,
      flowUnit: 'lps',
      status: 'on'
    },
    reservoir: {
      id: 'f56c2b53-7035-4e95-94f1-fe2e32925299',
      label: 'R4',
      elevation: 535.0,
      flow: 10.0,
      flowUnit: 'lps'
    }
  };

  const STORAGE_KEY = 'pdam_spam_measurements_v1';
  const DEMAND_STORAGE_KEY = 'pdam_spam_demands_v1';
  const SOURCE_STORAGE_KEY = 'pdam_spam_source_config_v1';

  /**
   * Inisialisasi Aplikasi saat Dokumen Siap
   */
  async function init() {
    // 1. Inisialisasi Peta
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
      onSaveSourceConfig: saveSourceConfig
    });

    // Setup Mode Switcher (Demand vs Pressure)
    setupModeSwitcher();

    // 3. Muat Pengukuran, Demand, dan Setting Sumber dari LocalStorage
    loadSavedMeasurements();

    // 4. Muat Data Topologi Pipa dari epanet_bunihayu.json
    await loadNetworkData();
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
   * Muat file epanet_bunihayu.json
   */
  async function loadNetworkData() {
    try {
      const response = await fetch('epanet_bunihayu.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      networkData = await response.json();

      // Inisialisasi demand awal dari JSON jika belum ada di storage
      networkData.nodes.forEach(node => {
        if (userDemands[node.id] === undefined) {
          userDemands[node.id] = Number(node.demand) || 0;
        }
      });

      // Inisialisasi parameter sumber dari JSON jika belum ada di storage
      if (!localStorage.getItem(SOURCE_STORAGE_KEY)) {
        if (networkData.pumps && networkData.pumps.length > 0) {
          const p = networkData.pumps[0];
          sourceConfig.pump.head = Number(p.designHead) || 50;
          sourceConfig.pump.flow = Number(p.designFlow) || 10;
          sourceConfig.pump.status = p.status || 'on';
        }
        const res = networkData.nodes.find(n => n.type === 'reservoir');
        if (res) {
          sourceConfig.reservoir.elevation = Number(res.elevation) || 535;
        }
      } else {
        // Sinkronkan data JSON dengan setting yang tersimpan di storage
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

      recalculateAndRender();
      setTimeout(() => MapManager.fitNetworkBounds(), 300);
    } catch (err) {
      console.warn('Gagal memuat epanet_bunihayu.json via fetch, mencoba menggunakan data bawaan:', err);
      alert('Informasi: Membuka aplikasi lewat HTTP Server (jalankan run_app.py atau start_app.bat) sangat disarankan untuk memuat data JSON secara otomatis.');
    }
  }

  /**
   * Tangani JSON kustom yang diunggah pengguna
   */
  function handleCustomJSON(data) {
    if (!data.nodes || !data.pipes) {
      alert('Format JSON tidak sesuai: Harus memiliki array "nodes" dan "pipes".');
      return;
    }
    networkData = data;
    nodeMeasurements = {};
    userDemands = {};
    saveMeasurementsToStorage();
    recalculateAndRender();
    MapManager.fitNetworkBounds();
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
      currentHydraulicResult = HydraulicEngine.solveNetworkHydraulics(networkData, nodeMeasurements, sourceConfig);
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
  }

  /**
   * Simpan Tekanan dan Demand pada Junction
   */
  function saveNodeData(nodeId, pressure, unit = 'bar', demand = 0) {
    userDemands[nodeId] = Number(demand);

    if (pressure !== null && !isNaN(pressure)) {
      nodeMeasurements[nodeId] = {
        pressure: Number(pressure),
        unit: unit,
        timestamp: new Date().toISOString()
      };
    }

    saveMeasurementsToStorage();
    recalculateAndRender();
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
   * Hapus Tekanan pada Junction
   */
  function deletePressure(nodeId) {
    delete nodeMeasurements[nodeId];
    saveMeasurementsToStorage();
    recalculateAndRender();
  }

  /**
   * Muat Skenario Uji Lapangan Awal
   */
  function loadSampleData() {
    nodeMeasurements = { ...AppConfig.sampleFieldMeasurements };
    saveMeasurementsToStorage();
    recalculateAndRender();
  }

  /**
   * Reset Semua Pengukuran Lapangan
   */
  function resetData() {
    if (confirm('Apakah Anda yakin ingin menghapus semua data tekanan lapangan yang telah diinput?')) {
      nodeMeasurements = {};
      saveMeasurementsToStorage();
      recalculateAndRender();
    }
  }

  /**
   * Jalankan Simulasi Jaringan Penuh (Estimasi titik yang belum terukur)
   */
  function solveFullNetwork() {
    if (!networkData) return;
    // Jika belum ada titik yang diukur, tawarkan muat data uji
    const measuredCount = Object.keys(nodeMeasurements).length;
    if (measuredCount === 0) {
      if (confirm('Belum ada data tekanan yang diinput. Ingin memuat data uji lapangan untuk melihat simulasi lengkap?')) {
        loadSampleData();
        return;
      }
    }
    recalculateAndRender();
    alert('Simulasi hidrolika jaringan telah diperbarui.');
  }

  /**
   * Ekspor Hasil Pengukuran dan Debit ke CSV
   */
  function exportToCSV() {
    if (!networkData || !currentHydraulicResult) return;

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += '=== LAPORAN MONITORING DEBIT AIR SPAM PDAM ===\n';
    csvContent += `Proyek: ${networkData.projectName || 'SPAM Bunihayu'}\n`;
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
    link.setAttribute('download', `Laporan_Debit_SPAM_${new Date().toISOString().slice(0, 10)}.csv`);
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
      MapManager.panToNode(node.lat, node.lng, 18);
      // Buka modal input juga jika junction
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

      // Pindah ke tab peta jika sedang di tab lain
      document.getElementById('btn-tabMap')?.click();

      // Zoom ke titik tengah pipa
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
      ChartController.renderProfileChart('profileChartCanvas', networkData, currentHydraulicResult.nodes);
    }
  }

  // Helper Simpan & Muat LocalStorage
  function saveMeasurementsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nodeMeasurements));
      localStorage.setItem(DEMAND_STORAGE_KEY, JSON.stringify(userDemands));
      localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(sourceConfig));
    } catch (e) {
      console.error('Gagal menyimpan ke LocalStorage:', e);
    }
  }

  function loadSavedMeasurements() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        nodeMeasurements = JSON.parse(raw);
      } else {
        // Default awal: muat sample data agar pengguna langsung dapat melihat visualisasinya
        nodeMeasurements = { ...AppConfig.sampleFieldMeasurements };
      }

      const rawDemands = localStorage.getItem(DEMAND_STORAGE_KEY);
      if (rawDemands) {
        userDemands = JSON.parse(rawDemands);
      }

      const rawSource = localStorage.getItem(SOURCE_STORAGE_KEY);
      if (rawSource) {
        sourceConfig = JSON.parse(rawSource);
      }
    } catch (e) {
      console.error('Gagal membaca LocalStorage:', e);
      nodeMeasurements = { ...AppConfig.sampleFieldMeasurements };
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
    getNetworkData: () => networkData
  };
})();

// Jalankan aplikasi saat DOM siap
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
