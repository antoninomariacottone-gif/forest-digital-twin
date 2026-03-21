import type { SensorConfig, World } from './types'
import { COVER_BIO, COVER_CLIMATE, COVER_SOIL, sensorTypeMask } from './sensors'
import { clamp01, hash2 } from './random'
import { worldXZToCell } from './terrain'

export type CoverageQuality = {
  mask: Uint8Array
  soilQ: Float32Array
  climateQ: Float32Array
  bioQ: Float32Array
}

export function computeCoverageQuality(world: World, sensors: SensorConfig[]): CoverageQuality {
  const nCells = world.gridSize * world.gridSize
  const mask = new Uint8Array(nCells)
  const soilQ = new Float32Array(nCells)
  const climateQ = new Float32Array(nCells)
  const bioQ = new Float32Array(nCells)

  const cellSize = world.cellSizeM
  const n = world.gridSize

  for (const s of sensors) {
    const m = sensorTypeMask(s.type)
    const radCells = Math.max(1, Math.floor(s.radiusM / cellSize))
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
        const c = z * n + x
        mask[c] |= m
        if (m === COVER_SOIL) soilQ[c] = Math.max(soilQ[c], s.precision)
        else if (m === COVER_CLIMATE) climateQ[c] = Math.max(climateQ[c], s.precision)
        else if (m === COVER_BIO) bioQ[c] = Math.max(bioQ[c], s.precision)
      }
    }
  }

  return { mask, soilQ, climateQ, bioQ }
}

export function noisy01(value01: number, quality: number, cell: number, day: number, salt: number) {
  const q = clamp01(quality)
  const r = hash2(cell, day, salt)
  const amp = (1 - q) * 0.18
  const n = (r - 0.5) * 2 * amp
  return clamp01(value01 + n)
}

export function noisyRange(value: number, min: number, max: number, quality: number, cell: number, day: number, salt: number) {
  const v01 = (value - min) / Math.max(1e-6, max - min)
  const x01 = noisy01(v01, quality, cell, day, salt)
  return min + x01 * (max - min)
}
