import { BadRequestException } from '@nestjs/common';
import type { ApplyDiscountDto, CreateCampaignDto } from './campaign.dto';

export function assertCreateCampaign(data: CreateCampaignDto): CreateCampaignDto {
  if (!data.name?.trim()) throw new BadRequestException('Campaign name is required');
  if (!data.type?.trim()) throw new BadRequestException('Campaign type is required');
  if (data.allocation < 0 || data.allocation > 100) {
    throw new BadRequestException('allocation must be 0–100');
  }
  if (data.quantityPerUser < 1) {
    throw new BadRequestException('quantityPerUser must be >= 1');
  }
  if (data.discountType !== 'percentage' && data.discountType !== 'fixed') {
    throw new BadRequestException('discountType must be percentage or fixed');
  }
  if (data.discountValue < 0) {
    throw new BadRequestException('discountValue must be >= 0');
  }
  const starts = new Date(data.startsAt);
  const ends = new Date(data.endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
    throw new BadRequestException('startsAt/endsAt must be valid dates');
  }
  if (ends <= starts) throw new BadRequestException('endsAt must be after startsAt');
  return {
    ...data,
    startsAt: starts,
    endsAt: ends,
  };
}

export function assertApplyDiscount(data: ApplyDiscountDto): ApplyDiscountDto {
  if (typeof data.basePrice !== 'number' || data.basePrice < 0) {
    throw new BadRequestException('basePrice must be a non-negative number');
  }
  if (!Number.isInteger(data.quantity) || data.quantity < 1) {
    throw new BadRequestException('quantity must be an integer >= 1');
  }
  return data;
}
