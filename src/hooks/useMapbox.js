import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import {
  MAPBOX_TOKEN, CENTER, ALPHA, BETA,
  CATEGORY_DELTAS, HALO_COLOR, CORE_COLOR
} from '../constants'
import { computeStats, computeRaw, normalize } from '../utils/geo'

export default function useMapbox({
  activeFields, impactData, selectedCategory,
  abmMode, abmCallbacks,
  onPointsLoaded, onImpactComputed,
  multiAbmActive, shelterData, selectedShelterCoord, onShelterSelected
}) {
  const mapContainerRef   = useRef(null)   // ref for the #map div
  const mapImpactRef      = useRef(null)   // ref for the #map-impact div
  const mapRef            = useRef(null)   // mapboxgl.Map instance (baseline)
  const mapImpactInst     = useRef(null)   // mapboxgl.Map instance (impact)
  const pointsRef         = useRef(null)   // GeoJSON feature collection
  const statsRef          = useRef({})     // computed stats
  const dividerXRef       = useRef(0)
  const activeFieldsRef   = useRef(activeFields)
  const abmCallbacksRef   = useRef(abmCallbacks)
  const [isCompareVisible, setIsCompareVisible] = useState(false)
  const onPointsLoadedRef  = useRef(onPointsLoaded)
  const onImpactComputedRef = useRef(onImpactComputed)
  useEffect(() => { onPointsLoadedRef.current  = onPointsLoaded  }, [onPointsLoaded])
  useEffect(() => { onImpactComputedRef.current = onImpactComputed }, [onImpactComputed])

  // Keep activeFieldsRef current so the map load callback can read latest value
  useEffect(() => { activeFieldsRef.current = activeFields }, [activeFields])
  useEffect(() => { abmCallbacksRef.current = abmCallbacks }, [abmCallbacks])

  const onShelterSelectedRef = useRef(onShelterSelected)
  useEffect(() => { onShelterSelectedRef.current = onShelterSelected }, [onShelterSelected])

  // ── Helpers ──────────────────────────────────────────────────────────────

  function removeSymbolLayers(m) {
    m.getStyle().layers.forEach(layer => {
      if (layer.type === 'symbol') {
        try { m.removeLayer(layer.id) } catch(e) {}
      }
    })
  }

  function addBuildingLayers(m, data, prefix) {
    const beforeLayer = m.getLayer('waterway-label') ? 'waterway-label' : undefined
    if (data) {
      m.addSource(`cadastral-${prefix}`, { type: 'geojson', data })
      m.addLayer({
        id: `fill-cadastral-${prefix}`,
        type: 'fill',
        source: `cadastral-${prefix}`,
        paint: {
          'fill-color': '#00eaff',
          'fill-opacity': 0.12,
          'fill-outline-color': 'rgba(0,234,255,0.35)'
        }
      }, beforeLayer)
    }
  }

  function addGlowLayers(m, sourceId, prefix) {
    m.addLayer({
      id: `glow-halo-${prefix}`,
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 5, 16, 25],
        'circle-color': HALO_COLOR,
        'circle-blur': 0.8,
        'circle-opacity': 1
      }
    })
    m.addLayer({
      id: `glow-core-${prefix}`,
      type: 'circle',
      source: sourceId,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 8],
        'circle-color': CORE_COLOR,
        'circle-opacity': 0.7
      }
    })
  }

  // ── Map initialisation (runs once) ────────────────────────────────────────

  useEffect(() => {
    mapboxgl.accessToken = MAPBOX_TOKEN

    if (!mapboxgl.supported()) {
      console.error('WebGL is not supported in this browser/environment. Map cannot be initialized.')
      return
    }

    const MAP_OPTIONS = {
      style: 'mapbox://styles/mapbox/dark-v11',
      center: CENTER,
      zoom: 13.5,
      pitch: 0,
      bearing: 0,
      maxPitch: 0,
      antialias: true,
      minZoom: 10,
      maxZoom: 18
    }

    let map
    try {
      map = new mapboxgl.Map({ container: mapContainerRef.current, ...MAP_OPTIONS })
    } catch (err) {
      console.error('Failed to initialize Mapbox map:', err)
      return
    }
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
    mapRef.current = map

    map.on('load', async () => {
      // Load cadastral buildings
      let cadastralData = null
      try {
        cadastralData = await fetch('/data/barcelona_buildings.geojson').then(r => r.json())
      } catch(e) { console.warn('Could not load cadastral buildings', e) }

      addBuildingLayers(map, cadastralData, 'main')
      removeSymbolLayers(map)

      // Load vulnerability points
      let pts
      try {
        pts = await fetch('/data/data.geojson').then(r => r.json())
      } catch(e) {
        console.error('data/data.geojson not found', e)
        return
      }
      statsRef.current = computeStats(pts.features)
      pointsRef.current = pts
      onPointsLoadedRef.current?.(pts, statsRef.current)

      map.addSource('points-main', { type: 'geojson', data: pts })
      addGlowLayers(map, 'points-main', 'main')

      // ── Shelter markers on BASELINE map ──────────────────────────────
      map.addSource('shelters-main', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('selected-shelter-main', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'shelters-main-circle', type: 'circle', source: 'shelters-main',
        layout: { visibility: 'none' },
        paint: { 'circle-radius': 7, 'circle-color': '#00ff88', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.85 }
      })
      map.addLayer({
        id: 'selected-shelter-main-circle', type: 'circle', source: 'selected-shelter-main',
        layout: { visibility: 'none' },
        paint: { 'circle-radius': 12, 'circle-color': '#00ff88', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff', 'circle-opacity': 1 }
      })
      map.on('click', 'shelters-main-circle', e => {
        if (!e.features.length) return
        onShelterSelectedRef.current?.(e.features[0])
      })
      map.on('mouseenter', 'shelters-main-circle', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'shelters-main-circle', () => { map.getCanvas().style.cursor = '' })
      // Multi-agent dots on BASELINE map (before-simulation agents)
      map.addSource('multi-agents-baseline', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'multi-agents-baseline-dot', type: 'circle', source: 'multi-agents-baseline',
        paint: {
          'circle-radius': 5,
          'circle-color': ['case', ['get', 'arrived'], '#00ff88', '#00eaff'],
          'circle-stroke-width': 1, 'circle-stroke-color': '#fff', 'circle-opacity': 0.9
        }
      })
      // ── ABM layers on BASELINE map (left side) ───────────────────────
      // Shows the before-agent path and moving dot against the original raster
      map.addSource('abm-path-baseline-main', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('abm-agent-baseline-main', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('abm-start-main', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('abm-end-main',   { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'abm-path-baseline-main-line', type: 'line', source: 'abm-path-baseline-main',
        paint: { 'line-color': '#00eaff', 'line-width': 3, 'line-opacity': 0.85 } })
      map.addLayer({ id: 'abm-agent-baseline-main-dot', type: 'circle', source: 'abm-agent-baseline-main',
        paint: { 'circle-radius': 10, 'circle-color': '#00eaff', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.95 } })
      map.addLayer({ id: 'abm-start-main-circle', type: 'circle', source: 'abm-start-main',
        paint: { 'circle-radius': 8, 'circle-color': '#FFD700', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } })
      map.addLayer({ id: 'abm-end-main-circle', type: 'circle', source: 'abm-end-main',
        paint: { 'circle-radius': 8, 'circle-color': '#C0C0C0', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } })

      // Initialise impact map
      const impactMap = new mapboxgl.Map({
        container: mapImpactRef.current,
        ...MAP_OPTIONS,
        interactive: false
      })
      mapImpactInst.current = impactMap

      await new Promise(res => impactMap.once('load', res))
      addBuildingLayers(impactMap, cadastralData, 'impact')
      removeSymbolLayers(impactMap)
      impactMap.addSource('points-impact', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      })
      addGlowLayers(impactMap, 'points-impact', 'impact')

      // ── Shelter markers on IMPACT map ────────────────────────────────
      impactMap.addSource('shelters-impact', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      impactMap.addSource('selected-shelter-impact', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      impactMap.addLayer({
        id: 'shelters-impact-circle', type: 'circle', source: 'shelters-impact',
        layout: { visibility: 'none' },
        paint: { 'circle-radius': 7, 'circle-color': '#00ff88', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.85 }
      })
      impactMap.addLayer({
        id: 'selected-shelter-impact-circle', type: 'circle', source: 'selected-shelter-impact',
        layout: { visibility: 'none' },
        paint: { 'circle-radius': 12, 'circle-color': '#00ff88', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff', 'circle-opacity': 1 }
      })
      // Multi-agent dots on IMPACT map (after-policy agents)
      impactMap.addSource('multi-agents-policy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      impactMap.addLayer({
        id: 'multi-agents-policy-dot', type: 'circle', source: 'multi-agents-policy',
        paint: {
          'circle-radius': 5,
          'circle-color': ['case', ['get', 'arrived'], '#00ff88', '#ff9900'],
          'circle-stroke-width': 1, 'circle-stroke-color': '#fff', 'circle-opacity': 0.9
        }
      })
      // ── ABM layers (all empty until ABM mode activates) ──────────────
      impactMap.addSource('abm-start',         { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      impactMap.addSource('abm-end',           { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      impactMap.addSource('abm-path-baseline', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      impactMap.addSource('abm-path-policy',   { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

      impactMap.addLayer({
        id: 'abm-path-baseline-line', type: 'line', source: 'abm-path-baseline',
        paint: { 'line-color': '#00eaff', 'line-width': 3, 'line-opacity': 0.85 }
      })
      impactMap.addLayer({
        id: 'abm-path-policy-line', type: 'line', source: 'abm-path-policy',
        paint: { 'line-color': '#ff9900', 'line-width': 3, 'line-opacity': 0.85, 'line-dasharray': [4, 2] }
      })
      impactMap.addLayer({
        id: 'abm-start-circle', type: 'circle', source: 'abm-start',
        paint: { 'circle-radius': 8, 'circle-color': '#FFD700', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
      })
      impactMap.addLayer({
        id: 'abm-end-circle', type: 'circle', source: 'abm-end',
        paint: { 'circle-radius': 8, 'circle-color': '#C0C0C0', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
      })

      // Agent dots — move along paths during Play animation
      impactMap.addSource('abm-agent-baseline', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      impactMap.addSource('abm-agent-policy',   { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      impactMap.addLayer({
        id: 'abm-agent-baseline-dot', type: 'circle', source: 'abm-agent-baseline',
        paint: { 'circle-radius': 10, 'circle-color': '#00eaff', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.95 }
      })
      impactMap.addLayer({
        id: 'abm-agent-policy-dot', type: 'circle', source: 'abm-agent-policy',
        paint: { 'circle-radius': 10, 'circle-color': '#ff9900', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.95 }
      })

      // Camera sync
      map.on('move', () => {
        impactMap.jumpTo({
          center: map.getCenter(),
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch()
        })
      })

      // ABM: forward map clicks to the ABM state machine
      map.on('click', e => {
        if (abmCallbacksRef.current?.handleMapClick) {
          abmCallbacksRef.current.handleMapClick(e.lngLat)
        }
      })

      // Trigger initial visualisation after maps are ready
      updateVisualizationInner(activeFieldsRef.current)
    })

    return () => { map?.remove() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally runs once — map init must not re-run on state changes

  // ── updateVisualization — called when activeFields changes ────────────────

  const updateVisualizationInner = useCallback((fields) => {
    const pts = pointsRef.current
    const map = mapRef.current
    if (!pts || !map || !map.getSource('points-main')) return

    pts.features.forEach(f => {
      const p = f.properties
      if (fields.length === 0) { p._value = 0; return }
      let sum = 0
      fields.forEach(k => sum += normalize(computeRaw(p, k), k, statsRef.current))
      p._value = sum / fields.length
    })
    map.getSource('points-main').setData(pts)
  }, [])

  useEffect(() => {
    updateVisualizationInner(activeFields)
  }, [activeFields, updateVisualizationInner])

  // ── updateImpactSource — called when impactData or selectedCategory changes ─

  useEffect(() => {
    const mapInst = mapImpactInst.current
    const pts = pointsRef.current
    if (!impactData || !mapInst || !pts) return
    if (!mapInst.getSource('points-impact')) return

    const local = impactData.neighborhood_level
    const city  = impactData.city_level
    const isCitywide   = impactData.is_citywide || false
    const targetBarri  = (impactData.analyzed_neighborhood || '').toLowerCase().trim()

    const catDeltas = CATEGORY_DELTAS[selectedCategory] || null
    const localSign = local.direction === 'Aggravation' ? 1 : -1
    const citySign  = city.direction  === 'Aggravation' ? 1 : -1
    const dLocal = k => catDeltas ? localSign * catDeltas[k] : localSign
    const dCity  = k => catDeltas ? citySign  * catDeltas[k] : citySign

    const lMacro = local.macro_impact || {}
    const cMacro = city.macro_impact  || lMacro
    const lW = { heat: lMacro['Heat risk']||0, SPEI: lMacro['Drought risk']||0, urban_health: lMacro['Urban health']||0 }
    const cW = { heat: cMacro['Heat risk']||0, SPEI: cMacro['Drought risk']||0, urban_health: cMacro['Urban health']||0 }

    const currentFields = activeFields.length > 0 ? activeFields : ['heat','SPEI','urban_health']

    const impactFeatures = pts.features.map(f => {
      const p = f.properties
      const barriName = (p.N_Barri || '').toLowerCase().trim()
      const isInNeighborhood = isCitywide || targetBarri === ''
        || barriName.includes(targetBarri) || targetBarri.includes(barriName)

      let V_sum = 0, count = 0
      currentFields.forEach(k => {
        const V_base = normalize(computeRaw(p, k), k, statsRef.current)
        let V_new
        if (isInNeighborhood) {
          const I_local = dLocal(k) * local.confidence * lW[k]
          const I_city  = dCity(k)  * city.confidence  * cW[k]
          const I_dim   = ALPHA * I_local + (1 - ALPHA) * I_city
          V_new = Math.min(1, Math.max(0, V_base + BETA * I_dim))
        } else {
          const I_city = dCity(k) * city.confidence * cW[k]
          V_new = Math.min(1, Math.max(0, V_base + BETA * (1 - ALPHA) * I_city))
        }
        V_sum += V_new
        count++
      })
      return {
        type: 'Feature',
        geometry: f.geometry,
        properties: { _value: count > 0 ? V_sum / count : 0, _inFocus: p._inFocus }
      }
    })

    const fc = { type: 'FeatureCollection', features: impactFeatures }
    mapInst.getSource('points-impact').setData(fc)
    onImpactComputedRef.current?.(fc)
  }, [impactData, selectedCategory, activeFields])

  // ── Compare divider controls ──────────────────────────────────────────────

  const showCompare = useCallback(() => {
    const mapInst = mapImpactInst.current
    if (dividerXRef.current === 0) {
      dividerXRef.current = (window.innerWidth - 370) / 2
    }
    const x = dividerXRef.current
    if (mapImpactRef.current) {
      mapImpactRef.current.style.clipPath = `inset(0 0 0 ${x}px)`
    }
    setIsCompareVisible(true)
    if (mapInst) mapInst.resize()
  }, [])

  const hideCompare = useCallback(() => {
    if (mapImpactRef.current) {
      mapImpactRef.current.style.clipPath = 'inset(0 0 0 100%)'
    }
    setIsCompareVisible(false)
  }, [])

  const updateDivider = useCallback((clientX) => {
    const minX = 240
    const maxX = window.innerWidth - 380
    const x = Math.max(minX, Math.min(maxX, clientX))
    dividerXRef.current = x
    if (mapImpactRef.current) {
      mapImpactRef.current.style.clipPath = `inset(0 0 0 ${x}px)`
    }
    return x
  }, [])

  // Sync ABM sources: baseline path/markers → left map, policy path/markers → right map
  useEffect(() => {
    const mBase   = mapRef.current           // baseline map (left)
    const mImpact = mapImpactInst.current    // impact map (right)
    if (!mImpact?.getSource('abm-start')) return

    const { startCoord, endCoord, baselinePath, policyPath } = abmCallbacks || {}

    const pt  = coord => coord
      ? [{ type: 'Feature', geometry: { type: 'Point',      coordinates: coord }, properties: {} }]
      : []
    const ln  = coords => coords?.length > 1
      ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }]
      : []
    const fc  = feats => ({ type: 'FeatureCollection', features: feats })

    // Right map (impact): start/end markers + policy path
    mImpact.getSource('abm-start').setData(fc(pt(startCoord)))
    mImpact.getSource('abm-end').setData(fc(pt(endCoord)))
    mImpact.getSource('abm-path-policy').setData(fc(ln(policyPath)))
    // Clear baseline path on impact map — it lives on the left map now
    mImpact.getSource('abm-path-baseline').setData(fc([]))

    // Left map (baseline): start/end markers + baseline path
    if (mBase?.getSource('abm-path-baseline-main')) {
      mBase.getSource('abm-start-main').setData(fc(pt(startCoord)))
      mBase.getSource('abm-end-main').setData(fc(pt(endCoord)))
      mBase.getSource('abm-path-baseline-main').setData(fc(ln(baselinePath)))
    }
  }, [abmCallbacks])

  // Move agent dots — baseline agent on LEFT map, policy agent on RIGHT map
  // Called directly from ABMPanel RAF tick — no React state, zero re-renders
  const updateAgentPositions = useCallback((step, basePath, polyPath, maxSteps) => {
    const mBase   = mapRef.current
    const mImpact = mapImpactInst.current
    if (!mImpact?.getSource('abm-agent-policy')) return

    const interp = (path, s, total) => {
      if (!path?.length) return null
      const idx = Math.min(Math.round(s * (path.length - 1) / Math.max(1, total - 1)), path.length - 1)
      return path[idx]
    }
    const fc = coord => ({
      type: 'FeatureCollection',
      features: coord ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: coord }, properties: {} }] : []
    })

    const bCoord = interp(basePath, step, maxSteps)
    const pCoord = interp(polyPath, step, maxSteps)

    // Before-agent (cyan) on baseline map — reacts to original raster
    if (mBase?.getSource('abm-agent-baseline-main')) {
      mBase.getSource('abm-agent-baseline-main').setData(fc(bCoord))
    }
    // After-agent (orange) on impact map — reacts to post-policy raster
    mImpact.getSource('abm-agent-policy').setData(fc(pCoord))
    // Keep impact map baseline agent empty — that agent lives on the left now
    if (mImpact.getSource('abm-agent-baseline')) {
      mImpact.getSource('abm-agent-baseline').setData(fc(null))
    }
  }, [])

  // Clear all ABM sources on both maps when ABM resets to placing-start
  // This eliminates the stale markers/paths from previous simulation runs
  useEffect(() => {
    if (abmMode !== 'placing-start') return
    const mBase   = mapRef.current
    const mImpact = mapImpactInst.current
    const empty   = { type: 'FeatureCollection', features: [] }
    const clear   = (map, ids) => ids.forEach(id => { if (map?.getSource(id)) map.getSource(id).setData(empty) })
    clear(mBase,   ['abm-path-baseline-main', 'abm-agent-baseline-main', 'abm-start-main', 'abm-end-main'])
    clear(mImpact, ['abm-path-baseline', 'abm-path-policy', 'abm-agent-baseline', 'abm-agent-policy', 'abm-start', 'abm-end'])
  }, [abmMode])

  // Climate dots stay visible in all modes — agents react to the visible raster.
  // Ensure they are always shown (in case anything else hid them).
  useEffect(() => {
    const m = mapRef.current
    if (!m) return
    ;['glow-halo-main', 'glow-core-main'].forEach(id => {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'visible')
    })
  }, [abmMode])

  // Show/hide shelter markers on both maps when multiAbmActive changes
  useEffect(() => {
    const mBase   = mapRef.current
    const mImpact = mapImpactInst.current
    if (!mBase?.getSource('shelters-main')) return
    const vis = multiAbmActive ? 'visible' : 'none'
    ;['shelters-main-circle', 'selected-shelter-main-circle'].forEach(id => {
      if (mBase.getLayer(id)) mBase.setLayoutProperty(id, 'visibility', vis)
    })
    ;['shelters-impact-circle', 'selected-shelter-impact-circle'].forEach(id => {
      if (mImpact?.getLayer(id)) mImpact.setLayoutProperty(id, 'visibility', vis)
    })
    if (!multiAbmActive) {
      const empty = { type: 'FeatureCollection', features: [] }
      if (mBase.getSource('multi-agents-baseline')) mBase.getSource('multi-agents-baseline').setData(empty)
      if (mImpact?.getSource('multi-agents-policy')) mImpact.getSource('multi-agents-policy').setData(empty)
    }
  }, [multiAbmActive])

  // Sync all shelter GeoJSON features to both maps
  useEffect(() => {
    const mBase   = mapRef.current
    const mImpact = mapImpactInst.current
    if (!shelterData?.length || !mBase?.getSource('shelters-main')) return
    const fc = { type: 'FeatureCollection', features: shelterData }
    mBase.getSource('shelters-main').setData(fc)
    if (mImpact?.getSource('shelters-impact')) mImpact.getSource('shelters-impact').setData(fc)
  }, [shelterData])

  // Highlight selected shelter on both maps
  useEffect(() => {
    const mBase   = mapRef.current
    const mImpact = mapImpactInst.current
    if (!mBase?.getSource('selected-shelter-main')) return
    const fc = selectedShelterCoord
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: selectedShelterCoord }, properties: {} }] }
      : { type: 'FeatureCollection', features: [] }
    mBase.getSource('selected-shelter-main').setData(fc)
    if (mImpact?.getSource('selected-shelter-impact')) mImpact.getSource('selected-shelter-impact').setData(fc)
  }, [selectedShelterCoord])

  // Move multi-agent dots — called directly from MultiABMPanel RAF tick
  const updateMultiAgentPositions = useCallback((frameIdx, baseSnaps, policySnaps) => {
    const mBase   = mapRef.current
    const mImpact = mapImpactInst.current
    if (!mBase?.getSource('multi-agents-baseline')) return
    const toFC = snapshot => ({
      type: 'FeatureCollection',
      features: (snapshot || []).map(a => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
        properties: { arrived: a.arrived }
      }))
    })
    const bFrame = baseSnaps?.[Math.min(frameIdx, (baseSnaps?.length || 1) - 1)]
    const pFrame = policySnaps?.[Math.min(frameIdx, (policySnaps?.length || 1) - 1)]
    mBase.getSource('multi-agents-baseline').setData(toFC(bFrame))
    if (mImpact?.getSource('multi-agents-policy')) mImpact.getSource('multi-agents-policy').setData(toFC(pFrame))
  }, [])

  return {
    mapContainerRef,
    mapImpactRef,
    isCompareVisible,
    showCompare,
    hideCompare,
    updateDivider,
    dividerXRef,
    updateAgentPositions,
    updateMultiAgentPositions
  }
}
