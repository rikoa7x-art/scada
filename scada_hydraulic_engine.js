/**
 * SCADA Hydraulic Engine & State Estimation
 * Perhitungan Debit Aliran (Q) Berdasarkan Beda Tekanan Lapangan & Parameter Jaringan Pipa Subang
 * Standar: Persamaan Hazen-Williams, Head Loss, dan Evaluasi Kecepatan SNI/PDAM
 */

(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.ScadaHydraulicEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {

  // Konstanta Fisika Hidrolika
  const HW_EXPONENT = 1.852;          // Eksponen Hazen-Williams
  const HEAD_PER_BAR = 10.197;        // 1 bar = 10.197 meter kolom air
  const GRAVITY = 9.81;               // m/s^2

  // Nilai Koefisien Kekasaran Pipa (C-Factor Hazen-Williams)
  const DEFAULT_C_FACTORS = {
    'DCI': 120,          // Ductile Cast Iron
    'Cast Iron': 100,    // Besi Cor lama
    'PVC': 140,          // Polivinil Klorida
    'HDPE': 140,         // High-Density Polyethylene
    'Steel': 110,        // Baja
    'Galvanized': 100    // Galvanis
  };

  // Tabel Diameter Dalam Nominal ke Internal (mm)
  const INTERNAL_DIAMETERS = {
    50: 44.0,
    75: 66.0,
    100: 88.0,
    150: 132.2,
    200: 176.2,
    250: 220.4,
    300: 264.4,
    350: 312.8,
    400: 352.6,
    450: 396.6,
    500: 440.6,
    600: 528.8
  };

  /**
   * Mendapatkan diameter internal efektif pipa (dalam meter)
   */
  function getInternalDiameterMeters(nominalDiameterMm) {
    const d = INTERNAL_DIAMETERS[nominalDiameterMm] || (nominalDiameterMm * 0.9);
    return d / 1000.0;
  }

  /**
   * Mendapatkan koefisien Hazen-Williams C
   */
  function getRoughnessC(material, customRoughness) {
    if (customRoughness && customRoughness > 40 && customRoughness < 160) {
      return customRoughness;
    }
    return DEFAULT_C_FACTORS[material] || 140;
  }

  /**
   * Menghitung Resistansi Hidrolis Pipa (koefisien hambatan Hazen-Williams)
   * R = 10.67 × L / (C^1.852 × D^4.871)
   *
   * R digunakan untuk interpolasi head antar simpul:
   * - R besar  → pipa panjang/kecil/kasar → head loss besar per satuan Q
   * - R kecil  → pipa pendek/besar/halus  → head loss kecil
   *
   * @returns {number} Resistansi (dimensi: m / (m³/s)^1.852)
   */
  function computePipeResistance(lengthM, nominalDiameterMm, cFactor) {
    const D = getInternalDiameterMeters(nominalDiameterMm);
    const L = Math.max(1.0, Number(lengthM) || 10.0);
    const C = Math.max(50, Math.min(160, Number(cFactor) || 140));
    if (D <= 0) return Infinity;
    return (10.67 * L) / (Math.pow(C, HW_EXPONENT) * Math.pow(D, 4.871));
  }

  /**
   * Interpolasi Hidrolis Head untuk Node Tanpa Data (Telemetri / EPANET)
   *
   * Algoritma:
   * 1. Bangun graf adjacency berbasis resistansi pipa (R_ij)
   * 2. Untuk setiap node unknown, jalankan Dijkstra untuk menemukan
   *    semua "boundary node" (node dengan head diketahui) terdekat
   *    secara hidrolis — BUKAN secara geografis
   * 3. Interpolasi head menggunakan CONDUCTANCE-WEIGHTED formula:
   *
   *    H_n = Σ(H_i / R_i) / Σ(1 / R_i)
   *
   *    Ini adalah penyelesaian persamaan kontinuitas linearisasi:
   *    Σ Q_i = Σ (H_i - H_n) / R_i = 0  ←→ hukum kekekalan massa di node n
   *
   * Hasilnya: Q Pipa_A ≈ Q Pipa_B untuk jalur seri (tidak ada lompatan debit
   * yang tidak fisik hanya karena satu node tidak punya data sensor).
   *
   * @param {Array}  updatedNodes - array node hasil inisialisasi head
   * @param {Map}    nodeMap      - Map nodeId → node object
   * @param {Array}  pipes        - array seluruh ruas pipa jaringan
   */
  function hydraulicInterpolateNodes(updatedNodes, nodeMap, pipes) {
    // Definisi "node yang headnya sudah diketahui"
    const isKnown = (n) => n && (
      n.hasTelemetry    ||
      n.type === 'reservoir' ||
      n.type === 'tank'      ||
      n.isPumpBoosted        ||
      n.hasEpanetPressure
    );

    // Bangun adjacency list berbobot resistansi
    const adjacency = new Map();
    updatedNodes.forEach(n => adjacency.set(n.id, []));
    pipes.forEach(p => {
      if (!p.startNodeId || !p.endNodeId) return;
      if (!adjacency.has(p.startNodeId)) adjacency.set(p.startNodeId, []);
      if (!adjacency.has(p.endNodeId))   adjacency.set(p.endNodeId, []);
      const C = getRoughnessC(p.material, p.roughness);
      const R = computePipeResistance(p.length, p.diameter, C);
      adjacency.get(p.startNodeId).push({ nodeId: p.endNodeId,   R });
      adjacency.get(p.endNodeId).push(  { nodeId: p.startNodeId, R });
    });

    updatedNodes.forEach(n => {
      // Lewati node yang sudah diketahui headnya atau bukan junction
      if (isKnown(n) || n.type !== 'junction') return;

      // ─── Dijkstra dari node n ke seluruh boundary ───────────────────
      // Tujuan: temukan semua "boundary node" (known head) yang paling
      // dekat secara hidrolis (minimum accumulated resistance), bukan jarak fisik.
      const dist     = new Map([[n.id, 0]]);
      const visited  = new Set();
      const pq       = [{ nodeId: n.id, R: 0 }];
      // boundaryMap: nodeId → {head, R: accumulated resistance dari n ke boundary ini}
      const boundaryMap = new Map();

      while (pq.length > 0) {
        // Priority queue sederhana — sufficient untuk skala jaringan SCADA
        pq.sort((a, b) => a.R - b.R);
        const { nodeId: cur, R: curR } = pq.shift();
        if (visited.has(cur)) continue;
        visited.add(cur);

        for (const { nodeId: nbr, R: edgeR } of (adjacency.get(cur) || [])) {
          const newR = curR + edgeR;
          if (dist.has(nbr) && dist.get(nbr) <= newR) continue;
          dist.set(nbr, newR);

          const nbrNode = nodeMap.get(nbr);
          if (!nbrNode) continue;

          if (isKnown(nbrNode)) {
            // Boundary ditemukan — catat dengan accumulated resistance
            // Update jika menemukan path lebih pendek ke boundary yang sama
            const prev = boundaryMap.get(nbr);
            if (!prev || newR < prev.R) {
              boundaryMap.set(nbr, { head: nbrNode.totalHead, R: newR });
            }
            // PENTING: jangan ekspansi melewati boundary node
            // (mencegah "shortcut" antar dua boundary yang tidak melalui n)
          } else {
            // Node belum diketahui — lanjut ekspansi Dijkstra
            pq.push({ nodeId: nbr, R: newR });
          }
        }
      }

      const boundaries = Array.from(boundaryMap.values());

      // ─── Interpolasi berdasarkan jumlah boundary yang ditemukan ─────
      let interpolatedHead;

      if (boundaries.length === 0) {
        // Tidak ada node referensi di seluruh jaringan terhubung → pakai elevasi
        n.totalHead = n.elevation;
        n.pressure  = 0;
        n.isInterpolated = false;
        return;

      } else if (boundaries.length === 1) {
        // Satu boundary: propagasi satu arah berbasis resistansi.
        // Estimasi Q referensi 5 L/s = 0.005 m³/s untuk hitung head loss tipis.
        // hf = R × Q^1.852
        const Q_ref = 0.005;
        const hf    = boundaries[0].R * Math.pow(Q_ref, HW_EXPONENT);
        interpolatedHead = boundaries[0].head - hf;

      } else {
        // Dua atau lebih boundary: Conductance-Weighted Interpolation.
        //
        // Derive dari persamaan kontinuitas node (linearisasi HW):
        //   Σ (H_i - H_n) / R_i = 0
        //   H_n × Σ(1/R_i) = Σ(H_i / R_i)
        //   H_n = Σ(H_i × C_i) / Σ(C_i),  C_i = 1/R_i (konduktansi)
        //
        // Contoh kasus seri A──n──B:
        //   H_n = (H_A×C_A + H_B×C_B) / (C_A + C_B)
        //   Ini setara dengan interpolasi resistance-weighted:
        //   H_n = H_A - R_A/(R_A+R_B) × (H_A - H_B)  ✓
        let sumConductance  = 0;
        let sumWeightedHead = 0;
        for (const b of boundaries) {
          const conductance = 1.0 / Math.max(b.R, 1e-12); // hindari div/0
          sumConductance  += conductance;
          sumWeightedHead += b.head * conductance;
        }
        interpolatedHead = sumWeightedHead / sumConductance;
      }

      n.totalHead      = Math.max(n.elevation, interpolatedHead);
      n.pressure       = Math.max(0, Math.round(((n.totalHead - n.elevation) / HEAD_PER_BAR) * 100) / 100);
      n.isInterpolated = true;   // flag untuk debugging
      n.boundaryCount  = boundaries.length;
      nodeMap.set(n.id, n);
    });
  }

  /**
   * Menghitung Total Dynamic Head (HGL) pada suatu simpul
   */
  function calculateTotalHead(elevation, pressureBar) {
    const p = Number(pressureBar) || 0;
    const elev = Number(elevation) || 0;
    return Math.round((elev + (p * HEAD_PER_BAR)) * 100) / 100;
  }

  /**
   * Menghitung Debit Aliran Pipa (Q) menggunakan Inversi Persamaan Hazen-Williams
   */
  function calculatePipeDischarge(head1, head2, lengthM, nominalDiameterMm, cFactor = 140) {
    const nomD = Number(nominalDiameterMm) || 0;
    if (nomD <= 0) {
      return {
        discharge_m3s: 0, discharge_Lps: 0, discharge_m3h: 0,
        velocity_mps: 0, headloss_m: 0, flowDirection: 'none', headDiff: 0
      };
    }
    const D = getInternalDiameterMeters(nomD);
    const L = Math.max(1.0, Number(lengthM) || 10.0);
    const C = Math.max(50, Math.min(160, Number(cFactor) || 140));

    const headDiff = head1 - head2;
    const absHf = Math.abs(headDiff);

    if (absHf < 0.001) {
      return {
        discharge_m3s: 0,
        discharge_Lps: 0,
        discharge_m3h: 0,
        velocity_mps: 0,
        headloss_m: 0,
        flowDirection: 'none',
        headDiff
      };
    }

    const flowDirection = headDiff > 0 ? 'forward' : 'backward';

    // Rumus Hazen-Williams metrik (standar EPANET): hf = 10.67 * L * Q^1.852 / (C^1.852 * D^4.871)
    const numerator = absHf * Math.pow(C, HW_EXPONENT) * Math.pow(D, 4.871);
    const denominator = 10.67 * L;
    const discharge_m3s = Math.pow(numerator / denominator, 1 / HW_EXPONENT);

    const discharge_Lps = discharge_m3s * 1000.0;
    const discharge_m3h = discharge_m3s * 3600.0;

    const area = Math.PI * Math.pow(D / 2.0, 2);
    const velocity_mps = area > 0 ? (discharge_m3s / area) : 0;

    return {
      discharge_m3s,
      discharge_Lps: Math.round(discharge_Lps * 100) / 100,
      discharge_m3h: Math.round(discharge_m3h * 10) / 10,
      velocity_mps: Math.round(velocity_mps * 1000) / 1000,
      headloss_m: Math.round(absHf * 100) / 100,
      flowDirection,
      headDiff: Math.round(headDiff * 100) / 100
    };
  }

  /**
   * Menghitung Status Operasional Pipa berdasarkan standar hidrolika PDAM
   */
  function evaluatePipeStatus(velocity_mps, pressureBar) {
    // Cek no-flow TERLEBIH DAHULU: jika tidak ada aliran, tidak bisa dideteksi sebagai bocor
    if (velocity_mps === 0) {
      return {
        code: 'NO_FLOW',
        label: 'Tidak Ada Aliran (Statis/Kran Tertutup)',
        color: '#94A3B8',
        severity: 'idle'
      };
    }

    // Baru cek tekanan rendah (hanya relevan jika pipa sedang mengalir)
    if (pressureBar !== undefined && pressureBar < 0.5) {
      return {
        code: 'LEAK_WARNING',
        label: 'Indikasi Kebocoran / Tekanan Drop',
        color: '#EF4444',
        severity: 'danger'
      };
    }

    if (velocity_mps > 2.0) {
      return {
        code: 'HIGH_VELOCITY',
        label: 'Kecepatan Aliran Sangat Tinggi (> 2.0 m/s)',
        color: '#F59E0B',
        severity: 'warning'
      };
    }

    if (velocity_mps < 0.3 && velocity_mps > 0.0) {
      return {
        code: 'LOW_VELOCITY',
        label: 'Kecepatan Rendah (< 0.3 m/s - Resiko Endapan)',
        color: '#EAB308',
        severity: 'warning'
      };
    }

    return {
      code: 'NORMAL',
      label: 'Aliran Normal Optimal (0.3 - 2.0 m/s)',
      color: '#10B981',
      severity: 'normal'
    };
  }

  /**
   * Menghitung Karakteristik Hidrolika dan Energi Pompa
   */
  function calculatePumpHydraulics(pump, suctionNode, dischargeNode) {
    const isOn = pump.status !== 'off';
    const speed = Math.max(0.2, Math.min(2.0, Number(pump.speed) || 1.0));
    const designHead = Math.max(5.0, Number(pump.designHead) || 40.0);
    const designFlow = Math.max(1.0, Number(pump.designFlow) || 30.0);
    const efficiency = Math.max(0.2, Math.min(0.95, Number(pump.efficiency) || 0.75));

    if (!isOn) {
      return {
        ...pump,
        status: 'off',
        speed,
        headBoost_m: 0,
        pressureBoost_bar: 0,
        discharge_Lps: 0,
        discharge_m3h: 0,
        hydraulicPower_kW: 0,
        motorPower_kW: 0,
        motorPower_HP: 0,
        sec_kWh_m3: 0,
        suctionHead_m: suctionNode ? (suctionNode.totalHead || suctionNode.elevation) : 0,
        dischargeHead_m: dischargeNode ? (dischargeNode.totalHead || dischargeNode.elevation) : 0,
        suctionPressure_bar: suctionNode ? (suctionNode.pressure || 0) : 0,
        dischargePressure_bar: dischargeNode ? (dischargeNode.pressure || 0) : 0,
        statusColor: '#94A3B8',
        statusLabel: 'Mati / Standby'
      };
    }

    // Model Kurva Standar EPANET: H = H0 - a*Q^2
    // Di mana H0 = 1.33 * Hdes, a = 0.33 * Hdes / Qdes^2
    const h0 = 1.333 * designHead;
    const aCoeff = (0.333 * designHead) / Math.pow(designFlow, 2);

    // Debit aktual operasi (L/s) - mendekati debit desain disesuaikan kecepatan VFD
    let actualFlow = designFlow * speed;
    let headBoost = Math.max(5.0, (Math.pow(speed, 2) * h0) - (aCoeff * Math.pow(actualFlow, 2)));

    // Jika ada kurva kustom 1-titik atau 3-titik
    if (pump.pumpCurve && Array.isArray(pump.pumpCurve) && pump.pumpCurve.length > 0) {
      const pt = pump.pumpCurve[0];
      if (pt.flow && pt.head) {
        actualFlow = pt.flow * speed;
        headBoost = pt.head * Math.pow(speed, 2);
      }
    }

    const pressureBoost_bar = Math.round((headBoost / HEAD_PER_BAR) * 100) / 100;
    
    // Daya hidrolik air (kW): Pw = rho * g * Q * H / 1000 = Q (L/s) * H (m) / 102
    const hydraulicPower_kW = (actualFlow * headBoost) / 102.0;

    // Daya listrik motor (kW): Pe = Pw / total efficiency
    const motorPower_kW = hydraulicPower_kW / efficiency;
    const motorPower_HP = motorPower_kW * 1.341;

    // Specific Energy Consumption (SEC): kWh / m3
    const discharge_m3h = actualFlow * 3.6;
    const sec_kWh_m3 = discharge_m3h > 0 ? (motorPower_kW / discharge_m3h) : 0;

    const suctionHead = suctionNode ? (suctionNode.totalHead || suctionNode.elevation) : 0;
    const suctionPres = suctionNode ? (suctionNode.pressure || 0) : 0;
    const dischargeHead = suctionHead + headBoost;
    const dischargeElev = dischargeNode ? dischargeNode.elevation : 0;
    const dischargePres = Math.max(0, Math.round(((dischargeHead - dischargeElev) / HEAD_PER_BAR) * 100) / 100);

    return {
      ...pump,
      status: 'on',
      speed,
      designHead,
      designFlow,
      efficiency,
      headBoost_m: Math.round(headBoost * 100) / 100,
      pressureBoost_bar,
      discharge_Lps: Math.round(actualFlow * 100) / 100,
      discharge_m3h: Math.round(discharge_m3h * 10) / 10,
      hydraulicPower_kW: Math.round(hydraulicPower_kW * 100) / 100,
      motorPower_kW: Math.round(motorPower_kW * 100) / 100,
      motorPower_HP: Math.round(motorPower_HP * 10) / 10,
      sec_kWh_m3: Math.round(sec_kWh_m3 * 1000) / 1000,
      suctionHead_m: Math.round(suctionHead * 100) / 100,
      dischargeHead_m: Math.round(dischargeHead * 100) / 100,
      suctionPressure_bar: suctionPres,
      dischargePressure_bar: dischargePres,
      statusColor: '#10B981',
      statusLabel: 'Beroperasi (Normal)'
    };
  }

  /**
   * State Estimation Jaringan SCADA Kota Subang (Mendukung SPAM Gravitasi & Pemompaan)
   */
  function solveScadaNetwork(nodes, pipes, telemetryReadings = {}, pumps = []) {
    const nodeMap = new Map();

    const updatedNodes = nodes.map(n => {
      const copy = { ...n };
      const tele = telemetryReadings[copy.id];

      if (tele && tele.pressure_bar !== undefined) {
        // PRIORITAS 1: Data sensor telemetri lapangan (paling akurat)
        copy.hasTelemetry = true;
        copy.measuredPressure = tele.pressure_bar;
        copy.telemetryTimestamp = tele.timestamp;
        copy.telemetryNotes = tele.notes;
        copy.totalHead = calculateTotalHead(copy.elevation, tele.pressure_bar);
        copy.pressure = tele.pressure_bar;
      } else if (copy.type === 'reservoir' || copy.type === 'tank') {
        // PRIORITAS 2: Sumber air (reservoir/tangki) - head = elevasi permukaan air
        copy.hasTelemetry = false;
        copy.totalHead = copy.elevation;
        copy.pressure = 0;
      } else if (copy.pressure !== undefined && copy.pressure > 0) {
        // PRIORITAS 3: Data tekanan pre-computed dari EPANET (lebih akurat dari estimasi jarak)
        // Ini adalah hasil solver Hardy-Cross EPANET yang sudah valid - JANGAN ditimpa estimasi kasar
        copy.hasTelemetry = false;
        copy.hasEpanetPressure = true;
        copy.totalHead = Math.round((copy.elevation + copy.pressure * HEAD_PER_BAR) * 100) / 100;
      } else {
        // PRIORITAS 4: Node tanpa data apapun - akan diestimasi dari propagasi
        copy.hasTelemetry = false;
        copy.hasEpanetPressure = false;
        copy.totalHead = copy.elevation; // Inisialisasi ke elevasi saja
        copy.pressure = 0;
      }
      nodeMap.set(copy.id, copy);
      return copy;
    });

    // 1. Proses Evaluasi Hidrolika Pompa
    const solvedPumps = (pumps || []).map(p => {
      const suctionNode = nodeMap.get(p.startNodeId);
      const dischargeNode = nodeMap.get(p.endNodeId);
      const pumpResult = calculatePumpHydraulics(p, suctionNode, dischargeNode);

      // Jika pompa aktif: override head discharge node.
      // Telemetri lapangan tetap lebih prioritas daripada pompa.
      if (pumpResult.status === 'on' && dischargeNode) {
        if (!dischargeNode.hasTelemetry) {
          dischargeNode.totalHead = pumpResult.dischargeHead_m;
          dischargeNode.pressure = pumpResult.dischargePressure_bar;
          dischargeNode.isPumpBoosted = true;
          dischargeNode.hasEpanetPressure = false; // pompa menggantikan data EPANET statis
          dischargeNode.pumpSourceLabel = p.label || 'Pompa';
        }
      }

      return pumpResult;
    });


    // 2. Interpolasi Hidrolis Head untuk Node Tanpa Data
    //    Menggantikan estimasi jarak geografis (3 m/km) dengan interpolasi
    //    berbasis resistansi pipa + conductance-weighted formula.
    //    Menjamin kontinuitas debit (Q masuk ≈ Q keluar) di setiap simpul.
    hydraulicInterpolateNodes(updatedNodes, nodeMap, pipes);


    let totalDischargeLps = 0;
    let leakWarningsCount = 0;
    let activePipesCount = 0;

    // 3. Evaluasi Aliran Seluruh Ruas Pipa
    const updatedPipes = pipes.map(p => {
      const startNode = nodeMap.get(p.startNodeId);
      const endNode = nodeMap.get(p.endNodeId);

      if (!startNode || !endNode) {
        return { ...p, discharge_Lps: 0, velocity_mps: 0, status: evaluatePipeStatus(0) };
      }

      const head1 = startNode.totalHead || startNode.elevation;
      const head2 = endNode.totalHead || endNode.elevation;
      const C = getRoughnessC(p.material, p.roughness);

      const calc = calculatePipeDischarge(head1, head2, p.length, p.diameter, C);

      // Hanya gunakan tekanan yang diukur langsung dari sensor (hasTelemetry) untuk evaluasi kebocoran
      const startIsSource = startNode.type === 'reservoir' || startNode.type === 'tank';
      const endIsSource = endNode.type === 'reservoir' || endNode.type === 'tank';
      let minPressure;
      if (startIsSource && endIsSource) {
        minPressure = undefined; 
      } else if (startIsSource) {
        minPressure = endNode.hasTelemetry ? endNode.pressure : undefined;
      } else if (endIsSource) {
        minPressure = startNode.hasTelemetry ? startNode.pressure : undefined;
      } else {
        if (startNode.hasTelemetry && endNode.hasTelemetry) {
          minPressure = Math.min(startNode.pressure, endNode.pressure);
        } else if (startNode.hasTelemetry) {
          minPressure = startNode.pressure;
        } else if (endNode.hasTelemetry) {
          minPressure = endNode.pressure;
        } else {
          minPressure = undefined;
        }
      }
      const status = evaluatePipeStatus(calc.velocity_mps, minPressure);

      if (status.code === 'LEAK_WARNING') {
        leakWarningsCount++;
      }

      if (calc.discharge_Lps > 0) {
        activePipesCount++;
      }

      // Hitung aliran keluar (net) dari sumber reservoir/tangki ke jaringan distribusi
      // PERBAIKAN Bug #3: Hanya hitung aliran MASUK jaringan (forward dari reservoir)
      // Aliran backward ke reservoir diabaikan karena pada sistem terbuka (gravitasi/pompa dari reservoir),
      // air tidak mungkin mengalir balik ke reservoir — itu artefak dari estimasi head yang tidak akurat
      const startIsReservoir = startIsSource; // alias agar konsisten dengan konteks di bawah
      const endIsReservoir = endIsSource;
      if (startIsReservoir && !endIsReservoir) {
        if (calc.flowDirection === 'forward') totalDischargeLps += calc.discharge_Lps;
        // Backward dari J ke RES diabaikan: tidak mungkin secara fisik untuk sistem gravitasi
      } else if (endIsReservoir && !startIsReservoir) {
        if (calc.flowDirection === 'backward') totalDischargeLps += calc.discharge_Lps;
        // Forward dari jaringan ke RES diabaikan: sama, return-flow tidak mungkin
      }

      return {
        ...p,
        head1: Math.round(head1 * 100) / 100,
        head2: Math.round(head2 * 100) / 100,
        discharge_Lps: calc.discharge_Lps,
        discharge_m3h: calc.discharge_m3h,
        velocity_mps: calc.velocity_mps,
        headloss_m: calc.headloss_m,
        flowDirection: calc.flowDirection,
        status: status
      };
    });

    // 4. Hitung Kontribusi Pompa terhadap Pasokan Air
    // Pompa dari reservoir masuk ke totalDischarge jika:
    // - Pipa langsung dari reservoir ke jaringan tidak mengalir (Q=0), ATAU
    // - Tidak ada pipa langsung dari reservoir ke discharge node pompa
    // Ini mencegah double-counting sekaligus memastikan jaringan pump-only terhitung pasokannya
    let totalPumpDischargeLps = 0;
    let totalPumpPowerKw = 0;
    solvedPumps.forEach(pump => {
      if (pump.status === 'on') {
        totalPumpPowerKw += pump.motorPower_kW || 0;
        totalPumpDischargeLps += pump.discharge_Lps || 0;

        const sNode = nodeMap.get(pump.startNodeId);
        if (sNode && (sNode.type === 'reservoir' || sNode.type === 'tank')) {
          // Cek apakah pipa langsung reservoir->discharge node sudah menghitung aliran ini
          const directPipes = updatedPipes.filter(p =>
            (p.startNodeId === pump.startNodeId && p.endNodeId === pump.endNodeId) ||
            (p.startNodeId === pump.endNodeId && p.endNodeId === pump.startNodeId)
          );
          const directFlowLps = directPipes.reduce((s, p) => s + (p.discharge_Lps || 0), 0);

          // Jika tidak ada pipa langsung yang mengalir, pompa adalah satu-satunya sumber pasokan
          // Tambahkan debit pompa ke totalDischarge (tidak ada double-counting)
          if (directFlowLps === 0) {
            totalDischargeLps += pump.discharge_Lps || 0;
          }
        }
      }
    });

    const junctions = updatedNodes.filter(n => n.type === 'junction');
    const totalPressure = junctions.reduce((acc, n) => acc + (n.pressure || 0), 0);
    const avgPressure = junctions.length > 0 ? (totalPressure / junctions.length) : 0;

    const summary = {
      activeSensorsCount: Object.keys(telemetryReadings).length,
      totalNodes: nodes.length,
      totalPipes: pipes.length,
      totalPumps: solvedPumps.length,
      activePumps: solvedPumps.filter(p => p.status === 'on').length,
      totalPumpPowerKw: Math.round(totalPumpPowerKw * 10) / 10,
      totalPumpDischargeLps: Math.round(totalPumpDischargeLps * 100) / 100,
      totalDischargeLps: Math.round(totalDischargeLps * 100) / 100,
      totalDischarge_m3h: Math.round(totalDischargeLps * 3.6 * 10) / 10,
      avgPressureBar: Math.round(avgPressure * 100) / 100,
      leakWarningsCount,
      activePipesCount,
      timestamp: new Date().toISOString()
    };

    return {
      nodes: updatedNodes,
      pipes: updatedPipes,
      pumps: solvedPumps,
      summary
    };
  }

  return {
    calculateTotalHead,
    calculatePipeDischarge,
    calculatePumpHydraulics,
    evaluatePipeStatus,
    solveScadaNetwork,
    getInternalDiameterMeters,
    getRoughnessC,
    computePipeResistance,
    hydraulicInterpolateNodes,
    HEAD_PER_BAR
  };

});

