import { Controller, Get, Headers } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TenantService } from './tenant.service';
import type { TenantCurrentResponse } from './tenant.types';

@ApiTags('Tenant')
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenant: TenantService) {}

  @Get('current')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Resolve the storefront tenant (public branding only) from the Host header',
  })
  async current(@Headers('host') host?: string): Promise<TenantCurrentResponse> {
    const organization = await this.tenant.resolveByHost(host ?? 'localhost');
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      theme: organization.tenantTheme,
    };
  }
}
