import { clamp01, lerp } from './random'

function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function grad(hash: number, x: number, y: number) {
  // 8 gradients
  const h = hash & 7
  const u = h < 4 ? x : y
  const v = h < 4 ? y : x
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
}

function hash(ix: number, iy: number, seed: number) {
  let h = ix * 374761393 + iy * 668265263 + seed * 1442695041
  h = (h ^ (h >>> 13)) * 1274126177
  h ^= h >>> 16
  return h >>> 0
}

export function perlin2(x: number, y: number, seed: number) {
  const x0 = Math.floor(x)
  const x1 = x0 + 1
  const y0 = Math.floor(y)
  const y1 = y0 + 1

  const sx = fade(x - x0)
  const sy = fade(y - y0)

  const n00 = grad(hash(x0, y0, seed), x - x0, y - y0)
  const n10 = grad(hash(x1, y0, seed), x - x1, y - y0)
  const n01 = grad(hash(x0, y1, seed), x - x0, y - y1)
  const n11 = grad(hash(x1, y1, seed), x - x1, y - y1)

  const ix0 = lerp(n00, n10, sx)
  const ix1 = lerp(n01, n11, sx)
  return lerp(ix0, ix1, sy) // ~[-1,1]
}

export function fbm2(x: number, y: number, seed: number, octaves: number, lacunarity = 2, gain = 0.5) {
  let amp = 0.5
  let freq = 1
  let sum = 0
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += perlin2(x * freq, y * freq, seed + o * 1013) * amp
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  const v = sum / Math.max(1e-6, norm) // ~[-1,1]
  return clamp01(v * 0.5 + 0.5)
}

