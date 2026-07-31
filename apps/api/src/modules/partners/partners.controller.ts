import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { Permissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateApiKeyDto, PaginationQueryDto } from './partners.dto';
import { PartnersService } from './partners.service';

@ApiTags('Partners / API Keys')
@ApiBearerAuth()
@Controller('partners')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get(':orgId/keys')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @Permissions('event:write')
  list(@Param('orgId') orgId: string, @Query() query: PaginationQueryDto) {
    return this.partners.listApiKeys(orgId, query.page, query.limit);
  }

  @Post(':orgId/keys')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @Permissions('event:write')
  create(
    @Param('orgId') orgId: string,
    @Body() body: CreateApiKeyDto,
    @Req() request: AuthRequest,
  ) {
    return this.partners.createApiKey(orgId, body, request.user?.sub);
  }

  @Patch(':orgId/keys/:keyId/revoke')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @Permissions('event:write')
  revoke(
    @Param('orgId') orgId: string,
    @Param('keyId') keyId: string,
    @Req() request: AuthRequest,
  ) {
    return this.partners.revokeApiKey(orgId, keyId, request.user?.sub);
  }
}
