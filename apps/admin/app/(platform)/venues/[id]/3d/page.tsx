'use client';

import dynamic from 'next/dynamic';

const Venue3DViewer = dynamic(
  () => import('@boletera/venue-3d').then((m) => m.Venue3DViewer),
  { ssr: false },
);

export default function Venue3DPage() {
  return (
    <div>
      <h1>Preview 3D del venue</h1>
      <Venue3DViewer mode="orbit" />
    </div>
  );
}
