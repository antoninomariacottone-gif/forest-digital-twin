export type SoilType = 'sabbioso' | 'argilloso' | 'limoso' | 'roccioso' | 'misto'
export type SensorType = 'suolo' | 'clima' | 'biodiversita'
export type InterventionType = 'semina_droni' | 'rimozione_invasive' | 'corridoio_antincendio'

export type Vec2 = { x: number; z: number }

export type TerrainConfig = {
  gridSize: number // cells per side
  worldSizeM: number // meters, XZ
  baseSoil: SoilType
  meanMoisturePct: number // 0..100
  nutrients: { n: number; p: number; k: number } // arbitrary units
  ph: number // 4..9
  meanTempC: number
  seasonalTempAmpC: number
  altitudeMinM: number
  altitudeMaxM: number
  roughness: number // 0..1
  shadePatchiness: number // 0..1
}

export type ClimateConfig = {
  meanRainMmDay: number
  windMean: number
  droughtChancePerDay: number // 0..1
  stormChancePerDay: number // 0..1
  wildfireChancePerDay: number // 0..1 (actual ignition still depends on fire risk)
  diseaseChancePerDay: number // 0..1
}

export type SpeciesConfig = {
  id: string
  name: string
  form: 'latifoglia' | 'conifera' | 'arbusto'
  maxHeightM: number
  maxTrunkRadiusM: number
  maxCanopyRadiusM: number
  rootDepthM: number
  waterUsePerDay: number // 0..1 relative demand
  nutrientUsePerDay: { n: number; p: number; k: number } // relative
  seed: {
    distanceM: number
    probabilityPerDay: number // 0..1 when mature
    minMoisturePct: number
    phMin: number
    phMax: number
  }
  tolerance: {
    tempMinC: number
    tempMaxC: number
    drought: number // 0..1 (1 = very tolerant)
    phMin: number
    phMax: number
  }
  germinationDays: number
  maturityDays: number
  shadePreference: number // 0..1 (1 loves shade)
  color: { canopy: string; trunk: string }
}

export type SensorConfig = {
  id: string
  type: SensorType
  position: Vec2 // world meters
  radiusM: number
  precision: number // 0..1 (1 = best)
  cost: number
}

export type Intervention = {
  id: string
  type: InterventionType
  createdAtDay: number
  approved: boolean
  rejected: boolean
  reason?: string
  cost: number
  payload:
    | { kind: 'seeding'; cells: number[]; speciesId: string }
    | { kind: 'invasive_removal'; cells: number[] }
    | { kind: 'firebreak'; polyline: Vec2[]; widthM: number }
}

export type AiSuggestion =
  | { id: string; kind: 'sensor_plan'; sensors: Omit<SensorConfig, 'id'>[]; totalCost: number; createdAtDay: number }
  | { id: string; kind: 'intervention'; intervention: Omit<Intervention, 'id'>; createdAtDay: number }

export type ProjectConfig = {
  terrain: TerrainConfig
  climate: ClimateConfig
  species: SpeciesConfig[]
  budgetCredits: number
}

export type World = {
  day: number // simulation day
  seasonDay: number // 0..365
  gridSize: number
  worldSizeM: number
  cellSizeM: number

  altitudeM: Float32Array
  shade: Float32Array // 0..1
  soilType: Uint8Array // enum index
  moisturePct: Float32Array // 0..100
  ph: Float32Array
  n: Float32Array
  p: Float32Array
  k: Float32Array
  carbon: Float32Array // kgC per cell (toy)

  invasive: Float32Array // 0..1
  canopyCover: Float32Array // 0..1
  biodiversity: Float32Array // 0..1
  fireRisk: Float32Array // 0..1

  degradedMask: Uint8Array // 1 = degraded at t0
  occupancy: Int32Array // plant index in plants[], -1 empty
  plants: Plant[]
}

export type Plant = {
  id: number
  speciesId: string
  cell: number
  ageDays: number
  heightM: number
  trunkRadiusM: number
  canopyRadiusM: number
  rootDepthM: number
  health: number // 0..1
  alive: boolean
  lastSeedDay: number
}

export type LogEvent = {
  day: number
  type:
    | 'climate_rain'
    | 'climate_wind'
    | 'climate_drought'
    | 'storm'
    | 'wildfire'
    | 'disease'
    | 'ai_blocked_no_data'
    | 'ai_suggest_sensor'
    | 'ai_suggest_intervention'
    | 'sensor_added'
    | 'intervention_applied'
    | 'intervention_rejected'
    | 'terrain_regenerated'
  message: string
}

export type MetricsPoint = {
  day: number
  vegetativeCover: number // 0..1
  biodiversity: number // 0..1
  carbonStorage: number // total kgC (toy)
  degradedRegen: number // 0..1 (how much degraded area recovered)
  totalCost: number
}
