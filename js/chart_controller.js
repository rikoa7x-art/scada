/**
 * ChartController - Visualisasi Profil Hidrolis (Ground Elevation vs HGL) menggunakan Chart.js
 */

const ChartController = (() => {
  let profileChart = null;
  let chartJsLoaded = typeof Chart !== 'undefined';
  let chartJsLoading = false;

  /**
   * [OPTIMASI MOBILE] Muat Chart.js hanya saat dibutuhkan (~200KB hemat di load awal)
   */
  async function ensureChartJs() {
    if (chartJsLoaded) return true;
    if (chartJsLoading) {
      // Tunggu loading yang sudah berjalan
      return new Promise(resolve => {
        const check = setInterval(() => {
          if (chartJsLoaded) { clearInterval(check); resolve(true); }
        }, 100);
      });
    }
    chartJsLoading = true;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      script.onload = () => { chartJsLoaded = true; chartJsLoading = false; resolve(true); };
      script.onerror = () => { chartJsLoading = false; reject(new Error('Gagal memuat Chart.js')); };
      document.head.appendChild(script);
    });
  }

  /**
   * Ekstrak jalur transmisi utama atau rute terpanjang dari reservoir ke titik terjauh
   */
  function extractMainPath(networkData, nodesStateMap, sequenceSteps = null) {
    if (!networkData || !networkData.nodes) return [];

    // Jalur transmisi tipikal dari R4 / J66 menuju J59 (SPAM Bunihayu)
    const preferredLabels = ['R4', 'J66', 'J46', 'J47', 'J48', 'J49', 'J50', 'J51', 'J52', 'J54', 'J57', 'J55', 'J59'];
    const preferredNodes = [];

    preferredLabels.forEach(lbl => {
      const node = networkData.nodes.find(n => n.label === lbl);
      if (node) {
        const state = nodesStateMap ? nodesStateMap.get(node.id) : null;
        preferredNodes.push({
          ...node,
          state: state
        });
      }
    });

    if (preferredNodes.length >= 4) {
      return preferredNodes;
    }

    // Fallback Cerdas: Ekstrak dari sequenceSteps (Berlaku untuk semua 9 Wilayah SPAM)
    if (sequenceSteps && sequenceSteps.length > 0) {
      const path = [];
      const sourceStep = sequenceSteps.find(s => s.type === 'source');
      if (sourceStep) {
        path.push({
          id: sourceStep.nodeId,
          label: sourceStep.nodeLabel || 'Reservoir',
          elevation: Number(sourceStep.elevation) || 0,
          state: {
            totalHead: sourceStep.totalHead,
            pressureHeadMeters: sourceStep.pressureM || 0
          },
          cumulativeDistance: 0
        });
      }

      const pumpStep = sequenceSteps.find(s => s.type === 'pump');
      if (pumpStep) {
        path.push({
          id: pumpStep.nodeId,
          label: pumpStep.nodeLabel || 'Pompa',
          elevation: Number(pumpStep.elevation) || 0,
          state: {
            totalHead: pumpStep.totalHead,
            pressureHeadMeters: pumpStep.pressureM || 0
          },
          cumulativeDistance: 0
        });
      }

      // Telusuri pipa hilir secara berantai mengikuti diameter terbesar
      const pipeSteps = sequenceSteps.filter(s => s.type === 'pipe');
      if (pipeSteps.length > 0) {
        const adj = new Map();
        pipeSteps.forEach(ps => {
          if (!adj.has(ps.startNodeId)) adj.set(ps.startNodeId, []);
          adj.get(ps.startNodeId).push(ps);
        });

        let currNodeId = pumpStep ? pumpStep.nodeId : (sourceStep ? sourceStep.nodeId : pipeSteps[0].startNodeId);
        if (!adj.has(currNodeId) && pipeSteps.length > 0) {
          currNodeId = pipeSteps[0].startNodeId;
        }

        const visited = new Set();
        let cumDist = 0;
        while (path.length < 25) {
          visited.add(currNodeId);
          const nextSteps = (adj.get(currNodeId) || []).filter(s => !visited.has(s.endNodeId));
          if (nextSteps.length === 0) break;
          // Prioritaskan pipa diameter terbesar
          nextSteps.sort((a, b) => (Number(b.diameter) || 0) - (Number(a.diameter) || 0));
          const chosen = nextSteps[0];
          cumDist += (Number(chosen.length) || 100);
          path.push({
            id: chosen.endNodeId,
            label: chosen.endNodeLabel || chosen.endNodeId,
            elevation: Number(chosen.elevation) || 0,
            state: {
              totalHead: chosen.totalHead,
              pressureHeadMeters: chosen.pressureM || 0
            },
            cumulativeDistance: cumDist
          });
          currNodeId = chosen.endNodeId;
        }
      }

      if (path.length >= 2) {
        return path;
      }
    }

    // Fallback Terakhir: Ambil simpul reservoir dan sambungan pipa pertama
    const reservoir = networkData.nodes.find(n => n.type === 'reservoir') || networkData.nodes[0];
    const fallbackPath = [];
    if (reservoir) {
      const resState = nodesStateMap ? nodesStateMap.get(reservoir.id) : null;
      fallbackPath.push({ ...reservoir, state: resState });
    }
    const sampleNodes = networkData.nodes.slice(0, 15);
    sampleNodes.forEach(n => {
      if (!fallbackPath.some(p => p.id === n.id)) {
        fallbackPath.push({ ...n, state: nodesStateMap ? nodesStateMap.get(n.id) : null });
      }
    });

    return fallbackPath;
  }

  /**
   * Render atau Update Grafik Profil Hidrolis
   * @param {string} canvasId - ID elemen canvas
   * @param {Object} networkData - Data jaringan
   * @param {Map} nodesStateMap - Map data node hasil perhitungan
   * @param {Array} sequenceSteps - Alur langkah hidrolis berurutan (opsional)
   */
  async function renderProfileChart(canvasId, networkData, nodesStateMap, sequenceSteps = null) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // [OPTIMASI MOBILE] Muat Chart.js on-demand
    try {
      await ensureChartJs();
    } catch (err) {
      console.warn('Chart.js tidak tersedia:', err);
      return;
    }

    const ctx = canvas.getContext('2d');
    const pathNodes = extractMainPath(networkData, nodesStateMap, sequenceSteps);
    if (!pathNodes || pathNodes.length === 0) return;

    // Hitung jarak kumulatif (meter)
    let cumulativeDistance = 0;
    const labels = [];
    const elevationData = [];
    const hglData = [];
    const pressureData = [];

    const isMobile = window.innerWidth < 640;

    pathNodes.forEach((node, index) => {
      if (node.cumulativeDistance !== undefined) {
        cumulativeDistance = node.cumulativeDistance;
      } else if (index > 0) {
        // Cari pipa penghubung
        const prevNode = pathNodes[index - 1];
        const pipe = networkData.pipes?.find(
          p => (p.startNodeId === prevNode.id && p.endNodeId === node.id) ||
               (p.startNodeId === node.id && p.endNodeId === prevNode.id)
        );
        cumulativeDistance += pipe ? Number(pipe.length) : 200;
      }

      const nodeLabel = node.label || node.id || `Simpul ${index + 1}`;
      // Gunakan multiline array label di mobile agar tidak bertumpuk
      if (isMobile) {
        labels.push([nodeLabel, `${Math.round(cumulativeDistance)}m`]);
      } else {
        labels.push(`${nodeLabel} (${Math.round(cumulativeDistance)}m)`);
      }
      
      elevationData.push(node.elevation != null ? Number(node.elevation) : 0);

      const totalHead = node.state && node.state.totalHead !== null && node.state.totalHead !== undefined 
        ? Number(node.state.totalHead.toFixed(2)) 
        : null;
      hglData.push(totalHead);

      const pMeters = node.state && node.state.pressureHeadMeters !== null && node.state.pressureHeadMeters !== undefined 
        ? Number(node.state.pressureHeadMeters.toFixed(2)) 
        : 0;
      pressureData.push(pMeters);
    });

    if (profileChart) {
      profileChart.destroy();
    }

    profileChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: isMobile ? 'HGL (m)' : 'Garis Derajat Hidrolis / HGL (m)',
            data: hglData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            borderWidth: isMobile ? 2 : 3,
            pointBackgroundColor: '#059669',
            pointRadius: isMobile ? 3 : 5,
            fill: false,
            tension: 0.2
          },
          {
            label: isMobile ? 'Tanah (m)' : 'Elevasi Muka Tanah (m dpl)',
            data: elevationData,
            borderColor: '#64748b',
            backgroundColor: 'rgba(100, 116, 139, 0.2)',
            borderWidth: isMobile ? 1.5 : 2,
            borderDash: [4, 4],
            pointBackgroundColor: '#475569',
            pointRadius: isMobile ? 2.5 : 4,
            fill: true,
            tension: 0.2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              font: { family: 'sans-serif', size: isMobile ? 10 : 12, weight: 'bold' },
              usePointStyle: true,
              boxWidth: isMobile ? 6 : 10,
              padding: isMobile ? 8 : 12
            }
          },
          tooltip: {
            callbacks: {
              afterBody: function(context) {
                const idx = context[0].dataIndex;
                const p = pressureData[idx] || 0;
                const pBar = (p / 10.19716).toFixed(2);
                return `Sisa Tekan: ${p.toFixed(2)} mH2O (${pBar} bar)`;
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: !isMobile,
              text: 'Titik Junction & Jarak Kumulatif (m)',
              font: { weight: 'bold', size: 11 }
            },
            ticks: {
              font: { size: isMobile ? 8.5 : 10 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: isMobile ? 8 : 15
            },
            grid: { color: 'rgba(203, 213, 225, 0.4)' }
          },
          y: {
            title: {
              display: true,
              text: isMobile ? 'Head (m)' : 'Elevasi & Head (meter)',
              font: { weight: 'bold', size: isMobile ? 9 : 11 }
            },
            ticks: {
              font: { size: isMobile ? 8.5 : 10 }
            },
            grid: { color: 'rgba(203, 213, 225, 0.4)' }
          }
        }
      }
    });
  }

  return {
    renderProfileChart,
    getChartInstance: () => profileChart
  };
})();
