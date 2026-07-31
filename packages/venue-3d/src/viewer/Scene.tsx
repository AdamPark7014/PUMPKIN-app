'use client';

import { SeatViewCamera } from '../SeatViewCamera';
import { CameraRig } from './CameraRig';
import { EgressPathOverlays } from './EgressPathOverlays';
import { GeometryOverlays } from './GeometryOverlays';
import { PerfProbe } from './PerfProbe';
import { SeatingBowl } from './SeatingBowl';
import { SectionPlates } from './SectionPlates';
import { StageBlock } from './StageBlock';
import { VenueShell } from './VenueShell';
import { WebGLTeardown } from './WebGLTeardown';
import type { SceneProps } from './sceneTypes';

/**
 * Everything that lives inside the `<Canvas>`: lights, venue geometry, seating
 * and the camera rig. Kept free of DOM so the HUD can re-render independently.
 */
export function Scene({
  seats,
  plates,
  stageZ,
  stagePose,
  aisles,
  obstacles,
  stairs,
  exits,
  furniture,
  focusPoints,
  egressOverlay,
  highlightEgressSection,
  selectedIds,
  heatBySeat,
  onToggleSeat,
  onHoverSeat,
  seatView,
  selectedSeat,
  cameraPreset,
  bounds,
  controllerRef,
  presetOptionsRef,
  autoOrbit,
  reducedMotion,
  cameraTransitionMs,
  cameraSampleMs,
  enablePan,
  onCameraChange,
  onUserInteract,
  layers,
  opacity,
  quality,
  fpsSampleMs,
  onPerfSample,
}: SceneProps) {
  const shadows = quality.shadows;

  return (
    <>
      <color attach="background" args={['#070708']} />
      <fog attach="fog" args={['#070708', 16, 38]} />
      <ambientLight intensity={0.28} />
      <directionalLight
        position={[7, 16, 5]}
        intensity={1.5}
        castShadow={shadows}
        shadow-mapSize={[quality.shadowMapSize, quality.shadowMapSize]}
      />
      <directionalLight position={[-6, 8, -4]} intensity={0.35} color="#93c5fd" />
      <hemisphereLight intensity={0.4} color="#fafafa" groundColor="#0a0a0a" />

      {layers.shell && <VenueShell />}
      {layers.stage && <StageBlock z={stageZ} pose={stagePose} shadows={shadows} />}
      <GeometryOverlays
        aisles={layers.aisles ? aisles : []}
        obstacles={layers.obstacles ? obstacles : []}
        stairs={layers.stairs ? stairs : []}
        exits={layers.exits ? exits : []}
        furniture={layers.furniture ? furniture : []}
        focusPoints={layers.focusPoints ? focusPoints : []}
        structureOpacity={opacity.structure}
        furnitureOpacity={opacity.furniture}
        castShadow={shadows}
      />
      {layers.egress && (
        <EgressPathOverlays
          overlay={egressOverlay}
          highlightSection={highlightEgressSection}
        />
      )}
      {layers.plates && <SectionPlates plates={plates} opacity={opacity.plates} />}
      {layers.seats && opacity.seats > 0 && (
        <SeatingBowl
          seats={seats}
          selectedIds={selectedIds}
          heatBySeat={heatBySeat}
          opacity={opacity.seats}
          showDecorative={layers.decorativeSeats}
          maxDecorativeSeats={quality.maxDecorativeSeats}
          instancingThreshold={quality.instancingThreshold}
          lodDistance={quality.lodDistance}
          castShadow={shadows}
          onToggleSeat={onToggleSeat}
          onHoverSeat={onHoverSeat}
        />
      )}

      {seatView && selectedSeat ? (
        <SeatViewCamera target={selectedSeat} />
      ) : (
        <CameraRig
          preset={cameraPreset === 'seat' ? 'orbit' : cameraPreset}
          bounds={bounds}
          stagePose={stagePose}
          stageZ={stageZ}
          autoRotate={autoOrbit}
          reducedMotion={reducedMotion}
          transitionMs={cameraTransitionMs}
          enablePan={enablePan}
          controllerRef={controllerRef}
          presetOptionsRef={presetOptionsRef}
          onCameraChange={onCameraChange}
          cameraSampleMs={cameraSampleMs}
          onUserInteract={onUserInteract}
        />
      )}

      {onPerfSample && <PerfProbe sampleMs={fpsSampleMs} onSample={onPerfSample} />}
      <WebGLTeardown />
    </>
  );
}
