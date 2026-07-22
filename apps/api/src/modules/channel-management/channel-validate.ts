/**
 * Lightweight write validation for channel/campaign metadata JSON.
 * Prefer these over casting `any` at controller boundaries.
 */
import { BadRequestException } from '@nestjs/common';
import type { ChannelConfigDto } from './channel.dto';

export function assertChannelConfig(config: ChannelConfigDto): ChannelConfigDto {
  const total =
    (config.web?.allocation ?? 0) +
    (config.taquilla?.allocation ?? 0) +
    (config.api?.allocation ?? 0) +
    (config.phone?.allocation ?? 0);
  if (total !== 100) {
    throw new BadRequestException(`Channel allocation must equal 100%, got ${total}%`);
  }
  return config;
}
