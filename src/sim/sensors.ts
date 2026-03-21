import type { SensorConfig, SensorType, Vec2, World } from './types'
import { worldXZToCell } from './terrain'

export const COVER_SOIL = 1
export const COVER_CLIMATE = 2
export const COVER_BIO = 4

export function sensorTypeMask(t: SensorType) {
  switch (t) {
    case 'suolo':
      return COVER_SOIL
    case 'clima':
      return COVER_CLIMATE
    case 'biodiversita':
      return COVER_BIO
  }
}

export function computeCoverage(world: World, sensors: SensorConfig[]) {
  const nCells = world.gridSize * world.gridSize
  const cov = new Uint8Array(nCells)
  const cellSize = world.cellSizeM
  const n = world.gridSize

  for (const s of sensors) {
    const mask = sensorTypeMask(s.type)
    const radCells = Math.max(1, Math.floor(s.radiusM / cellSize))
    // Use the same mapping as selection/terrain to avoid any offset (clamped indices).
    const center = worldXZToCell(world, s.position.x, s.position.z)
    const cx = center % n
    const cz = Math.floor(center / n)
    for (let dz = -radCells; dz <= radCells; dz++) {
      for (let dx = -radCells; dx <= radCells; dx++) {
        const x = cx + dx
        const z = cz + dz
        if (x < 0 || z < 0 || x >= n || z >= n) continue
        const d2 = dx * dx + dz * dz
        if (d2 > radCells * radCells) continue
        cov[z * n + x] |= mask
      }
    }
  }

  return cov
}

export function hasCoverage(cov: Uint8Array, cell: number, requiredMask: number) {
  return (cov[cell] & requiredMask) === requiredMask
}

export function quantizeSensorCost(type: SensorType, precision: number, radiusM: number) {
  const base = type === 'suolo' ? 1500 : type === 'clima' ? 2500 : 4000
  const prec = 0.7 + 0.75 * Math.max(0, Math.min(1, precision))
  const rad = 0.75 + Math.min(1.8, radiusM / 18)
  return Math.round(base * prec * rad)
}

export function worldClampPosition(world: World, p: Vec2): Vec2 {
  const half = world.worldSizeM / 2
  return { x: Math.max(-half, Math.min(half, p.x)), z: Math.max(-half, Math.min(half, p.z)) }
}
