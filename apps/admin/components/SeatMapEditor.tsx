'use client';

import type { SeatMapData, SeatMapSection } from '@boletera/shared';
import { VenueBuilder } from './venue-builder/VenueBuilder';

export type SeatMapEditorProps = {
  initial: SeatMapData;
  onSave: (map: SeatMapData) => Promise<void>;
  onApplyTemplate?: (template: 'arena' | 'theater' | 'stadium' | 'festival') => Promise<SeatMapData>;
  onAiSuggest?: (description: string) => Promise<SeatMapData | SeatMapSection[]>;
  venueId?: string;
  getAuthToken?: () => string | null;
};

/**
 * Thin facade kept for existing consumers (`maps/page`, `venues/[id]/map/page`).
 * All editor behaviour lives in `venue-builder/`.
 */
export function SeatMapEditor(props: SeatMapEditorProps) {
  return <VenueBuilder {...props} />;
}
