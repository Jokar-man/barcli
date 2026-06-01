import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import {
  MAPBOX_TOKEN, CENTER, ALPHA, BETA,
  CATEGORY_DELTAS, HALO_COLOR, CORE_COLOR
} from '../constants'
import { computeStats, computeRaw, normalize } from '../utils/geo'

export default function useMapbox({ activeFields, impactData, selectedCategory, abmMode, abmCallbacks, onPointsLoaded, onImpactComputed }) {
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

    const map = new mapboxgl.Map({ container: mapContainerRef.current, ...MAP_OPTIONS })
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

    return () => { map.remove() }
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

  // Sync ABM marker and path sources to map whenever abmCallbacks updates
  useEffect(() => {
    const m = mapImpactInst.current
    if (!m || !m.getSource('abm-start')) return

    const { startCoord, endCoord, baselinePath, policyPath } = abmCallbacks || {}

    m.getSource('abm-start').setData({
      type: 'FeatureCollection',
      features: startCoord
        ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: startCoord }, properties: {} }]
        : []
    })
    m.getSource('abm-end').setData({
      type: 'FeatureCollection',
      features: endCoord
        ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: endCoord }, properties: {} }]
        : []
    })
    m.getSource('abm-path-baseline').setData({
      type: 'FeatureCollection',
      features: baselinePath?.length > 1
        ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: baselinePath }, properties: {} }]
        : []
    })
    m.getSource('abm-path-policy').setData({
      type: 'FeatureCollection',
      features: policyPath?.length > 1
        ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: policyPath }, properties: {} }]
        : []
    })
  }, [abmCallbacks])

  // Move the agent dots along both paths — called directly from ABMPanel RAF tick
  const updateAgentPositions = useCallback((step, basePath, polyPath, maxSteps) => {
    const m = mapImpactInst.current
    if (!m || !m.getSource('abm-agent-baseline')) return

    const interp = (path, s, total) => {
      if (!path?.length) return null
      const idx = Math.min(Math.round(s * (path.length - 1) / Math.max(1, total - 1)), path.length - 1)
      return path[idx]
    }

    const bCoord = interp(basePath, step, maxSteps)
    const pCoord = interp(polyPath, step, maxSteps)

    m.getSource('abm-agent-baseline').setData({
      type: 'FeatureCollection',
      features: bCoord ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: bCoord }, properties: {} }] : []
    })
    m.getSource('abm-agent-policy').setData({
      type: 'FeatureCollection',
      features: pCoord ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: pCoord }, properties: {} }] : []
    })
  }, [])

  // Hide baseline climate layers when ABM mode is active
  useEffect(() => {
    const m = mapRef.current
    if (!m) return
    const isAbm = abmMode !== 'idle' && abmMode !== undefined
    const visibility = isAbm ? 'none' : 'visible'
    ;['glow-halo-main', 'glow-core-main'].forEach(id => {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', visibility)
    })
  }, [abmMode])

  return {
    mapContainerRef,
    mapImpactRef,
    isCompareVisible,
    showCompare,
    hideCompare,
    updateDivider,
    dividerXRef,
    updateAgentPositions
  }
}
