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
    400: 352.6
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
    const C = Math.max(50, Math.min(150, Number(cFactor) || 140));

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

    // Rumus Hazen-Williams metrik: hf = 10.67 * L * Q^1.852 / (C^1.852 * D^4.87)
    const numerator = absHf * Math.pow(C, HW_EXPONENT) * Math.pow(D, 4.87);
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

    if (velocity_mps === 0) {
      return {
        code: 'NO_FLOW',
        label: 'Tidak Ada Aliran (Statis/Kran Tertutup)',
        color: '#94A3B8',
        severity: 'idle'
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
   * State Estimation Jaringan SCADA Kota Subang
   */
  function solveScadaNetwork(nodes, pipes, telemetryReadings = {}) {
    const nodeMap = new Map();

    const updatedNodes = nodes.map(n => {
      const copy = { ...n };
      const tele = telemetryReadings[copy.id];

      if (tele && tele.pressure_bar !== undefined) {
        copy.hasTelemetry = true;
        copy.measuredPressure = tele.pressure_bar;
        copy.telemetryTimestamp = tele.timestamp;
        copy.telemetryNotes = tele.notes;
        copy.totalHead = calculateTotalHead(copy.elevation, tele.pressure_bar);
        copy.pressure = tele.pressure_bar;
      } else if (copy.type === 'reservoir' || copy.type === 'tank') {
        copy.hasTelemetry = false;
        copy.totalHead = copy.elevation;
        copy.pressure = 0;
      } else {
        copy.hasTelemetry = false;
        copy.totalHead = copy.totalHead || (copy.elevation + (copy.pressure ? copy.pressure * HEAD_PER_BAR : 0));
      }
      nodeMap.set(copy.id, copy);
      return copy;
    });

    const knownNodes = updatedNodes.filter(n => n.hasTelemetry || n.type === 'reservoir');
    if (knownNodes.length > 0) {
      updatedNodes.forEach(n => {
        if (!n.hasTelemetry && n.type === 'junction') {
          let closest = null;
          let minDist = Infinity;
          knownNodes.forEach(kn => {
            const dLat = n.lat - kn.lat;
            const dLng = n.lng - kn.lng;
            const dist = Math.sqrt(dLat * dLat + dLng * dLng);
            if (dist < minDist) {
              minDist = dist;
              closest = kn;
            }
          });

          if (closest) {
            const approxDistKm = minDist * 111.0;
            const estimatedHeadLoss = Math.min(approxDistKm * 3.0, 15.0);
            n.totalHead = Math.max(n.elevation, closest.totalHead - estimatedHeadLoss);
            n.pressure = Math.max(0, Math.round(((n.totalHead - n.elevation) / HEAD_PER_BAR) * 100) / 100);
          }
        }
      });
    }

    let totalDischargeLps = 0;
    let leakWarningsCount = 0;
    let activePipesCount = 0;

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

      // Jangan gunakan tekanan reservoir (0 bar) untuk evaluasi status kebocoran
      const startIsSource = startNode.type === 'reservoir' || startNode.type === 'tank';
      const endIsSource = endNode.type === 'reservoir' || endNode.type === 'tank';
      let minPressure;
      if (startIsSource && endIsSource) {
        minPressure = undefined; // Kedua ujung reservoir, skip pengecekan tekanan
      } else if (startIsSource) {
        minPressure = endNode.pressure || 0;
      } else if (endIsSource) {
        minPressure = startNode.pressure || 0;
      } else {
        minPressure = Math.min(startNode.pressure || 0, endNode.pressure || 0);
      }
      const status = evaluatePipeStatus(calc.velocity_mps, minPressure);

      if (status.code === 'LEAK_WARNING') {
        leakWarningsCount++;
      }

      if (calc.discharge_Lps > 0) {
        activePipesCount++;
      }

      if (startNode.type === 'reservoir' || endNode.type === 'reservoir') {
        totalDischargeLps += calc.discharge_Lps;
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

    const junctions = updatedNodes.filter(n => n.type === 'junction');
    const totalPressure = junctions.reduce((acc, n) => acc + (n.pressure || 0), 0);
    const avgPressure = junctions.length > 0 ? (totalPressure / junctions.length) : 0;

    const summary = {
      activeSensorsCount: Object.keys(telemetryReadings).length,
      totalNodes: nodes.length,
      totalPipes: pipes.length,
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
      summary
    };
  }

  return {
    calculateTotalHead,
    calculatePipeDischarge,
    evaluatePipeStatus,
    solveScadaNetwork,
    getInternalDiameterMeters,
    getRoughnessC,
    HEAD_PER_BAR
  };

});
