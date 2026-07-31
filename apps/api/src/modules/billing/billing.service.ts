import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Currency, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ListCfdiQueryDto, StampCfdiDto, UpsertFiscalProfileDto } from './billing.dto';
import {
  MXN_CURRENCY,
  formatMxnXml,
  roundMxn,
  toCentavos,
  toDecimalMxn,
} from './billing.money';

const FISCAL_PROFILE_SELECT = {
  id: true,
  organizationId: true,
  rfc: true,
  legalName: true,
  regimenFiscal: true,
  codigoPostal: true,
  serie: true,
  nextFolio: true,
  pacMode: true,
  pacProvider: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

const CFDI_LIST_SELECT = {
  id: true,
  uuid: true,
  serie: true,
  folio: true,
  status: true,
  receptorRfc: true,
  total: true,
  stampedAt: true,
  orderId: true,
  tipo: true,
  currency: true,
  createdAt: true,
} as const;

/**
 * CFDI 4.0 sandbox timbrado — produces deterministic fake UUID/XML for local/dev.
 * Swap pacProvider integration when a real PAC is configured.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Resolve the tenant org for a route `:orgId`. Non-privileged callers use
   * `requireOrganization()`; SUPER_ADMIN may operate on the route org.
   */
  resolveOrganizationId(routeOrgId: string): string {
    const ctx = this.tenant.current();
    if (ctx.privileged) {
      if (!routeOrgId) {
        throw new BadRequestException('organizationId is required');
      }
      return routeOrgId;
    }
    const organizationId = this.tenant.requireOrganization();
    this.tenant.assertOrganization(routeOrgId);
    return organizationId;
  }

  async upsertFiscalProfile(routeOrgId: string, data: UpsertFiscalProfileDto) {
    const organizationId = this.resolveOrganizationId(routeOrgId);

    const rfc = data.rfc.toUpperCase();
    const profile = await this.prisma.fiscalProfile.upsert({
      where: { organizationId },
      create: {
        organizationId,
        rfc,
        legalName: data.legalName.trim(),
        regimenFiscal: data.regimenFiscal ?? '601',
        codigoPostal: data.codigoPostal,
        serie: data.serie ?? 'A',
        pacMode: data.pacMode ?? 'sandbox',
        pacProvider: data.pacProvider,
        pacApiKey: data.pacApiKey,
      },
      update: {
        rfc,
        legalName: data.legalName.trim(),
        ...(data.regimenFiscal !== undefined
          ? { regimenFiscal: data.regimenFiscal }
          : {}),
        codigoPostal: data.codigoPostal,
        ...(data.serie !== undefined ? { serie: data.serie } : {}),
        ...(data.pacMode !== undefined ? { pacMode: data.pacMode } : {}),
        ...(data.pacProvider !== undefined
          ? { pacProvider: data.pacProvider }
          : {}),
        ...(data.pacApiKey !== undefined ? { pacApiKey: data.pacApiKey } : {}),
      },
      select: FISCAL_PROFILE_SELECT,
    });

    await this.audit.log({
      action: 'BILLING_FISCAL_PROFILE_UPSERT',
      entityType: 'FiscalProfile',
      entityId: profile.id,
      organizationId,
      userId: this.tenant.current().userId,
      metadata: {
        rfc: profile.rfc,
        pacMode: profile.pacMode,
        serie: profile.serie,
      },
    });

    return profile;
  }

  async getFiscalProfile(routeOrgId: string) {
    const organizationId = this.resolveOrganizationId(routeOrgId);
    return this.prisma.fiscalProfile.findUnique({
      where: { organizationId },
      select: FISCAL_PROFILE_SELECT,
    });
  }

  async stampOrderInvoice(routeOrgId: string, data: StampCfdiDto) {
    const organizationId = this.resolveOrganizationId(routeOrgId);

    const profile = await this.prisma.fiscalProfile.findUnique({
      where: { organizationId },
      select: {
        id: true,
        organizationId: true,
        rfc: true,
        legalName: true,
        serie: true,
        nextFolio: true,
        pacMode: true,
        pacProvider: true,
        active: true,
      },
    });
    if (!profile?.active) {
      throw new BadRequestException('Configure fiscal profile before stamping CFDI');
    }

    const order = await this.prisma.order.findFirst({
      where: {
        id: data.orderId,
        organizationId,
        status: 'COMPLETED',
      },
      select: {
        id: true,
        organizationId: true,
        subtotal: true,
        taxAmount: true,
        totalAmount: true,
        currency: true,
      },
    });
    if (!order) throw new NotFoundException('Completed order not found');

    if (order.currency !== Currency.MXN) {
      throw new BadRequestException(
        `CFDI stamping currently supports ${MXN_CURRENCY} only`,
      );
    }

    const existing = await this.findStampedInvoice(organizationId, order.id);
    if (existing) {
      return existing;
    }

    this.assertMoneyConsistency(order);

    const subtotal = toDecimalMxn(order.subtotal);
    const iva = toDecimalMxn(order.taxAmount);
    const total = toDecimalMxn(order.totalAmount);
    const isSandbox = profile.pacMode !== 'production';
    const receptorRfc = data.receptorRfc.toUpperCase();
    const receptorUsoCfdi = data.receptorUsoCfdi ?? 'G03';

    try {
      const invoice = await this.prisma.$transaction(
        async (tx) => {
          const again = await tx.cfdiInvoice.findFirst({
            where: {
              organizationId,
              orderId: order.id,
              status: 'STAMPED',
              tipo: 'I',
            },
            select: {
              id: true,
              uuid: true,
              serie: true,
              folio: true,
              status: true,
              receptorRfc: true,
              total: true,
              stampedAt: true,
              orderId: true,
              tipo: true,
              currency: true,
              subtotal: true,
              iva: true,
              receptorNombre: true,
              receptorUsoCfdi: true,
              pacRaw: true,
              createdAt: true,
              updatedAt: true,
              organizationId: true,
              xmlUrl: true,
              pdfUrl: true,
              errorMessage: true,
            },
          });
          if (again) return { kind: 'existing' as const, invoice: again };

          const locked = await tx.fiscalProfile.findUnique({
            where: { id: profile.id },
            select: {
              id: true,
              nextFolio: true,
              serie: true,
              rfc: true,
              legalName: true,
              pacMode: true,
              pacProvider: true,
              organizationId: true,
            },
          });
          if (!locked || locked.organizationId !== organizationId) {
            throw new NotFoundException('Fiscal profile not found');
          }

          const folio = locked.nextFolio;
          const advanced = await tx.fiscalProfile.updateMany({
            where: {
              id: locked.id,
              organizationId,
              nextFolio: folio,
            },
            data: { nextFolio: folio + 1 },
          });
          if (advanced.count !== 1) {
            throw new ConflictException(
              'Concurrent folio allocation; retry stamp request',
            );
          }

          const uuid = randomUUID();
          const xml = this.buildSandboxXml({
            uuid,
            rfcEmisor: locked.rfc,
            nombreEmisor: locked.legalName,
            rfcReceptor: receptorRfc,
            nombreReceptor: data.receptorNombre,
            usoCfdi: receptorUsoCfdi,
            serie: locked.serie,
            folio,
            subtotal: roundMxn(subtotal),
            iva: roundMxn(iva),
            total: roundMxn(total),
          });

          const created = await tx.cfdiInvoice.create({
            data: {
              organizationId,
              orderId: order.id,
              uuid,
              serie: locked.serie,
              folio,
              tipo: 'I',
              status: 'STAMPED',
              receptorRfc,
              receptorNombre: data.receptorNombre,
              receptorUsoCfdi,
              subtotal,
              iva,
              total,
              currency: Currency.MXN,
              stampedAt: new Date(),
              pacRaw: {
                mode: locked.pacMode,
                provider: locked.pacProvider ?? 'boletera-sandbox',
                xmlSha256: createHash('sha256').update(xml).digest('hex'),
                xmlPreview: xml.slice(0, 500),
              },
            },
          });

          return { kind: 'created' as const, invoice: created, xml };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (invoice.kind === 'existing') {
        return invoice.invoice;
      }

      await this.audit.log({
        action: 'CFDI_STAMPED',
        entityType: 'CfdiInvoice',
        entityId: invoice.invoice.id,
        organizationId,
        userId: this.tenant.current().userId,
        metadata: {
          orderId: order.id,
          uuid: invoice.invoice.uuid,
          sandbox: isSandbox,
          folio: invoice.invoice.folio,
          serie: invoice.invoice.serie,
          totalCentavos: toCentavos(total),
        },
      });

      return {
        ...invoice.invoice,
        sandbox: isSandbox,
        xml: invoice.xml,
      };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raced = await this.findStampedInvoice(organizationId, order.id);
        if (raced) {
          return raced;
        }
        throw new ConflictException(
          'CFDI folio or UUID collision; retry stamp request',
        );
      }
      throw err;
    }
  }

  async listInvoices(routeOrgId: string, query: ListCfdiQueryDto = {}) {
    const organizationId = this.resolveOrganizationId(routeOrgId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const skip = (page - 1) * pageSize;

    return this.prisma.cfdiInvoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      select: CFDI_LIST_SELECT,
    });
  }

  private async findStampedInvoice(organizationId: string, orderId: string) {
    return this.prisma.cfdiInvoice.findFirst({
      where: {
        organizationId,
        orderId,
        status: 'STAMPED',
        tipo: 'I',
      },
    });
  }

  private assertMoneyConsistency(order: {
    subtotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
  }): void {
    const sub = toCentavos(order.subtotal);
    const tax = toCentavos(order.taxAmount);
    const total = toCentavos(order.totalAmount);
    if (sub < 0 || tax < 0 || total < 0) {
      throw new BadRequestException('Order amounts must be non-negative MXN');
    }
    // total may include fees/discounts beyond subtotal+tax; require total >= tax
    // and that stored decimals round cleanly to centavos (already enforced by toCentavos).
    if (total < tax) {
      throw new BadRequestException('Order total is inconsistent with tax');
    }
  }

  private buildSandboxXml(p: {
    uuid: string;
    rfcEmisor: string;
    nombreEmisor: string;
    rfcReceptor: string;
    nombreReceptor: string;
    usoCfdi: string;
    serie: string;
    folio: number;
    subtotal: number;
    iva: number;
    total: number;
  }): string {
    const esc = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante Version="4.0" Serie="${esc(p.serie)}" Folio="${p.folio}" SubTotal="${formatMxnXml(p.subtotal)}" Total="${formatMxnXml(p.total)}" Moneda="MXN"
  xmlns:cfdi="http://www.sat.gob.mx/cfd/4">
  <cfdi:Emisor Rfc="${esc(p.rfcEmisor)}" Nombre="${esc(p.nombreEmisor)}"/>
  <cfdi:Receptor Rfc="${esc(p.rfcReceptor)}" Nombre="${esc(p.nombreReceptor)}" UsoCFDI="${esc(p.usoCfdi)}"/>
  <cfdi:Impuestos TotalImpuestosTrasladados="${formatMxnXml(p.iva)}"/>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital UUID="${esc(p.uuid)}" FechaTimbrado="${new Date().toISOString()}" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;
  }
}
