/**
 * MapManager - Manajemen Peta GIS Leaflet untuk Monitoring Jaringan Pipa PDAM
 */

const MapManager = (() => {
  let map = null;
  let baseLayers = {};
  let pipeLayersGroup = null;
  let nodeLayersGroup = null;
  let arrowLayersGroup = null;
  let flowLabelLayersGroup = null;
  let flowLabelMode = 'lps'; // 'lps' | 'm3h' | 'both' | 'off'
  let lastNodesStateMap = null;
  let lastPipesStateMap = null;
  let lastSourceConfig = null;
  let activeNetworkData = null;
  let onNodeClickCallback = null;
  let onPipeClickCallback = null;
  let onPumpClickCallback = null;
  let currentSelectedPipeId = null;

  /**
   * Inisialisasi Peta Leaflet
   */
  function init(elementId = 'map') {
    const config = AppConfig.map;

    // Buat objek map
    map = L.map(elementId, {
      center: config.defaultCenter,
      zoom: config.defaultZoom,
      minZoom: config.minZoom,
      maxZoom: config.maxZoom,
      zoomControl: false // Kita posisikan di tempat yang lebih rapi
    });

    // Posisikan zoom control di kanan bawah agar tidak menabrak panel
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Buat layer group
    pipeLayersGroup = L.featureGroup().addTo(map);
    arrowLayersGroup = L.featureGroup().addTo(map);
    flowLabelLayersGroup = L.featureGroup().addTo(map);
    nodeLayersGroup = L.featureGroup().addTo(map);

    // Siapkan Base Tile Layers
    const tiles = config.tileLayers;
    baseLayers = {
      'Google Hybrid': L.tileLayer(tiles.googleHybrid.url, {
        attribution: tiles.googleHybrid.attribution,
        maxZoom: tiles.googleHybrid.maxZoom
      }),
      'OpenStreetMap': L.tileLayer(tiles.openStreetMap.url, {
        attribution: tiles.openStreetMap.attribution,
        maxZoom: tiles.openStreetMap.maxZoom
      }),
      'Google Satellite': L.tileLayer(tiles.googleSatellite.url, {
        attribution: tiles.googleSatellite.attribution,
        maxZoom: tiles.googleSatellite.maxZoom
      }),
      'Google Streets': L.tileLayer(tiles.googleStreets.url, {
        attribution: tiles.googleStreets.attribution,
        maxZoom: tiles.googleStreets.maxZoom
      }),
      'Carto Light': L.tileLayer(tiles.cartoLight.url, {
        attribution: tiles.cartoLight.attribution,
        maxZoom: tiles.cartoLight.maxZoom
      }),
      'Carto Dark': L.tileLayer(tiles.cartoDark.url, {
        attribution: tiles.cartoDark.attribution,
        maxZoom: tiles.cartoDark.maxZoom
      })
    };

    // Set default base layer: Google Hybrid
    baseLayers['Google Hybrid'].addTo(map);

    return map;
  }

  /**
   * Ganti Base Layer (Google Hybrid, OpenStreetMap, dll.)
   */
  function switchBaseLayer(layerKey) {
    if (!baseLayers[layerKey] || !map) return;

    Object.values(baseLayers).forEach(layer => {
      if (map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    });

    baseLayers[layerKey].addTo(map);
  }

  /**
   * Set callback saat node, pipa, atau pompa diklik
   */
  function setCallbacks({ onNodeClick, onPipeClick, onPumpClick }) {
    onNodeClickCallback = onNodeClick;
    onPipeClickCallback = onPipeClick;
    onPumpClickCallback = onPumpClick;
  }

  /**
   * Render seluruh jaringan pipa dan node ke peta
   * @param {Object} networkData - Data jaringan { nodes, pipes, pumps }
   * @param {Map} nodesStateMap - Map hasil hidrolika dari HydraulicEngine
   * @param {Map} pipesStateMap - Map hasil hidrolika dari HydraulicEngine
   * @param {Object} sourceConfig - Konfigurasi sumber (pompa & reservoir)
   */
  function renderNetwork(networkData, nodesStateMap, pipesStateMap, sourceConfig = {}) {
    if (!map) return;
    activeNetworkData = networkData;
    lastNodesStateMap = nodesStateMap;
    lastPipesStateMap = pipesStateMap;
    lastSourceConfig = sourceConfig;

    pipeLayersGroup.clearLayers();
    arrowLayersGroup.clearLayers();
    flowLabelLayersGroup.clearLayers();
    nodeLayersGroup.clearLayers();

    // 1. Render Pipa
    networkData.pipes.forEach(pipe => {
      const pipeCalc = pipesStateMap ? pipesStateMap.get(pipe.id)?.calculation : null;
      const startNode = nodesStateMap?.get(pipe.startNodeId);
      const endNode = nodesStateMap?.get(pipe.endNodeId);

      // Ambil rute koordinat (jika ada routeCoordinates dari survey jalan, gunakan itu)
      let coords = pipe.routeCoordinates;
      if (!coords || coords.length === 0) {
        if (startNode && endNode) {
          coords = [
            [startNode.lat, startNode.lng],
            [endNode.lat, endNode.lng]
          ];
        } else {
          return;
        }
      }

      // Tentukan warna dan ketebalan berdasarkan status perhitungan dan diameter
      const isCalculated = pipeCalc && pipeCalc.status === 'calculated';
      let strokeColor = AppConfig.pipeStyle.colors.unmeasured;
      let dashArray = null;

      if (isCalculated) {
        if (pipeCalc.velocityStatus === 'critical') {
          strokeColor = AppConfig.pipeStyle.colors.criticalVelocity;
        } else if (pipeCalc.velocityStatus === 'warning') {
          strokeColor = AppConfig.pipeStyle.colors.warningVelocity;
        } else if (pipeCalc.velocityStatus === 'low' || pipeCalc.velocityStatus === 'very_low') {
          strokeColor = AppConfig.pipeStyle.colors.lowVelocity;
        } else {
          strokeColor = AppConfig.pipeStyle.colors.normalVelocity;
        }
      } else {
        dashArray = '6, 6'; // Garis putus-putus jika belum terukur
      }

      const diameter = Number(pipe.diameter) || 100;
      const weight = AppConfig.pipeStyle.diameterWeights[diameter] || (diameter >= 150 ? 6 : (diameter >= 100 ? 5 : 4));

      // Buat Polyline Pipa
      const polyline = L.polyline(coords, {
        color: strokeColor,
        weight: pipe.id === currentSelectedPipeId ? weight + 4 : weight,
        opacity: 0.9,
        dashArray: dashArray,
        lineCap: 'round',
        lineJoin: 'round'
      });

      // Tooltip informatif
      const startLabel = startNode?.label || 'N/A';
      const endLabel = endNode?.label || 'N/A';
      let tooltipContent = `
        <div class="p-1 font-sans text-xs">
          <div class="font-bold text-slate-800 flex items-center gap-1">
            <span>Pipa: ${startLabel} &rarr; ${endLabel}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">DN ${diameter} mm</span>
          </div>
          <div class="text-slate-600 mt-1">Panjang: <b>${pipe.length} m</b> | Material: <b>${pipe.material || 'PVC'}</b></div>
      `;

      if (isCalculated) {
        tooltipContent += `
          <div class="mt-1.5 pt-1.5 border-t border-slate-200 space-y-0.5">
            <div class="text-emerald-700 font-semibold">Debit: <b>${pipeCalc.flowRateLps.toFixed(2)} L/det</b> (${pipeCalc.flowRateM3h.toFixed(1)} m³/jam)</div>
            <div class="text-slate-700">Kecepatan: <b>${pipeCalc.velocity.toFixed(2)} m/s</b> (${pipeCalc.velocityLabel})</div>
            <div class="text-slate-600">Head Loss: <b>${pipeCalc.headLoss.toFixed(2)} m</b> (${pipeCalc.unitHeadLoss.toFixed(2)} m/km)</div>
            <div class="text-sky-700 font-medium">Arah: <b>${pipeCalc.direction === 'forward' ? `${startLabel} &rarr; ${endLabel}` : `${endLabel} &rarr; ${startLabel}`}</b></div>
          </div>
        `;
      } else {
        tooltipContent += `
          <div class="mt-1.5 text-amber-600 font-medium italic">Tekanan kedua junction belum terisi</div>
        `;
      }
      tooltipContent += `</div>`;

      polyline.bindTooltip(tooltipContent, { sticky: true, className: 'custom-leaflet-tooltip' });

      // Event klik pipa
      polyline.on('click', () => {
        currentSelectedPipeId = pipe.id;
        highlightPipe(pipe.id);
        if (onPipeClickCallback) {
          onPipeClickCallback(pipe, pipeCalc, startNode, endNode);
        }
      });

      polyline.pipeId = pipe.id;
      pipeLayersGroup.addLayer(polyline);

      // Render Panah Arah Aliran Air jika sudah terhitung
      if (isCalculated && pipeCalc.direction !== 'none') {
        renderFlowArrows(coords, pipeCalc.direction, strokeColor);
      }
    });

    // 2. Render Junctions, Reservoir, dan Pompa
    networkData.nodes.forEach(node => {
      const nodeState = nodesStateMap ? nodesStateMap.get(node.id) : null;
      const isReservoir = node.type === 'reservoir';
      const isPumpNode = networkData.pumps?.some(p => p.startNodeId === node.id || p.endNodeId === node.id);

      let fillColor = AppConfig.nodeStyle.node?.measuredFill || '#10b981';
      let radius = AppConfig.nodeStyle.junction.radius;
      let strokeColor = '#ffffff';

      if (isReservoir) {
        fillColor = AppConfig.nodeStyle.reservoir.fill;
        radius = AppConfig.nodeStyle.reservoir.radius;
      } else if (nodeState) {
        if (nodeState.isMeasured) {
          fillColor = '#10b981'; // Hijau: terukur
        } else if (nodeState.isEstimated) {
          fillColor = '#6366f1'; // Indigo: estimasi solver
        } else {
          fillColor = '#f59e0b'; // Kuning: belum diisi
        }
      }

      // Marker Lingkaran
      const marker = L.circleMarker([node.lat, node.lng], {
        radius: radius,
        fillColor: fillColor,
        color: strokeColor,
        weight: 2,
        opacity: 1,
        fillOpacity: 0.95
      });

      // Label teks di atas marker
      const labelIcon = L.divIcon({
        className: 'node-map-label',
        html: `<div class="bg-white/90 backdrop-blur-xs px-1.5 py-0.5 rounded shadow-xs text-[11px] font-bold text-slate-800 border border-slate-300 pointer-events-none transform -translate-y-6">${node.label}</div>`,
        iconSize: [0, 0]
      });
      const textLabelMarker = L.marker([node.lat, node.lng], { icon: labelIcon, interactive: false });
      nodeLayersGroup.addLayer(textLabelMarker);

      // Tooltip Node
      let nodeTooltip = '';
      if (isReservoir) {
        const isGravity = sourceConfig?.systemMode === 'gravity';
        const resFlow = Number(sourceConfig?.reservoir?.flow) || 10;
        const resElev = Number(sourceConfig?.reservoir?.elevation) || node.elevation;

        nodeTooltip = `
          <div class="p-1 font-sans text-xs">
            <div class="font-bold text-blue-900 text-sm flex items-center justify-between gap-2">
              <span>${node.label} (Reservoir Air)</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded font-bold ${isGravity ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'}">
                ${isGravity ? 'SISTEM GRAVITASI' : 'SUPLAI POMPA'}
              </span>
            </div>
            <div class="text-slate-600 mt-1">Muka Air Reservoir ($z$): <b class="text-blue-700">${resElev} m dpl</b></div>
            <div class="text-slate-600">Setting Debit Reservoir: <b class="text-emerald-700">${resFlow.toFixed(1)} L/det</b> (${(resFlow * 3.6).toFixed(0)} m³/jam)</div>
            <div class="mt-1.5 pt-1 border-t border-slate-200 text-blue-600 font-semibold text-[11px]">
              👉 Klik untuk setting debit reservoir & gravitasi
            </div>
          </div>
        `;
      } else {
        nodeTooltip = `
          <div class="p-1 font-sans text-xs">
            <div class="font-bold text-slate-800 text-sm flex items-center justify-between gap-2">
              <span>${node.label} (${node.type || 'junction'})</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded ${nodeState?.isMeasured ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
                ${nodeState?.isMeasured ? 'Terukur' : (nodeState?.isEstimated ? 'Estimasi' : 'Belum Terukur')}
              </span>
            </div>
            <div class="text-slate-600 mt-1">Elevasi Tanah ($z$): <b>${node.elevation} m dpl</b></div>
        `;

        if (nodeState && nodeState.pressureHeadMeters !== null) {
          const pBar = (nodeState.pressureHeadMeters / 10.19716).toFixed(2);
          const pMeters = nodeState.pressureHeadMeters.toFixed(2);
          const totalHead = nodeState.totalHead ? nodeState.totalHead.toFixed(2) : '-';

          nodeTooltip += `
            <div class="mt-1 pt-1 border-t border-slate-200 text-slate-700">
              <div>Tekanan: <b class="text-blue-700">${pBar} bar</b> (${pMeters} mH2O)</div>
              <div>Total Head (HGL): <b class="text-emerald-700">${totalHead} m</b></div>
            </div>
          `;
        } else {
          nodeTooltip += `
            <div class="mt-1 text-amber-600 italic">Klik untuk input tekanan lapangan</div>
          `;
        }
        nodeTooltip += `</div>`;
      }

      marker.bindTooltip(nodeTooltip, { sticky: true, className: 'custom-leaflet-tooltip' });

      // Event klik node
      marker.on('click', () => {
        if (onNodeClickCallback) {
          onNodeClickCallback(node, nodeState);
        }
      });

      marker.nodeId = node.id;
      nodeLayersGroup.addLayer(marker);
    });

    // 3. Render Ikon Pompa khusus jika ada
    if (networkData.pumps && networkData.pumps.length > 0) {
      const isGravity = sourceConfig?.systemMode === 'gravity';
      const isPumpActive = !isGravity && (sourceConfig?.pump?.status !== 'off');
      const curHead = isPumpActive ? (Number(sourceConfig?.pump?.head) ?? 50) : 0;
      const curFlow = Number(sourceConfig?.pump?.flow) ?? 10;

      networkData.pumps.forEach(pump => {
        const startNode = nodesStateMap?.get(pump.startNodeId);
        const endNode = nodesStateMap?.get(pump.endNodeId);
        if (startNode && endNode) {
          const midLat = (startNode.lat + endNode.lat) / 2;
          const midLng = (startNode.lng + endNode.lng) / 2;

          const pumpIcon = L.divIcon({
            className: 'pump-map-marker',
            html: `
              <div class="w-8 h-8 rounded-full ${isPumpActive ? 'bg-violet-600' : 'bg-slate-500'} text-white shadow-lg flex items-center justify-center border-2 border-white cursor-pointer transform -translate-x-4 -translate-y-4 hover:scale-110 transition-transform" title="Pompa: ${pump.label}">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              </div>
            `,
            iconSize: [32, 32]
          });

          const pumpMarker = L.marker([midLat, midLng], { icon: pumpIcon });
          pumpMarker.bindTooltip(`
            <div class="p-1 font-sans text-xs">
              <div class="font-bold ${isPumpActive ? 'text-violet-800' : 'text-slate-700'} text-sm flex items-center justify-between gap-2">
                <span>Pompa ${pump.label}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded font-bold ${isPumpActive ? 'bg-violet-100 text-violet-800' : 'bg-slate-200 text-slate-700'}">
                  ${isPumpActive ? 'AKTIF' : 'BYPASS (OFF)'}
                </span>
              </div>
              <div class="text-slate-600 mt-1">Kapasitas Head: <b class="text-indigo-700">${isPumpActive ? curHead.toFixed(1) + ' m' : '0 m (Bypass Gravitasi)'}</b></div>
              <div class="text-slate-600">Kapasitas Debit: <b class="text-emerald-700">${curFlow.toFixed(1)} L/det</b> (${(curFlow * 3.6).toFixed(0)} m³/jam)</div>
              <div class="mt-1.5 pt-1 border-t border-slate-200 text-indigo-600 font-semibold text-[11px]">
                👉 Klik untuk edit kapasitas head & debit pompa
              </div>
            </div>
          `, { sticky: true });

          pumpMarker.on('click', () => {
            if (onPumpClickCallback) {
              onPumpClickCallback(pump);
            }
          });

          nodeLayersGroup.addLayer(pumpMarker);
        }
      });
    }

    // 4. Render Badge Angka Debit pada Garis Pipa
    renderPipeFlowLabels();
  }

  /**
   * Cari titik koordinat dan sudut bearing pada persentase panjang polyline
   * @param {Array} coords - Array titik [[lat, lng], ...]
   * @param {number} ratio - Posisi rasio dari pangkal ke ujung (0.0 - 1.0)
   * @returns {Object} { point: [lat, lng], bearing: number }
   */
  function getSegmentAlongPolyline(coords, ratio = 0.5) {
    if (!coords || coords.length === 0) return { point: null, bearing: 0 };
    if (coords.length === 1) return { point: coords[0], bearing: 0 };

    // Hitung jarak kumulatif antar titik koordinat
    let totalDist = 0;
    const segDists = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const dLat = coords[i+1][0] - coords[i][0];
      const dLng = coords[i+1][1] - coords[i][1];
      const d = Math.sqrt(dLat * dLat + dLng * dLng);
      segDists.push(d);
      totalDist += d;
    }

    if (totalDist === 0) {
      return { point: coords[0], bearing: 0 };
    }

    const clampedRatio = Math.max(0.05, Math.min(0.95, ratio));
    const targetDist = totalDist * clampedRatio;
    let accumulated = 0;
    let segIndex = 0;
    let segRatio = 0.5;

    for (let i = 0; i < segDists.length; i++) {
      if (accumulated + segDists[i] >= targetDist) {
        segIndex = i;
        segRatio = segDists[i] > 0 ? (targetDist - accumulated) / segDists[i] : 0;
        break;
      }
      accumulated += segDists[i];
    }

    const pA = coords[segIndex];
    const pB = coords[Math.min(coords.length - 1, segIndex + 1)];

    const lat = pA[0] + (pB[0] - pA[0]) * segRatio;
    const lng = pA[1] + (pB[1] - pA[1]) * segRatio;

    // Hitung bearing arah maju
    const lat1 = pA[0] * Math.PI / 180;
    const lng1 = pA[1] * Math.PI / 180;
    const lat2 = pB[0] * Math.PI / 180;
    const lng2 = pB[1] * Math.PI / 180;
    const dLng = lng2 - lng1;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

    return { point: [lat, lng], bearing };
  }

  /**
   * Render panah penunjuk arah aliran di sepanjang jalur pipa
   */
  function renderFlowArrows(coords, direction, color) {
    if (!coords || coords.length < 2) return;

    const isReverse = direction === 'reverse';
    // Letakkan panah di 35% panjang pipa (atau 65% jika reverse) agar tidak menabrak label debit
    const arrowSeg = getSegmentAlongPolyline(coords, isReverse ? 0.65 : 0.35);
    if (!arrowSeg || !arrowSeg.point) return;

    let bearing = arrowSeg.bearing;
    if (isReverse) {
      bearing = (bearing + 180) % 360;
    }

    // SVG Panah dengan animasi denyut aliran
    const arrowIcon = L.divIcon({
      className: 'flow-arrow-marker',
      html: `
        <div style="transform: translate(-10px, -10px) rotate(${bearing}deg);" class="flow-pulse">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="${color}" stroke="#ffffff" stroke-width="1.5">
            <path d="M12 2L19 21L12 17L5 21L12 2Z"/>
          </svg>
        </div>
      `,
      iconSize: [20, 20]
    });

    const arrowMarker = L.marker(arrowSeg.point, { icon: arrowIcon, interactive: false });
    arrowLayersGroup.addLayer(arrowMarker);
  }

  /**
   * Render badge angka debit langsung pada garis pipa
   */
  function renderPipeFlowLabels() {
    if (!flowLabelLayersGroup) return;
    flowLabelLayersGroup.clearLayers();

    if (flowLabelMode === 'off' || !activeNetworkData) return;

    activeNetworkData.pipes.forEach(pipe => {
      const pipeCalc = lastPipesStateMap ? lastPipesStateMap.get(pipe.id)?.calculation : null;
      const startNode = lastNodesStateMap?.get(pipe.startNodeId);
      const endNode = lastNodesStateMap?.get(pipe.endNodeId);

      const isCalculated = pipeCalc && pipeCalc.status === 'calculated';
      if (!isCalculated) return;

      let coords = pipe.routeCoordinates;
      if (!coords || coords.length === 0) {
        if (startNode && endNode) {
          coords = [
            [startNode.lat, startNode.lng],
            [endNode.lat, endNode.lng]
          ];
        } else {
          return;
        }
      }

      // Format teks debit sesuai mode satuan aktif
      let flowText = '';
      if (flowLabelMode === 'm3h') {
        flowText = `${pipeCalc.flowRateM3h.toFixed(1)} m³/j`;
      } else if (flowLabelMode === 'both') {
        flowText = `${pipeCalc.flowRateLps.toFixed(1)} L/s (${pipeCalc.flowRateM3h.toFixed(0)} m³/j)`;
      } else {
        // default 'lps'
        flowText = `${pipeCalc.flowRateLps.toFixed(1)} L/s`;
      }

      // Badge status kecepatan
      let badgeClass = 'badge-normal';
      if (pipeCalc.velocityStatus === 'critical') {
        badgeClass = 'badge-critical';
      } else if (pipeCalc.velocityStatus === 'warning') {
        badgeClass = 'badge-warning';
      } else if (pipeCalc.velocityStatus === 'low' || pipeCalc.velocityStatus === 'very_low') {
        badgeClass = 'badge-low';
      }

      const isSelected = pipe.id === currentSelectedPipeId;
      const isReverse = pipeCalc.direction === 'reverse';

      // Posisi label di 62% panjang pipa (atau 38% jika arah aliran reverse)
      const labelSeg = getSegmentAlongPolyline(coords, isReverse ? 0.38 : 0.62);
      if (!labelSeg || !labelSeg.point) return;

      const startLabel = startNode?.label || 'N/A';
      const endLabel = endNode?.label || 'N/A';
      const tooltipTitle = `Pipa: ${startLabel} ➔ ${endLabel}&#10;Debit: ${pipeCalc.flowRateLps.toFixed(2)} L/s (${pipeCalc.flowRateM3h.toFixed(1)} m³/jam)&#10;Kecepatan: ${pipeCalc.velocity.toFixed(2)} m/s (${pipeCalc.velocityLabel})&#10;👉 Klik untuk sorot & lihat detail`;

      const badgeHtml = `
        <div class="pipe-flow-badge ${badgeClass} ${isSelected ? 'selected' : ''}" data-pipe-id="${pipe.id}" title="${tooltipTitle}">
          <span class="text-sky-500 font-bold text-[10px]">💧</span>
          <span>${flowText}</span>
        </div>
      `;

      const labelMarker = L.marker(labelSeg.point, {
        icon: L.divIcon({
          className: 'pipe-flow-marker',
          html: badgeHtml,
          iconSize: [0, 0]
        }),
        interactive: true,
        zIndexOffset: isSelected ? 600 : 250
      });

      labelMarker.on('click', (e) => {
        if (e && e.originalEvent) {
          L.DomEvent.stopPropagation(e);
        }
        currentSelectedPipeId = pipe.id;
        highlightPipe(pipe.id);
        if (onPipeClickCallback) {
          onPipeClickCallback(pipe, pipeCalc, startNode, endNode);
        }
      });

      flowLabelLayersGroup.addLayer(labelMarker);
    });
  }

  /**
   * Set mode tampilan label debit ('lps', 'm3h', 'both', 'off')
   */
  function setFlowLabelMode(mode) {
    if (['lps', 'm3h', 'both', 'off'].includes(mode)) {
      flowLabelMode = mode;
      renderPipeFlowLabels();
    }
  }

  /**
   * Dapatkan mode tampilan label debit saat ini
   */
  function getFlowLabelMode() {
    return flowLabelMode;
  }

  /**
   * Sorot pipa yang dipilih
   */
  function highlightPipe(pipeId) {
    pipeLayersGroup.eachLayer(layer => {
      if (layer instanceof L.Polyline && layer.pipeId) {
        if (layer.pipeId === pipeId) {
          layer.setStyle({ weight: 9, opacity: 1 });
          layer.bringToFront();
        } else {
          layer.setStyle({ weight: 5, opacity: 0.8 });
        }
      }
    });

    // Update kelas terpilih pada badge angka debit
    document.querySelectorAll('.pipe-flow-badge').forEach(badge => {
      if (badge.getAttribute('data-pipe-id') === pipeId) {
        badge.classList.add('selected');
      } else {
        badge.classList.remove('selected');
      }
    });
  }

  /**
   * Zoom ke keseluruhan jaringan pipa & titik simpul
   */
  function fitNetworkBounds() {
    if (!map) return;
    let bounds = null;
    if (pipeLayersGroup && pipeLayersGroup.getLayers().length > 0) {
      bounds = pipeLayersGroup.getBounds();
    } else if (nodeLayersGroup && nodeLayersGroup.getLayers().length > 0) {
      bounds = nodeLayersGroup.getBounds();
    }
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    }
  }

  /**
   * Zoom ke lokasi tertentu
   */
  function panToNode(lat, lng, zoom = 17) {
    if (!map) return;
    map.setView([lat, lng], zoom, { animate: true });
  }

  return {
    init,
    switchBaseLayer,
    setCallbacks,
    renderNetwork,
    renderPipeFlowLabels,
    setFlowLabelMode,
    getFlowLabelMode,
    highlightPipe,
    fitNetworkBounds,
    panToNode,
    getMap: () => map
  };
})();
