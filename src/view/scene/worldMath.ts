import type { World } from '../../sim/types'

export function sampleAltitude(world: World, xM: number, zM: number) {
  const n = world.gridSize
  const half = world.worldSizeM / 2
  const ux = (xM + half) / world.worldSizeM
  const uz = (zM + half) / world.worldSizeM

  const fx = Math.min(n - 1.001, Math.max(0, ux * (n - 1)))
  const fz = Math.min(n - 1.001, Math.max(0, uz * (n - 1)))
  const x0 = Math.floor(fx)
  const z0 = Math.floor(fz)
  const x1 = Math.min(n - 1, x0 + 1)
  const z1 = Math.min(n - 1, z0 + 1)
  const tx = fx - x0
  const tz = fz - z0

  const c00 = world.altitudeM[z0 * n + x0]
  const c10 = world.altitudeM[z0 * n + x1]
  const c01 = world.altitudeM[z1 * n + x0]
  const c11 = world.altitudeM[z1 * n + x1]

  const a = c00 * (1 - tx) + c10 * tx
  const b = c01 * (1 - tx) + c11 * tx
  return a * (1 - tz) + b * tz
}
