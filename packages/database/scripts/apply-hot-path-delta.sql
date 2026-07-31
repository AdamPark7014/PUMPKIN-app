-- Hot-path indexes, money precision, enums, and seat uniqueness.
-- Safe for existing demo/dev data (enum USING + duplicate cleanup).
-- Use on DBs that predate 20260730220000_init. Fresh installs: prisma migrate deploy.

DO $$ BEGIN CREATE TYPE "PosTerminalStatus" AS ENUM ('READY', 'OFFLINE', 'DISABLED', 'MAINTENANCE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PosSessionStatus" AS ENUM ('ACTIVE', 'CLOSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SeasonPassPurchaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED', 'REFUNDED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Event" ALTER COLUMN "minPrice" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "maxPrice" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "currency" SET DEFAULT 'MXN';

ALTER TABLE "Offer" ALTER COLUMN "basePrice" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "fees" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "currency" SET DEFAULT 'MXN';

ALTER TABLE "Order" ALTER COLUMN "currency" SET DEFAULT 'MXN';

ALTER TABLE "Organization" ALTER COLUMN "timezone" SET DEFAULT 'America/Mexico_City',
ALTER COLUMN "currency" SET DEFAULT 'MXN';

ALTER TABLE "ResaleListing" ALTER COLUMN "currency" SET DEFAULT 'MXN';

ALTER TABLE "Ticket" ALTER COLUMN "originalPrice" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "resalePrice" SET DATA TYPE DECIMAL(12,2);

-- PosTerminal.status String → enum (skip if already enum)
DO $$ BEGIN
  ALTER TABLE "PosTerminal" ALTER COLUMN "status" DROP DEFAULT;
  ALTER TABLE "PosTerminal"
    ALTER COLUMN "status" TYPE "PosTerminalStatus"
    USING (
      CASE upper(status::text)
        WHEN 'READY' THEN 'READY'::"PosTerminalStatus"
        WHEN 'OFFLINE' THEN 'OFFLINE'::"PosTerminalStatus"
        WHEN 'DISABLED' THEN 'DISABLED'::"PosTerminalStatus"
        WHEN 'MAINTENANCE' THEN 'MAINTENANCE'::"PosTerminalStatus"
        ELSE 'READY'::"PosTerminalStatus"
      END
    );
  ALTER TABLE "PosTerminal" ALTER COLUMN "status" SET DEFAULT 'READY'::"PosTerminalStatus";
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PosCashierSession" ALTER COLUMN "status" DROP DEFAULT;
  ALTER TABLE "PosCashierSession"
    ALTER COLUMN "status" TYPE "PosSessionStatus"
    USING (
      CASE upper(status::text)
        WHEN 'ACTIVE' THEN 'ACTIVE'::"PosSessionStatus"
        WHEN 'CLOSED' THEN 'CLOSED'::"PosSessionStatus"
        ELSE 'CLOSED'::"PosSessionStatus"
      END
    );
  ALTER TABLE "PosCashierSession" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"PosSessionStatus";
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SeasonPassPurchase" ALTER COLUMN "status" DROP DEFAULT;
  ALTER TABLE "SeasonPassPurchase"
    ALTER COLUMN "status" TYPE "SeasonPassPurchaseStatus"
    USING (
      CASE upper(status::text)
        WHEN 'PENDING' THEN 'PENDING'::"SeasonPassPurchaseStatus"
        WHEN 'COMPLETED' THEN 'COMPLETED'::"SeasonPassPurchaseStatus"
        WHEN 'CANCELLED' THEN 'CANCELLED'::"SeasonPassPurchaseStatus"
        WHEN 'REFUNDED' THEN 'REFUNDED'::"SeasonPassPurchaseStatus"
        ELSE 'PENDING'::"SeasonPassPurchaseStatus"
      END
    );
  ALTER TABLE "SeasonPassPurchase" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"SeasonPassPurchaseStatus";
EXCEPTION WHEN others THEN NULL;
END $$;

DELETE FROM "AccessZone" az WHERE NOT EXISTS (SELECT 1 FROM "Venue" v WHERE v.id = az."venueId");
DELETE FROM "TicketScan" ts WHERE NOT EXISTS (SELECT 1 FROM "Ticket" t WHERE t.id = ts."ticketId");

DELETE FROM "Ticket" a
USING "Ticket" b
WHERE a."seatId" IS NOT NULL
  AND a."eventId" = b."eventId"
  AND a."seatId" = b."seatId"
  AND a."createdAt" < b."createdAt";

CREATE INDEX IF NOT EXISTS "AccessZone_venueId_idx" ON "AccessZone"("venueId");
CREATE INDEX IF NOT EXISTS "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "CashierShift_userId_closedAt_idx" ON "CashierShift"("userId", "closedAt");
CREATE INDEX IF NOT EXISTS "CashierShift_organizationId_openedAt_idx" ON "CashierShift"("organizationId", "openedAt");
CREATE INDEX IF NOT EXISTS "CfdiInvoice_organizationId_status_createdAt_idx" ON "CfdiInvoice"("organizationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Event_organizationId_status_startsAt_idx" ON "Event"("organizationId", "status", "startsAt");
CREATE INDEX IF NOT EXISTS "Event_organizationId_status_publishAt_idx" ON "Event"("organizationId", "status", "publishAt");
CREATE INDEX IF NOT EXISTS "Event_status_category_startsAt_idx" ON "Event"("status", "category", "startsAt");
CREATE INDEX IF NOT EXISTS "FraudFlag_eventId_status_idx" ON "FraudFlag"("eventId", "status");
CREATE INDEX IF NOT EXISTS "FraudFlag_eventId_severity_idx" ON "FraudFlag"("eventId", "severity");
CREATE INDEX IF NOT EXISTS "FraudFlag_ticketId_idx" ON "FraudFlag"("ticketId");
CREATE INDEX IF NOT EXISTS "Offer_eventId_isAvailable_idx" ON "Offer"("eventId", "isAvailable");
CREATE INDEX IF NOT EXISTS "Order_organizationId_status_createdAt_idx" ON "Order"("organizationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Order_organizationId_status_completedAt_idx" ON "Order"("organizationId", "status", "completedAt");
CREATE INDEX IF NOT EXISTS "Order_eventId_status_idx" ON "Order"("eventId", "status");
CREATE INDEX IF NOT EXISTS "Order_organizationId_channel_status_createdAt_idx" ON "Order"("organizationId", "channel", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Order_cashierId_channel_createdAt_idx" ON "Order"("cashierId", "channel", "createdAt");
CREATE INDEX IF NOT EXISTS "Order_paymentId_idx" ON "Order"("paymentId");
CREATE INDEX IF NOT EXISTS "Order_promotionId_idx" ON "Order"("promotionId");
CREATE INDEX IF NOT EXISTS "Payment_gateway_status_createdAt_idx" ON "Payment"("gateway", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentIntent_provider_status_createdAt_idx" ON "PaymentIntent"("provider", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentIntent_status_expiresAt_idx" ON "PaymentIntent"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "PosCashierSession_terminalId_cashierId_status_idx" ON "PosCashierSession"("terminalId", "cashierId", "status");
CREATE INDEX IF NOT EXISTS "PosCashierSession_terminalId_status_startedAt_idx" ON "PosCashierSession"("terminalId", "status", "startedAt");
CREATE INDEX IF NOT EXISTS "PosTerminal_organizationId_status_idx" ON "PosTerminal"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "PromoterPayout_organizationId_status_periodEnd_idx" ON "PromoterPayout"("organizationId", "status", "periodEnd");
CREATE INDEX IF NOT EXISTS "Refund_status_processedAt_idx" ON "Refund"("status", "processedAt");
CREATE INDEX IF NOT EXISTS "Refund_status_requestedAt_idx" ON "Refund"("status", "requestedAt");
CREATE INDEX IF NOT EXISTS "ResaleListing_status_listedAt_idx" ON "ResaleListing"("status", "listedAt");
CREATE INDEX IF NOT EXISTS "SeasonPassPurchase_seasonPassId_status_idx" ON "SeasonPassPurchase"("seasonPassId", "status");
CREATE INDEX IF NOT EXISTS "SeatHold_eventId_status_expiresAt_idx" ON "SeatHold"("eventId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "SeatHold_sessionId_status_idx" ON "SeatHold"("sessionId", "status");
CREATE INDEX IF NOT EXISTS "Ticket_eventId_status_idx" ON "Ticket"("eventId", "status");
CREATE INDEX IF NOT EXISTS "Ticket_eventId_offerId_status_idx" ON "Ticket"("eventId", "offerId", "status");
CREATE INDEX IF NOT EXISTS "Ticket_eventId_seatId_status_idx" ON "Ticket"("eventId", "seatId", "status");
CREATE INDEX IF NOT EXISTS "Ticket_eventId_checkedInAt_idx" ON "Ticket"("eventId", "checkedInAt");
CREATE INDEX IF NOT EXISTS "Ticket_orderItemId_idx" ON "Ticket"("orderItemId");
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_eventId_seatId_key" ON "Ticket"("eventId", "seatId");
CREATE INDEX IF NOT EXISTS "TicketScan_zoneId_scannedAt_idx" ON "TicketScan"("zoneId", "scannedAt");
CREATE INDEX IF NOT EXISTS "TicketScan_ticketId_success_scannedAt_idx" ON "TicketScan"("ticketId", "success", "scannedAt");
CREATE INDEX IF NOT EXISTS "TicketTransfer_status_expiresAt_idx" ON "TicketTransfer"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "Venue_organizationId_city_idx" ON "Venue"("organizationId", "city");
CREATE INDEX IF NOT EXISTS "WaitlistEntry_eventId_status_priority_createdAt_idx" ON "WaitlistEntry"("eventId", "status", "priority", "createdAt");

DO $$ BEGIN
  ALTER TABLE "AccessZone" ADD CONSTRAINT "AccessZone_venueId_fkey"
    FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TicketScan" ADD CONSTRAINT "TicketScan_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
