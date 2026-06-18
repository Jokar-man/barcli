export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';
export const CENTER = [2.1734, 41.3851];
export const ALPHA = 0.6;
export const BETA  = 0.5;
export const AI_API_URL   = import.meta.env.VITE_AI_API_URL   || 'https://jokar-man-urban-climate-model.hf.space';
export const MESA_API_URL = import.meta.env.VITE_MESA_API_URL || AI_API_URL;

export const HALO_COLOR = [
  'interpolate', ['linear'], ['coalesce', ['get', '_value'], 0],
  0,   'rgba(0,120,255,0)',
  0.1, 'rgba(0,120,255,0.12)',
  0.5, 'rgba(0,255,180,0.18)',
  0.8, 'rgba(255,220,0,0.24)',
  1,   'rgba(255,0,80,0.32)'
];

export const CORE_COLOR = [
  'interpolate', ['linear'], ['coalesce', ['get', '_value'], 0],
  0.0, 'rgba(50,50,50,0)',
  0.2, 'rgb(0,120,255)',
  0.5, 'rgb(0,255,180)',
  0.8, 'rgb(255,220,0)',
  1.0, 'rgb(255,0,80)'
];

export const CATEGORY_DELTAS = {
  urban:      { heat: 0.797, SPEI: 0.386, urban_health: 0.592 },
  green:      { heat: 0.517, SPEI: 0.310, urban_health: 0.414 },
  water:      { heat: 0.482, SPEI: 0.020, urban_health: 0.231 },
  energy:     { heat: 0.607, SPEI: 0.323, urban_health: 0.142 },
  governance: { heat: 0.436, SPEI: 0.274, urban_health: 0.355 }
};
