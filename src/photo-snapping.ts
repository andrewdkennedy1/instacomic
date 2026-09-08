/** A small screen-space magnet that releases easily when the drag continues. */
export function snapPhotoOffset(offset: number, framePixels: number, latched: boolean) {
  const distance = Math.abs(offset * framePixels)
  const snapped = distance <= (latched ? 9 : 5)
  return { offset: snapped ? 0 : offset, snapped }
}
