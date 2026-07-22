import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const PartnerOrgId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return req.organizationId as string;
});
