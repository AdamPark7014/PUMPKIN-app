import { BadRequestException } from '@nestjs/common';
import type {
  ApplyDiscountDto,
  CreateCampaignDto,
  ValidatedCreateCampaign,
} from './campaign.dto';

export function assertCreateCampaign(data: CreateCampaignDto): ValidatedCreateCampaign {
  const starts = new Date(data.startsAt);
  const ends = new Date(data.endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
    throw new BadRequestException('Las fechas de inicio y fin no son válidas');
  }
  if (ends <= starts) {
    throw new BadRequestException('La fecha de fin debe ser posterior a la fecha de inicio');
  }
  if (data.discountType === 'percentage' && data.discountValue > 100) {
    throw new BadRequestException('El descuento porcentual no puede exceder 100');
  }
  return {
    ...data,
    name: data.name.trim(),
    type: data.type.trim(),
    startsAt: starts,
    endsAt: ends,
  };
}

export function assertApplyDiscount(data: ApplyDiscountDto): ApplyDiscountDto {
  if (typeof data.basePrice !== 'number' || data.basePrice < 0) {
    throw new BadRequestException('El precio base debe ser un número no negativo');
  }
  if (!Number.isInteger(data.quantity) || data.quantity < 1) {
    throw new BadRequestException('La cantidad debe ser un entero mayor o igual a 1');
  }
  return data;
}
