/** Shared rectangular boundaries keep neighboring photos connected during resizing. */
export type RectPanel = { id: string; x: number; y: number; w: number; h: number; points?: Array<[number, number]> }
export type RectDivider = {
  id: string; axis: 'x' | 'y'; position: number; start: number; end: number
  before: string[]; after: string[]; min: number; max: number
}

const epsilon = 0.00001
const equal = (a: number, b: number) => Math.abs(a - b) < epsilon

export function rectangularDividers(panels: RectPanel[]): RectDivider[] {
  if (panels.some(panel => panel.points)) return []
  const result: RectDivider[] = []
  for (const axis of ['x', 'y'] as const) {
    const cross = axis === 'x' ? 'y' : 'x'
    const size = axis === 'x' ? 'w' : 'h'
    const crossSize = axis === 'x' ? 'h' : 'w'
    const positions = panels.map(panel => panel[axis] + panel[size]).filter(value => value > epsilon && value < 1 - epsilon)
      .filter((value, index, values) => values.findIndex(other => equal(value, other)) === index)
    for (const position of positions) {
      const spans: Array<{ start: number; end: number }> = []
      for (const before of panels.filter(panel => equal(panel[axis] + panel[size], position))) {
        for (const after of panels.filter(panel => equal(panel[axis], position))) {
          const start = Math.max(before[cross], after[cross])
          const end = Math.min(before[cross] + before[crossSize], after[cross] + after[crossSize])
          if (end - start > epsilon) spans.push({ start, end })
        }
      }
      const merged: typeof spans = []
      for (const span of spans.sort((a, b) => a.start - b.start)) {
        const previous = merged.at(-1)
        if (previous && span.start <= previous.end + epsilon) previous.end = Math.max(previous.end, span.end)
        else merged.push({ ...span })
      }
      for (const { start, end } of merged) {
        const overlaps = (panel: RectPanel) => Math.min(end, panel[cross] + panel[crossSize]) - Math.max(start, panel[cross]) > epsilon
        const before = panels.filter(panel => equal(panel[axis] + panel[size], position) && overlaps(panel))
        const after = panels.filter(panel => equal(panel[axis], position) && overlaps(panel))
        result.push({
          id: `${axis}:${before.map(panel => panel.id).sort().join(',')}:${after.map(panel => panel.id).sort().join(',')}`,
          axis, position, start, end, before: before.map(panel => panel.id), after: after.map(panel => panel.id),
          min: Math.max(...before.map(panel => panel[axis] + 0.05)),
          max: Math.min(...after.map(panel => panel[axis] + panel[size] - 0.05)),
        })
      }
    }
  }
  return result
}

export function moveRectDivider<T extends RectPanel>(panels: T[], divider: RectDivider, requested: number): T[] {
  const position = Math.max(divider.min, Math.min(divider.max, requested))
  const size = divider.axis === 'x' ? 'w' : 'h'
  return panels.map(panel => {
    if (divider.before.includes(panel.id)) return { ...panel, [size]: position - panel[divider.axis] }
    if (divider.after.includes(panel.id)) return { ...panel, [divider.axis]: position, [size]: panel[divider.axis] + panel[size] - position }
    return panel
  })
}

export function snapGridCenter(position: number, latched: boolean, enabled = true) {
  const snapped = enabled && Math.abs(position - 0.5) <= (latched ? 0.025 : 0.015)
  return { position: snapped ? 0.5 : position, snapped }
}
