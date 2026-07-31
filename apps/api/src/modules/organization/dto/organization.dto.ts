import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { TEAM_ROLES, type TeamRole } from '../team-roles';

const IDENTIFIER = /^[A-Za-z0-9_-]{6,64}$/;
const PHONE = /^\+?[0-9][0-9 ()-]{5,19}$/;
const AUDIT_ACTION = /^[A-Z0-9_]{2,64}$/;

function trim({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function trimLower({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/** Empty strings from form submits clear the column instead of storing `""`. */
function emptyToNull({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isPresent(object: object, value: unknown): boolean {
  return value !== null && value !== undefined;
}

export class OrganizationScopeQueryDto {
  @ApiPropertyOptional({ description: 'Target organization. Cross-tenant operators only.' })
  @IsOptional()
  @IsString()
  @Matches(IDENTIFIER)
  organizationId?: string;
}

export class OrgIdParamDto {
  @ApiProperty()
  @IsString()
  @Matches(IDENTIFIER)
  orgId!: string;
}

export class TeamMemberParamDto extends OrgIdParamDto {
  @ApiProperty()
  @IsString()
  @Matches(IDENTIFIER)
  userId!: string;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(isPresent)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(isPresent)
  @IsString()
  @MaxLength(300)
  website?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(isPresent)
  @IsString()
  @Matches(PHONE)
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowResale?: boolean;

  @ApiPropertyOptional({ description: 'Platform commission rate (0-1). Cross-tenant operators only.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  commissionRate?: number;

  @ApiPropertyOptional({ description: 'Fees included in the ticket price. Cross-tenant operators only.' })
  @IsOptional()
  @IsBoolean()
  feesInclusive?: boolean;
}

export class InviteTeamMemberDto {
  @ApiProperty()
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @ApiProperty({ enum: TEAM_ROLES })
  @IsIn([...TEAM_ROLES])
  role!: TeamRole;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class UpdateTeamMemberDto {
  @ApiPropertyOptional({ enum: TEAM_ROLES })
  @IsOptional()
  @IsIn([...TEAM_ROLES])
  role?: TeamRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class TeamQueryDto {
  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Id of the last row of the previous page.' })
  @IsOptional()
  @IsString()
  @Matches(IDENTIFIER)
  cursor?: string;
}

export class AuditQueryDto extends TeamQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(AUDIT_ACTION)
  action?: string;
}
