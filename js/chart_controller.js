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

    const isMobile = window.innerWidth < 640;

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

      // Gunakan multiline array label di mobile agar tidak bertumpuk
      if (isMobile) {
        labels.push([node.label, `${Math.round(cumulativeDistance)}m`]);
      } else {
        labels.push(`${node.label} (${Math.round(cumulativeDistance)}m)`);
      }
      
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
    renderProfileChart
  };
})();
