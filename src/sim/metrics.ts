import type { MetricsPoint, World } from './types'
import { estimatePlantBiomassKgC } from './engine'

export function computeMetrics(world: World, totalCost: number): MetricsPoint {
  const nCells = world.gridSize * world.gridSize
  let cover = 0
  let biod = 0
  let carbonSoil = 0
  let degraded = 0
  let degradedRecovered = 0
  for (let c = 0; c < nCells; c++) {
    cover += world.canopyCover[c]
    biod += world.biodiversity[c]
    carbonSoil += world.carbon[c]
    if (world.degradedMask[c]) {
      degraded++
      if (world.canopyCover[c] > 0.18) degradedRecovered++
    }
  }
  const plantC = estimatePlantBiomassKgC(world)
  return {
    day: Math.floor(world.day),
    vegetativeCover: cover / nCells,
    biodiversity: biod / nCells,
    carbonStorage: carbonSoil + plantC,
    degradedRegen: degraded ? degradedRecovered / degraded : 1,
    totalCost,
  }
}

