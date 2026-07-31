'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

const MIN_CAM_Y = 3.4;

type OrbitControlsHandle = {
  object: { position: { y: number } };
  update: () => void;
};

type ConstrainedOrbitProps = {
  stageZ: number;
  autoOrbit: boolean;
  onUserInteract: () => void;
};

export function ConstrainedOrbit({ stageZ, autoOrbit, onUserInteract }: ConstrainedOrbitProps) {
  const ref = useRef<OrbitControlsHandle | null>(null);

  useFrame(() => {
    const ctrl = ref.current;
    if (!ctrl) return;
    const cam = ctrl.object;
    if (cam.position.y < MIN_CAM_Y) {
      cam.position.y = MIN_CAM_Y;
      ctrl.update();
    }
  });

  return (
    <OrbitControls
      ref={ref as never}
      enablePan={false}
      minPolarAngle={0.55}
      maxPolarAngle={Math.PI / 2.35}
      minDistance={8}
      maxDistance={22}
      target={[0, 1.6, stageZ * 0.28]}
      enableDamping
      dampingFactor={0.07}
      autoRotate={autoOrbit}
      autoRotateSpeed={0.55}
      onStart={onUserInteract}
    />
  );
}
