export interface TilePoint {
  x: number
  y: number
}

// Returns a straight-line path between two tile coordinates.
// A* implementation can replace this when room geometry is needed.
export function findPath(from: TilePoint, to: TilePoint): TilePoint[] {
  if (from.x === to.x && from.y === to.y) return [from]
  return [from, to]
}

// Convert tile coordinates to isometric screen coordinates
export function isoToScreen(
  tileX: number,
  tileY: number,
  originX: number,
  originY: number,
  tileW = 64,
  tileH = 32,
): { x: number; y: number } {
  return {
    x: originX + (tileX - tileY) * (tileW / 2),
    y: originY + (tileX + tileY) * (tileH / 2),
  }
}

// Depth value for correct isometric z-ordering
export function isoDepth(tileX: number, tileY: number): number {
  return tileX + tileY
}
