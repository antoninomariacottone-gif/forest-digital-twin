declare module 'three/examples/jsm/controls/OrbitControls.js' {
  import type { Camera } from 'three'

  export class OrbitControls {
    constructor(object: Camera, domElement?: HTMLElement)
    enableDamping: boolean
    dampingFactor: number
    rotateSpeed: number
    panSpeed: number
    minDistance: number
    maxDistance: number
    maxPolarAngle: number
    update(): void
    dispose(): void
  }
}

