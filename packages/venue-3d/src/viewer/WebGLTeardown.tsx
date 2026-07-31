'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { disposeSceneResources, disposeWebGLRenderer } from './dispose';

/** Runs on Canvas unmount: dispose geometries/materials/textures and tear down WebGL. */
export function WebGLTeardown() {
  const { gl, scene } = useThree();

  useEffect(() => {
    return () => {
      disposeSceneResources(scene);
      disposeWebGLRenderer(gl);
    };
  }, [gl, scene]);

  return null;
}
