import assert from 'node:assert/strict'
import { cutAt, cutControls, cutPaintSpan, extendCut } from '../src/grid-geometry.ts'

const edge = (x, y) => x === 0 || x === 100 || y === 0 || y === 100
for (const aspect of [1.25, 4 / 3, 0.75, 16 / 9]) {
  for (let angle = -90; angle <= 90; angle += 3) {
    for (const position of [5, 20, 50, 73, 95]) {
      const line = cutAt(angle, position, aspect)
      assert.ok(edge(line.x1, line.y1) && edge(line.x2, line.y2), 'Both ends must meet an edge')
      assert.ok(Object.values(line).every(v => Number.isFinite(v) && v >= 0 && v <= 100))
      const controls = cutControls(line, aspect)
      const paint = cutPaintSpan(line, aspect, true)
      const vx = paint.x2 - paint.x1
      const vy = (paint.y2 - paint.y1) * aspect
      const lengthSquared = vx * vx + vy * vy
      for (const [x, y] of [[0, 0], [100, 0], [100, 100], [0, 100]]) {
        const t = ((x - paint.x1) * vx + (y - paint.y1) * aspect * vy) / lengthSquared
        assert.ok(t > 0 && t < 1, 'A square stroke cap can intersect the canvas')
      }
      assert.ok(Math.abs(controls.angle - angle) < 0.001)
      assert.ok(Math.abs(controls.position - position) < 0.001)
      const moved = extendCut({ x1: line.x1 + 30, x2: line.x2 + 30, y1: line.y1 - 10, y2: line.y2 - 10 }, aspect)
      assert.ok(edge(moved.x1, moved.y1) && edge(moved.x2, moved.y2), 'Translation detached a cut')
      assert.ok(Math.abs(cutControls(moved, aspect).angle - angle) < 0.001, 'Translation changed the angle')
    }
  }
}
assert.deepEqual(cutAt(0, 30, 1.25), { x1: 0, y1: 30, x2: 100, y2: 30 })
const internal = { x1: 20, y1: 30, x2: 60, y2: 70 }
assert.deepEqual(cutPaintSpan(internal, 1.25), internal, 'Legacy internal segments must not change')
console.log('1,220 cut cases passed: edge continuity, translation, angle, position, and four canvas formats.')
