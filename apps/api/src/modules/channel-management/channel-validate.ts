import { BadRequestException } from '@nestjs/common';
import type { ChannelConfigDto } from './channel.dto';

export function assertChannelConfig(config: ChannelConfigDto): ChannelConfigDto {
  const total =
    (config.web?.allocation ?? 0) +
    (config.taquilla?.allocation ?? 0) +
    (config.api?.allocation ?? 0) +
    (config.phone?.allocation ?? 0);
  if (total !== 100) {
    throw new BadRequestException(
      `La asignación de canales debe sumar 100%; se recibió ${total}%`,
    );
  }
  return config;
}
