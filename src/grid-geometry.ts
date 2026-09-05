/** A cut is an infinite line clipped to the canvas, not a resizable stroke. */
export type Cut = { x1: number; y1: number; x2: number; y2: number }

export function cutControls(line: Cut, aspect: number) {
  let angle = (Math.atan2((line.y2 - line.y1) * aspect, line.x2 - line.x1) * 180) / Math.PI
  if (angle > 90) angle -= 180
  if (angle < -90) angle += 180
  const radians = (angle * Math.PI) / 180
  const nx = -Math.sin(radians)
  const ny = Math.cos(radians)
  const reach = 50 * Math.abs(nx) + 50 * aspect * Math.abs(ny)
  const distance = ((line.x1 + line.x2) / 2 - 50) * nx + ((line.y1 + line.y2) / 2 - 50) * aspect * ny
  return { angle, position: 50 + (distance / reach) * 50 }
}

export function cutAt(angle: number, position: number, aspect: number): Cut {
  const radians = (angle * Math.PI) / 180
  const dx = Math.cos(radians)
  const dy = Math.sin(radians)
  const nx = -dy
  const ny = dx
  const reach = 50 * Math.abs(nx) + 50 * aspect * Math.abs(ny)
  // Keep a cut inside the canvas even when a finger travels outside it.
  const distance = ((Math.max(5, Math.min(95, position)) - 50) / 50) * reach
  const cx = 50 + nx * distance
  const cy = 50 * aspect + ny * distance
  let low = -Infinity
  let high = Infinity
  for (const [center, direction, size] of [
    [cx, dx, 100],
    [cy, dy, 100 * aspect],
  ]) {
    if (Math.abs(direction) < 1e-9) continue
    const a = -center / direction
    const b = (size - center) / direction
    low = Math.max(low, Math.min(a, b))
    high = Math.min(high, Math.max(a, b))
  }
  const bounded = (value: number) => Math.max(0, Math.min(100, Number(value.toFixed(4))))
  return {
    x1: bounded(cx + dx * low),
    y1: bounded((cy + dy * low) / aspect),
    x2: bounded(cx + dx * high),
    y2: bounded((cy + dy * high) / aspect),
  }
}

export function extendCut(line: Cut, aspect: number, snap = false): Cut {
  let { angle, position } = cutControls(line, aspect)
  if (snap) {
    const targetAngle = Math.round(angle / 15) * 15
    if (Math.abs(targetAngle - angle) <= 2) angle = targetAngle
    const targetPosition = Math.round(position / 25) * 25
    if (Math.abs(targetPosition - position) <= 1.2) position = targetPosition
  }
  return cutAt(angle, position, aspect)
}
