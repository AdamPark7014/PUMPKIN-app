import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { SeatMapData } from '@boletera/shared';

const EGRESS_FORMATS = ['json', 'csv', 'pdf'] as const;
const LAYOUT_TEMPLATES = ['arena', 'theater', 'stadium', 'festival'] as const;

export class EgressOverviewQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class EgressAnalyzeDto {
  @IsOptional()
  @IsObject()
  mapData?: SeatMapData;

  @IsOptional()
  @IsIn(EGRESS_FORMATS)
  format?: (typeof EGRESS_FORMATS)[number];
}

export class SaveLayoutDto {
  @IsOptional()
  @IsObject()
  mapData?: SeatMapData;

  @IsOptional()
  @IsArray()
  sections?: SeatMapData['sections'];

  @IsOptional()
  @IsObject()
  viewport?: SeatMapData['viewport'];

  @IsOptional()
  @IsObject()
  venue?: SeatMapData['venue'];

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  /** Optimistic concurrency token matching VenueLayout.version */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class FromTemplateDto {
  @IsIn(LAYOUT_TEMPLATES)
  template!: (typeof LAYOUT_TEMPLATES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  capacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  sectionCount?: number;
}

export class AiImportDto {
  @IsArray()
  @ArrayMinSize(1)
  sections!: SeatMapData['sections'];
}

export class SuggestLayoutDto {
  @IsString()
  @MaxLength(2000)
  prompt!: string;
}

/** Normalize PUT body that may be either SeatMapData or `{ mapData, expectedVersion }`. */
export function coerceSeatMapData(body: SaveLayoutDto): {
  mapData: SeatMapData;
  expectedVersion?: number;
} {
  const nested = body.mapData;
  const sections = nested?.sections ?? body.sections;
  if (!Array.isArray(sections)) {
    throw new BadRequestException('mapData.sections is required');
  }
  const versionRaw = nested?.version ?? body.version ?? 3;
  const version: 1 | 2 | 3 =
    versionRaw === 1 || versionRaw === 2 || versionRaw === 3 ? versionRaw : 3;
  return {
    mapData: {
      version,
      sections,
      viewport: nested?.viewport ?? body.viewport,
      venue: nested?.venue ?? body.venue,
    },
    expectedVersion: body.expectedVersion,
  };
}
