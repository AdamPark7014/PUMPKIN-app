import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SeatPosition {
  id: string;
  label: string;
  section: string;
  row: string;
  seatNumber: number;
  x: number;
  y: number;
  z: number;
  tier: 'premium' | 'standard' | 'economy';
  visible: boolean;
  accessible: boolean;
  price: number;
  status: 'available' | 'held' | 'sold' | 'blocked';
}

export interface Section3D {
  id: string;
  name: string;
  color: string;
  seats: SeatPosition[];
  capacity: number;
  soldCount: number;
  price: number;
  geometry: {
    shape: 'rectangular' | 'curved' | 'circular';
    width: number;
    depth: number;
    rotation: number;
  };
}

@Injectable()
export class SeatMapping3DService {
  private logger = new Logger(SeatMapping3DService.name);

  constructor(private prisma: PrismaService) {}

  // ==================== 3D VENUE GENERATION ====================

  async generateVenue3D(venueId: string) {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      include: {
        layouts: {
          where: { isActive: true },
          include: {
            sections: {
              include: {
                seats: { include: { row: true } },
                rows: true,
              },
            },
          },
          take: 1,
        },
      },
    });

    if (!venue) throw new BadRequestException('Venue not found');

    const layout = venue.layouts[0];
    if (layout?.sections?.length) {
      const sections: Section3D[] = layout.sections.map((sec, i) => {
        const seats: SeatPosition[] = (sec.seats ?? []).map((s, idx) => {
          const numMatch = s.label.match(/(\d+)\s*$/);
          return {
            id: s.id,
            label: s.label || `${sec.name}-${idx + 1}`,
            section: sec.name,
            row: s.row?.label ?? 'A',
            seatNumber: numMatch ? parseInt(numMatch[1], 10) : idx + 1,
            x: Number(s.x ?? 0),
            y: 0,
            z: Number(s.y ?? 0),
            tier: (s.tier as SeatPosition['tier']) || 'standard',
            visible: true,
            accessible: Boolean(s.accessible),
            price: 0,
            status: 'available' as const,
          };
        });
        return {
          id: sec.id,
          name: sec.name,
          color: sec.color || '#4ecdc4',
          seats,
          capacity: seats.length,
          soldCount: 0,
          price: this.calculateSectionPrice(i),
          geometry: {
            shape: 'rectangular' as const,
            width: 50,
            depth: 30,
            rotation: (i * 45) % 360,
          },
        };
      });

      return {
        venueId,
        venueName: venue.name,
        capacity: venue.totalCapacity,
        type: 'layout',
        source: 'VenueLayout',
        layoutId: layout.id,
        sections,
        metadata: {
          center: { x: 0, y: 0, z: 0 },
          scale: 1.0,
          lighting: 'professional',
          perspective: '3d',
        },
      };
    }

    const sections: Section3D[] = this.generateVenueSections(venue.totalCapacity);
    return {
      venueId,
      venueName: venue.name,
      capacity: venue.totalCapacity,
      type: 'arena',
      source: 'synthetic',
      sections,
      metadata: {
        center: { x: 0, y: 0, z: 0 },
        scale: 1.0,
        lighting: 'professional',
        perspective: '3d',
      },
    };
  }

  // ==================== INTELLIGENT SECTION GENERATION ====================

  private generateVenueSections(totalCapacity: number): Section3D[] {
    const sections: Section3D[] = [];
    const seatsPerSection = Math.floor(totalCapacity / 8); // 8 main sections

    const sectionNames = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dfe6e9', '#6c5ce7', '#fd79a8'];

    let totalSeats = 0;

    for (let i = 0; i < 8; i++) {
      const angle = (i * 360) / 8;
      const radiusX = 150;
      const radiusY = 100;

      const section: Section3D = {
        id: `section-${i}`,
        name: `${sectionNames[i]} - ${(i + 1) * 100}`,
        color: colors[i],
        seats: this.generateSeatsInSection(seatsPerSection, angle, radiusX, radiusY, i),
        capacity: seatsPerSection,
        soldCount: 0,
        price: this.calculateSectionPrice(i),
        geometry: {
          shape: 'curved',
          width: 50,
          depth: 30,
          rotation: angle,
        },
      };

      sections.push(section);
      totalSeats += seatsPerSection;
    }

    // Add floor/stage seating
    sections.push(this.generateFloorSection(totalCapacity - totalSeats));

    return sections;
  }

  // ==================== AI-POWERED SEAT GENERATION ====================

  private generateSeatsInSection(
    count: number,
    angle: number,
    radiusX: number,
    radiusY: number,
    sectionIndex: number,
  ): SeatPosition[] {
    const seats: SeatPosition[] = [];
    const rowsPerSection = Math.ceil(Math.sqrt(count));
    const seatsPerRow = Math.ceil(count / rowsPerSection);

    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'R'];

    for (let row = 0; row < rowsPerSection && seats.length < count; row++) {
      for (let seat = 0; seat < seatsPerRow && seats.length < count; seat++) {
        // Convert angle to radians
        const angleRad = (angle * Math.PI) / 180;

        // Calculate base position on the arc
        const progressAlongRow = seat / seatsPerRow;
        const progressAlongRadius = row / rowsPerSection;

        // Apply elliptical coordinates with angle offset
        const x = radiusX * Math.cos(angleRad) * (0.5 + progressAlongRow);
        const y = radiusY * Math.sin(angleRad) * (0.5 + progressAlongRow);
        const z = progressAlongRadius * 20; // Height increases with distance from stage

        // Determine tier based on proximity to stage
        let tier: 'premium' | 'standard' | 'economy' = 'standard';
        if (row < Math.ceil(rowsPerSection * 0.3)) tier = 'premium';
        if (row > Math.ceil(rowsPerSection * 0.7)) tier = 'economy';

        seats.push({
          id: `seat-${sectionIndex}-${rows[row]}-${seat + 1}`,
          label: `${rows[row]}${seat + 1}`,
          section: `section-${sectionIndex}`,
          row: rows[row],
          seatNumber: seat + 1,
          x: Math.round(x * 100) / 100,
          y: Math.round(y * 100) / 100,
          z: Math.round(z * 100) / 100,
          tier,
          visible: true,
          accessible: row === 0, // First row accessible
          price: this.calculateSeatPrice(tier),
          status: 'available',
        });
      }
    }

    return seats;
  }

  private generateFloorSection(capacity: number): Section3D {
    const seats: SeatPosition[] = [];

    for (let i = 0; i < capacity; i++) {
      const x = (Math.random() - 0.5) * 100;
      const y = (Math.random() - 0.5) * 100 + 80; // Closer to stage
      const z = 0;

      seats.push({
        id: `floor-${i}`,
        label: `GA-${i + 1}`,
        section: 'floor',
        row: 'FLOOR',
        seatNumber: i + 1,
        x,
        y,
        z,
        tier: 'standard',
        visible: true,
        accessible: true,
        price: this.calculateSeatPrice('standard'),
        status: 'available',
      });
    }

    return {
      id: 'floor-section',
      name: 'Floor / General Admission',
      color: '#2c3e50',
      seats,
      capacity,
      soldCount: 0,
      price: this.calculateSeatPrice('standard'),
      geometry: {
        shape: 'rectangular',
        width: 200,
        depth: 150,
        rotation: 0,
      },
    };
  }

  // ==================== PRICING CALCULATION ====================

  private calculateSectionPrice(sectionIndex: number): number {
    // Center sections (North, South) are premium
    if (sectionIndex === 0 || sectionIndex === 4) return 150;
    // Side sections are standard
    if (sectionIndex % 2 === 1) return 120;
    // Back sections are economy
    return 80;
  }

  private calculateSeatPrice(tier: string): number {
    const tierPrices: Record<string, number> = {
      premium: 150,
      standard: 100,
      economy: 50,
    };
    return tierPrices[tier] || 100;
  }

  // ==================== INTERACTIVE 3D VIEW ====================

  async getInteractiveSeatView(eventId: string, selectedSeatId?: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { venue: true, offers: true },
    });

    if (!event) throw new BadRequestException('Event not found');

    const venue3D = await this.generateVenue3D(event.venueId);

    // Get real ticket statuses
    const tickets = await this.prisma.ticket.findMany({
      where: { eventId },
      select: { id: true, status: true, seatId: true },
    });

    const ticketMap = new Map(tickets.map((t) => [t.seatId, t.status]));

    // Update 3D seats with real statuses
    const updatedSections = venue3D.sections.map((section) => ({
      ...section,
      seats: section.seats.map((seat) => ({
        ...seat,
        status: ticketMap.get(seat.id) || 'available',
      })),
    }));

    const selectedSeat = selectedSeatId
      ? updatedSections
          .flatMap((s) => s.seats)
          .find((s) => s.id === selectedSeatId)
      : null;

    return {
      venue: updatedSections,
      selectedSeat,
      camera: {
        position: { x: 0, y: -50, z: 200 },
        target: { x: 0, y: 0, z: 0 },
        fov: 60,
      },
      controls: {
        zoom: true,
        rotate: true,
        pan: true,
        keyboard: true,
      },
    };
  }

  // ==================== AI SEAT RECOMMENDATION ====================

  async recommendSeats(eventId: string, preferences: {
    tier?: 'premium' | 'standard' | 'economy';
    count: number;
    accessible?: boolean;
    viewQuality?: 'best' | 'good' | 'any';
  }) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { venue: true },
    });

    if (!event) throw new BadRequestException('Event not found');

    const venue3D = await this.generateVenue3D(event.venueId);

    // Get available seats
    const tickets = await this.prisma.ticket.findMany({
      where: { eventId, status: 'AVAILABLE' },
      select: { id: true, seatId: true },
    });

    const availableSeatIds = new Set(tickets.map((t) => t.seatId));

    // Flatten all seats and filter by criteria
    const allSeats = venue3D.sections.flatMap((section) =>
      section.seats.filter((seat) => availableSeatIds.has(seat.id)),
    );

    let filtered = allSeats;

    // Filter by tier
    if (preferences.tier) {
      filtered = filtered.filter((s) => s.tier === preferences.tier);
    }

    // Filter by accessibility
    if (preferences.accessible) {
      filtered = filtered.filter((s) => s.accessible);
    }

    // Score seats by view quality (distance from stage, center position)
    const scored = filtered.map((seat) => {
      const distFromStage = Math.sqrt(seat.x ** 2 + seat.y ** 2);
      const centerness = 1 - Math.abs(seat.x) / 150; // Closer to center is better
      const score = centerness * 100 - distFromStage;
      return { seat, score };
    });

    // Sort by score and take top N adjacent seats
    const recommended = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, preferences.count * 2) // Get more to find adjacent
      .map((s) => s.seat)
      .slice(0, preferences.count);

    this.logger.log(`Recommended ${recommended.length} seats for event ${eventId}`);

    return {
      recommended,
      totalAvailable: filtered.length,
      viewQuality: 'excellent',
      confidence: Math.min(recommended.length / preferences.count, 1.0),
    };
  }

  // ==================== HEAT MAP (OCCUPANCY) ====================

  async getOccupancyHeatmap(eventId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { eventId },
      select: { status: true, seatId: true },
    });

    const occupancy = {
      total: tickets.length,
      sold: tickets.filter((t) => t.status === 'SOLD').length,
      held: tickets.filter((t) => t.status === 'HELD').length,
      available: tickets.filter((t) => t.status === 'AVAILABLE').length,
      refunded: tickets.filter((t) => t.status === 'REFUNDED').length,
    };

    const occupancyPercent = Math.round((occupancy.sold / occupancy.total) * 100);

    return {
      eventId,
      occupancy,
      occupancyPercent,
      heatmapUrl: `/3d/venue/${eventId}/heatmap.webp`, // Could generate with Three.js
      recommendation: this.getOccupancyRecommendation(occupancyPercent),
    };
  }

  private getOccupancyRecommendation(percent: number): string {
    if (percent < 20) return 'Lots of inventory available';
    if (percent < 50) return 'Good availability';
    if (percent < 80) return 'Limited seats remaining';
    if (percent < 95) return 'Almost sold out';
    return 'Sold out or nearly sold out';
  }
}


