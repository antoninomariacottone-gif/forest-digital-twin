import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js'

type Props = {
  maxPolarAngle?: number
  minDistance?: number
  maxDistance?: number
}

export function OrbitControlsR3F({ maxPolarAngle, minDistance, maxDistance }: Props) {
  const { camera, gl } = useThree()
  const controls = useRef<OrbitControlsImpl | null>(null)

  useEffect(() => {
    const c = new OrbitControlsImpl(camera, gl.domElement)
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.rotateSpeed = 0.55
    c.panSpeed = 0.55
    if (typeof maxPolarAngle === 'number') c.maxPolarAngle = maxPolarAngle
    if (typeof minDistance === 'number') c.minDistance = minDistance
    if (typeof maxDistance === 'number') c.maxDistance = maxDistance
    controls.current = c
    return () => c.dispose()
  }, [camera, gl, maxDistance, maxPolarAngle, minDistance])

  useFrame(() => {
    controls.current?.update()
  })

  return null
}
