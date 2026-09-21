/**
 * UIController - Manajemen Tampilan, Modal Input Tekanan, Tabel, dan Ekspor Laporan
 */

const UIController = (() => {
  let activeNode = null;
  let onSavePressureCallback = null;
  let onDeletePressureCallback = null;
  let onSaveSourceConfigCallback = null;
  let currentSourceConfig = null;

  // Cache data jaringan untuk fitur pencarian & render ulang di mobile
  let cachedNetworkData = null;
  let cachedNodesMap = null;
  let cachedPipesMap = null;
  let cachedSequenceSteps = null;

  let junctionSearchTerm = '';
  let junctionFilterStatus = 'all';

  let pipeSearchTerm = '';
  let pipeFilterStatus = 'all';

  let pipeViewMode = window.innerWidth < 768 ? 'card' : 'table';
  let sequenceViewMode = window.innerWidth < 768 ? 'card' : 'table';

  /**
   * Inisialisasi Event Listener UI
   */
  function init({ 
    onSavePressure, 
    onDeletePressure, 
    onResetData, 
    onLoadSampleData, 
    onSolveNetwork, 
    onExportCSV, 
    onUploadJSON, 
    onSaveSourceConfig,
    onSelectRegion,
    onSyncCloud,
    onBackupTopology
  }) {
    onSavePressureCallback = onSavePressure;
    onDeletePressureCallback = onDeletePressure;
    onSaveSourceConfigCallback = onSaveSourceConfig;

    // Pemilih Wilayah SPAM (Desktop & Mobile)
    const selectRegion = document.getElementById('selectRegion');
    const selectRegionMobile = document.getElementById('selectRegionMobile');

    if (selectRegion) {
      selectRegion.addEventListener('change', (e) => {
        const val = e.target.value;
        if (selectRegionMobile) selectRegionMobile.value = val;
        if (onSelectRegion) onSelectRegion(val);
      });
    }

    if (selectRegionMobile) {
      selectRegionMobile.addEventListener('change', (e) => {
        const val = e.target.value;
        if (selectRegion) selectRegion.value = val;
        document.getElementById('mobileActionMenu')?.classList.add('hidden');
        if (onSelectRegion) onSelectRegion(val);
      });
    }

    // Tombol Cloud Sync & Status
    document.getElementById('btnSyncCloud')?.addEventListener('click', () => {
      if (onSyncCloud) onSyncCloud();
    });
    document.getElementById('btnSyncCloudMobile')?.addEventListener('click', () => {
      document.getElementById('mobileActionMenu')?.classList.add('hidden');
      if (onSyncCloud) onSyncCloud();
    });
    document.getElementById('btnCloudStatus')?.addEventListener('click', () => {
      if (onSyncCloud) onSyncCloud();
    });

    // Tombol Backup Topologi ke Cloud (Desktop & Mobile)
    document.getElementById('btnBackupCloud')?.addEventListener('click', () => {
      if (onBackupTopology) onBackupTopology();
    });
    document.getElementById('btnSaveTopologyCloudMobile')?.addEventListener('click', () => {
      document.getElementById('mobileActionMenu')?.classList.add('hidden');
      if (onBackupTopology) onBackupTopology();
    });

    // Tombol di Header / Toolbar
    document.getElementById('btnLoadSample')?.addEventListener('click', onLoadSampleData);
    document.getElementById('btnResetData')?.addEventListener('click', onResetData);
    document.getElementById('btnSolveNetwork')?.addEventListener('click', onSolveNetwork);
    document.getElementById('btnExportCSV')?.addEventListener('click', onExportCSV);
    document.getElementById('btnPrintReport')?.addEventListener('click', printReport);
    document.getElementById('btnFitMap')?.addEventListener('click', () => MapManager.fitNetworkBounds());

    // Tombol Floating Map Mobile: Fit Bounds & GPS Lokasi Lapangan
    document.getElementById('btnMobileFitMap')?.addEventListener('click', () => {
      MapManager.fitNetworkBounds();
      showToast('🗺️ Peta dipusatkan ke seluruh jaringan', 'info');
    });
    document.getElementById('btnMobileGps')?.addEventListener('click', () => {
      MapManager.locateUser();
    });

    // Tombol Modal Pengaturan Sumber (Pompa & Gravitasi)
    document.getElementById('btnSourceSettings')?.addEventListener('click', () => openSourceSettingsModal());
    document.getElementById('btnCloseSourceModal')?.addEventListener('click', closeSourceSettingsModal);
    document.getElementById('btnSaveSourceModal')?.addEventListener('click', saveSourceSettingsFromModal);
    document.getElementById('btnResetSourceModal')?.addEventListener('click', resetSourceSettingsModal);

    // Live preview event listeners pada input modal sumber
    const liveSourceInputs = [
      'modalPumpHead', 'modalPumpFlow', 'modalPumpFlowUnit',
      'modalPumpStatus', 'modalReservoirFlow', 'modalReservoirFlowUnit',
      'modalReservoirElev'
    ];
    liveSourceInputs.forEach(id => {
      const el = document.getElementById(id);
      el?.addEventListener('input', updateSourceModalPreview);
      el?.addEventListener('change', updateSourceModalPreview);
    });

    // Radio switcher mode sistem (Pompa vs Gravitasi)
    document.querySelectorAll('input[name="modalSystemMode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        updateSourceModalModeUI(e.target.value);
        updateSourceModalPreview();
      });
    });

    // Layer Switcher Dropdown / Buttons
    document.getElementById('selectBaseLayer')?.addEventListener('change', (e) => {
      MapManager.switchBaseLayer(e.target.value);
    });

    // Switcher Satuan Label Debit Pipa pada Peta GIS
    const selectFlowUnit = document.getElementById('selectPipeFlowUnit');
    if (selectFlowUnit) {
      try {
        const savedFlowUnit = localStorage.getItem('pdam_spam_flow_label_unit') || 'lps';
        selectFlowUnit.value = savedFlowUnit;
        MapManager.setFlowLabelMode(savedFlowUnit);
      } catch (err) {
        console.warn('Gagal membaca preferensi label debit:', err);
      }

      selectFlowUnit.addEventListener('change', (e) => {
        const mode = e.target.value;
        MapManager.setFlowLabelMode(mode);
        try {
          localStorage.setItem('pdam_spam_flow_label_unit', mode);
        } catch (err) {
          console.warn('Gagal menyimpan preferensi label debit:', err);
        }
      });
    }

    // Upload JSON Kustom (Desktop)
    const fileInput = document.getElementById('inputJsonFile');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            try {
              const data = JSON.parse(event.target.result);
              if (onUploadJSON) onUploadJSON(data, file.name);
            } catch (err) {
              alert('File JSON tidak valid: ' + err.message);
            }
          };
          reader.readAsText(file);
          e.target.value = '';
        }
      });
    }

    // =========================================================
    // MOBILE UI CONTROLS & LISTENERS
    // =========================================================

    // Mobile Action Menu Drawer Toggle & Close
    const btnMobileMenu = document.getElementById('btnMobileMenuToggle');
    const mobileActionMenu = document.getElementById('mobileActionMenu');
    btnMobileMenu?.addEventListener('click', () => {
      mobileActionMenu?.classList.remove('hidden');
    });
    document.getElementById('btnCloseMobileMenu')?.addEventListener('click', () => {
      mobileActionMenu?.classList.add('hidden');
    });
    document.getElementById('btnCloseMobileMenuBtn')?.addEventListener('click', () => {
      mobileActionMenu?.classList.add('hidden');
    });
    mobileActionMenu?.addEventListener('click', (e) => {
      if (e.target === mobileActionMenu) {
        mobileActionMenu.classList.add('hidden');
      }
    });

    // Mobile BaseLayer Selector Sync
    const selectBaseMobile = document.getElementById('selectBaseLayerMobile');
    if (selectBaseMobile) {
      selectBaseMobile.addEventListener('change', (e) => {
        MapManager.switchBaseLayer(e.target.value);
        const desktopSelect = document.getElementById('selectBaseLayer');
        if (desktopSelect) desktopSelect.value = e.target.value;
        mobileActionMenu?.classList.add('hidden');
      });
    }

    // Mobile Action Buttons
    document.getElementById('btnLoadSampleMobile')?.addEventListener('click', () => {
      mobileActionMenu?.classList.add('hidden');
      if (onLoadSampleData) onLoadSampleData();
    });
    document.getElementById('btnResetDataMobile')?.addEventListener('click', () => {
      mobileActionMenu?.classList.add('hidden');
      if (onResetData) onResetData();
    });
    document.getElementById('btnExportCSVMobile')?.addEventListener('click', () => {
      mobileActionMenu?.classList.add('hidden');
      if (onExportCSV) onExportCSV();
    });
    document.getElementById('btnPrintReportMobile')?.addEventListener('click', () => {
      mobileActionMenu?.classList.add('hidden');
      window.print();
    });

    // Mobile Upload JSON
    const fileInputMobile = document.getElementById('inputJsonFileMobile');
    if (fileInputMobile) {
      fileInputMobile.addEventListener('change', (e) => {
        mobileActionMenu?.classList.add('hidden');
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            try {
              const data = JSON.parse(event.target.result);
              if (onUploadJSON) onUploadJSON(data, file.name);
            } catch (err) {
              alert('File JSON tidak valid: ' + err.message);
            }
          };
          reader.readAsText(file);
          e.target.value = '';
        }
      });
    }

    // Mobile Sidebar Drawer Toggle & Close + Backdrop
    const btnToggleMobileSidebar = document.getElementById('btnToggleMobileSidebar');
    const btnCloseMobileSidebar = document.getElementById('btnCloseMobileSidebar');
    const sidebarContainer = document.getElementById('sidebarJunctionsContainer');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');

    const openMobileSidebar = () => {
      sidebarContainer?.classList.remove('hidden');
      sidebarContainer?.classList.add('flex');
      sidebarBackdrop?.classList.add('active');
      btnToggleMobileSidebar?.classList.add('hidden');
      setTimeout(() => {
        MapManager.getMap()?.invalidateSize();
      }, 200);
    };

    const closeMobileSidebar = () => {
      sidebarContainer?.classList.add('hidden');
      sidebarContainer?.classList.remove('flex');
      sidebarBackdrop?.classList.remove('active');
      btnToggleMobileSidebar?.classList.remove('hidden');
      setTimeout(() => {
        MapManager.getMap()?.invalidateSize();
      }, 200);
    };

    btnToggleMobileSidebar?.addEventListener('click', openMobileSidebar);
    btnCloseMobileSidebar?.addEventListener('click', closeMobileSidebar);
    sidebarBackdrop?.addEventListener('click', closeMobileSidebar);

    // Backdrop Kartu Detail Pipa
    const pipeDetailBackdrop = document.getElementById('pipeDetailBackdrop');
    pipeDetailBackdrop?.addEventListener('click', () => {
      document.getElementById('pipeDetailCard')?.classList.add('hidden');
      pipeDetailBackdrop?.classList.remove('active');
    });

    // Backdrop Click to Dismiss pada Modals
    const pressureModal = document.getElementById('pressureModal');
    pressureModal?.addEventListener('click', (e) => {
      if (e.target === pressureModal) {
        closePressureModal();
      }
    });

    const sourceModal = document.getElementById('sourceSettingsModal');
    sourceModal?.addEventListener('click', (e) => {
      if (e.target === sourceModal) {
        closeSourceSettingsModal();
      }
    });

    // Setup Pencarian & Filter Simpul Junction di Sidebar
    setupJunctionFilters();

    // Setup Tampilan Switcher Tab 2 & Tab 3
    setupViewSwitchers();

    // Modal Form Events (Tekanan Junction)
    document.getElementById('btnSavePressureModal')?.addEventListener('click', savePressureFromModal);
    document.getElementById('btnDeletePressureModal')?.addEventListener('click', deletePressureFromModal);
    document.getElementById('btnClosePressureModal')?.addEventListener('click', closePressureModal);
    document.getElementById('modalPressureInput')?.addEventListener('input', updateModalHeadPreview);
    document.getElementById('modalPressureUnit')?.addEventListener('change', updateModalHeadPreview);

    // Tab Switcher (Peta, Tabel Pipa, Profil Hidrolis)
    setupTabs();

    // Toggle Sembunyikan / Buka Dashboard Informasi (Mode EPANET & KPI Strip)
    setupDashboardToggle();

    // Tombol Layar Penuh (Fullscreen Map)
    setupMapFullscreen();
  }

  /**
   * Setup Filter & Pencarian Cepat Junction di Sidebar
   */
  function setupJunctionFilters() {
    const inputSearch = document.getElementById('inputSearchJunctions');
    const btnClear = document.getElementById('btnClearJunctionSearch');
    const filterPills = document.querySelectorAll('#sidebarJunctionsContainer .filter-pill, [data-junction-filter], [data-filter]');

    inputSearch?.addEventListener('input', (e) => {
      junctionSearchTerm = e.target.value.toLowerCase().trim();
      if (btnClear) {
        btnClear.classList.toggle('hidden', !junctionSearchTerm);
      }
      reRenderJunctionsSidebar();
    });

    btnClear?.addEventListener('click', () => {
      if (inputSearch) inputSearch.value = '';
      junctionSearchTerm = '';
      btnClear.classList.add('hidden');
      reRenderJunctionsSidebar();
    });

    filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        filterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        junctionFilterStatus = pill.getAttribute('data-junction-filter') || pill.getAttribute('data-filter') || 'all';
        reRenderJunctionsSidebar();
      });
    });
  }

  /**
   * Re-render daftar junction di sidebar menggunakan cache
   */
  function reRenderJunctionsSidebar() {
    if (cachedNetworkData && cachedNodesMap) {
      renderJunctionsSidebarTable(cachedNetworkData, cachedNodesMap, currentSourceConfig);
    }
  }

  /**
   * Setup Segmented View Switchers (Card vs Table) untuk Tab 2 & Tab 3 serta Filter Pipa
   */
  function setupViewSwitchers() {
    // -------------------------------------------------------------
    // Tab 2: Tabel Monitoring Pipa (Card View vs Full Table)
    // -------------------------------------------------------------
    const btnViewPipesCard = document.getElementById('btnViewPipesCard');
    const btnViewPipesTable = document.getElementById('btnViewPipesTable');
    const desktopPipesTable = document.getElementById('desktopPipesTableContainer');
    const mobilePipesCard = document.getElementById('mobilePipesCardContainer');

    function setPipeView(mode) {
      pipeViewMode = mode;
      btnViewPipesCard?.classList.toggle('active', mode === 'card');
      btnViewPipesTable?.classList.toggle('active', mode === 'table');

      if (mode === 'card') {
        mobilePipesCard?.classList.remove('hidden');
        desktopPipesTable?.classList.add('hidden');
      } else {
        desktopPipesTable?.classList.remove('hidden');
        mobilePipesCard?.classList.add('hidden');
      }
    }

    btnViewPipesCard?.addEventListener('click', () => setPipeView('card'));
    btnViewPipesTable?.addEventListener('click', () => setPipeView('table'));

    // Default mode: Card pada layar kecil (<768px), Table pada desktop
    if (window.innerWidth < 768) {
      setPipeView('card');
    } else {
      setPipeView('table');
    }

    // Pencarian & Filter Pipa Tab 2
    const inputSearchPipes = document.getElementById('inputSearchPipes');
    const btnClearPipeSearch = document.getElementById('btnClearPipeSearch');
    const pipeFilterPills = document.querySelectorAll('[data-pipe-filter]');

    inputSearchPipes?.addEventListener('input', (e) => {
      pipeSearchTerm = e.target.value.toLowerCase().trim();
      if (btnClearPipeSearch) {
        btnClearPipeSearch.classList.toggle('hidden', !pipeSearchTerm);
      }
      reRenderPipesTable();
    });

    btnClearPipeSearch?.addEventListener('click', () => {
      if (inputSearchPipes) inputSearchPipes.value = '';
      pipeSearchTerm = '';
      btnClearPipeSearch.classList.add('hidden');
      reRenderPipesTable();
    });

    pipeFilterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        pipeFilterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        pipeFilterStatus = pill.getAttribute('data-pipe-filter') || 'all';
        reRenderPipesTable();
      });
    });

    // -------------------------------------------------------------
    // Tab 3: Alur Berurutan (Flow Step Journey vs Full Table)
    // -------------------------------------------------------------
    const btnViewSeqCard = document.getElementById('btnViewSequenceCard');
    const btnViewSeqTable = document.getElementById('btnViewSequenceTable');
    const desktopSeqTable = document.getElementById('desktopSequenceTableContainer');
    const mobileSeqFlow = document.getElementById('mobileSequenceFlowContainer');

    function setSequenceView(mode) {
      sequenceViewMode = mode;
      btnViewSeqCard?.classList.toggle('active', mode === 'card');
      btnViewSeqTable?.classList.toggle('active', mode === 'table');

      if (mode === 'card') {
        mobileSeqFlow?.classList.remove('hidden');
        desktopSeqTable?.classList.add('hidden');
      } else {
        desktopSeqTable?.classList.remove('hidden');
        mobileSeqFlow?.classList.add('hidden');
      }
    }

    btnViewSeqCard?.addEventListener('click', () => setSequenceView('card'));
    btnViewSeqTable?.addEventListener('click', () => setSequenceView('table'));

    if (window.innerWidth < 768) {
      setSequenceView('card');
    } else {
      setSequenceView('table');
    }
  }

  /**
   * Re-render tabel & kartu pipa dari cache
   */
  function reRenderPipesTable() {
    if (cachedNetworkData && cachedNodesMap && cachedPipesMap) {
      renderPipesTable(cachedNetworkData, cachedNodesMap, cachedPipesMap);
    }
  }

  /**
   * Buka Kartu Detail Pipa berdasarkan ID pipa (shortcut dari Card View Tab 2 / Tab 3)
   */
  function showPipeDetailCardFromId(pipeId) {
    if (!cachedNetworkData || !cachedNodesMap || !cachedPipesMap) return;
    const pipe = cachedNetworkData.pipes.find(p => p.id === pipeId);
    if (!pipe) return;
    const calc = cachedPipesMap.get(pipeId)?.calculation;
    const startNode = cachedNodesMap.get(pipe.startNodeId);
    const endNode = cachedNodesMap.get(pipe.endNodeId);
    showPipeDetailCard(pipe, calc, startNode, endNode);
  }

  /**
   * Buka Modal Input Tekanan berdasarkan ID simpul (shortcut dari Kartu Detail & Journey)
   */
  function openPressureModalForNodeId(nodeId) {
    if (!cachedNetworkData || !cachedNodesMap) return;
    const node = cachedNetworkData.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const nodeState = cachedNodesMap.get(nodeId);
    openPressureModal(node, nodeState);
  }

  /**
   * Setup Navigasi Tab (Peta, Tabel Monitoring, Alur Berurutan, Profil HGL) - Desktop & Mobile Sync
   */
  function setupTabs() {
    const tabs = ['tabMap', 'tabTable', 'tabSequence', 'tabProfile'];
    const mobileBtnMap = {
      'tabMap': 'btnMobileTabMap',
      'tabTable': 'btnMobileTabTable',
      'tabSequence': 'btnMobileTabSequence',
      'tabProfile': 'btnMobileTabProfile'
    };

    function activateTab(tabId) {
      tabs.forEach(t => {
        const el = document.getElementById(t);
        const b = document.getElementById(`btn-${t}`);
        const mb = document.getElementById(mobileBtnMap[t]);

        if (t === tabId) {
          el?.classList.remove('hidden');
          b?.classList.add('bg-blue-600', 'text-white');
          b?.classList.remove('text-slate-600', 'hover:bg-slate-100');
          if (mb) {
            mb.classList.add('text-blue-600', 'font-bold');
            mb.classList.remove('text-slate-500', 'hover:text-slate-800', 'font-medium');
          }
        } else {
          el?.classList.add('hidden');
          b?.classList.remove('bg-blue-600', 'text-white');
          b?.classList.add('text-slate-600', 'hover:bg-slate-100');
          if (mb) {
            mb.classList.remove('text-blue-600', 'font-bold');
            mb.classList.add('text-slate-500', 'hover:text-slate-800', 'font-medium');
          }
        }
      });

      // Refresh map atau chart saat tab aktif
      if (tabId === 'tabMap') {
        setTimeout(() => {
          MapManager.getMap()?.invalidateSize();
        }, 150);
      } else if (tabId === 'tabProfile') {
        App.refreshProfileChart();
      }
    }

    tabs.forEach(tabId => {
      document.getElementById(`btn-${tabId}`)?.addEventListener('click', () => activateTab(tabId));
      document.getElementById(mobileBtnMap[tabId])?.addEventListener('click', () => activateTab(tabId));
    });
  }

  let isDashboardCollapsed = false;

  /**
   * Fungsi Toggle Dashboard (Bisa dipanggil dari event listener atau inline onclick HTML)
   */
  function toggleDashboard() {
    setDashboardCollapsed(!isDashboardCollapsed, true);
  }

  /**
   * Set Status Collapsed / Expanded Dashboard secara pasti
   */
  function setDashboardCollapsed(collapsed, triggerResize = true) {
    isDashboardCollapsed = !!collapsed;
    const container = document.getElementById('collapsibleDashboard');
    const btnToggle = document.getElementById('btnToggleDashboard');
    const btnHeaderToggle = document.getElementById('btnHeaderToggleDashboard');
    const chevron = document.getElementById('toggleDashboardChevron');
    const headerChevron = document.getElementById('headerToggleDashIcon');
    const textLabel = document.getElementById('toggleDashboardText');
    const miniKpi = document.getElementById('toggleDashboardMiniKpi');
    const mobileStatusLabel = document.getElementById('labelDashboardStatusMobile');

    if (!container) return;

    if (isDashboardCollapsed) {
      // Sembunyikan secara pasti dengan display: none dan class is-collapsed
      container.style.display = 'none';
      container.classList.add('is-collapsed');
      btnToggle?.classList.add('active-glow');
      chevron?.classList.add('rotate-180');
      headerChevron?.classList.add('rotate-180');
      if (textLabel) textLabel.textContent = 'Buka Info';
      miniKpi?.classList.remove('hidden');
      if (mobileStatusLabel) {
        mobileStatusLabel.textContent = 'Tersembunyi';
        mobileStatusLabel.className = 'text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-md font-bold';
      }
    } else {
      // Tampilkan kembali
      container.style.display = '';
      container.classList.remove('is-collapsed');
      btnToggle?.classList.remove('active-glow');
      chevron?.classList.remove('rotate-180');
      headerChevron?.classList.remove('rotate-180');
      if (textLabel) textLabel.textContent = 'Sembunyikan Info';
      miniKpi?.classList.add('hidden');
      if (mobileStatusLabel) {
        mobileStatusLabel.textContent = 'Terbuka';
        mobileStatusLabel.className = 'text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md font-bold';
      }
    }

    try {
      localStorage.setItem('pdam_spam_dashboard_collapsed', isDashboardCollapsed ? 'true' : 'false');
    } catch (e) {
      console.warn('Gagal menyimpan status dashboard:', e);
    }

    if (triggerResize) {
      setTimeout(() => MapManager.getMap()?.invalidateSize(), 50);
      setTimeout(() => MapManager.getMap()?.invalidateSize(), 180);
      setTimeout(() => MapManager.getMap()?.invalidateSize(), 350);
    }
  }

  /**
   * Setup Fitur Sembunyikan / Tampilkan Dashboard Informasi (Mode EPANET & KPI Strip)
   */
  function setupDashboardToggle() {
    const STORAGE_KEY = 'pdam_spam_dashboard_collapsed';
    let initCollapsed = false;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        initCollapsed = saved === 'true';
      } else {
        // Default di mobile (< 768px): sembunyikan dashboard agar peta langsung luas dan nyaman
        initCollapsed = window.innerWidth < 768;
      }
    } catch (e) {
      initCollapsed = window.innerWidth < 768;
    }

    // Terapkan kondisi awal
    setDashboardCollapsed(initCollapsed, false);

    // Event Listener Klik
    const btnToggle = document.getElementById('btnToggleDashboard');
    const btnHeaderToggle = document.getElementById('btnHeaderToggleDashboard');
    const btnMobileToggle = document.getElementById('btnToggleDashboardMobileMenu');

    btnToggle?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleDashboard();
    });

    btnHeaderToggle?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleDashboard();
    });

    btnMobileToggle?.addEventListener('click', (e) => {
      e.preventDefault();
      toggleDashboard();
      document.getElementById('mobileActionMenu')?.classList.add('hidden');
    });

    // Handle perputaran layar HP (orientasi berubah)
    window.addEventListener('resize', () => {
      setTimeout(() => MapManager.getMap()?.invalidateSize(), 200);
    });
  }

  /**
   * Setup Tombol Layar Penuh (Fullscreen Map)
   */
  function setupMapFullscreen() {
    const btnFullscreen = document.getElementById('btnMapFullscreen');
    if (!btnFullscreen) return;

    btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) {
          docEl.requestFullscreen().catch(() => {});
        } else if (docEl.webkitRequestFullscreen) {
          docEl.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
      setTimeout(() => MapManager.getMap()?.invalidateSize(), 200);
    });

    document.addEventListener('fullscreenchange', () => {
      setTimeout(() => MapManager.getMap()?.invalidateSize(), 200);
    });
    document.addEventListener('webkitfullscreenchange', () => {
      setTimeout(() => MapManager.getMap()?.invalidateSize(), 200);
    });
  }

  /**
   * Update visual pemilihan mode sistem (Pompa vs Gravitasi)
   */
  function updateSourceModalModeUI(mode) {
    const cardPump = document.getElementById('optModePumpCard');
    const cardGravity = document.getElementById('optModeGravityCard');
    const sectionPump = document.getElementById('sectionPumpSettings');
    const sectionReservoir = document.getElementById('sectionReservoirSettings');

    if (mode === 'gravity') {
      cardGravity?.classList.add('border-blue-600', 'bg-blue-50/70');
      cardGravity?.classList.remove('border-slate-200', 'bg-white');
      cardPump?.classList.remove('border-indigo-600', 'bg-indigo-50/50');
      cardPump?.classList.add('border-slate-200', 'bg-white');

      if (sectionPump) {
        sectionPump.classList.add('opacity-60');
      }
      if (sectionReservoir) {
        sectionReservoir.classList.remove('opacity-60');
        sectionReservoir.classList.add('ring-2', 'ring-blue-500/40');
      }
    } else {
      cardPump?.classList.add('border-indigo-600', 'bg-indigo-50/50');
      cardPump?.classList.remove('border-slate-200', 'bg-white');
      cardGravity?.classList.remove('border-blue-600', 'bg-blue-50/70');
      cardGravity?.classList.add('border-slate-200', 'bg-white');

      if (sectionPump) {
        sectionPump.classList.remove('opacity-60');
        sectionPump.classList.add('ring-2', 'ring-indigo-500/40');
      }
      if (sectionReservoir) {
        sectionReservoir.classList.remove('opacity-60', 'ring-2', 'ring-blue-500/40');
      }
    }
  }

  /**
   * Update Preview Kalkulasi Total Head & Daya Pompa di Modal secara real-time
   */
  function updateSourceModalPreview() {
    const isGravity = document.getElementById('optModeGravity')?.checked;
    const pumpStatus = document.getElementById('modalPumpStatus')?.value || 'on';
    const isPumpActive = !isGravity && (pumpStatus !== 'off');

    const resElev = parseFloat(document.getElementById('modalReservoirElev')?.value) || 535;
    const pumpHead = parseFloat(document.getElementById('modalPumpHead')?.value) || 0;
    
    let pumpFlow = parseFloat(document.getElementById('modalPumpFlow')?.value) || 0;
    if (document.getElementById('modalPumpFlowUnit')?.value === 'm3h') {
      pumpFlow = pumpFlow / 3.6;
    }

    const outletHead = isPumpActive ? (resElev + pumpHead) : resElev;
    const previewOutlet = document.getElementById('previewPumpOutletHead');
    if (previewOutlet) {
      previewOutlet.textContent = `${outletHead.toFixed(1)} m dpl ${!isPumpActive ? '(Bypass Gravitasi: +0m)' : `(+${pumpHead.toFixed(1)}m Pompa)`}`;
    }

    const previewPower = document.getElementById('previewPumpPower');
    if (previewPower) {
      if (isPumpActive && pumpFlow > 0 && pumpHead > 0) {
        // Daya hidrolis P = 9.81 * (Q_lps / 1000) * H in kW
        const powerKW = 9.81 * (pumpFlow / 1000.0) * pumpHead;
        const powerHP = powerKW * 1.34102;
        previewPower.textContent = `${powerKW.toFixed(2)} kW (${powerHP.toFixed(1)} HP)`;
      } else {
        previewPower.textContent = `0.0 kW (Non-Aktif)`;
      }
    }

    const previewGravity = document.getElementById('previewGravityHeadDrop');
    if (previewGravity) {
      const drop = resElev - 496; // 496m elevasi terendah di J49
      const barEst = drop / 10.19716;
      previewGravity.textContent = `Δz = ${drop.toFixed(1)} meter (Potensi Tekanan Alami Gravitasi: ${barEst.toFixed(2)} bar)`;
    }
  }

  /**
   * Buka Modal Pengaturan Sumber (Pompa & Gravitasi)
   */
  function openSourceSettingsModal(focusTarget = 'pump') {
    const modal = document.getElementById('sourceSettingsModal');
    if (!modal) return;

    if (currentSourceConfig) {
      const mode = currentSourceConfig.systemMode || 'pump';
      if (mode === 'gravity') {
        const rad = document.getElementById('optModeGravity');
        if (rad) rad.checked = true;
      } else {
        const rad = document.getElementById('optModePump');
        if (rad) rad.checked = true;
      }
      updateSourceModalModeUI(mode);

      const pumpHeadEl = document.getElementById('modalPumpHead');
      const pumpFlowEl = document.getElementById('modalPumpFlow');
      const pumpStatusEl = document.getElementById('modalPumpStatus');
      const pumpUnitEl = document.getElementById('modalPumpFlowUnit');

      if (pumpHeadEl) pumpHeadEl.value = currentSourceConfig.pump?.head ?? 50;
      if (pumpFlowEl) pumpFlowEl.value = currentSourceConfig.pump?.flow ?? 10;
      if (pumpStatusEl) pumpStatusEl.value = currentSourceConfig.pump?.status || 'on';
      if (pumpUnitEl) pumpUnitEl.value = currentSourceConfig.pump?.flowUnit || 'lps';

      const resFlowEl = document.getElementById('modalReservoirFlow');
      const resFlowUnitEl = document.getElementById('modalReservoirFlowUnit');
      const resElevEl = document.getElementById('modalReservoirElev');

      if (resFlowEl) resFlowEl.value = currentSourceConfig.reservoir?.flow ?? 10;
      if (resFlowUnitEl) resFlowUnitEl.value = currentSourceConfig.reservoir?.flowUnit || 'lps';
      if (resElevEl) resElevEl.value = currentSourceConfig.reservoir?.elevation ?? 535;
    }

    updateSourceModalPreview();
    modal.classList.remove('hidden');

    if (focusTarget === 'reservoir') {
      const rad = document.getElementById('optModeGravity');
      if (rad) {
        rad.checked = true;
        updateSourceModalModeUI('gravity');
        updateSourceModalPreview();
      }
      setTimeout(() => document.getElementById('modalReservoirFlow')?.focus(), 50);
    } else {
      setTimeout(() => document.getElementById('modalPumpHead')?.focus(), 50);
    }
  }

  /**
   * Tutup Modal Pengaturan Sumber
   */
  function closeSourceSettingsModal() {
    document.getElementById('sourceSettingsModal')?.classList.add('hidden');
  }

  /**
   * Simpan Pengaturan Sumber dari Modal
   */
  function saveSourceSettingsFromModal() {
    const isGravity = document.getElementById('optModeGravity')?.checked;
    const systemMode = isGravity ? 'gravity' : 'pump';

    const pumpHead = parseFloat(document.getElementById('modalPumpHead')?.value) || 0;
    let pumpFlow = parseFloat(document.getElementById('modalPumpFlow')?.value) || 0;
    const pumpFlowUnit = document.getElementById('modalPumpFlowUnit')?.value || 'lps';
    const pumpStatus = document.getElementById('modalPumpStatus')?.value || 'on';

    let resFlow = parseFloat(document.getElementById('modalReservoirFlow')?.value) || 0;
    const resFlowUnit = document.getElementById('modalReservoirFlowUnit')?.value || 'lps';
    const resElev = parseFloat(document.getElementById('modalReservoirElev')?.value) || 535;

    // Simpan dalam format L/s
    const pumpFlowLps = pumpFlowUnit === 'm3h' ? (pumpFlow / 3.6) : pumpFlow;
    const resFlowLps = resFlowUnit === 'm3h' ? (resFlow / 3.6) : resFlow;

    const newConfig = {
      systemMode: systemMode,
      pump: {
        id: currentSourceConfig?.pump?.id || 'c49cf912-b713-48a7-93a8-3164489b9471',
        label: currentSourceConfig?.pump?.label || 'PMP4',
        head: pumpHead,
        flow: Number(pumpFlowLps.toFixed(2)),
        flowUnit: pumpFlowUnit,
        status: pumpStatus
      },
      reservoir: {
        id: currentSourceConfig?.reservoir?.id || 'f56c2b53-7035-4e95-94f1-fe2e32925299',
        label: currentSourceConfig?.reservoir?.label || 'R4',
        elevation: resElev,
        flow: Number(resFlowLps.toFixed(2)),
        flowUnit: resFlowUnit
      }
    };

    if (onSaveSourceConfigCallback) {
      onSaveSourceConfigCallback(newConfig);
    }

    closeSourceSettingsModal();
  }

  /**
   * Kembalikan Modal Sumber ke Default Awal
   */
  function resetSourceSettingsModal() {
    if (confirm('Kembalikan kapasitas pompa dan reservoir ke setelan awal pabrik (Head 50m, Debit 10 L/s, Mode Pompa)?')) {
      const defaultCfg = {
        systemMode: 'pump',
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

      currentSourceConfig = defaultCfg;
      openSourceSettingsModal('pump');
      if (onSaveSourceConfigCallback) {
        onSaveSourceConfigCallback(defaultCfg);
      }
    }
  }

  /**
   * Update Badge Sumber di Header Toolbar
   */
  function updateSourceBadge(sourceConfig) {
    currentSourceConfig = sourceConfig;
    const badge = document.getElementById('sourceBadge');
    if (!badge || !sourceConfig) return;

    if (sourceConfig.systemMode === 'gravity') {
      const q = sourceConfig.reservoir?.flow || 10;
      badge.textContent = `💧 Gravitasi: ${q.toFixed(1)} L/s`;
      badge.className = 'bg-blue-900/80 text-blue-100 border border-blue-300/40 px-1.5 py-0.5 rounded text-[10px] font-bold shadow-2xs max-w-[110px] sm:max-w-none truncate';
    } else {
      const h = sourceConfig.pump?.head || 50;
      const q = sourceConfig.pump?.flow || 10;
      const status = sourceConfig.pump?.status === 'off' ? ' (OFF)' : '';
      badge.textContent = `⚡ Pompa: ${h.toFixed(0)}m / ${q.toFixed(1)} L/s${status}`;
      badge.className = 'bg-indigo-900/80 text-indigo-100 border border-indigo-300/40 px-1.5 py-0.5 rounded text-[10px] font-bold shadow-2xs max-w-[110px] sm:max-w-none truncate';
    }
  }

  /**
   * Buka Modal Input Tekanan Junction
   */
  function openPressureModal(node, nodeState) {
    activeNode = node;
    const modal = document.getElementById('pressureModal');
    if (!modal) return;

    document.getElementById('modalNodeLabel').textContent = `${node.label} (${node.type || 'junction'})`;
    document.getElementById('modalNodeElevation').textContent = `${node.elevation} m dpl`;

    const demandInput = document.getElementById('modalDemandInput');
    const pressureInput = document.getElementById('modalPressureInput');
    const unitSelect = document.getElementById('modalPressureUnit');

    if (demandInput) {
      let d = 0;
      if (nodeState && nodeState.demand !== undefined && nodeState.demand !== null) {
        d = nodeState.demand;
      } else if (node && node.demand !== undefined && node.demand !== null) {
        d = node.demand;
      }
      demandInput.value = d;
    }

    if (nodeState && nodeState.pressureValue !== null && nodeState.pressureValue !== undefined) {
      pressureInput.value = nodeState.pressureValue;
      unitSelect.value = nodeState.pressureUnit || 'bar';
    } else {
      pressureInput.value = '';
      unitSelect.value = 'bar';
    }

    updateModalHeadPreview();
    modal.classList.remove('hidden');
    if (demandInput) {
      setTimeout(() => demandInput.focus(), 100);
    }
  }

  /**
   * Tutup Modal Input Tekanan
   */
  function closePressureModal() {
    const modal = document.getElementById('pressureModal');
    modal?.classList.add('hidden');
    activeNode = null;
  }

  /**
   * Update Preview Total Head di Modal secara real-time
   */
  function updateModalHeadPreview() {
    if (!activeNode) return;
    const inputVal = parseFloat(document.getElementById('modalPressureInput')?.value);
    const unit = document.getElementById('modalPressureUnit')?.value || 'bar';
    const previewEl = document.getElementById('modalTotalHeadPreview');
    const convertedEl = document.getElementById('modalConvertedPressure');

    if (!isNaN(inputVal)) {
      const pMeters = HydraulicEngine.convertPressureToMeters(inputVal, unit);
      const totalHead = Number(activeNode.elevation) + pMeters;
      if (previewEl) previewEl.textContent = `${totalHead.toFixed(2)} m`;
      if (convertedEl) convertedEl.textContent = `(${pMeters.toFixed(2)} mH2O)`;
    } else {
      if (previewEl) previewEl.textContent = `${activeNode.elevation} m (Elevasi)`;
      if (convertedEl) convertedEl.textContent = '-';
    }
  }

  /**
   * Simpan Tekanan dan Demand dari Modal (100% Tangguh & Responsif)
   */
  function savePressureFromModal() {
    if (!activeNode) {
      closePressureModal();
      return;
    }

    const nodeId = activeNode.id;
    const nodeLabel = activeNode.label || nodeId;

    try {
      const demandInput = document.getElementById('modalDemandInput');
      const pressInput = document.getElementById('modalPressureInput');
      const unitSelect = document.getElementById('modalPressureUnit');

      const rawDemand = demandInput ? demandInput.value : '';
      const demandVal = rawDemand !== '' ? parseFloat(rawDemand) : 0;
      const safeDemand = isNaN(demandVal) ? 0 : demandVal;

      const unit = unitSelect?.value || 'bar';
      const pressVal = (pressInput && pressInput.value !== '') ? parseFloat(pressInput.value) : null;
      const safePressure = (pressVal !== null && !isNaN(pressVal)) ? pressVal : null;

      if (typeof onSavePressureCallback === 'function') {
        onSavePressureCallback(nodeId, safePressure, unit, safeDemand);
      }

      showToast(`💾 Titik ${nodeLabel} disimpan: Demand = ${safeDemand} L/s`, 'success');
    } catch (err) {
      console.error('Error saving pressure/demand from modal:', err);
      showToast(`Terjadi kesalahan saat menyimpan data titik ${nodeLabel}`, 'error');
    } finally {
      closePressureModal();
    }
  }

  /**
   * Hapus Tekanan dari Modal
   */
  function deletePressureFromModal() {
    if (!activeNode) {
      closePressureModal();
      return;
    }

    const nodeId = activeNode.id;
    const nodeLabel = activeNode.label || nodeId;

    if (confirm(`Hapus data tekanan pada junction ${nodeLabel}?`)) {
      try {
        if (typeof onDeletePressureCallback === 'function') {
          onDeletePressureCallback(nodeId);
        }
      } catch (err) {
        console.error('Error deleting pressure from modal:', err);
      } finally {
        closePressureModal();
      }
    }
  }

  /**
   * Tampilkan Kartu Detail Pipa Terpilih
   */
  function showPipeDetailCard(pipe, pipeCalc, startNode, endNode) {
    const container = document.getElementById('pipeDetailCard');
    const backdrop = document.getElementById('pipeDetailBackdrop');
    if (!container) return;

    const startLabel = startNode?.label || 'N/A';
    const endLabel = endNode?.label || 'N/A';

    let html = `
      <div class="bg-white rounded-t-3xl sm:rounded-xl shadow-2xl sm:shadow-md border-t sm:border border-slate-200 p-4 space-y-3">
        <div class="bottom-sheet-handle sm:hidden"></div>
        <div class="flex items-center justify-between border-b border-slate-100 pb-2">
          <div>
            <h4 class="font-bold text-slate-800 text-sm flex items-center gap-1.5">
              <span>Detail Pipa:</span>
              <span class="text-blue-700 font-mono font-black">${startLabel} &rarr; ${endLabel}</span>
            </h4>
            <span class="text-xs text-slate-500">ID: ${pipe.id.substring(0, 8)}... | Material: ${pipe.material || 'PVC'}</span>
          </div>
          <button onclick="document.getElementById('pipeDetailCard').classList.add('hidden'); document.getElementById('pipeDetailBackdrop')?.classList.remove('active');" class="text-slate-400 hover:text-slate-600 text-2xl leading-none px-2 py-0.5 active-press">&times;</button>
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="bg-slate-50 p-2 rounded-lg border border-slate-200/60">
            <span class="text-slate-500">Diameter ($D$):</span>
            <div class="font-bold text-slate-800 text-sm">${pipe.diameter} mm</div>
          </div>
          <div class="bg-slate-50 p-2 rounded-lg border border-slate-200/60">
            <span class="text-slate-500">Panjang ($L$):</span>
            <div class="font-bold text-slate-800 text-sm">${pipe.length} m</div>
          </div>
          <div class="bg-slate-50 p-2 rounded-lg border border-slate-200/60">
            <span class="text-slate-500">Kekasaran ($C$):</span>
            <div class="font-bold text-slate-800 text-sm">${pipe.roughness || 140}</div>
          </div>
          <div class="bg-slate-50 p-2 rounded-lg border border-slate-200/60">
            <span class="text-slate-500">Resistansi ($R$):</span>
            <div class="font-bold text-slate-800 text-sm">${pipeCalc?.resistanceR ? pipeCalc.resistanceR.toFixed(1) : '-'}</div>
          </div>
        </div>
    `;

    if (pipeCalc && pipeCalc.status === 'calculated') {
      const dirText = pipeCalc.direction === 'forward' ? `${startLabel} ke ${endLabel}` : `${endLabel} ke ${startLabel}`;
      html += `
        <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs text-emerald-800 font-semibold">HASIL ANALISA DEBIT:</span>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${pipeCalc.velocityBadgeClass}">
              ${pipeCalc.velocityLabel}
            </span>
          </div>
          <div class="flex items-baseline gap-2">
            <span class="text-2xl font-black text-emerald-700">${pipeCalc.flowRateLps.toFixed(2)}</span>
            <span class="text-xs font-semibold text-emerald-900">Liter / detik</span>
            <span class="text-xs text-slate-500">(${pipeCalc.flowRateM3h.toFixed(1)} m³/jam)</span>
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-emerald-200/60 text-slate-700">
            <div>Kecepatan ($v$): <b>${pipeCalc.velocity.toFixed(2)} m/s</b></div>
            <div>Head Loss ($h_f$): <b>${pipeCalc.headLoss.toFixed(2)} m</b></div>
            <div>Beda Head ($\Delta H$): <b>${pipeCalc.deltaH.toFixed(2)} m</b></div>
            <div>Gradien ($S$): <b>${pipeCalc.unitHeadLoss.toFixed(2)} m/km</b></div>
          </div>
          <div class="text-xs text-slate-700 pt-1">
            Arah Aliran Aktual: <b class="text-blue-700">${dirText}</b>
          </div>
        </div>

        ${pipeCalc.anomalyWarning ? `
          <div class="bg-amber-50 border border-amber-300 rounded-lg p-2.5 text-xs text-amber-900 space-y-1">
            <div class="font-bold flex items-center gap-1 text-amber-800">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-amber-600 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span>Perhatian: Anomali Hidrolika</span>
            </div>
            <p class="text-[11px] leading-relaxed text-amber-800">${pipeCalc.anomalyWarning}</p>
          </div>
        ` : ''}

        <div class="text-[11px] bg-slate-100 p-2 rounded-lg text-slate-600 font-mono">
          Rumus: $Q = (|\\Delta H| / R)^{1/1.852} = (${pipeCalc.headLoss.toFixed(2)} / ${pipeCalc.resistanceR.toFixed(0)})^{0.54} = ${(pipeCalc.flowRateM3s * 1000).toFixed(2)}$ L/s
        </div>
      `;
    } else {
      html += `
        <div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
          <b>Status: Belum Terhitung</b><br>
          Tekanan salah satu atau kedua junction (${startLabel} & ${endLabel}) belum diinput di lapangan.
        </div>
      `;
    }

    // Pintasan Langsung Input Tekanan Simpul Hulu & Hilir
    html += `
      <div class="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-1.5">
        <div class="text-[11px] font-bold text-slate-700">Pintasan Ukur Tekanan Simpul:</div>
        <div class="grid grid-cols-2 gap-2">
          <button 
            onclick="UIController.openPressureModalForNodeId('${pipe.startNodeId}')" 
            class="py-2 px-2 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 shadow-2xs active-press"
          >
            <span>📍 Titik ${startLabel}</span>
          </button>
          <button 
            onclick="UIController.openPressureModalForNodeId('${pipe.endNodeId}')" 
            class="py-2 px-2 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 shadow-2xs active-press"
          >
            <span>📍 Titik ${endLabel}</span>
          </button>
        </div>
      </div>
    `;

    html += `
      <div class="pt-1 flex gap-2 sm:hidden">
        <button onclick="document.getElementById('pipeDetailCard').classList.add('hidden'); document.getElementById('pipeDetailBackdrop')?.classList.remove('active');" class="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs active-press">
          Tutup Rincian Pipa
        </button>
      </div>
    `;

    html += `</div>`;
    container.innerHTML = html;
    container.classList.remove('hidden');
    backdrop?.classList.add('active');
  }

  /**
   * Update Summary KPI Cards
   */
  function updateSummaryCards(summary, nodesMap, pipesMap) {
    document.getElementById('kpiMeasuredNodes').textContent = `${summary.measuredNodes} / ${summary.totalNodes}`;
    document.getElementById('kpiCalculatedPipes').textContent = `${summary.calculatedPipes} / ${summary.totalPipes}`;
    document.getElementById('kpiTotalDebit').textContent = `${summary.totalFlowLps.toFixed(1)} L/s`;
    document.getElementById('kpiTotalDebitM3h').textContent = `${(summary.totalFlowLps * 3.6).toFixed(0)} m³/jam`;
    document.getElementById('kpiCriticalPipes').textContent = summary.criticalPipes;

    // Update juga preview di mini pill saat dashboard tersembunyi
    const miniKpi = document.getElementById('toggleDashboardMiniKpi');
    if (miniKpi) {
      miniKpi.textContent = `💧 ${summary.totalFlowLps.toFixed(1)} L/s`;
    }

    const criticalBadge = document.getElementById('kpiCriticalBadge');
    if (criticalBadge) {
      if (summary.criticalPipes > 0) {
        criticalBadge.classList.remove('bg-emerald-500');
        criticalBadge.classList.add('bg-red-500');
      } else {
        criticalBadge.classList.remove('bg-red-500');
        criticalBadge.classList.add('bg-emerald-500');
      }
    }

    // Update badge notifikasi pipa bermasalah pada navigasi mobile bawah
    const mobileBadge = document.getElementById('mobileTabTableBadge');
    if (mobileBadge) {
      if (summary.criticalPipes > 0) {
        mobileBadge.textContent = summary.criticalPipes;
        mobileBadge.classList.remove('hidden');
      } else {
        mobileBadge.classList.add('hidden');
      }
    }
  }

  /**
   * Render Tabel Monitoring Pipa (Dual Mode: Desktop Table & Mobile Card View + Search & Filter)
   */
  function renderPipesTable(networkData, nodesMap, pipesMap) {
    cachedNetworkData = networkData;
    cachedNodesMap = nodesMap;
    cachedPipesMap = pipesMap;

    const tbody = document.getElementById('tablePipesBody');
    const cardContainer = document.getElementById('mobilePipesCardContainer');
    const countBadge = document.getElementById('pipesCountBadge');
    if (!tbody) return;

    // Filter pipa berdasarkan search & status filter
    const filteredPipes = networkData.pipes.filter(pipe => {
      const calc = pipesMap.get(pipe.id)?.calculation;
      const startNode = nodesMap.get(pipe.startNodeId);
      const endNode = nodesMap.get(pipe.endNodeId);
      const startLabel = (startNode?.label || '').toLowerCase();
      const endLabel = (endNode?.label || '').toLowerCase();
      const pipeId = (pipe.id || '').toLowerCase();
      const isCalculated = calc && calc.status === 'calculated';

      // Filter status
      if (pipeFilterStatus === 'calculated' && !isCalculated) return false;
      if (pipeFilterStatus === 'unmeasured' && isCalculated) return false;
      if (pipeFilterStatus === 'critical') {
        if (!isCalculated || (calc.velocityStatus !== 'warning' && calc.velocityStatus !== 'danger')) return false;
      }

      // Filter search
      if (pipeSearchTerm) {
        const matchesStart = startLabel.includes(pipeSearchTerm);
        const matchesEnd = endLabel.includes(pipeSearchTerm);
        const matchesId = pipeId.includes(pipeSearchTerm);
        if (!matchesStart && !matchesEnd && !matchesId) return false;
      }

      return true;
    });

    if (countBadge) {
      countBadge.textContent = `${filteredPipes.length} / ${networkData.pipes.length} Pipa`;
    }

    // 1. Render Desktop Table Body
    let rows = '';
    if (filteredPipes.length === 0) {
      rows = `
        <tr>
          <td colspan="12" class="text-center py-8 text-slate-400">
            Tidak ada pipa yang sesuai kriteria pencarian atau filter.
          </td>
        </tr>
      `;
    } else {
      filteredPipes.forEach((pipe, idx) => {
        const calc = pipesMap.get(pipe.id)?.calculation;
        const startNode = nodesMap.get(pipe.startNodeId);
        const endNode = nodesMap.get(pipe.endNodeId);
        const startLabel = startNode?.label || 'N/A';
        const endLabel = endNode?.label || 'N/A';
        const isCalculated = calc && calc.status === 'calculated';

        let directionBadge = '-';
        if (isCalculated && calc.direction !== 'none') {
          directionBadge = calc.direction === 'forward' 
            ? `<span class="text-blue-600 font-semibold">${startLabel} &rarr; ${endLabel}</span>`
            : `<span class="text-indigo-600 font-semibold">${endLabel} &rarr; ${startLabel}</span>`;
        }

        rows += `
          <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 text-xs">
            <td class="p-2.5 font-bold text-slate-800">${idx + 1}</td>
            <td class="p-2.5 font-semibold text-slate-800">
              ${startLabel} &rarr; ${endLabel}
            </td>
            <td class="p-2.5 text-slate-600">${pipe.diameter} mm</td>
            <td class="p-2.5 text-slate-600">${pipe.length} m</td>
            <td class="p-2.5 text-slate-600">${pipe.roughness || 140}</td>
            <td class="p-2.5 text-slate-700 font-mono">${isCalculated ? calc.headLoss.toFixed(2) + ' m' : '-'}</td>
            <td class="p-2.5 font-bold ${isCalculated ? 'text-emerald-700 font-mono text-sm' : 'text-slate-400'}">
              ${isCalculated ? calc.flowRateLps.toFixed(2) : '-'}
            </td>
            <td class="p-2.5 font-semibold ${isCalculated ? 'text-slate-700 font-mono' : 'text-slate-400'}">
              ${isCalculated ? calc.flowRateM3h.toFixed(1) : '-'}
            </td>
            <td class="p-2.5 font-mono ${isCalculated ? 'text-slate-800' : 'text-slate-400'}">
              ${isCalculated ? calc.velocity.toFixed(2) : '-'}
            </td>
            <td class="p-2.5">
              ${isCalculated 
                ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold ${calc.velocityBadgeClass}">${calc.velocityStatus.toUpperCase()}</span>`
                : `<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500">BELUM DIUKUR</span>`}
            </td>
            <td class="p-2.5">${directionBadge}</td>
            <td class="p-2.5 text-center">
              <button onclick="App.locatePipe('${pipe.id}')" class="px-2 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded text-[11px] font-medium transition-colors">
                Lihat di Peta
              </button>
            </td>
          </tr>
        `;
      });
    }
    tbody.innerHTML = rows;

    // 2. Render Mobile Card Container
    if (cardContainer) {
      if (filteredPipes.length === 0) {
        cardContainer.innerHTML = `
          <div class="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-6">
            <div class="text-3xl mb-2">🔍</div>
            <div class="font-bold text-slate-700 text-sm">Tidak Ditemukan</div>
            <div class="text-xs text-slate-500 mt-1">Tidak ada pipa yang cocok dengan pencarian atau filter saat ini.</div>
          </div>
        `;
      } else {
        let cardsHtml = '';
        filteredPipes.forEach((pipe, idx) => {
          const calc = pipesMap.get(pipe.id)?.calculation;
          const startNode = nodesMap.get(pipe.startNodeId);
          const endNode = nodesMap.get(pipe.endNodeId);
          const startLabel = startNode?.label || 'N/A';
          const endLabel = endNode?.label || 'N/A';
          const isCalculated = calc && calc.status === 'calculated';

          let statusBadge = isCalculated
            ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${calc.velocityBadgeClass}">${calc.velocityLabel || calc.velocityStatus.toUpperCase()}</span>`
            : `<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500">BELUM DIUKUR</span>`;

          cardsHtml += `
            <div class="mobile-pipe-card ${isCalculated && (calc.velocityStatus === 'warning' || calc.velocityStatus === 'danger') ? 'border-amber-300 bg-amber-50/20' : ''}">
              <div class="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div class="flex items-center gap-1.5">
                  <span class="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold text-[10px] flex items-center justify-center flex-none">
                    ${idx + 1}
                  </span>
                  <div class="font-bold text-slate-900 text-sm">
                    ${startLabel} &rarr; ${endLabel}
                  </div>
                </div>
                ${statusBadge}
              </div>

              <!-- Nilai Utama Debit & Kecepatan -->
              <div class="grid grid-cols-2 gap-2 bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/50">
                <div>
                  <div class="text-[10px] font-medium text-slate-500">Debit Aliran (Q):</div>
                  <div class="font-black text-slate-900 text-base flex items-baseline gap-1">
                    <span class="${isCalculated ? 'text-emerald-700' : 'text-slate-400'}">${isCalculated ? calc.flowRateLps.toFixed(2) : '-'}</span>
                    <span class="text-[10px] font-semibold text-slate-500">L/s</span>
                  </div>
                  <div class="text-[10px] text-slate-400 font-mono">${isCalculated ? calc.flowRateM3h.toFixed(1) + ' m³/jam' : '-'}</div>
                </div>
                <div>
                  <div class="text-[10px] font-medium text-slate-500">Kecepatan (v):</div>
                  <div class="font-black text-slate-900 text-base flex items-baseline gap-1">
                    <span class="${isCalculated ? 'text-blue-700' : 'text-slate-400'}">${isCalculated ? calc.velocity.toFixed(2) : '-'}</span>
                    <span class="text-[10px] font-semibold text-slate-500">m/s</span>
                  </div>
                  <div class="text-[10px] text-slate-400">Head Loss: <b class="text-slate-600">${isCalculated ? calc.headLoss.toFixed(2) + ' m' : '-'}</b></div>
                </div>
              </div>

              <!-- Detail Spesifikasi Pipa -->
              <div class="flex items-center justify-between text-[11px] text-slate-500 px-1">
                <span>&empty; <b>${pipe.diameter} mm</b></span>
                <span>Panjang: <b>${pipe.length} m</b></span>
                <span>C: <b>${pipe.roughness || 140}</b></span>
              </div>

              <!-- Tombol Aksi Mobile -->
              <div class="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                <button 
                  onclick="App.locatePipe('${pipe.id}')"
                  class="py-2 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1 active-press"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                  <span>Peta GIS</span>
                </button>
                <button 
                  onclick="UIController.showPipeDetailCardFromId('${pipe.id}')"
                  class="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1 active-press"
                >
                  <span>Rincian &rarr;</span>
                </button>
              </div>
            </div>
          `;
        });
        cardContainer.innerHTML = cardsHtml;
      }
    }
  }

  /**
   * Render Tabel Input Batch Junction di Sidebar (dengan Filter Status & Pencarian Cepat)
   */
  function renderJunctionsSidebarTable(networkData, nodesMap, sourceConfig = null) {
    cachedNetworkData = networkData;
    cachedNodesMap = nodesMap;
    if (sourceConfig) currentSourceConfig = sourceConfig;

    const container = document.getElementById('junctionsSidebarList');
    if (!container) return;

    const cfg = sourceConfig || currentSourceConfig;
    const isGravity = cfg?.systemMode === 'gravity';
    const isPumpActive = !isGravity && (cfg?.pump?.status !== 'off');
    const curPumpHead = isPumpActive ? (Number(cfg?.pump?.head) ?? 50) : 0;
    const curPumpFlow = Number(cfg?.pump?.flow) ?? 10;
    const resFlow = Number(cfg?.reservoir?.flow) ?? 10;
    const resElev = Number(cfg?.reservoir?.elevation) ?? 535;

    let html = '';

    // Hanya tampilkan Reservoir & Pompa jika filter 'Semua' dan tidak sedang mencari junction spesifik
    if (junctionFilterStatus === 'all' && !junctionSearchTerm) {
      // 1. Card Reservoir Air (R4)
      html += `
        <div class="p-2.5 bg-blue-50/90 rounded-xl border border-blue-200 shadow-2xs hover:border-blue-400 transition-all flex items-center justify-between gap-2 text-xs">
          <div class="cursor-pointer flex-1 min-w-0" onclick="UIController.openSourceSettingsModal('reservoir')">
            <div class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-blue-600 flex-none"></span>
              <span class="font-bold text-blue-950 text-sm">Reservoir R4</span>
              <span class="text-[10px] ${isGravity ? 'bg-blue-200 text-blue-900' : 'bg-slate-200 text-slate-700'} px-1.5 py-0.2 rounded font-semibold">${isGravity ? 'Gravitasi' : 'Suplai'}</span>
            </div>
            <div class="text-[11px] text-slate-600 mt-0.5 truncate">
              Muka Air: <b>${resElev}m</b> &bull; Debit: <b class="text-blue-800">${resFlow.toFixed(1)} L/s</b>
            </div>
          </div>
          <button 
            onclick="UIController.openSourceSettingsModal('reservoir')"
            class="px-2.5 py-1.5 bg-white hover:bg-blue-100 text-blue-700 rounded-lg border border-blue-300 font-semibold text-[11px] transition-colors flex items-center gap-1 shadow-2xs cursor-pointer flex-none active-press"
            title="Setting Debit di Reservoir"
          >
            <span>⚙️ Setting</span>
          </button>
        </div>
      `;

      // 2. Card Pompa Transmisi (PMP4)
      html += `
        <div class="p-2.5 bg-indigo-50/90 rounded-xl border border-indigo-200 shadow-2xs hover:border-indigo-400 transition-all flex items-center justify-between gap-2 text-xs">
          <div class="cursor-pointer flex-1 min-w-0" onclick="UIController.openSourceSettingsModal('pump')">
            <div class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full ${isPumpActive ? 'bg-violet-600' : 'bg-slate-400'} flex-none"></span>
              <span class="font-bold text-indigo-950 text-sm">Pompa PMP4</span>
              <span class="text-[10px] ${isPumpActive ? 'bg-indigo-200 text-indigo-900' : 'bg-slate-200 text-slate-700'} px-1.5 py-0.2 rounded font-semibold">${isPumpActive ? 'Aktif' : 'Bypass'}</span>
            </div>
            <div class="text-[11px] text-slate-600 mt-0.5 truncate">
              Head: <b class="text-indigo-800">${isPumpActive ? curPumpHead.toFixed(1) + 'm' : '0m'}</b> &bull; Debit: <b class="text-indigo-800">${curPumpFlow.toFixed(1)} L/s</b>
            </div>
          </div>
          <button 
            onclick="UIController.openSourceSettingsModal('pump')"
            class="px-2.5 py-1.5 bg-white hover:bg-indigo-100 text-indigo-700 rounded-lg border border-indigo-300 font-semibold text-[11px] transition-colors flex items-center gap-1 shadow-2xs cursor-pointer flex-none active-press"
            title="Edit Kapasitas Head & Debit Pompa"
          >
            <span>⚙️ Setting</span>
          </button>
        </div>
      `;

      // Garis Pemisah Junction Lapangan
      html += `
        <div class="pt-1 pb-0.5 flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          <span>Tekanan Simpul / Junction Lapangan</span>
          <div class="flex-1 border-t border-slate-200"></div>
        </div>
      `;
    }

    // Filter junctions
    const filteredJunctions = networkData.nodes.filter(n => n.type !== 'reservoir').filter(node => {
      const state = nodesMap.get(node.id);
      const isMeasured = state?.isMeasured;
      const label = (node.label || '').toLowerCase();
      const id = (node.id || '').toLowerCase();

      // Filter status
      if (junctionFilterStatus === 'measured' && !isMeasured) return false;
      if (junctionFilterStatus === 'unmeasured' && isMeasured) return false;

      // Filter pencarian
      if (junctionSearchTerm) {
        const matchesLabel = label.includes(junctionSearchTerm);
        const matchesId = id.includes(junctionSearchTerm);
        if (!matchesLabel && !matchesId) return false;
      }

      return true;
    });

    if (filteredJunctions.length === 0) {
      html += `
        <div class="p-6 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
          <div class="text-2xl mb-1">🔍</div>
          <div class="text-xs font-semibold text-slate-600">Tidak ada junction yang sesuai</div>
          <div class="text-[10px] text-slate-400 mt-0.5">Ubah kata kunci pencarian atau filter status.</div>
        </div>
      `;
    } else {
      filteredJunctions.forEach(node => {
        const state = nodesMap.get(node.id);
        const isMeasured = state?.isMeasured;
        const val = state?.pressureValue !== null && state?.pressureValue !== undefined ? state.pressureValue : '';
        const unit = state?.pressureUnit || 'bar';

        html += `
          <div class="p-2.5 bg-white rounded-xl border border-slate-200/80 shadow-2xs hover:border-blue-300 transition-all flex items-center justify-between gap-2 text-xs">
            <div class="cursor-pointer flex-1 min-w-0" onclick="App.locateNode('${node.id}')">
              <div class="flex items-center gap-1.5">
                <span class="w-2.5 h-2.5 rounded-full ${isMeasured ? 'bg-emerald-500' : 'bg-amber-400'} flex-none"></span>
                <span class="font-bold text-slate-800 text-sm truncate">${node.label}</span>
                <span class="text-[10px] text-slate-500 flex-none">(${node.elevation}m)</span>
              </div>
              <div class="text-[11px] text-slate-500 mt-0.5 truncate">
                ${isMeasured ? `Total Head: <b>${state.totalHead.toFixed(1)}m</b>` : 'Tekanan belum ada'}
              </div>
            </div>

            <div class="flex items-center gap-1 flex-none">
              <input 
                type="number" 
                inputmode="decimal"
                step="0.01" 
                placeholder="Tekanan" 
                value="${val}" 
                id="inline-pressure-${node.id}" 
                class="w-16 px-1.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-hidden font-mono text-right"
              />
              <select id="inline-unit-${node.id}" class="text-[11px] py-1.5 px-1 border border-slate-300 rounded-lg bg-slate-50 text-slate-700">
                <option value="bar" ${unit === 'bar' ? 'selected' : ''}>bar</option>
                <option value="mH2O" ${unit === 'mH2O' ? 'selected' : ''}>mH2O</option>
                <option value="psi" ${unit === 'psi' ? 'selected' : ''}>psi</option>
              </select>
              <button 
                onclick="App.saveInlinePressure('${node.id}')"
                class="p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg border border-emerald-200 transition-colors active-press"
                title="Simpan Tekanan"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
            </div>
          </div>
        `;
      });
    }

    container.innerHTML = html;
  }

  /**
   * Render Tabel Alur Hidrolis Berurutan (Dual Mode: Desktop Table & Mobile Flow Journey Steps)
   */
  function renderSequentialFlowTable(sequenceSteps) {
    cachedSequenceSteps = sequenceSteps;
    const tbody = document.getElementById('tableSequenceBody');
    const flowContainer = document.getElementById('mobileSequenceFlowContainer');
    if (!tbody) return;

    // 1. Render Desktop Table
    let rows = '';
    sequenceSteps.forEach((step) => {
      const isSource = step.type === 'source';
      const isPump = step.type === 'pump';
      const isPipe = step.type === 'pipe';

      let indentClass = '';
      if (step.depth === 1) indentClass = 'pl-6';
      else if (step.depth === 2) indentClass = 'pl-10';
      else if (step.depth >= 3) indentClass = 'pl-14';

      let typeBadge = '';
      if (isSource) {
        typeBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">SUMBER AIR</span>';
      } else if (isPump) {
        typeBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-300">POMPA</span>';
      } else if (step.demand > 0) {
        typeBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">DEMAND ${step.demand} L/s</span>`;
      } else if (step.depth >= 3) {
        typeBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">UJUNG JARINGAN</span>';
      } else {
        typeBadge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">TRANSMISI</span>';
      }

      const qDisplay = step.flowRateLps > 0 ? step.flowRateLps.toFixed(2) : '-';
      const qM3hDisplay = step.flowRateM3h > 0 ? step.flowRateM3h.toFixed(1) : '-';
      const vDisplay = step.velocity > 0 ? step.velocity.toFixed(2) : '-';
      const hfDisplay = step.headLoss > 0 ? step.headLoss.toFixed(2) : '-';

      let actionBtn = '';
      if (isPipe) {
        actionBtn = `
          <button onclick="App.locatePipe('${step.pipeId}')" class="px-2 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded text-[11px] font-medium transition-colors">
            Lihat
          </button>
        `;
      } else if (isSource) {
        actionBtn = `
          <button onclick="UIController.openSourceSettingsModal('reservoir')" class="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[11px] font-semibold transition-colors flex items-center gap-1 shadow-2xs mx-auto">
            <span>⚙️ Setting</span>
          </button>
        `;
      } else if (isPump) {
        actionBtn = `
          <button onclick="UIController.openSourceSettingsModal('pump')" class="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-semibold transition-colors flex items-center gap-1 shadow-2xs mx-auto">
            <span>⚙️ Setting</span>
          </button>
        `;
      } else {
        actionBtn = `
          <button onclick="App.locateNode('${step.nodeId}')" class="px-2 py-1 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded text-[11px] font-medium transition-colors">
            Lihat
          </button>
        `;
      }

      rows += `
        <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 text-xs ${isSource ? 'bg-blue-50/50' : (isPump ? 'bg-purple-50/30' : '')}">
          <td class="p-2.5 font-bold text-slate-700 text-center">${step.stepNumber}</td>
          <td class="p-2.5 ${indentClass}">
            <div class="flex items-center gap-1.5">
              ${isPipe ? '<span class="text-slate-400 font-mono">&bull;&rarr;</span>' : ''}
              <span class="font-bold text-slate-900 text-sm">${step.pipeLabel || step.nodeLabel}</span>
            </div>
            <div class="text-[11px] text-slate-500">${step.description || ''}</div>
          </td>
          <td class="p-2.5">${typeBadge}</td>
          <td class="p-2.5 font-mono text-slate-600">${step.cumulativeDistance ? Math.round(step.cumulativeDistance) + ' m' : '0 m'}</td>
          <td class="p-2.5 font-mono text-slate-700">${step.elevation} m</td>
          <td class="p-2.5 font-bold font-mono text-blue-700">${step.pressureBar ? step.pressureBar.toFixed(2) + ' bar' : '0.00 bar'}</td>
          <td class="p-2.5 font-bold font-mono text-emerald-700">${step.totalHead ? step.totalHead.toFixed(2) + ' m' : '-'}</td>
          <td class="p-2.5 font-mono text-slate-600">${hfDisplay !== '-' ? hfDisplay + ' m' : '-'}</td>
          <td class="p-2.5 font-bold font-mono text-emerald-800 text-sm">${qDisplay}</td>
          <td class="p-2.5 font-mono text-slate-700">${qM3hDisplay}</td>
          <td class="p-2.5 font-mono text-slate-800">${vDisplay}</td>
          <td class="p-2.5 text-center">
            ${actionBtn}
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = rows;

    // 2. Render Mobile Sequence Flow Steps
    if (flowContainer) {
      let cardsHtml = '';
      sequenceSteps.forEach((step) => {
        const isSource = step.type === 'source';
        const isPump = step.type === 'pump';
        const isPipe = step.type === 'pipe';

        let badgeType = '';
        if (isSource) {
          badgeType = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">SUMBER AIR</span>';
        } else if (isPump) {
          badgeType = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-300">POMPA</span>';
        } else if (step.demand > 0) {
          badgeType = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">DEMAND ${step.demand} L/s</span>`;
        } else if (step.depth >= 3) {
          badgeType = '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">UJUNG JARINGAN</span>';
        } else {
          badgeType = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">TRANSMISI</span>';
        }

        const qDisplay = step.flowRateLps > 0 ? step.flowRateLps.toFixed(2) : '-';
        const qM3hDisplay = step.flowRateM3h > 0 ? step.flowRateM3h.toFixed(1) : '-';
        const vDisplay = step.velocity > 0 ? step.velocity.toFixed(2) : '-';
        const hfDisplay = step.headLoss > 0 ? step.headLoss.toFixed(2) : '-';

        let actionBtn = '';
        if (isPipe) {
          actionBtn = `
            <button onclick="App.locatePipe('${step.pipeId}')" class="flex-1 py-2 px-3 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1 active-press">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              <span>Peta GIS</span>
            </button>
            <button onclick="UIController.showPipeDetailCardFromId('${step.pipeId}')" class="flex-1 py-2 px-3 bg-slate-100 text-slate-800 hover:bg-slate-200 rounded-xl text-xs font-bold transition-colors active-press">
              Rincian &rarr;
            </button>
          `;
        } else if (isSource) {
          actionBtn = `
            <button onclick="UIController.openSourceSettingsModal('reservoir')" class="w-full py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1 active-press">
              <span>⚙️ Setting Reservoir R4</span>
            </button>
          `;
        } else if (isPump) {
          actionBtn = `
            <button onclick="UIController.openSourceSettingsModal('pump')" class="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1 active-press">
              <span>⚙️ Setting Pompa PMP4</span>
            </button>
          `;
        } else {
          actionBtn = `
            <button onclick="App.locateNode('${step.nodeId}')" class="flex-1 py-2 px-3 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1 active-press">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              <span>Peta GIS</span>
            </button>
            <button onclick="UIController.openPressureModalForNodeId('${step.nodeId}')" class="flex-1 py-2 px-3 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 rounded-xl text-xs font-bold transition-colors active-press">
              Ukur Tekanan ✍️
            </button>
          `;
        }

        cardsHtml += `
          <div class="mobile-flow-step ${isSource ? 'border-blue-300 bg-blue-50/20' : (isPump ? 'border-purple-300 bg-purple-50/20' : '')}">
            <div class="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <div class="flex items-center gap-2 min-w-0">
                <span class="w-6 h-6 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center flex-none">
                  ${step.stepNumber}
                </span>
                <div class="min-w-0">
                  <div class="font-bold text-slate-900 text-sm truncate">${step.pipeLabel || step.nodeLabel}</div>
                  <div class="text-[10px] text-slate-500 truncate">${step.description || ''}</div>
                </div>
              </div>
              ${badgeType}
            </div>

            <!-- Metrik Alur -->
            <div class="grid grid-cols-3 gap-2 bg-slate-50/80 p-2 rounded-xl text-center border border-slate-200/50 text-xs">
              <div>
                <span class="text-[10px] text-slate-400 block">Jarak</span>
                <span class="font-bold font-mono text-slate-800">${step.cumulativeDistance ? Math.round(step.cumulativeDistance) + 'm' : '0m'}</span>
              </div>
              <div>
                <span class="text-[10px] text-slate-400 block">Tekanan</span>
                <span class="font-bold font-mono text-blue-700">${step.pressureBar ? step.pressureBar.toFixed(2) + ' bar' : '0 bar'}</span>
              </div>
              <div>
                <span class="text-[10px] text-slate-400 block">Total Head</span>
                <span class="font-bold font-mono text-emerald-700">${step.totalHead ? step.totalHead.toFixed(1) + 'm' : '-'}</span>
              </div>
            </div>

            ${qDisplay !== '-' || vDisplay !== '-' || hfDisplay !== '-' ? `
              <div class="grid grid-cols-3 gap-2 px-1 text-xs">
                <div>
                  <span class="text-[10px] text-slate-400 block">Debit (Q):</span>
                  <span class="font-bold font-mono text-emerald-800">${qDisplay} L/s</span>
                  <span class="text-[9px] text-slate-400 block">${qM3hDisplay} m³/h</span>
                </div>
                <div>
                  <span class="text-[10px] text-slate-400 block">Kecepatan (v):</span>
                  <span class="font-bold font-mono text-slate-800">${vDisplay} m/s</span>
                </div>
                <div>
                  <span class="text-[10px] text-slate-400 block">Head Loss:</span>
                  <span class="font-bold font-mono text-slate-600">${hfDisplay !== '-' ? hfDisplay + 'm' : '-'}</span>
                </div>
              </div>
            ` : ''}

            <!-- Tombol Aksi -->
            <div class="flex items-center gap-2 pt-1 border-t border-slate-100">
              ${actionBtn}
            </div>
          </div>
        `;
      });
      flowContainer.innerHTML = cardsHtml;
    }

    // Perbarui Box Konseptual Sumber & Pompa secara dinamis
    const boxHeader = document.getElementById('boxSequenceSourceHeader');
    const boxDesc = document.getElementById('boxSequenceSourceDesc');
    if (boxHeader && boxDesc && currentSourceConfig) {
      if (currentSourceConfig.systemMode === 'gravity') {
        boxHeader.innerHTML = '<span class="w-2.5 h-2.5 rounded-full bg-blue-600"></span> 1. Sumber Gravitasi (Hulu)';
        boxDesc.innerHTML = `Air mengalir alami dari <b>Reservoir R4</b> (Elevasi ${currentSourceConfig.reservoir?.elevation || 535} m) secara gravitasi murni tanpa pompa dengan debit <b>${(currentSourceConfig.reservoir?.flow || 10).toFixed(1)} L/s</b> (${((currentSourceConfig.reservoir?.flow || 10) * 3.6).toFixed(0)} m³/jam) ke Junction J66.`;
      } else {
        const pHead = (currentSourceConfig.pump?.head || 50).toFixed(1);
        const pFlow = (currentSourceConfig.pump?.flow || 10).toFixed(1);
        const pStatus = currentSourceConfig.pump?.status === 'off' ? ' (Bypass/Mati)' : `(+${pHead} m, Q=${pFlow} L/s)`;
        boxHeader.innerHTML = '<span class="w-2.5 h-2.5 rounded-full bg-blue-600"></span> 1. Sumber & Pompa (Hulu)';
        boxDesc.innerHTML = `Air bermula dari <b>Reservoir R4</b> (Elevasi ${currentSourceConfig.reservoir?.elevation || 535} m), lalu tekanannya dinaikkan oleh <b>Pompa PMP4 ${pStatus}</b> ke Junction J66 (Total Head ${(Number(currentSourceConfig.reservoir?.elevation || 535) + Number(currentSourceConfig.pump?.status === 'off' ? 0 : (currentSourceConfig.pump?.head || 50))).toFixed(1)} m).`;
      }
    }
  }

  /**
   * Tampilkan Toast Feedback Notifikasi Elegan
   */
  function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'fixed top-16 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full px-4 sm:px-0';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const bgColors = {
      success: 'bg-emerald-700 text-white border-emerald-500',
      info: 'bg-slate-800 text-white border-slate-700',
      warning: 'bg-amber-600 text-white border-amber-400',
      error: 'bg-red-600 text-white border-red-400'
    };

    toast.className = `p-3 rounded-xl shadow-xl text-xs font-semibold border flex items-center justify-between pointer-events-auto transition-all transform duration-300 translate-y-2 opacity-0 ${bgColors[type] || bgColors.info}`;
    toast.innerHTML = `<span class="flex-1 pr-2">${message}</span><button class="text-white/80 hover:text-white font-bold text-base leading-none">&times;</button>`;
    
    toast.querySelector('button')?.addEventListener('click', () => toast.remove());

    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    }, 10);

    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  /**
   * Perbarui Status Indikator Cloud Supabase pada Desktop & Mobile
   */
  function updateCloudStatus(status) {
    const dot = document.getElementById('cloudStatusDot');
    const text = document.getElementById('cloudStatusText');
    const badgeMobile = document.getElementById('cloudStatusBadgeMobile');
    const btnStatus = document.getElementById('btnCloudStatus');

    if (!dot || !text) return;

    if (status === 'connected') {
      dot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-none';
      text.innerText = 'Cloud Aktif';
      text.className = 'hidden sm:inline text-[11px] font-mono text-emerald-400';
      if (btnStatus) {
        btnStatus.className = 'flex items-center gap-1 sm:gap-1.5 bg-slate-800/90 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 px-2 py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold transition-colors cursor-pointer';
        btnStatus.title = 'Terhubung ke Supabase SCADA Server (Real-Time Aktif)';
      }
      if (badgeMobile) {
        badgeMobile.innerText = 'Terhubung';
        badgeMobile.className = 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold';
      }
    } else if (status === 'syncing') {
      dot.className = 'w-2 h-2 rounded-full bg-sky-400 animate-ping flex-none';
      text.innerText = 'Sinkronisasi...';
      text.className = 'hidden sm:inline text-[11px] font-mono text-sky-400';
      if (badgeMobile) {
        badgeMobile.innerText = 'Syncing...';
        badgeMobile.className = 'text-[10px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-bold';
      }
    } else if (status === 'offline') {
      dot.className = 'w-2 h-2 rounded-full bg-amber-400 flex-none';
      text.innerText = 'Offline (Lokal)';
      text.className = 'hidden sm:inline text-[11px] font-mono text-amber-400';
      if (btnStatus) {
        btnStatus.className = 'flex items-center gap-1 sm:gap-1.5 bg-slate-800/90 hover:bg-slate-700 text-amber-400 border border-amber-500/30 px-2 py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold transition-colors cursor-pointer';
        btnStatus.title = 'Mode Offline: Menggunakan penyimpanan lokal perangkat';
      }
      if (badgeMobile) {
        badgeMobile.innerText = 'Offline';
        badgeMobile.className = 'text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold';
      }
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-red-400 flex-none';
      text.innerText = 'Error Cloud';
      text.className = 'hidden sm:inline text-[11px] font-mono text-red-400';
      if (badgeMobile) {
        badgeMobile.innerText = 'Error';
        badgeMobile.className = 'text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-bold';
      }
    }
  }

  /**
   * Set Pilihan Wilayah Aktif di Antarmuka
   */
  function setActiveRegionDisplay(regionId, regionName) {
    const sel = document.getElementById('selectRegion');
    const selMob = document.getElementById('selectRegionMobile');
    const subtitle = document.getElementById('appSubtitle');

    if (sel) sel.value = regionId;
    if (selMob) selMob.value = regionId;
    if (subtitle) {
      subtitle.innerHTML = `<strong>${regionName}</strong> &bull; Monitoring Tekanan & Debit Pipa`;
    }
  }

  return {
    init,
    toggleDashboard,
    setDashboardCollapsed,
    isDashboardCollapsed: () => isDashboardCollapsed,
    openPressureModal,
    closePressureModal,
    savePressureFromModal,
    deletePressureFromModal,
    openSourceSettingsModal,
    closeSourceSettingsModal,
    updateSourceBadge,
    showPipeDetailCard,
    showPipeDetailCardFromId,
    openPressureModalForNodeId,
    updateSummaryCards,
    renderPipesTable,
    renderJunctionsSidebarTable,
    renderSequentialFlowTable,
    updateCloudStatus,
    setActiveRegionDisplay,
    showToast
  };
})();

// Expose global shortcut untuk inline HTML onclick
window.UIController = UIController;
window.toggleDashboard = () => UIController.toggleDashboard();
window.savePressureFromModal = () => UIController.savePressureFromModal();
window.deletePressureFromModal = () => UIController.deletePressureFromModal();
window.closePressureModal = () => UIController.closePressureModal();
window.openPressureModalForNodeId = (id) => UIController.openPressureModalForNodeId(id);
window.showPipeDetailCardFromId = (id) => UIController.showPipeDetailCardFromId(id);


