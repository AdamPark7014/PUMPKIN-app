# @boletera/venue-3d — migration notes

## Public API

Unchanged. Continue importing from `@boletera/venue-3d`:

- `Venue3DViewer`, `Seat3D`, `Venue3DViewerProps`, `Venue3DHeatMode`
- `SeatViewCamera`
- `layoutSeatsInBowl`, `layoutSeatsFromPublished`, `layoutSeatsAuto`, `sectionColor`
- `BowlSeat`, `LaidOutSeat`, `SectionPlate`, `LayoutSceneExtras`

## Internal structure (no consumer changes)

- `Venue3DViewer.tsx` is a thin orchestrator
- Scene pieces live under `src/viewer/`
- Bowl layout internals under `src/bowlLayout/` (barrel `bowlLayout.ts` preserved)
- GPU cleanup via `WebGLTeardown` + `dispose.ts`
- Large venues use `InstancedSeating` above a seat-count threshold
