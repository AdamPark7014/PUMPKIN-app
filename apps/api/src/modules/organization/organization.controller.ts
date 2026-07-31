import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgAccessGuard } from '../auth/org-access.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AuditQueryDto,
  InviteTeamMemberDto,
  OrganizationScopeQueryDto,
  OrgIdParamDto,
  TeamMemberParamDto,
  TeamQueryDto,
  UpdateOrganizationDto,
  UpdateTeamMemberDto,
} from './dto/organization.dto';
import { OrganizationService } from './organization.service';

/**
 * Role sets match the previous public contract so PROMOTER clients keep working.
 * Horizontal isolation is enforced by OrgAccessGuard + TenantScopeService; privilege
 * escalation inside the tenant is blocked in OrganizationService.
 *
 * Granular `@Permissions(...)` is not applied on PROMOTER-shared routes because
 * the current role→permission map (auth module, out of scope) does not grant
 * `tenant:manage` / `role:write` / `audit:read` to PROMOTER.
 */
@ApiTags('Organization')
@ApiBearerAuth()
@Controller('organization')
@UseGuards(JwtAuthGuard, RolesGuard, OrgAccessGuard)
export class OrganizationController {
  constructor(private readonly orgService: OrganizationService) {}

  @Get('capabilities')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: "SaaS capability matrix for the caller's organization" })
  capabilities(@Query() query: OrganizationScopeQueryDto) {
    return this.orgService.getSaasCapabilities(query.organizationId);
  }

  @Get(':orgId')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Organization profile (no banking / fiscal secrets)' })
  get(@Param() params: OrgIdParamDto) {
    return this.orgService.getOrganization(params.orgId);
  }

  @Patch(':orgId')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiOperation({ summary: 'Update organization profile fields' })
  update(@Param() params: OrgIdParamDto, @Body() body: UpdateOrganizationDto) {
    return this.orgService.updateOrganization(params.orgId, body);
  }

  @Get(':orgId/team')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER')
  @ApiOperation({ summary: 'Paginated team roster for the organization' })
  team(@Param() params: OrgIdParamDto, @Query() query: TeamQueryDto) {
    return this.orgService.listTeam(params.orgId, query);
  }

  @Post(':orgId/team')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiOperation({ summary: 'Invite a team member into the organization' })
  invite(@Param() params: OrgIdParamDto, @Body() body: InviteTeamMemberDto) {
    return this.orgService.inviteTeamMember(params.orgId, body);
  }

  @Patch(':orgId/team/:userId')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiOperation({ summary: 'Update a team member role or active flag' })
  updateMember(
    @Param() params: TeamMemberParamDto,
    @Body() body: UpdateTeamMemberDto,
  ) {
    return this.orgService.updateTeamMember(params.orgId, params.userId, body);
  }

  @Get(':orgId/audit')
  @Roles('ADMIN', 'SUPER_ADMIN', 'PROMOTER')
  @ApiOperation({ summary: 'Cursor-paginated audit feed for the organization' })
  audit(@Param() params: OrgIdParamDto, @Query() query: AuditQueryDto) {
    return this.orgService.getAuditLog(params.orgId, query);
  }
}
