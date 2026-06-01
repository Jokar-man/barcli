import { useRef, useEffect } from 'react'

export default function CompareDivider({ isVisible, onDrag, dividerXRef }) {
  const elRef = useRef(null)

  useEffect(() => {
    const el = elRef.current
    if (!el) return
    let dragging = false

    const onMouseDown = e => { dragging = true; e.preventDefault() }
    const move = clientX => {
      const x = onDrag(clientX)
      if (x != null && elRef.current) elRef.current.style.left = x + 'px'
    }
    const onMouseMove  = e => { if (dragging) move(e.clientX) }
    const onMouseUp    = () => { dragging = false }
    const onTouchStart = e => { dragging = true; e.preventDefault() }
    const onTouchMove  = e => { if (dragging) move(e.touches[0].clientX) }
    const onTouchEnd   = () => { dragging = false }

    el.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd)

    return () => {
      el.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      el.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [onDrag])

  // On first show, set initial position from dividerXRef
  useEffect(() => {
    if (isVisible && elRef.current && dividerXRef?.current > 0) {
      elRef.current.style.left = dividerXRef.current + 'px'
    }
  }, [isVisible, dividerXRef])

  return (
    <div
      id="compare-divider"
      ref={elRef}
      style={{ display: isVisible ? 'flex' : 'none' }}
    >
      <div id="compare-handle">&#8612;&#8614;</div>
      <div className="cmp-label cmp-left">Baseline</div>
      <div className="cmp-label cmp-right">After Policy</div>
    </div>
  )
}
