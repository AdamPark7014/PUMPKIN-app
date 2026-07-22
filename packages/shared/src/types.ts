export interface SeatMapData {
  sections: SeatMapSection[];
  viewport?: { width: number; height: number };
}

export interface SeatMapSection {
  id: string;
  name: string;
  slug: string;
  color: string;
  seats: SeatMapSeat[];
}

export interface SeatMapSeat {
  id: string;
  label: string;
  row?: string;
  x: number;
  y: number;
  rotation?: number;
  tier?: string;
  coord3d?: { x: number; y: number; z: number };
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  organizationId?: string;
}

export interface TenantContext {
  organizationId: string;
  slug: string;
  subdomain?: string;
}
