import type { HoldStatus, SalesChannel, SeatHold, TicketStatus } from '@prisma/client';

export type CreateHoldInput = {
  eventId: string;
  seatIds?: string[];
  offerId?: string;
  quantity?: number;
  userId?: string;
  sessionId?: string;
  channel?: SalesChannel;
  cashierId?: string;
  saleCode?: string | null;
};

export type CreateBestAvailableHoldInput = {
  eventId: string;
  offerId: string;
  quantity: number;
  sessionId?: string;
  userId?: string;
  channel?: SalesChannel;
  cashierId?: string;
  contiguous?: boolean;
  saleCode?: string | null;
};

export type AvailabilityTicket = {
  id: string;
  seatId: string | null;
  status: TicketStatus;
  section: string | null;
  row: string | null;
  seatNumber: string | null;
};

export type AvailabilityResult = {
  tickets: AvailabilityTicket[];
  activeHolds: number;
  statusCounts: Record<string, number>;
};

export type HoldResult = {
  holds: SeatHold[];
  expiresAt: Date;
};

export type BestAvailableHoldResult = HoldResult & {
  seats: Array<{
    seatId: string | null;
    section: string | null;
    row: string | null;
    seatNumber: string | null;
    label: string;
  }>;
  mode: 'RESERVED' | 'GA';
};

export type SeatHoldRow = {
  id: string;
  eventId: string;
  seatId: string | null;
  offerId: string | null;
  quantity?: number;
  sessionId: string | null;
  status: HoldStatus;
  expiresAt: Date;
};
