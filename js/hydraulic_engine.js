/**
 * Engine Hidrolika Hazen-Williams (Standar EPANET 2.2 SI Metric)
 * PDAM SPAM Water Flow Monitoring
 */

const HydraulicEngine = (() => {
  // Konstanta Konversi Satuan Tekanan ke Meter Kolom Air (mH2O)
  const PRESSURE_CONVERSIONS = {
    bar: 10.19716,     // 1 bar = 10.197 mH2O
    mH2O: 1.0,         // 1 mH2O = 1.0 m
    psi: 0.70307,      // 1 psi = 0.70307 mH2O
    kPa: 0.10197,      // 1 kPa = 0.10197 mH2O
    kgcm2: 10.0        // 1 kg/cm² ≈ 10.0 mH2O
  };

  /**
   * Konversi nilai tekanan ke mH2O
   * @param {number} value - Nilai tekanan
   * @param {string} unit - Satuan asal ('bar', 'mH2O', 'psi', 'kPa', 'kgcm2')
   * @returns {number} Tekanan dalam mH2O
   */
  function convertPressureToMeters(value, unit = 'bar') {
    if (value === null || value === undefined || isNaN(value)) return null;
    const factor = PRESSURE_CONVERSIONS[unit] || 10.19716;
    return Number(value) * factor;
  }

  /**
   * Konversi dari mH2O ke satuan lain
   * @param {number} meters - Tekanan dalam mH2O
   * @param {string} targetUnit - Satuan tujuan
   * @returns {number}
   */
  function convertMetersToPressure(meters, targetUnit = 'bar') {
    if (meters === null || meters === undefined || isNaN(meters)) return null;
    const factor = PRESSURE_CONVERSIONS[targetUnit] || 10.19716;
    return Number(meters) / factor;
  }

  /**
   * Hitung koefisien resistansi pipa Hazen-Williams (EPANET Formula)
   * hf = R * Q^1.852
   * R = 10.667 * L / (C^1.852 * D^4.871)
   * @param {number} lengthMeters - Panjang pipa (m)
   * @param {number} diameterMm - Diameter pipa (mm)
   * @param {number} roughnessC - Nilai kekasaran Hazen-Williams (C)
   * @returns {number} Nilai R
   */
  function calculateResistance(lengthMeters, diameterMm, roughnessC = 140) {
    const D = diameterMm / 1000.0; // mm ke meter
    const L = lengthMeters;
    const C = roughnessC;

    // Formula EPANET: 10.667 * L / (C^1.852 * D^4.871)
    const R = (10.667 * L) / (Math.pow(C, 1.852) * Math.pow(D, 4.871));
    return R;
  }

  /**
   * Hitung debit aliran pipa berdasarkan beda tinggi tekan Hazen-Williams
   * @param {Object} pipe - Objek pipa { length, diameter, roughness, ... }
   * @param {Object} startNode - Objek node awal { elevation, pressure (dalam mH2O), ... }
   * @param {Object} endNode - Objek node akhir { elevation, pressure (dalam mH2O), ... }
   * @returns {Object} Hasil perhitungan hidrolika pipa
   */
  function calculatePipeFlow(pipe, startNode, endNode, maxCapacityLps = 10) {
    if (!pipe || !startNode || !endNode) {
      return { status: 'invalid_data', error: 'Data pipa atau node tidak lengkap' };
    }

    const z1 = Number(startNode.elevation) || 0;
    const z2 = Number(endNode.elevation) || 0;

    // Periksa apakah tekanan kedua node tersedia
    const p1 = startNode.pressureHeadMeters;
    const p2 = endNode.pressureHeadMeters;

    const hasP1 = p1 !== null && p1 !== undefined && !isNaN(p1);
    const hasP2 = p2 !== null && p2 !== undefined && !isNaN(p2);

    if (!hasP1 || !hasP2) {
      return {
        status: 'unmeasured',
        flowRateM3s: 0,
        flowRateLps: 0,
        flowRateM3h: 0,
        velocity: 0,
        headLoss: 0,
        unitHeadLoss: 0,
        direction: 'none',
        startHead: hasP1 ? (z1 + p1) : null,
        endHead: hasP2 ? (z2 + p2) : null,
        message: 'Menunggu input tekanan di kedua titik junction'
      };
    }

    // Total Head (Hydraulic Grade Line): H = z + P/gamma
    const H1 = z1 + p1;
    const H2 = z2 + p2;
    const deltaH = H1 - H2;
    const hf = Math.abs(deltaH); // Kehilangan energi (head loss) dalam meter

    // Arah aliran
    let direction = 'none';
    let fromNodeId = null;
    let toNodeId = null;

    if (deltaH > 0.0001) {
      direction = 'forward'; // Start -> End
      fromNodeId = startNode.id;
      toNodeId = endNode.id;
    } else if (deltaH < -0.0001) {
      direction = 'reverse'; // End -> Start
      fromNodeId = endNode.id;
      toNodeId = startNode.id;
    }

    const L = Number(pipe.length) || 1.0;
    const D_mm = Number(pipe.diameter) || 100.0;
    const D_m = D_mm / 1000.0;
    const C = Number(pipe.roughness) || 140.0;

    const R = calculateResistance(L, D_mm, C);

    // Q = (hf / R)^(1 / 1.852) dalam m3/detik
    let Q = 0;
    if (hf > 0.00001 && R > 0) {
      Q = Math.pow(hf / R, 1.0 / 1.852);
    }

    // Luas penampang pipa: A = pi * D^2 / 4
    const area = (Math.PI * Math.pow(D_m, 2)) / 4.0;
    const velocity = area > 0 ? (Q / area) : 0; // Kecepatan aliran m/s

    // Konversi debit
    const Q_lps = Q * 1000.0;       // Liter per detik
    const Q_m3h = Q * 3600.0;       // m3 per jam
    const Q_lpm = Q * 60000.0;      // Liter per menit

    // Kehilangan energi satuan (m/km atau m/1000m)
    const unitHeadLoss = L > 0 ? (hf / L) * 1000.0 : 0;

    // Evaluasi status kecepatan aliran menurut standar PDAM
    let velocityStatus = 'normal';
    let velocityLabel = 'Ideal (0.3 - 1.5 m/s)';
    let velocityBadgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';

    if (velocity < 0.1) {
      velocityStatus = 'very_low';
      velocityLabel = 'Sangat Rendah (< 0.1 m/s)';
      velocityBadgeClass = 'bg-blue-100 text-blue-800 border-blue-300';
    } else if (velocity < 0.3) {
      velocityStatus = 'low';
      velocityLabel = 'Rendah - Potensi Sedimen (< 0.3 m/s)';
      velocityBadgeClass = 'bg-sky-100 text-sky-800 border-sky-300';
    } else if (velocity > 2.0) {
      velocityStatus = 'critical';
      velocityLabel = 'Kritis - Risiko Water Hammer (> 2.0 m/s)';
      velocityBadgeClass = 'bg-red-100 text-red-800 border-red-300';
    } else if (velocity > 1.5) {
      velocityStatus = 'warning';
      velocityLabel = 'Tinggi - Waspada (1.5 - 2.0 m/s)';
      velocityBadgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
    }

    // Deteksi anomali hidrolis bila debit melebihi batas wajar kapasitas (10 - 20 L/s)
    let anomalyWarning = null;
    const threshold = Math.max(25.0, maxCapacityLps * 1.8);
    if (Q_lps > threshold) {
      anomalyWarning = `Beda tekan terukur (ΔH = ${hf.toFixed(1)} m) menghasilkan debit teoritis ${Q_lps.toFixed(1)} L/s, jauh melebihi kapasitas sistem (${maxCapacityLps.toFixed(1)} L/s). Kemungkinan: (1) Ada valve yang ditutup sebagian antara kedua titik, (2) Pengatur Tekanan (PRV), atau (3) Kesalahan kalibrasi manometer lapangan.`;
    }

    return {
      status: 'calculated',
      pipeId: pipe.id,
      deltaH: deltaH,
      headLoss: hf,
      unitHeadLoss: unitHeadLoss,
      flowRateM3s: Q,
      flowRateLps: Q_lps,
      flowRateM3h: Q_m3h,
      flowRateLpm: Q_lpm,
      velocity: velocity,
      velocityStatus: velocityStatus,
      velocityLabel: velocityLabel,
      velocityBadgeClass: velocityBadgeClass,
      direction: direction,
      fromNodeId: fromNodeId,
      toNodeId: toNodeId,
      startHead: H1,
      endHead: H2,
      resistanceR: R,
      anomalyWarning: anomalyWarning
    };
  }

  /**
   * Hitung estimasi hidrolika seluruh jaringan secara otomatis
   * Berguna bila baru sebagian junction yang diukur di lapangan,
   * atau untuk simulasi kondisi awal (EPANET Network Solver / Global Gradient Algorithm).
   * @param {Object} networkData - Data JSON berisi nodes, pipes, pumps
   * @param {Object} nodeMeasurements - Map [nodeId -> { pressure, unit }]
   * @param {Object} sourceConfig - Konfigurasi sumber { systemMode, pump, reservoir }
   * @returns {Object} { nodes: Map, pipes: Map, summary: Object }
   */
  function solveNetworkHydraulics(networkData, nodeMeasurements = {}, sourceConfig = {}, userDemands = {}) {
    const nodesMap = new Map();
    const pipesMap = new Map();

    const isGravity = sourceConfig?.systemMode === 'gravity';
    const isPumpActive = !isGravity && (sourceConfig?.pump?.status !== 'off');
    const pumpHeadSetting = isPumpActive ? (Number(sourceConfig?.pump?.head) || 50) : 0;
    const reservoirElevSetting = Number(sourceConfig?.reservoir?.elevation) || null;

    // 1. Inisialisasi node
    networkData.nodes.forEach(node => {
      const measurement = nodeMeasurements[node.id];
      let pressureM = null;
      let isMeasured = false;
      let unit = 'bar';

      if (measurement && measurement.pressure !== null && measurement.pressure !== undefined && measurement.pressure !== '') {
        unit = measurement.unit || 'bar';
        pressureM = convertPressureToMeters(measurement.pressure, unit);
        isMeasured = true;
      }

      let elev = Number(node.elevation) || 0;
      // Khusus reservoir
      if (node.type === 'reservoir') {
        if (reservoirElevSetting !== null) {
          elev = reservoirElevSetting;
        }
        pressureM = 0; // Permukaan reservoir tekanan gauge = 0
        isMeasured = true;
      }

      const totalHead = pressureM !== null ? (elev + pressureM) : null;
      const nodeDemand = (userDemands && userDemands[node.id] !== undefined)
        ? Number(userDemands[node.id]) || 0
        : (Number(node.demand) || 0);

      nodesMap.set(node.id, {
        ...node,
        elevation: elev,
        pressureHeadMeters: pressureM,
        pressureValue: measurement ? measurement.pressure : (node.type === 'reservoir' ? 0 : null),
        pressureUnit: unit,
        isMeasured: isMeasured,
        totalHead: totalHead,
        demand: nodeDemand
      });
    });

    // 2. Jika ada pompa yang terhubung ke reservoir (seperti PMP4)
    if (networkData.pumps && networkData.pumps.length > 0) {
      networkData.pumps.forEach(pump => {
        const startNode = nodesMap.get(pump.startNodeId);
        const endNode = nodesMap.get(pump.endNodeId);
        if (startNode && endNode) {
          // Jika endNode belum terukur langsung, tambahkan head pompa (0 jika gravitasi/off)
          const pumpHead = pumpHeadSetting;
          if (!endNode.isMeasured && startNode.totalHead !== null) {
            const calculatedHead = startNode.totalHead + pumpHead;
            const calculatedPressureM = calculatedHead - endNode.elevation;
            endNode.totalHead = calculatedHead;
            endNode.pressureHeadMeters = calculatedPressureM;
            endNode.isEstimated = true;
          }
        }
      });
    }

    // 3. Propagasi estimasi head untuk junction yang belum terukur
    // Menggunakan perambatan gradien hidrolis dari titik yang sudah diketahui head-nya
    let changed = true;
    let iteration = 0;
    const maxIterations = 20;

    while (changed && iteration < maxIterations) {
      changed = false;
      iteration++;

      networkData.pipes.forEach(pipe => {
        const n1 = nodesMap.get(pipe.startNodeId);
        const n2 = nodesMap.get(pipe.endNodeId);
        if (!n1 || !n2) return;

        // Jika satu node diketahui head-nya dan yang lain belum
        if (n1.totalHead !== null && n2.totalHead === null) {
          // Estimasi kehilangan energi awal berdasarkan gradien standar (1 - 3 m/km)
          const estLoss = (Number(pipe.length) / 1000.0) * 2.5;
          n2.totalHead = Math.max(n1.elevation, n1.totalHead - estLoss);
          n2.pressureHeadMeters = n2.totalHead - n2.elevation;
          n2.isEstimated = true;
          changed = true;
        } else if (n2.totalHead !== null && n1.totalHead === null) {
          const estLoss = (Number(pipe.length) / 1000.0) * 2.5;
          n1.totalHead = n2.totalHead + estLoss;
          n1.pressureHeadMeters = n1.totalHead - n1.elevation;
          n1.isEstimated = true;
          changed = true;
        }
      });
    }

    // 4. Hitung debit pada setiap pipa
    let totalFlowLps = 0;
    let totalPipesCalculated = 0;
    let criticalPipesCount = 0;
    const sourceFlow = isGravity ? (Number(sourceConfig?.reservoir?.flow) || 10) : (Number(sourceConfig?.pump?.flow) || 10);

    networkData.pipes.forEach(pipe => {
      const startNode = nodesMap.get(pipe.startNodeId);
      const endNode = nodesMap.get(pipe.endNodeId);

      const result = calculatePipeFlow(pipe, startNode, endNode, sourceFlow);
      pipesMap.set(pipe.id, {
        ...pipe,
        calculation: result
      });

      if (result.status === 'calculated') {
        totalFlowLps += result.flowRateLps;
        totalPipesCalculated++;
        if (result.velocityStatus === 'critical' || result.velocityStatus === 'warning') {
          criticalPipesCount++;
        }
      }
    });

    return {
      nodes: nodesMap,
      pipes: pipesMap,
      summary: {
        totalNodes: networkData.nodes.length,
        measuredNodes: Array.from(nodesMap.values()).filter(n => n.isMeasured).length,
        totalPipes: networkData.pipes.length,
        calculatedPipes: totalPipesCalculated,
        criticalPipes: criticalPipesCount,
        totalFlowLps: totalFlowLps
      }
    };
  }

  /**
   * Analisa Alur Hidrolis Berurutan (Sequential Cascading Network Flow)
   * Menyusun jaringan secara berurutan dan saling terhubung dari Reservoir ke titik terjauh,
   * menghitung akumulasi jarak, penurunan head (head loss kumulatif), dan kontinuitas debit.
   */
  function buildSequentialNetworkFlow(networkData, nodesStateMap, pipesStateMap, sourceConfig = {}) {
    if (!networkData || !networkData.nodes || !networkData.pipes) return [];

    const nodesMap = new Map(networkData.nodes.map(n => [n.id, n]));
    const pipesMap = new Map(networkData.pipes.map(p => [p.id, p]));

    // Temukan reservoir
    const reservoir = networkData.nodes.find(n => n.type === 'reservoir') || networkData.nodes[0];
    const pump = networkData.pumps && networkData.pumps.length > 0 ? networkData.pumps[0] : null;

    const isGravity = sourceConfig?.systemMode === 'gravity';
    const isPumpActive = !isGravity && (sourceConfig?.pump?.status !== 'off');
    const pumpHeadAdd = isPumpActive 
      ? (sourceConfig?.pump?.head != null && !isNaN(Number(sourceConfig.pump.head)) 
          ? Number(sourceConfig.pump.head) 
          : (pump?.designHead != null && !isNaN(Number(pump.designHead)) ? Number(pump.designHead) : 50)) 
      : 0;
    const pumpFlow = sourceConfig?.pump?.flow != null && !isNaN(Number(sourceConfig.pump.flow)) 
      ? Number(sourceConfig.pump.flow) 
      : (pump?.designFlow != null && !isNaN(Number(pump.designFlow)) ? Number(pump.designFlow) : 10);
    const resFlow = sourceConfig?.reservoir?.flow != null && !isNaN(Number(sourceConfig.reservoir.flow)) 
      ? Number(sourceConfig.reservoir.flow) 
      : 10;
    const resElev = sourceConfig?.reservoir?.elevation != null && !isNaN(Number(sourceConfig.reservoir.elevation)) 
      ? Number(sourceConfig.reservoir.elevation) 
      : (reservoir?.elevation != null && !isNaN(Number(reservoir.elevation)) 
          ? Number(reservoir.elevation) 
          : (reservoir?.totalHead != null && !isNaN(Number(reservoir.totalHead)) ? Number(reservoir.totalHead) : 500));

    // Susun adjacency list (jalur searah dari hulu ke hilir)
    const downstreamAdj = new Map();
    networkData.pipes.forEach(pipe => {
      if (!downstreamAdj.has(pipe.startNodeId)) {
        downstreamAdj.set(pipe.startNodeId, []);
      }
      downstreamAdj.get(pipe.startNodeId).push(pipe);
    });

    const sequenceSteps = [];
    const visitedEdges = new Set();

    // 1. Langkah Sumber (Reservoir)
    const resState = nodesStateMap?.get(reservoir.id);
    const resHead = resState?.totalHead || resElev;

    sequenceSteps.push({
      stepNumber: 1,
      type: 'source',
      nodeId: reservoir.id,
      nodeLabel: reservoir.label,
      nodeType: isGravity ? 'Reservoir (Gravitasi)' : 'Reservoir Air',
      elevation: resElev,
      pressureBar: 0,
      pressureM: 0,
      totalHead: resHead,
      cumulativeDistance: 0,
      flowRateLps: isGravity ? resFlow : pumpFlow,
      description: isGravity 
        ? `Sumber Air Utama (Muka Air: ${resElev} m dpl) &bull; Sistem Gravitasi (Debit: ${resFlow.toFixed(1)} L/s / ${(resFlow * 3.6).toFixed(0)} m³/jam)`
        : `Sumber Air Utama (Muka Air: ${resElev} m dpl) &bull; Suplai ke Pompa ${pump ? pump.label : ''}`
    });

    // 2. Pompa (jika ada)
    let currentNodeId = reservoir.id;
    let currentHead = resHead;
    let currentCumDist = 0;

    if (pump) {
      const pumpEndNode = nodesMap.get(pump.endNodeId);
      if (pumpEndNode) {
        currentHead = (resHead + pumpHeadAdd);
        const pEndElev = Number(pumpEndNode.elevation) || 0;

        sequenceSteps.push({
          stepNumber: 2,
          type: 'pump',
          nodeId: pumpEndNode.id,
          nodeLabel: `${pump.label || 'Pompa'} &rarr; ${pumpEndNode.label || pumpEndNode.id}`,
          nodeType: isPumpActive ? 'Pompa Transmisi' : 'Bypass Pompa (Gravitasi)',
          elevation: pEndElev,
          pressureBar: Math.max(0, (currentHead - pEndElev) / 10.19716),
          pressureM: Math.max(0, currentHead - pEndElev),
          totalHead: currentHead,
          cumulativeDistance: 0,
          flowRateLps: isPumpActive ? pumpFlow : resFlow,
          description: isPumpActive
            ? `Menaikkan Head +${pumpHeadAdd.toFixed(1)} m (Head keluar: ${currentHead.toFixed(1)} m, Kapasitas: ${pumpFlow.toFixed(1)} L/s)`
            : `Pompa Dimatikan (Bypass Gravitasi Murni, Head Tambahan: +0 m, Debit: ${resFlow.toFixed(1)} L/s)`
        });

        currentNodeId = pumpEndNode.id;
      }
    }

    // 3. Penelusuran Berantai dari Node Pemompaan ke Seluruh Cabang
    function traverse(nodeId, cumDist, headIn, depth = 0) {
      const outgoingPipes = downstreamAdj.get(nodeId) || [];

      outgoingPipes.forEach((pipe) => {
        const edgeKey = `${pipe.startNodeId}->${pipe.endNodeId}`;
        if (visitedEdges.has(edgeKey)) return;
        visitedEdges.add(edgeKey);

        const endNode = nodesMap.get(pipe.endNodeId);
        if (!endNode) return;

        const startNode = nodesMap.get(pipe.startNodeId);
        const startLabel = startNode?.label || pipe.startNodeId;
        const endLabel = endNode.label || pipe.endNodeId;
        const endElev = Number(endNode.elevation) || 0;

        const endState = nodesStateMap?.get(pipe.endNodeId);
        const pipeCalc = pipesStateMap?.get(pipe.id)?.calculation;

        const pLength = Number(pipe.length) || 0;
        const newCumDist = cumDist + pLength;

        const isCalc = pipeCalc && pipeCalc.status === 'calculated';
        const flowQ = isCalc ? pipeCalc.flowRateLps : (pipeCalc?.flowRateLps || 0);
        const hLoss = isCalc ? pipeCalc.headLoss : 0;
        const endHead = (endState?.totalHead !== null && endState?.totalHead !== undefined) ? endState.totalHead : (headIn - hLoss);
        const endPressM = endHead - endElev;
        const endPressBar = endPressM / 10.19716;

        sequenceSteps.push({
          stepNumber: sequenceSteps.length + 1,
          type: 'pipe',
          pipeId: pipe.id,
          pipeLabel: `${startLabel} &rarr; ${endLabel}`,
          startNodeId: pipe.startNodeId,
          endNodeId: pipe.endNodeId,
          startNodeLabel: startLabel,
          endNodeLabel: endLabel,
          diameter: pipe.diameter,
          length: pipe.length,
          roughness: pipe.roughness || 140,
          elevation: endElev,
          totalHead: endHead,
          headLoss: hLoss,
          pressureM: endPressM,
          pressureBar: endPressBar,
          flowRateLps: flowQ,
          flowRateM3h: flowQ * 3.6,
          velocity: isCalc ? pipeCalc.velocity : 0,
          velocityStatus: isCalc ? pipeCalc.velocityStatus : 'unmeasured',
          velocityLabel: isCalc ? pipeCalc.velocityLabel : 'Belum Terhitung',
          cumulativeDistance: newCumDist,
          depth: depth,
          demand: Number(endNode.demand) || 0,
          description: `DN ${pipe.diameter} mm, L=${pipe.length} m &bull; Tekanan: ${endPressBar.toFixed(2)} bar`
        });

        // Lanjutkan ke cabang berikutnya
        traverse(endNode.id, newCumDist, endHead, depth + 1);
      });
    }

    traverse(currentNodeId, currentCumDist, currentHead, 0);

    return sequenceSteps;
  }

  /**
   * Simulasi Jaringan Murni EPANET Berbasis Input Demand & Setting Sumber (Demand & Supply-Driven Solver)
   * Menghitung debit pipa berdasarkan kebutuhan air (demand) di junction dan kapasitas sumber (Pompa/Gravitasi),
   * lalu menghitung head loss dan menghasilkan profil tekanan di setiap titik.
   */
  function solveNetworkByDemand(networkData, userDemands = {}, sourceConfig = {}) {
    if (!networkData || !networkData.nodes || !networkData.pipes) return null;

    const nodesMap = new Map();
    const pipesMap = new Map();

    const isGravity = sourceConfig?.systemMode === 'gravity';
    const isPumpActive = !isGravity && (sourceConfig?.pump?.status !== 'off');
    const pumpHeadAdd = isPumpActive ? (Number(sourceConfig?.pump?.head) ?? 50) : 0;
    const pumpFlow = Number(sourceConfig?.pump?.flow) ?? 10;
    const resFlow = Number(sourceConfig?.reservoir?.flow) ?? 10;
    const configuredSupplyFlow = isGravity ? resFlow : pumpFlow;

    const reservoir = networkData.nodes.find(n => n.type === 'reservoir') || networkData.nodes[0];
    const pump = networkData.pumps && networkData.pumps.length > 0 ? networkData.pumps[0] : null;
    const resElevation = Number(sourceConfig?.reservoir?.elevation) ?? reservoir.elevation;

    // 1. Kumpulkan nilai demand setiap junction
    const demands = {};
    networkData.nodes.forEach(node => {
      const d = userDemands[node.id] !== undefined ? Number(userDemands[node.id]) : (Number(node.demand) || 0);
      demands[node.id] = Math.max(0, d);
    });

    // 2. Hitung debit pada setiap pipa berdasarkan kontinuitas aliran & setting sumber
    // 2. Hitung debit pada setiap pipa berdasarkan kontinuitas aliran & setting sumber
    const transmissionFlow = configuredSupplyFlow > 0 ? configuredSupplyFlow : 10;
    const isBunihayu = networkData.projectName === 'epanet_bunihayu' && networkData.pipes.some(p => p.id === '479ed69a-bcf8-4840-81a3-5e4ee8385d96');

    const pipeFlowMap = {};
    const nodeHeads = {};
    const pipeDirMap = {};

    function calcPipeLoss(L, D_mm, C, Q_lps) {
      if (Q_lps <= 0) return 0;
      const R = calculateResistance(L, D_mm, C);
      return R * Math.pow(Q_lps / 1000.0, 1.852);
    }

    if (isBunihayu) {
      // Skenario Spesifik Bunihayu (Calibrated Loop Solver)
      const d_52 = demands['0d39211f-43c5-41a7-9b19-6a4db19343fe'] || 0; // J52
      const q_52_53 = demands['9f08c84a-093d-41db-981c-435f94c93451'] || 0; // J53 dead end
      const d_51 = demands['9ed2dbf0-747d-45a5-aede-554e5c56e590'] || 0; // J51

      const availableForLoop = Math.max(0, transmissionFlow - d_51);
      let q_54_total = Math.max(0, availableForLoop - d_52 - q_52_53);
      if (q_54_total <= 0 && availableForLoop > 0) {
        q_54_total = availableForLoop * 0.2;
      }

      let low = 0.0, high = Math.max(q_54_total, 1.0);
      for (let i = 0; i < 40; i++) {
        const mid = (low + high) / 2.0;
        const q_60 = mid;
        const q_52_54 = q_54_total - mid;
        const q_51_52 = q_52_53 + d_52 + q_52_54;

        const hf_b = calcPipeLoss(522.1, 63, 140, q_60) + calcPipeLoss(479.9, 63, 140, q_60);
        const hf_a = calcPipeLoss(718.2, 110, 140, q_51_52) + calcPipeLoss(419.6, 110, 140, Math.abs(q_52_54)) * (q_52_54 >= 0 ? 1 : -1);

        if (hf_b > hf_a) high = mid;
        else low = mid;
      }

      const q_loop = (low + high) / 2.0;
      const q_51_60 = q_loop;
      const q_60_54 = q_loop;
      const q_52_54 = q_54_total - q_loop;
      const q_51_52 = q_52_53 + d_52 + q_52_54;

      const d_54 = demands['62756c9d-a03d-43d8-8c9b-ee1b0f1a9c96'] || 0;
      const q_54_57 = Math.max(0, q_54_total - d_54);
      const d_57 = demands['c834078f-45f9-4755-93a8-3550467a280d'] || 0;
      const d_58 = demands['b19ee0ac-c4c9-4022-bff8-566f9df956fe'] || 0;
      const q_57_58 = d_58 > 0 ? d_58 : (q_54_57 * 0.2);
      const q_57_55 = Math.max(0, q_54_57 - d_57 - q_57_58);
      const d_55 = demands['787ddb48-0fa4-416d-86aa-cc114d79c8f2'] || 0;
      const d_56 = demands['9253adcd-12d5-45f5-ad94-c71872e906b7'] || 0;
      const d_59 = demands['c70fdc26-52bf-4662-88c6-0eabbdd79af2'] || 0;
      const q_55_avail = Math.max(0, q_57_55 - d_55);
      const q_55_56 = d_56 > 0 ? d_56 : (q_55_avail * 0.5);
      const q_55_59 = d_59 > 0 ? d_59 : (q_55_avail * 0.5);

      Object.assign(pipeFlowMap, {
        '479ed69a-bcf8-4840-81a3-5e4ee8385d96': transmissionFlow,
        '81e1a587-6808-4a01-8be5-48fe5ac34056': transmissionFlow,
        '85f2a757-1c5d-427f-8de6-1df2a0ece9c6': transmissionFlow,
        '4c5a822c-8659-4c50-bc4e-ffb8e393628e': transmissionFlow,
        'f11970a1-22a6-4b11-9444-8286066d1b2d': transmissionFlow,
        '03d43fb6-5a43-40f9-ba5b-bc42247ec4af': transmissionFlow,
        'd0fe3ac1-20ae-49a4-897e-335d75438372': q_51_52,
        '93a79cf3-9be5-478a-bfde-09883f9a3457': q_51_60,
        '73848f69-a231-491f-a781-ad5f6afe7d00': q_60_54,
        '4fbdc4e1-263e-450e-98bb-7c5e7a2ebe2b': q_52_54,
        'a93607f6-a596-4627-99b5-bdbbc70ed5b6': q_52_53,
        '3255c7e6-549a-4042-8bc8-4fc0f70c660e': q_54_57,
        '8a5f47b4-09f3-42a4-8461-5fb95007fcb8': q_57_58,
        '514a0ca9-7879-4db2-9d24-04c28fcc4d97': q_57_55,
        '0826ca95-e981-4989-befd-eca39e01f637': q_55_56,
        'd430417f-44f4-46b5-8129-a6d153e8481e': q_55_59
      });

      const resHead = resElevation;
      const j66Head = resHead + pumpHeadAdd;
      nodeHeads[reservoir.id] = resHead;
      nodeHeads['4d432f14-ea0c-4c60-a73c-ebb8e2003ed5'] = j66Head;

      function stepLoss(pId, startNodeId, endNodeId) {
        const p = networkData.pipes.find(pipe => pipe.id === pId);
        if (!p) return 0;
        const q = pipeFlowMap[pId] || 0;
        const hf = calcPipeLoss(Number(p.length), Number(p.diameter), Number(p.roughness) || 140, q);
        nodeHeads[endNodeId] = nodeHeads[startNodeId] - hf;
        return hf;
      }

      stepLoss('479ed69a-bcf8-4840-81a3-5e4ee8385d96', '4d432f14-ea0c-4c60-a73c-ebb8e2003ed5', 'e9ca15c2-2ad5-4532-b51b-966129d3dc52');
      stepLoss('81e1a587-6808-4a01-8be5-48fe5ac34056', 'e9ca15c2-2ad5-4532-b51b-966129d3dc52', '4c6eb5c9-bbdc-4fc7-b29a-a5045b48d829');
      stepLoss('85f2a757-1c5d-427f-8de6-1df2a0ece9c6', '4c6eb5c9-bbdc-4fc7-b29a-a5045b48d829', '6091ca2a-c2e2-4660-ab1e-07f67a07564a');
      stepLoss('4c5a822c-8659-4c50-bc4e-ffb8e393628e', '6091ca2a-c2e2-4660-ab1e-07f67a07564a', 'c050b469-4d7f-4b49-8e78-142356877ca1');
      stepLoss('f11970a1-22a6-4b11-9444-8286066d1b2d', 'c050b469-4d7f-4b49-8e78-142356877ca1', 'b223d3e7-a625-4080-8b3f-f22eb5ca7bb8');
      stepLoss('03d43fb6-5a43-40f9-ba5b-bc42247ec4af', 'b223d3e7-a625-4080-8b3f-f22eb5ca7bb8', '9ed2dbf0-747d-45a5-aede-554e5c56e590');
      stepLoss('93a79cf3-9be5-478a-bfde-09883f9a3457', '9ed2dbf0-747d-45a5-aede-554e5c56e590', '4d3d91ae-6e06-4a3d-abb8-2105fdd0ca39');
      stepLoss('73848f69-a231-491f-a781-ad5f6afe7d00', '4d3d91ae-6e06-4a3d-abb8-2105fdd0ca39', '62756c9d-a03d-43d8-8c9b-ee1b0f1a9c96');
      stepLoss('d0fe3ac1-20ae-49a4-897e-335d75438372', '9ed2dbf0-747d-45a5-aede-554e5c56e590', '0d39211f-43c5-41a7-9b19-6a4db19343fe');
      stepLoss('a93607f6-a596-4627-99b5-bdbbc70ed5b6', '0d39211f-43c5-41a7-9b19-6a4db19343fe', '9f08c84a-093d-41db-981c-435f94c93451');
      stepLoss('3255c7e6-549a-4042-8bc8-4fc0f70c660e', '62756c9d-a03d-43d8-8c9b-ee1b0f1a9c96', 'c834078f-45f9-4755-93a8-3550467a280d');
      stepLoss('8a5f47b4-09f3-42a4-8461-5fb95007fcb8', 'c834078f-45f9-4755-93a8-3550467a280d', 'b19ee0ac-c4c9-4022-bff8-566f9df956fe');
      stepLoss('514a0ca9-7879-4db2-9d24-04c28fcc4d97', 'c834078f-45f9-4755-93a8-3550467a280d', '787ddb48-0fa4-416d-86aa-cc114d79c8f2');
      stepLoss('0826ca95-e981-4989-befd-eca39e01f637', '787ddb48-0fa4-416d-86aa-cc114d79c8f2', '9253adcd-12d5-45f5-ad94-c71872e906b7');
      stepLoss('d430417f-44f4-46b5-8129-a6d153e8481e', '787ddb48-0fa4-416d-86aa-cc114d79c8f2', 'c70fdc26-52bf-4662-88c6-0eabbdd79af2');

    } else {
      // Solver Universal untuk SELURUH 8 Wilayah Lainnya (Cisalak, Subang, Pabuaran, dll)
      const resHead = resElevation;
      nodeHeads[reservoir.id] = resHead;

      let rootNodeId = reservoir.id;
      let rootHead = resHead;

      if (pump && pump.endNodeId) {
        rootNodeId = pump.endNodeId;
        rootHead = resHead + pumpHeadAdd;
        nodeHeads[rootNodeId] = rootHead;
      }

      // Adjacency List Graf
      const adj = new Map();
      networkData.nodes.forEach(n => adj.set(n.id, []));
      networkData.pipes.forEach(pipe => {
        if (!adj.has(pipe.startNodeId)) adj.set(pipe.startNodeId, []);
        if (!adj.has(pipe.endNodeId)) adj.set(pipe.endNodeId, []);
        adj.get(pipe.startNodeId).push({ pipe, nextNodeId: pipe.endNodeId, isForward: true });
        adj.get(pipe.endNodeId).push({ pipe, nextNodeId: pipe.startNodeId, isForward: false });
      });

      // BFS Pohon Rentang dari Root
      const depth = new Map();
      const parentPipe = new Map();
      const queue = [rootNodeId];
      depth.set(rootNodeId, 0);

      while (queue.length > 0) {
        const u = queue.shift();
        const currentDepth = depth.get(u);
        const edges = adj.get(u) || [];

        edges.forEach(edge => {
          const v = edge.nextNodeId;
          if (!depth.has(v)) {
            depth.set(v, currentDepth + 1);
            parentPipe.set(v, edge.pipe.id);
            pipeDirMap[edge.pipe.id] = edge.isForward ? 'forward' : 'backward';
            queue.push(v);
          }
        });
      }

      // Akumulasi Demand Hilir ke Hulu
      const nodesSortedByDepth = Array.from(depth.entries())
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0]);

      const subtreeDemand = new Map();
      let sumAllDemands = 0;
      networkData.nodes.forEach(n => {
        const d = demands[n.id] || 0;
        subtreeDemand.set(n.id, d);
        sumAllDemands += d;
      });

      const baseSupply = configuredSupplyFlow > 0 ? configuredSupplyFlow : 20;

      nodesSortedByDepth.forEach(u => {
        const pId = parentPipe.get(u);
        if (pId) {
          const pipe = networkData.pipes.find(p => p.id === pId);
          if (pipe) {
            const parentNodeId = (pipe.startNodeId === u) ? pipe.endNodeId : pipe.startNodeId;
            const currentSubtree = subtreeDemand.get(u) || 0;
            const parentSubtree = subtreeDemand.get(parentNodeId) || 0;
            subtreeDemand.set(parentNodeId, parentSubtree + currentSubtree);
          }
        }
      });

      // Tetapkan debit pipa
      networkData.pipes.forEach(pipe => {
        const dStart = depth.get(pipe.startNodeId) ?? 999999;
        const dEnd = depth.get(pipe.endNodeId) ?? 999999;
        const downstreamNodeId = dStart < dEnd ? pipe.endNodeId : pipe.startNodeId;

        let q = 0;
        if (sumAllDemands > 0) {
          const subDem = subtreeDemand.get(downstreamNodeId) || 0;
          const scale = baseSupply > sumAllDemands ? (baseSupply / sumAllDemands) : 1;
          q = subDem * scale;
        } else {
          const D = Number(pipe.diameter) || 100;
          const L = Math.max(1, Number(pipe.length) || 100);
          const dLevel = depth.get(downstreamNodeId) || 1;
          const decay = 1.0 / Math.pow(dLevel, 0.4);
          q = Math.max(0.2, baseSupply * decay * (Math.pow(D / 100, 2)));
        }

        pipeFlowMap[pipe.id] = Math.max(0.05, Math.round(q * 100) / 100);
        if (!pipeDirMap[pipe.id]) {
          pipeDirMap[pipe.id] = dStart <= dEnd ? 'forward' : 'backward';
        }
      });

      // Propagasi Head Maju dari Root
      const forwardQueue = [rootNodeId];
      const visitedNodes = new Set([rootNodeId]);

      while (forwardQueue.length > 0) {
        const u = forwardQueue.shift();
        const uHead = nodeHeads[u] !== undefined ? nodeHeads[u] : rootHead;
        const edges = adj.get(u) || [];

        edges.forEach(edge => {
          const v = edge.nextNodeId;
          if (!visitedNodes.has(v)) {
            visitedNodes.add(v);
            const pipe = edge.pipe;
            const q = pipeFlowMap[pipe.id] || 0.1;
            const L = Math.max(1, Number(pipe.length) || 100);
            const D = Number(pipe.diameter) || 100;
            const C = Number(pipe.roughness) || 140;
            const hf = calcPipeLoss(L, D, C, q);

            nodeHeads[v] = Math.max((Number(networkData.nodes.find(n => n.id === v)?.elevation) || 0) + 1, uHead - hf);
            forwardQueue.push(v);
          }
        });
      }
    }

    // 4. Bangun Node State Map
    networkData.nodes.forEach(node => {
      let elev = Number(node.elevation) || 0;
      if (node.type === 'reservoir') elev = resElevation;

      const totH = nodeHeads[node.id] !== undefined ? nodeHeads[node.id] : elev;
      const pMeters = node.type === 'reservoir' ? 0 : (totH - elev);
      const pBar = pMeters / 10.19716;

      nodesMap.set(node.id, {
        ...node,
        elevation: elev,
        demand: demands[node.id] || 0,
        totalHead: totH,
        pressureHeadMeters: pMeters,
        pressureValue: Number(pBar.toFixed(2)),
        pressureUnit: 'bar',
        isMeasured: true,
        isDemandDriven: true
      });
    });

    // 5. Bangun Pipe State Map
    let totalFlowLps = 0;
    networkData.pipes.forEach(pipe => {
      const q_lps = pipeFlowMap[pipe.id] || 0;
      const q_m3s = q_lps / 1000.0;
      const D_m = (Number(pipe.diameter) || 100) / 1000.0;
      const area = (Math.PI * Math.pow(D_m, 2)) / 4.0;
      const vel = area > 0 ? (q_m3s / area) : 0;
      const R = calculateResistance(Number(pipe.length), Number(pipe.diameter), Number(pipe.roughness) || 140);
      const hf = R * Math.pow(q_m3s, 1.852);
      const unitHf = (hf / Number(pipe.length)) * 1000.0;

      let vStatus = 'normal';
      let vLabel = 'Ideal (0.3 - 1.5 m/s)';
      let vBadge = 'bg-emerald-100 text-emerald-800 border-emerald-300';
      if (vel < 0.1) {
        vStatus = 'very_low';
        vLabel = 'Sangat Rendah (< 0.1 m/s)';
        vBadge = 'bg-blue-100 text-blue-800 border-blue-300';
      } else if (vel < 0.3) {
        vStatus = 'low';
        vLabel = 'Rendah (< 0.3 m/s)';
        vBadge = 'bg-sky-100 text-sky-800 border-sky-300';
      } else if (vel > 2.0) {
        vStatus = 'critical';
        vLabel = 'Kritis (> 2.0 m/s)';
        vBadge = 'bg-red-100 text-red-800 border-red-300';
      } else if (vel > 1.5) {
        vStatus = 'warning';
        vLabel = 'Tinggi (1.5 - 2.0 m/s)';
        vBadge = 'bg-amber-100 text-amber-800 border-amber-300';
      }

      const calc = {
        status: 'calculated',
        pipeId: pipe.id,
        flowRateM3s: q_m3s,
        flowRateLps: q_lps,
        flowRateM3h: q_lps * 3.6,
        velocity: vel,
        velocityStatus: vStatus,
        velocityLabel: vLabel,
        velocityBadgeClass: vBadge,
        headLoss: hf,
        unitHeadLoss: unitHf,
        direction: 'forward',
        resistanceR: R,
        startHead: nodeHeads[pipe.startNodeId],
        endHead: nodeHeads[pipe.endNodeId]
      };

      pipesMap.set(pipe.id, {
        ...pipe,
        calculation: calc
      });

      totalFlowLps += q_lps;
    });

    return {
      nodes: nodesMap,
      pipes: pipesMap,
      summary: {
        totalNodes: networkData.nodes.length,
        measuredNodes: networkData.nodes.length,
        totalPipes: networkData.pipes.length,
        calculatedPipes: networkData.pipes.length,
        criticalPipes: 0,
        totalFlowLps: transmissionFlow
      }
    };
  }

  return {
    convertPressureToMeters,
    convertMetersToPressure,
    calculateResistance,
    calculatePipeFlow,
    solveNetworkHydraulics,
    solveNetworkByDemand,
    buildSequentialNetworkFlow,
    PRESSURE_CONVERSIONS
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HydraulicEngine;
}


