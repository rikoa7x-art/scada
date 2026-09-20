/**
 * ChartController - Visualisasi Profil Hidrolis (Ground Elevation vs HGL) menggunakan Chart.js
 */

const ChartController = (() => {
  let profileChart = null;

  /**
   * Ekstrak jalur transmisi utama atau rute terpanjang dari reservoir ke titik terjauh
   */
  function extractMainPath(networkData, nodesStateMap) {
    // Jalur transmisi tipikal dari R4 / J66 menuju J59
    const preferredLabels = ['R4', 'J66', 'J46', 'J47', 'J48', 'J49', 'J50', 'J51', 'J52', 'J54', 'J57', 'J55', 'J59'];
    const pathNodes = [];

    preferredLabels.forEach(lbl => {
      const node = networkData.nodes.find(n => n.label === lbl);
      if (node) {
        const state = nodesStateMap ? nodesStateMap.get(node.id) : null;
        pathNodes.push({
          ...node,
          state: state
        });
      }
    });

    return pathNodes;
  }

  /**
   * Render atau Update Grafik Profil Hidrolis
   * @param {string} canvasId - ID elemen canvas
   * @param {Object} networkData - Data jaringan
   * @param {Map} nodesStateMap - Map data node hasil perhitungan
   */
  function renderProfileChart(canvasId, networkData, nodesStateMap) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const pathNodes = extractMainPath(networkData, nodesStateMap);

    // Hitung jarak kumulatif (meter)
    let cumulativeDistance = 0;
    const labels = [];
    const elevationData = [];
    const hglData = [];
    const pressureData = [];

    pathNodes.forEach((node, index) => {
      if (index > 0) {
        // Cari pipa penghubung
        const prevNode = pathNodes[index - 1];
        const pipe = networkData.pipes.find(
          p => (p.startNodeId === prevNode.id && p.endNodeId === node.id) ||
               (p.startNodeId === node.id && p.endNodeId === prevNode.id)
        );
        cumulativeDistance += pipe ? Number(pipe.length) : 200;
      }

      labels.push(`${node.label} (${Math.round(cumulativeDistance)}m)`);
      elevationData.push(node.elevation);

      const totalHead = node.state && node.state.totalHead !== null ? Number(node.state.totalHead.toFixed(2)) : null;
      hglData.push(totalHead);

      const pMeters = node.state && node.state.pressureHeadMeters !== null ? Number(node.state.pressureHeadMeters.toFixed(2)) : 0;
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
            label: 'Garis Derajat Hidrolis / HGL (m)',
            data: hglData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            borderWidth: 3,
            pointBackgroundColor: '#059669',
            pointRadius: 5,
            fill: false,
            tension: 0.2
          },
          {
            label: 'Elevasi Muka Tanah (m dpl)',
            data: elevationData,
            borderColor: '#64748b',
            backgroundColor: 'rgba(100, 116, 139, 0.2)',
            borderWidth: 2,
            borderDash: [5, 5],
            pointBackgroundColor: '#475569',
            pointRadius: 4,
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
              font: { family: 'sans-serif', size: 12, weight: 'bold' },
              usePointStyle: true
            }
          },
          tooltip: {
            callbacks: {
              afterBody: function(context) {
                const idx = context[0].dataIndex;
                const p = pressureData[idx];
                const pBar = (p / 10.19716).toFixed(2);
                return `Sisa Tekan: ${p.toFixed(2)} mH2O (${pBar} bar)`;
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Titik Junction & Jarak Kumulatif (m)',
              font: { weight: 'bold', size: 11 }
            },
            grid: { color: 'rgba(203, 213, 225, 0.4)' }
          },
          y: {
            title: {
              display: true,
              text: 'Elevasi & Head (meter)',
              font: { weight: 'bold', size: 11 }
            },
            grid: { color: 'rgba(203, 213, 225, 0.4)' }
          }
        }
      }
    });
  }

  return {
    renderProfileChart
  };
})();
