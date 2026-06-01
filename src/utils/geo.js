export function getDistance(coord1, coord2) {
  const R = 6371;
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeRaw(p, f) {
  if (f === 'heat')         return ((+p.LST1 || 0) + (+p.uhi2 || 0)) / 2;
  if (f === 'urban_health') return p._urban_health || 0;
  return +p[f] || 0;
}

export function normalize(raw, f, stats) {
  const s = stats[f];
  if (!s || s.range === 0) return 0;
  return Math.min(1, Math.max(0, (raw - s.min) / s.range));
}

// Mutates each feature's properties to add _urban_health, returns a stats object
export function computeStats(features) {
  const subData = { immigrant1: [], income1: [], pop_sex3: [] };
  features.forEach(f => {
    const p = f.properties;
    subData.immigrant1.push(+p.immigrant1 || 0);
    subData.income1.push(  +p.income1    || 0);
    subData.pop_sex3.push( +p.pop_sex3   || 0);
  });

  const subStats = {};
  Object.keys(subData).forEach(k => {
    const s = subData[k].filter(isFinite).sort((a, b) => a - b);
    const n = s.length;
    subStats[k] = {
      min:   s[Math.floor(n * 0.05)] || 0,
      max:   s[Math.floor(n * 0.95)] || 1,
      range: Math.max(1e-6, (s[Math.floor(n * 0.95)] || 1) - (s[Math.floor(n * 0.05)] || 0))
    };
  });

  features.forEach(f => {
    const p = f.properties;
    const nImm = Math.min(1, Math.max(0, ((+p.immigrant1 || 0) - subStats.immigrant1.min) / subStats.immigrant1.range));
    const nInc = Math.min(1, Math.max(0, ((+p.income1    || 0) - subStats.income1.min)    / subStats.income1.range));
    const nPop = Math.min(1, Math.max(0, ((+p.pop_sex3   || 0) - subStats.pop_sex3.min)   / subStats.pop_sex3.range));
    p._urban_health = (nImm + (1 - nInc) + nPop) / 3;
  });

  const fields = { heat: [], SPEI: [], urban_health: [] };
  features.forEach(f => {
    const p = f.properties;
    fields.heat.push(computeRaw(p, 'heat'));
    fields.SPEI.push(+p.SPEI || 0);
    fields.urban_health.push(p._urban_health);
  });

  const stats = {};
  Object.keys(fields).forEach(k => {
    const a = fields[k].filter(x => x != null && isFinite(x)).sort((x, y) => x - y);
    const n = a.length;
    if (n === 0) { stats[k] = { min: 0, max: 1, range: 1 }; return; }
    const mn = a[Math.floor(n * 0.05)] || 0;
    const mx = a[Math.floor(n * 0.95)] || 1;
    stats[k] = { min: mn, max: mx, range: Math.max(1e-6, mx - mn) };
  });

  return stats;
}
