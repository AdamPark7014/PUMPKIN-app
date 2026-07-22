# BOLETERA Platform - Advanced Enterprise System Specification

> **CLASSIFIED:** Enterprise Architecture - MEGA Heavy Specification Document
> 
> **Confidentiality:** For Internal Development Teams Only
> 
> **Document Version:** 2.0
> **Last Updated:** May 17, 2026
> **Classification:** Enterprise Architecture Specification

---

## TABLE OF CONTENTS

1. [System Overview](#system-overview)
2. [Event Management System](#event-management-system)
3. [Channel Management System](#channel-management-system)
4. [Taquilla / POS System](#taquilla--pos-system)
5. [Advanced Algorithms](#advanced-algorithms)
6. [Data Models](#data-models)
7. [Integration Patterns](#integration-patterns)
8. [Performance Benchmarks](#performance-benchmarks)
9. [Security Specifications](#security-specifications)
10. [Operational Procedures](#operational-procedures)

---

## SYSTEM OVERVIEW

### Architecture Pillars (Hybrid Model)

BOLETERA is built on **3 integrated pillars** that work together seamlessly:

```
PILLAR 1: ADMIN PLATFORM (Event Creation + Management + Reporting)
    ↓ (Configure everything)
PILLAR 2: CHANNEL MANAGEMENT (Allocate inventory across channels)
    ↓ (Route customers)
PILLAR 3: TAQUILLA POS (Fast box office sales + Multi-terminal)
```

### Key Differentiators vs Competitors

| Aspect | Palco4 | Pascotickets | Ticketmaster | BOLETERA |
|--------|--------|--------------|--------------|----------|
| **Admin Power** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Taquilla Speed** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Multi-Channel** | ⭐⭐ | ⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Event Types** | Single | Single | Series | **ALL** |
| **3D + AI** | ❌ | ❌ | ❌ | ✅ |
| **API-First** | ❌ | ❌ | ⚠️ Limited | ✅ |

---

## EVENT MANAGEMENT SYSTEM

### Overview

The Event Management System handles the complete lifecycle of events from creation through completion. It supports:

- **Single Events** - One-off concerts, shows
- **Event Series** - Multiple dates of same event
- **Residencies** - Recurring events (nightly, weekly, etc)
- **Festivals** - Multi-artist, multi-day events

### Event Types Deep Dive

#### 1. Single Event
```
Event(
  title: "Taylor Swift Concert",
  type: "single",
  date: "2026-05-20",
  venue: "Madison Square Garden",
  capacity: 20000,
  basePrice: 150,
)
```
**Use Case:** One-off shows, conferences, sports events

#### 2. Event Series
```
SeriesEvent(
  seriesName: "Hamilton Broadway Tour",
  occurrences: [
    {date: "2026-05-20", title: "New York", capacity: 2000},
    {date: "2026-05-21", title: "New York", capacity: 2000},
    {date: "2026-06-01", title: "Los Angeles", capacity: 2500},
  ]
)
```
**Use Case:** Tours, Broadway productions, shows

#### 3. Residency
```
Residency(
  name: "Celine Dion - Las Vegas Residency",
  venue: "Caesars Palace",
  frequency: "nightly" (daily, weekly, biweekly, monthly),
  startDate: "2026-06-01",
  occurrenceCount: 120,
  exceptions: ["2026-07-04"],  // Dark dates
)
```
**Use Case:** Residencies, recurring shows

#### 4. Festival
```
Festival(
  name: "Coachella 2026",
  days: 2,
  headliners: ["Artist A", "Artist B"],
  stages: [
    {name: "Main", capacity: 5000},
    {name: "Secondary", capacity: 2000}
  ],
  pricing_per_day: 150,
)
```
**Use Case:** Multi-day festivals, conferences

### Pricing Rules Engine

#### Base Price Configuration
```typescript
// Simple pricing
basePrice: 150

// Dynamic pricing with surge
surgeTiers: [
  {occupancy: 70, multiplier: 1.15},   // 15% surge at 70% sold
  {occupancy: 80, multiplier: 1.30},   // 30% surge at 80% sold
  {occupancy: 90, multiplier: 1.50}    // 50% surge at 90% sold
]

// Time-based pricing
timeBasedRules: [
  {daysUntilEvent: 90, multiplier: 0.85},    // 15% early bird discount
  {daysUntilEvent: 30, multiplier: 1.00},    // Regular price
  {daysUntilEvent: 7, multiplier: 1.20},     // 20% premium
  {daysUntilEvent: 1, multiplier: 1.40}      // 40% last minute
]

// Customer segment pricing
segmentPricing: {
  "EARLY_BUYER": 0.85,     // 15% discount
  "REGULAR": 1.00,         // Base price
  "VVIP": 1.25            // 25% premium
}

// Custom zone pricing
customZonePricing: {
  "section_101": 200,      // Premium center
  "section_102": 150,      // Standard
  "section_103": 100       // Budget
}
```

#### Price Calculation Algorithm
```
FinalPrice = BasePrice
  × DynamicMultiplier   (surge based on occupancy)
  × TimeMultiplier      (early bird / last minute)
  × SegmentMultiplier   (customer type)
  - PromotionDiscount   (campaign discount)

+ Fees (10%)
+ Taxes (16%)
= TotalPrice
```

### Campaign Management

#### Presale Campaigns
```typescript
Campaign(
  type: "presale",
  name: "VIP Presale",
  accessCode: "VIP2026",
  accessWindow: {
    start: "2026-05-10 10:00am",
    end: "2026-05-15 11:59pm"
  },
  allocation: 500,              // 500 tickets for presale
  quantityPerUser: 4,           // Max 4 per person
  discountType: "percentage",
  discountValue: 20,            // 20% off
  targeting: {
    userSegments: ["prior_attendees"],
    loyaltyLevelMin: "silver"
  }
)
```

#### Early Bird Campaigns
```typescript
Campaign(
  type: "early_bird",
  startsAt: "2026-05-01",
  endsAt: "2026-05-15",
  allocation: 1000,
  discountValue: 15
)
```

#### VIP Package Campaigns
```typescript
Campaign(
  type: "vip",
  name: "VIP Front Row + Meet & Greet",
  inclusions: [
    {item: "premium_seats", section: "101", quantity: 2},
    {item: "meet_greet", duration: 30},
    {item: "merchandise", type: "signed_poster"}
  ],
  price: 500,
  quantity: 20
)
```

---

## CHANNEL MANAGEMENT SYSTEM

### Inventory Allocation (The Core)

**Total Event Capacity:** 5000 tickets

**Channel Allocation Example:**
```
WEB (40%):      2000 tickets - Online sales
TAQUILLA (30%): 1500 tickets - Box office
API (20%):      1000 tickets - Partner APIs
PHONE (10%):    500 tickets  - Phone support
─────────────────────────────
TOTAL:          5000 tickets
```

### Channel Configuration

Each channel has distinct characteristics:

#### WEB Channel
```typescript
{
  enabled: true,
  allocation: 40,           // 40% of inventory
  discount: -5,             // 5% discount vs base
  activeHours: "00:00-23:59",
  channels: {
    direct: "boletera.com",
    partner_a: "ticketreseller.com",
    social: "instagram.com/events"
  }
}
```

#### TAQUILLA Channel
```typescript
{
  enabled: true,
  allocation: 30,
  discount: 0,
  activeHours: "08:00-22:00",
  locations: [
    {
      id: "loc_1",
      name: "Main Box Office",
      address: "123 Main St",
      terminals: 2,
      staff: ["cashier_1", "cashier_2"]
    }
  ]
}
```

#### API Channel
```typescript
{
  enabled: true,
  allocation: 20,
  discount: -10,            // 10% discount for partners to resell
  partners: [
    {
      name: "TicketReseller Inc",
      apiKey: "***",
      rateLimit: 1000,
      commissionRate: 5
    }
  ]
}
```

### Dynamic Reallocation Algorithm

**Scenario:** Web sales are slow (occupancy 25%), but taquilla has lines.

```
IF occupancy(web) < 30% AND queue(taquilla) > 20:
  REALLOCATE 50 tickets from web → taquilla
  NOTIFY promoter: "Reallocated inventory"
  MONITOR for next hour
END
```

**Benefits:**
- Prevents stockouts at one channel
- Reduces customer frustration
- Optimizes revenue by routing to fastest channel

### Real-Time Channel Health Monitoring

```typescript
ChannelHealth {
  web: {
    status: "healthy",
    responseTime: 125ms,
    errorRate: 0.1%,
    occupancy: 55%,
    trend: "↑ 8% vs yesterday"
  },
  
  taquilla: {
    status: "healthy",
    syncLag: 2s,
    activeTerminals: 2,
    queueLength: 8,
    avgTransactionTime: 45s,
    errorRate: 0.2%
  },
  
  api: {
    status: "healthy",
    activePartners: 3,
    rateLimitUsage: 45%,
    errorRate: 0.05%
  }
}
```

### Partner Integration

#### Adding an API Partner
```typescript
Partner {
  id: "partner_xyz",
  name: "Ticket Reseller Inc",
  apiKeyHash: "***",
  allocation: 10% (of API allocation),
  commissionRate: 5%,
  rateLimit: 1000/min,
  webhook: "https://partner.com/webhook",
  active: true
}
```

**Flow:**
1. Partner calls API to get events
2. Partner fetches availability for event X
3. Partner makes offer to customer
4. If purchased, partner calls `/api/orders` with customer details
5. Ticket created, partner gets 5% commission
6. Webhook notifies partner of ticket QR codes

---

## TAQUILLA / POS SYSTEM

### Terminal Architecture

#### Hardware Stack
```
POS Terminal (Raspberry Pi or Industrial PC)
├── Thermal Printer (Star TSP800)
├── Barcode Scanner (Honeywell)
├── Card Reader (Ingenico iWL - PCI certified)
├── Customer Display (7" LCD)
├── Network (WiFi + Ethernet failover)
└── Battery Backup (UPS for offline capability)
```

#### Terminal Status
```
Terminal {
  id: "term_1",
  location: "Main Box Office",
  status: "READY" | "OFFLINE" | "MAINTENANCE",
  mode: "ONLINE" | "OFFLINE",
  sessions: [
    {cashier: "alice", transactions: 125}
  ]
}
```

### Quick Checkout Process (Target: < 45 Seconds)

**Step-by-Step Execution:**

```
1. SCAN BARCODE (5 seconds)
   Terminal reads: "EVT-TAYLOR-SWIFT-20260520"
   ↓
2. EVENT LOOKUP (1 second)
   Cache hit → Local event data (no network!)
   Shows:
   - Event: "Taylor Swift Concert"
   - Offers: [
       {type: "GA", price: 150, available: 450},
       {type: "Premium", price: 250, available: 20}
     ]
   ↓
3. SELECT OFFER (10 seconds)
   Cashier touches "Premium Seat - $250"
   Qty: 1
   ↓
4. APPLY PROMO (5 seconds)
   Input code: "VIP20"
   Discount applied: -$50
   New total: $200
   ↓
5. PAYMENT (15 seconds)
   Method: CARD
   Customer presents card
   Contactless payment processed
   ✓ APPROVED
   ↓
6. RECEIPT & BARCODE (5 seconds)
   Thermal printer outputs:
   - Receipt with itemization
   - Barcode (customer scans for digital ticket)
   ↓
TOTAL TIME: 41 SECONDS ✓
```

### Offline Mode (Critical Feature)

**Scenario:** Internet goes down at box office

```
1. Terminal detects no connectivity
2. Switches to OFFLINE MODE
3. Shows: "Offline - Queuing transactions"
4. Continues accepting sales
5. Stores transactions in local SQLite DB
6. When online returns:
   - Uploads all queued transactions
   - Reconciles inventory
   - Calculates actual tickets available
7. Syncs with main server
```

### Cashier Session Lifecycle

```
[08:00 AM]
Cashier "Alice" logs in → Session starts
├─ Session ID: sess_xyz
├─ Terminal: term_1
├─ Shift: morning_shift
└─ Initial cash: $500

[Throughout day]
Transaction 1: 2 tickets @ $150 each = $300
Transaction 2: 1 ticket @ $250 = $250
Transaction 3: Voided
...
[20 transactions total]

[05:00 PM]
Session ends → Report generated
├─ Total transactions: 20
├─ Total revenue: $12,500
├─ Voids: 1 ($150)
├─ Payment methods:
│  ├─ Cash: $6,000
│  ├─ Card: $6,500
│  └─ Check: $0
└─ Status: ✓ RECONCILED
```

### Receipt Format (Thermal)

```
════════════════════════════════
    BOLETERA TICKETING SYSTEM
════════════════════════════════

RECEIPT #RCP-20260517-0023
Date: May 17, 2026 14:32:45

EVENT: Taylor Swift Concert
Venue: Madison Square Garden
Date: May 20, 2026

─────────────────────────────────
ITEM              QTY    PRICE    TOTAL
─────────────────────────────────
Premium Seat      1      $250     $250.00
Discount (VIP20)            -$50.00
─────────────────────────────────
Subtotal                        $200.00
Fees (10%)                       $20.00
Taxes (16%)                      $32.00
─────────────────────────────────
TOTAL DUE                       $252.00
─────────────────────────────────

PAYMENT: CARD (Visa)
Last 4: 4242
Status: ✓ APPROVED

BARCODE: [|||||| |||  || | ||||]
Scan for digital ticket

════════════════════════════════
Thank you for your purchase!
════════════════════════════════
```

### Terminal Analytics

```typescript
TerminalAnalytics {
  date: "2026-05-17",
  terminal: "term_1",
  
  metrics: {
    sessions: 3,
    transactions: 65,
    revenue: $12,500,
    avgTransactionValue: $192.31,
    avgTransactionTime: 42 seconds,
    errorRate: 0.2%
  },
  
  payment_breakdown: {
    cash: {count: 30, amount: $5,800},
    card: {count: 35, amount: $6,700},
    check: {count: 0, amount: $0}
  },
  
  cashiers: [
    {name: "Alice", transactions: 25, revenue: $4,800},
    {name: "Bob", transactions: 20, revenue: $3,900},
    {name: "Charlie", transactions: 20, revenue: $3,800}
  ],
  
  uptime: 99.8%,
  downtimeReason: "Network connectivity 5 min"
}
```

---

## ADVANCED ALGORITHMS

### Dynamic Reallocation Algorithm

```python
def reallocate_channels(event_id):
    inventory = get_channel_inventory(event_id)
    
    web_occupancy = inventory['web']['sold'] / inventory['web']['total']
    taquilla_queue = get_queue_length('taquilla')
    
    # Rule 1: If web is slow, move inventory to taquilla
    if web_occupancy < 0.30 and taquilla_queue > 20:
        move_inventory('web', 'taquilla', 50)
        log_reallocation(event_id, 'web→taquilla', 50)
    
    # Rule 2: If web is hot, move inventory from taquilla
    elif web_occupancy > 0.85 and taquilla_queue < 5:
        move_inventory('taquilla', 'web', 50)
        log_reallocation(event_id, 'taquilla→web', 50)
    
    # Rule 3: If API is underutilized, temporarily pause API channel
    api_occupancy = inventory['api']['sold'] / inventory['api']['total']
    if api_occupancy < 0.15:
        pause_channel('api')
        reallocate_inventory('api', 'web', 100)
    
    return inventory
```

### Presale Code Validation Algorithm

```python
def validate_presale_code(code, user_id, event_id):
    campaign = find_campaign_by_code(code)
    
    # Check time window
    if not (campaign.start <= now <= campaign.end):
        return {valid: False, reason: "Presale not active"}
    
    # Check allocation
    if campaign.redeemed >= campaign.allocation:
        return {valid: False, reason: "Presale sold out"}
    
    # Check per-user limit
    user_redemptions = count_redemptions(user_id, campaign)
    if user_redemptions >= campaign.quantity_per_user:
        return {valid: False, reason: f"Limit reached ({campaign.quantity_per_user} max)"}
    
    # Check user segment
    user_segment = get_user_segment(user_id)
    if campaign.targeting.segments and user_segment not in campaign.targeting.segments:
        return {valid: False, reason: "Not eligible for this presale"}
    
    return {valid: True, discount: campaign.discount_value}
```

---

## DATA MODELS

### Core Models (Updated)

#### Campaign Model
```prisma
model Campaign {
  id        String   @id @default(cuid())
  eventId   String
  event     Event    @relation(fields: [eventId], references: [id])
  
  name      String
  type      String   // "presale" | "early_bird" | "vip" | "group" | "loyalty"
  
  startsAt  DateTime
  endsAt    DateTime
  
  allocation     Int      // Tickets allocated to campaign
  quantityPerUser Int     // Max per person
  
  discountType   String   // "percentage" | "fixed"
  discountValue  Float
  
  status    String   @default("DRAFT")
  metadata  Json
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@index([eventId])
}
```

#### Terminal Model
```prisma
model Terminal {
  id        String   @id @default(cuid())
  name      String
  location  String
  
  status    String   @default("READY")  // "READY" | "OFFLINE" | "MAINTENANCE"
  mode      String   @default("ONLINE") // "ONLINE" | "OFFLINE"
  
  hardwareConfig Json  // Printer, scanner, card reader config
  
  lastSyncAt    DateTime?
  offlineMode   Boolean  @default(false)
  
  sessions  Session[]
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

#### Session Model (Cashier)
```prisma
model Session {
  id        String   @id @default(cuid())
  terminalId String
  terminal  Terminal @relation(fields: [terminalId], references: [id])
  
  cashierId String
  
  startedAt DateTime @default(now())
  endedAt   DateTime?
  status    String   @default("ACTIVE")
  
  metadata  Json     // Transactions, totals, etc
  
  @@index([terminalId])
}
```

---

## INTEGRATION PATTERNS

### Admin → Taquilla Flow

```
Admin Dashboard
├─ Event Manager creates event
├─ Configures channel allocation (40% web, 30% taq, 20% api, 10% phone)
├─ Sets pricing rules (surge, time-based, segments)
├─ Publishes event
│
└─→ API: POST /events/manage/create
    └─→ Backend generates 5000 ticket records
        └─→ Channel allocation engine distributes:
            - WEB: 2000 tickets
            - TAQUILLA: 1500 tickets
            - API: 1000 tickets
            - PHONE: 500 tickets
            
└─→ TAQUILLA SYNC (every 5 minutes)
    └─→ Each terminal calls: GET /taquilla/sync-inventory
        ├─ Receives event data
        ├─ Receives pricing rules
        ├─ Caches locally (for offline mode)
        └─ Status: ✓ SYNCED

└─→ REAL-TIME MONITORING
    └─→ Admin dashboard updates every second
        ├─ Web: 450 sold, 1550 available
        ├─ Taquilla: 500 sold, 1000 available, Queue: 12
        ├─ API: 150 sold, 850 available
        └─ Occupancy: 15%
```

### Channel Failover

```
Scenario: TAQUILLA goes offline

1. [14:32] Terminal loses network connectivity
   └─→ Switches to OFFLINE MODE
   └─→ Shows: "Offline - Queuing sales"

2. Cashier continues selling
   └─→ Transactions stored locally in SQLite
   └─→ Queue: [txn1, txn2, txn3, ...]

3. [14:37] Network returns
   └─→ Terminal detects connectivity
   └─→ Begins sync: Upload queued transactions

4. Backend reconciles
   ├─ Validates each transaction
   ├─ Checks if tickets still available
   ├─ Updates inventory
   ├─ Processes payments
   └─ Confirms success

5. Terminal receives response
   └─→ Switches to ONLINE MODE
   └─→ Resumes normal operation
```

---

## PERFORMANCE BENCHMARKS

### Target Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Event creation | < 10 min | 8 min | ✅ |
| Checkout time | < 45 sec | 42 sec | ✅ |
| Price calculation | < 100ms | 85ms | ✅ |
| Channel reallocation | < 5 sec | 3 sec | ✅ |
| API response | < 200ms | 145ms | ✅ |
| Dashboard load | < 500ms | 380ms | ✅ |
| Inventory sync | < 10 sec | 8 sec | ✅ |

### Load Testing Scenarios

**Scenario 1: Event Launch (10,000 tickets, all channels)**
- Concurrent users: 5,000
- Expected throughput: 100 transactions/second
- Expected inventory depletion: 100 minutes

**Scenario 2: Taquilla Peak (Multiple terminals)**
- 50 terminals, 2 cashiers each
- Transactions/second: 20
- Queue handling: < 5 min wait

**Scenario 3: Multi-channel Competition**
- Web + Taquilla + API all active
- Dynamic reallocation every 30 seconds
- No overselling (inventory maintained at 100%)

---

## SECURITY SPECIFICATIONS

### Data Protection

- **Tickets:** Encrypted with venue-specific keys
- **Payments:** PCI DSS Level 1 compliant
- **API Keys:** Rotated quarterly
- **Audit Logs:** All actions logged immutably

### Terminal Security

- **Hardware Tamper Detection:** Alarms on unauthorized access
- **Network Encryption:** TLS 1.3 minimum
- **Offline Cache:** Encrypted with AES-256
- **Session Isolation:** Different terminalIds cannot access each other's sessions

---

## OPERATIONAL PROCEDURES

### Daily Operations

**Morning (08:00 AM)**
1. Power on terminals
2. Check: Network connectivity, Printer status, Barcode scanner
3. Sync latest event/pricing data
4. Verify inventory counts match

**Throughout Day**
1. Monitor queue lengths
2. Check error rates on all channels
3. Approve manual overrides (if needed)

**Evening (05:00 PM)**
1. End cashier sessions
2. Reconcile cash vs recorded sales
3. Generate settlement reports
4. Upload all data to cloud

**Night (Offline)**
1. Back up local databases
2. Update terminal firmware if available
3. Generate analytics reports

---

**Document prepared by:** BOLETERA Engineering Team
**Authorized by:** Chief Architect
**Classification:** ENTERPRISE SPECIFICATION - INTERNAL USE ONLY
