'use client';

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';

export function SeatViewCamera({ target }: { target: { x: number; y: number; z: number } }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(target.x, target.y + 1.2, target.z + 2);
    camera.lookAt(target.x, target.y + 0.5, target.z - 4);
  }, [camera, target]);
  return null;
}
