import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PartnersService } from './partners.service';

export const API_KEY_SCOPES_KEY = 'apiKeyScopes';
export const RequireApiScopes = (...scopes: string[]) =>
  SetMetadata(API_KEY_SCOPES_KEY, scopes);

type PartnerRequest = {
  headers: Record<string, string | string[] | undefined>;
  apiKey?: unknown;
  partnerOrganization?: unknown;
  organizationId?: string;
};

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly partners: PartnersService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PartnerRequest>();
    const headerValue = req.headers['x-api-key'];
    const authorization = req.headers.authorization;
    const header =
      (typeof headerValue === 'string' ? headerValue : undefined) ||
      (typeof authorization === 'string' &&
      authorization.toLowerCase().startsWith('bearer blk_')
        ? authorization.slice(7).trim()
        : undefined);

    if (!header) {
      throw new UnauthorizedException(
        'Se requiere API key (X-Api-Key o Bearer blk_…)',
      );
    }

    const key = await this.partners.validateApiKey(header);
    if (!key) {
      throw new UnauthorizedException('API key inválida o expirada');
    }

    const required = this.reflector.getAllAndOverride<string[]>(API_KEY_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required?.length) {
      const scopes = key.scopes ?? [];
      const ok = required.every((scope) => scopes.includes(scope) || scopes.includes('*'));
      if (!ok) {
        throw new ForbiddenException(
          `La API key no tiene los permisos: ${required.join(', ')}`,
        );
      }
    }

    req.apiKey = key;
    req.partnerOrganization = key.organization;
    req.organizationId = key.organizationId;
    return true;
  }
}
