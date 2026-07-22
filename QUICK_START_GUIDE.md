# BOLETERA Development Quick Guide

> **Para continuar el desarrollo fácilmente**
>
> Última actualización: May 17, 2026

---

## 📂 PROJECT STRUCTURE

```
boletera-app/
├── apps/
│   ├── api/                          # NestJS Backend
│   │   ├── src/
│   │   │   ├── app.module.ts          # 7 Pillar modules registered
│   │   │   ├── modules/
│   │   │   │   ├── event-management/
│   │   │   │   ├── channel-management/
│   │   │   │   ├── taquilla-pos/
│   │   │   │   ├── layout-management/ ✨ NEW
│   │   │   │   ├── search-service/    ✨ NEW
│   │   │   │   ├── reporting-service/ ✨ NEW
│   │   │   │   ├── campaign-execution/ ✨ NEW
│   │   │   │   ├── orders/
│   │   │   │   ├── payment/
│   │   │   │   ├── inventory/
│   │   │   │   └── [...]
│   │   │   └── prisma/
│   ├── admin/                        # React Admin Dashboard
│   ├── web/                          # Next.js Customer App
│   └── mobile/                       # React Native (future)
├── packages/
│   ├── database/
│   │   └── prisma/
│   │       ├── schema.prisma         # MEGA schema
│   │       └── migrations/
│   ├── ui/                           # Shared components
│   └── utils/                        # Shared utilities
├── ENTERPRISE_SPECIFICATION.md       # 3,500+ lines
├── SYSTEM_INTEGRATION.md             # 2,500+ lines
├── API_REFERENCE.md                  # 3,000+ lines (75+ endpoints)
├── WEBHOOKS_EVENTS.md                # 2,000+ lines (27+ events)
└── IMPLEMENTATION_SUMMARY.md         # Executive summary
```

---

## 🚀 GETTING STARTED

### 1. Install Dependencies
```bash
cd boletera-app
pnpm install
```

### 2. Setup Database
```bash
# PostgreSQL must be running
cd packages/database

# Apply migrations
pnpm prisma migrate dev --name initial

# Seed database (optional)
pnpm prisma db seed
```

### 3. Start API
```bash
cd apps/api
pnpm dev
```

API will be available at `http://localhost:3000`

### 4. Start Admin Dashboard
```bash
cd apps/admin
pnpm dev
```

Admin dashboard at `http://localhost:3001`

---

## 📚 KEY FILES TO UNDERSTAND

### **Backend Setup**
- `apps/api/src/app.module.ts` - All 7 modules registered
- `apps/api/src/modules/index.ts` - Module exports
- `packages/database/prisma/schema.prisma` - Complete schema

### **Core Services (Read These First)**
1. `EventManagementService` - Event lifecycle
2. `ChannelManagementService` - Channel orchestration
3. `SearchService` - AI ranking (understand the weights!)
4. `ReportingService` - Real-time metrics
5. `CampaignExecutionService` - Campaign lifecycle
6. `LayoutManagementService` - 3D layout math
7. `TaquillaPosService` - Checkout logic

### **Documentation (Read in Order)**
1. **IMPLEMENTATION_SUMMARY.md** - Quick overview
2. **ENTERPRISE_SPECIFICATION.md** - Deep dive architecture
3. **API_REFERENCE.md** - All endpoints
4. **SYSTEM_INTEGRATION.md** - Data flow patterns
5. **WEBHOOKS_EVENTS.md** - Event types & examples

---

## 🔧 COMMON TASKS

### Create a New Event
```typescript
// Direct service call
const event = await eventManagementService.createEvent(
  'org_promoter_1',
  {
    title: 'New Concert',
    type: 'single',
    startDate: new Date('2026-06-01'),
    venueId: 'venue_madison_square',
    capacity: 20000,
    basePrice: 150
  }
);

// OR via API
POST /api/v1/events/manage/create
```

### Configure Pricing Rules
```typescript
await eventManagementService.setPricingRules(eventId, {
  basePrice: 150,
  surgePricing: {
    enabled: true,
    tiers: [
      { occupancy: 70, multiplier: 1.15 },
      { occupancy: 80, multiplier: 1.30 },
      { occupancy: 90, multiplier: 1.50 }
    ]
  },
  timeBased: {
    enabled: true,
    rules: [
      { daysUntilEvent: 30, multiplier: 1.00 },
      { daysUntilEvent: 7, multiplier: 1.20 }
    ]
  }
});
```

### Create Campaign
```typescript
const campaign = await campaignExecutionService.createCampaign(
  'org_promoter_1',
  eventId,
  {
    name: 'VIP Presale',
    type: 'presale',
    allocation: 500,
    discountType: 'percentage',
    discountValue: 20,
    startsAt: new Date(),
    endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  }
);

// Publish it
await campaignExecutionService.publishCampaign(campaign.id);
```

### Search Events (AI-Powered)
```typescript
const results = await searchService.searchEvents({
  query: 'taylor swift',
  dateRange: { start: new Date(), end: new Date() },
  userId: 'user_john_123'  // For personalization
});

// Returns: sorted by AI score (content 30% + personalization 40% + demand 20% + business 10%)
```

### Process Checkout
```typescript
// Quick checkout in < 45 seconds
const order = await taquillaPosService.quickCheckout(
  terminalId,
  eventId,
  offerId,
  quantity,
  presaleCode
);

// Process payment
const payment = await paymentService.processPayment(
  order.id,
  'CARD',
  order.total
);

// On payment success, order auto-completes and tickets are generated
```

### Get Real-Time Dashboard
```typescript
const dashboard = await reportingService.getRealtimeDashboard(organizationId);

// Returns: {
//   todayRevenue: 45000,
//   todayOrders: 300,
//   occupancy: 55.5,
//   channels: [...],
//   trend: {...}
// }
```

### Predict Occupancy
```typescript
const prediction = await reportingService.predictOccupancy(eventId);

// Returns: {
//   predictedOccupancy: 92.0,
//   confidence: 0.85,
//   recommendation: "Event trending towards SOLD OUT..."
// }
```

---

## 🔌 ADDING NEW FEATURES

### Option 1: Extend Existing Service
```typescript
// In existing service file
async myNewMethod(data) {
  // Your implementation
}
```

### Option 2: Create New Module
```typescript
// 1. Create folder: apps/api/src/modules/my-feature/
// 2. Create files:
//    - my-feature.service.ts
//    - my-feature.controller.ts
//    - my-feature.module.ts

// 3. Register in app.module.ts
import { MyFeatureModule } from './modules/my-feature/my-feature.module';

@Module({
  imports: [
    // ... existing modules
    MyFeatureModule,  // Add here
  ]
})
export class AppModule {}

// 4. Export in modules/index.ts
export { MyFeatureModule } from './my-feature/my-feature.module';
```

### Option 3: Add Webhook Event
```typescript
// 1. Define event type in WEBHOOKS_EVENTS.md
// 2. Emit in your service:
await this.eventEmitter.emit('custom.event', {
  eventType: 'custom.event',
  data: { /* your data */ }
});

// 3. Add handler in Bull queue
this.queue.process('webhook:custom.event', async (job) => {
  await this.deliverWebhook(job.data);
});
```

---

## 🐛 DEBUGGING

### View Logs
```bash
# API logs
tail -f logs/api.log

# Database logs
tail -f logs/db.log

# Redis logs
tail -f logs/redis.log
```

### Database Introspection
```bash
cd packages/database

# Open Prisma Studio (interactive DB browser)
pnpm prisma studio

# View schema
pnpm prisma db push --skip-generate --dry-run
```

### Test API Endpoint
```bash
# Using curl
curl -X POST http://localhost:3000/api/v1/events/manage/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{...}'

# Using Postman/Insomnia - import API_REFERENCE.md
```

### Check Job Queue
```typescript
// Bull Dashboard: http://localhost:3000/admin/queues

// Or programmatically:
const jobs = await this.queue.getJobs(['waiting', 'active', 'failed']);
console.log(jobs);
```

---

## ✅ BEFORE DEPLOYING

### Checklist
- [ ] All tests passing: `pnpm test`
- [ ] No TypeScript errors: `pnpm tsc --noEmit`
- [ ] ESLint clean: `pnpm lint`
- [ ] Database migrations applied
- [ ] Environment variables configured
- [ ] Redis running
- [ ] PostgreSQL running
- [ ] API health check: `GET /health`

### Performance Check
```bash
# Load test
pnpm test:load

# Memory usage
node --expose-gc -e "gc()" apps/api/dist/main.js

# Database query analysis
pnpm analyze:queries
```

---

## 📞 IMPORTANT CONTACTS / RESOURCES

### Documentation Files
- **API Endpoints:** `API_REFERENCE.md` (75+ endpoints)
- **System Flow:** `SYSTEM_INTEGRATION.md` (all integrations)
- **Events/Webhooks:** `WEBHOOKS_EVENTS.md` (27+ events)
- **Detailed Spec:** `ENTERPRISE_SPECIFICATION.md` (3,500+ lines)

### Environment Setup
- PostgreSQL: Ensure port 5432 open
- Redis: Ensure port 6379 open
- JWT Secret: Set in `.env`
- Webhook Secret: Set in `.env`

### Useful Commands
```bash
# Fresh start
pnpm clean && pnpm install && pnpm build

# Run tests with coverage
pnpm test --coverage

# Generate API docs
pnpm gen:docs

# Check for security vulnerabilities
pnpm audit

# Update dependencies
pnpm update --interactive
```

---

## 🎯 NEXT PHASE: FRONTEND

### Admin Dashboard Priority
1. Event management dashboard
2. Real-time reporting/analytics
3. Campaign management interface
4. Terminal configuration

### Web App Priority
1. Event search & discovery
2. Seat selection with 3D preview
3. Checkout flow
4. Order confirmation

---

## 💡 PRO TIPS

1. **Always check SYSTEM_INTEGRATION.md** before adding features to understand data flow
2. **Test webhook handlers** locally before deploying
3. **Use Bull queue** for all async jobs (don't do blocking ops)
4. **Cache aggressively** with Redis for read-heavy operations
5. **Validate presale codes** at TWO points: before creating order, during payment
6. **Log everything** to audit trail for compliance
7. **Monitor channel health** - it's critical for allocations
8. **Test offline mode** on terminals before going live

---

**Happy coding! The platform is now ready for enterprise deployment.** 🚀

