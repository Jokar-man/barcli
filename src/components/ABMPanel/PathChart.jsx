// src/components/ABMPanel/PathChart.jsx

const W = 310
const H = 140
const PAD = { top: 10, right: 10, bottom: 28, left: 32 }

export default function PathChart({ baselineProfile, policyProfile, stepIndex }) {
  if (!baselineProfile?.length) return null

  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const n = Math.max(baselineProfile.length, policyProfile?.length || 0)

  function xScale(i) { return PAD.left + (i / (n - 1)) * innerW }
  function yScale(v) { return PAD.top + innerH - v * innerH }

  function toPolyline(profile) {
    return profile.map((v, i) => `${xScale(i)},${yScale(v)}`).join(' ')
  }

  const stepX = stepIndex != null ? xScale(Math.min(stepIndex, n - 1)) : null

  return (
    <svg width={W} height={H} style={{ display: 'block', background: 'rgba(0,0,0,0.3)', borderRadius: 4 }}>
      {/* Y axis */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerH} stroke="#444" strokeWidth={1} />
      {/* X axis */}
      <line x1={PAD.left} y1={PAD.top + innerH} x2={PAD.left + innerW} y2={PAD.top + innerH} stroke="#444" strokeWidth={1} />
      {/* Y axis labels */}
      {[0, 0.5, 1].map(v => (
        <text key={v} x={PAD.left - 4} y={yScale(v) + 4} fill="#666" fontSize={8} textAnchor="end">{v.toFixed(1)}</text>
      ))}
      {/* Axis titles */}
      <text x={PAD.left + innerW / 2} y={H - 2} fill="#555" fontSize={8} textAnchor="middle">steps</text>
      <text x={8} y={PAD.top + innerH / 2} fill="#555" fontSize={8} textAnchor="middle" transform={`rotate(-90,8,${PAD.top + innerH / 2})`}>vulnerability</text>

      {/* Policy path (orange dashed) */}
      {policyProfile?.length > 0 && (
        <polyline points={toPolyline(policyProfile)} fill="none" stroke="#ff9900" strokeWidth={1.5} strokeDasharray="4 2" opacity={0.8} />
      )}
      {/* Baseline path (cyan) */}
      <polyline points={toPolyline(baselineProfile)} fill="none" stroke="#00eaff" strokeWidth={1.5} opacity={0.9} />

      {/* Step cursor */}
      {stepX != null && (
        <line x1={stepX} y1={PAD.top} x2={stepX} y2={PAD.top + innerH} stroke="#fff" strokeWidth={1} strokeDasharray="2 2" opacity={0.5} />
      )}

      {/* Legend */}
      <rect x={PAD.left + 4} y={PAD.top + 4} width={8} height={2} fill="#00eaff" />
      <text x={PAD.left + 15} y={PAD.top + 8} fill="#00eaff" fontSize={7}>Baseline</text>
      <rect x={PAD.left + 55} y={PAD.top + 4} width={8} height={2} fill="#ff9900" />
      <text x={PAD.left + 66} y={PAD.top + 8} fill="#ff9900" fontSize={7}>After Policy</text>
    </svg>
  )
}
