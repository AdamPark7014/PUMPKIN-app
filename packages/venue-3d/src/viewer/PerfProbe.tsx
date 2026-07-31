'use client';

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Venue3DPerfStats } from '../types';

type PerfProbeProps = {
  /** Sampling window in ms. */
  sampleMs: number;
  onSample: (stats: Venue3DPerfStats) => void;
};

/**
 * Samples the real WebGL frame rate from inside the render loop — unlike a bare
 * `requestAnimationFrame` counter it only counts frames the GPU actually drew,
 * and it reports the renderer's live geometry/texture counts alongside.
 */
export function PerfProbe({ sampleMs, onSample }: PerfProbeProps) {
  const gl = useThree((state) => state.gl);
  const frames = useRef(0);
  const windowStart = useRef(0);

  useFrame(() => {
    const now = performance.now();
    if (!windowStart.current) {
      windowStart.current = now;
      return;
    }
    frames.current += 1;
    const elapsed = now - windowStart.current;
    if (elapsed < sampleMs) return;

    const count = frames.current;
    frames.current = 0;
    windowStart.current = now;
    if (!count) return;

    onSample({
      fps: Math.round((count * 1000) / elapsed),
      frameMs: elapsed / count,
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      programs: gl.info.programs?.length ?? 0,
    });
  });

  return null;
}
