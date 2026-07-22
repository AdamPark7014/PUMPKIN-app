# 🔥 BOLETERA - PLAN DE ACCIÓN INMEDIATO

> **Start Here: 8-Hour Sprint to Production-Ready**

---

## 🎯 OBJETIVO: MVP LAUNCH READINESS

```
Current State:    88% Complete
Target State:     95% Complete  
Time Budget:      8 hours
Priority:         HIGH - Payment gateway + Frontend sync
```

---

## ⚡ QUICK WIN #1: STRIPE INTEGRATION (2 hours)

### **Status:** ⚠️ Package installed, implementation incomplete

### **What to do:**

**Step 1:** Create StripeService
```bash
cd apps/api/src/modules/payment
# Create: stripe.service.ts
```

**Step 2:** Key implementation points
- Stripe token creation
- Payment intent handling
- Webhook verification (signature)
- Error mapping

**Step 3:** Update PaymentService
- Add Stripe as second gateway option
- Conditional gateway selection

**Step 4:** Test endpoints
```
POST /payment/stripe/intent          → Create payment intent
POST /payment/stripe/confirm          → Confirm payment
GET  /payment/stripe/status/:id       → Check status
```

**Files to create/modify:**
```
apps/api/src/modules/payment/
├── stripe.service.ts              (NEW - ~200 LOC)
├── payment.service.ts             (UPDATE - add Stripe)
├── payment.controller.ts          (UPDATE - add routes)
└── payment.module.ts              (UPDATE - register)

.env.example
├── Add: STRIPE_SECRET_KEY
└── Add: STRIPE_PUBLISHABLE_KEY
```

**Dependencies already installed:**
- ✅ stripe (npm package)

---

## ⚡ QUICK WIN #2: UPDATE REACT HOOKS (1 hour)

### **Status:** ⚠️ Outdated - many new endpoints not in hooks

### **What to do:**

**Review new endpoints added since hooks.ts creation:**
- Admin endpoints (user, payout, audit)
- WebSocket setup
- Fraud detection
- Advanced analytics
- Resale features

**Update packages/ui/hooks.ts with:**
```typescript
// Add new queries/mutations:
useGetAdminUsers()
useCreateUser()
useUpdateUser()
useGetPayoutReports()
useValidateFraud()
useGetAdvancedAnalytics()
useListResaleCampaigns()
// ... etc
```

**Files to modify:**
```
packages/ui/
├── hooks.ts              (UPDATE - add ~10-15 new hooks)
└── types.ts              (UPDATE - add response types)

apps/web/
└── (auto-uses updated hooks)

apps/admin/
└── (auto-uses updated hooks)
```

**Time breakdown:**
- Review new endpoints: 15 min
- Create hook templates: 20 min
- Test with components: 25 min

---

## ⚡ QUICK WIN #3: THREE.JS INTEGRATION (2 hours)

### **Status:** ⚠️ Documentation complete, not in components

### **What to do:**

**Step 1:** Create Venue3D.tsx component
```typescript
// apps/web/components/Venue3D.tsx (NEW - ~300 LOC)
- Import Three.js from 3D_VISUALIZATION_GUIDE.md
- Setup scene initialization
- Connect to SeatSelection context
- Implement mouse controls
```

**Step 2:** Update SeatSelection.tsx
```typescript
// Replace 3D placeholder with new Venue3D component
// Connect state management
// Add fallback for 2D rendering
```

**Step 3:** Data flow
```
SeatSelection
├── 2D rendering (SVG)
├── 3D toggle button
└── Venue3D component (Three.js)
    ├── Seat geometry
    ├── Heatmap coloring
    ├── Mouse controls
    └── Sightline tooltips
```

**Source:** Copy from 3D_VISUALIZATION_GUIDE.md
- Scene setup: Lines 150-200
- Seat rendering: Lines 250-350
- Heatmap algorithm: Lines 450-520
- Sightline calculation: Lines 550-600

**Files to create/modify:**
```
apps/web/components/
├── Venue3D.tsx          (NEW - ~300 LOC)
└── SeatSelection.tsx    (UPDATE - add 3D toggle)

apps/web/package.json
└── (three.js already listed)
```

**Test checklist:**
- [ ] 2D view loads
- [ ] Toggle to 3D works
- [ ] Seatmap renders
- [ ] Heatmap colors update
- [ ] Mouse controls work

---

## ⚡ QUICK WIN #4: COMPLETE ADMIN MODULE (2 hours)

### **Status:** ⚠️ 85% done - missing user/payout/audit

### **What to do:**

**Missing endpoints:**
```
Admin Users:
POST   /admin/users              → Create user
GET    /admin/users              → List users
PUT    /admin/users/:id          → Update user
DELETE /admin/users/:id          → Delete user
GET    /admin/users/:id/audit    → User audit log

Payouts:
GET    /admin/payouts            → List payouts
GET    /admin/payouts/:id        → Payout details
POST   /admin/payouts/:id/approve → Approve payout
POST   /admin/payouts/:id/reject  → Reject payout

Audit Logs:
GET    /admin/audit              → Audit trail
GET    /admin/audit/:entityId    → Entity audit
```

**Create in AdminService:**
```typescript
// apps/api/src/modules/admin/admin.service.ts (EXPAND)
+ createUser()
+ listUsers()
+ updateUser()
+ deleteUser()
+ getUserAuditLog()
+ listPayouts()
+ getPayoutDetails()
+ approvePayouts()
+ rejectPayouts()
+ getAuditLog()
```

**Update AdminController:**
```typescript
// Add routes for all new methods
// Add proper validation with Zod
// Add role-based checks
```

**Files to modify:**
```
apps/api/src/modules/admin/
├── admin.service.ts     (EXPAND - add 10 methods)
├── admin.controller.ts  (EXPAND - add 10 routes)
└── admin.module.ts      (Already imported)

Modify:
└── packages/ui/api-client.ts (add admin methods)
```

---

## ⚡ QUICK WIN #5: EMAIL HTML TEMPLATES (1 hour)

### **Status:** ⚠️ Plain text only, no branded HTML

### **Templates needed:**
```
1. Order Confirmation
2. Presale Code Activation
3. Loyalty Tier Update
4. Ticket Download Link
5. Refund Notification
6. Payment Failed
7. Event Reminder
```

**Create structure:**
```
apps/api/src/modules/notification/
└── templates/
    ├── order-confirmation.html
    ├── presale-code.html
    ├── loyalty-tier.html
    ├── ticket-download.html
    ├── refund.html
    ├── payment-failed.html
    └── event-reminder.html
```

**Each template should have:**
- BOLETERA branding
- Event details
- Action buttons/links
- Footer with contact info
- Mobile-responsive

**Update MailService:**
```typescript
// apps/api/src/modules/notification/mail.service.ts
+ loadTemplate(templateName, context)
+ sendOrderConfirmation()
+ sendPresaleCode()
+ sendLoyaltyUpdate()
// ... etc
```

---

## 🔄 OPTIONAL BUT RECOMMENDED

### **WebSocket Real-Time (3 hours)**
```
High impact - Dashboard goes from 10s refresh to live updates
Create:
├── apps/api/src/modules/websocket/
│   ├── websocket.gateway.ts
│   ├── websocket.service.ts
│   └── websocket.module.ts
└── apps/web/hooks/useRealtimeUpdates.ts
```

### **Order Tracking Component (1.5 hours)**
```
Frontend polish - Show tickets, QR codes, downloads
Create:
└── apps/web/components/OrderTracking.tsx
    ├── Ticket display
    ├── QR code rendering
    ├── PDF download
    └── Resale option
```

---

## 📋 EXECUTION SEQUENCE

### **Session 1 (2 hours):**
```
[ ] Review this document fully
[ ] Read AUDIT_STATUS_MAY_17.md sections on Stripe & hooks
[ ] Start: Stripe integration
[ ] Complete: StripeService basic implementation
```

### **Session 2 (1.5 hours):**
```
[ ] Finish: Stripe integration (test, error handling)
[ ] Start: Update React hooks
[ ] Complete: New hooks added to hooks.ts
```

### **Session 3 (2.5 hours):**
```
[ ] Complete: React hooks update (types, validation)
[ ] Start: Three.js integration
[ ] Complete: Venue3D component (basic structure)
```

### **Session 4 (2 hours):**
```
[ ] Finish: Three.js integration (testing, fallbacks)
[ ] Start: Admin module completion
[ ] Complete: User management endpoints
```

### **Session 5 (1 hour):**
```
[ ] Complete: Admin payout/audit endpoints
[ ] Create: Email HTML templates
[ ] Quick test of all changes
```

---

## ✅ VERIFICATION CHECKLIST

After each quick win:

### **Stripe Integration:**
- [ ] Package imported correctly
- [ ] StripeService created
- [ ] Payment intent endpoint works
- [ ] Webhook signature verified
- [ ] Error handling in place
- [ ] API client updated with methods
- [ ] Test transaction processed

### **React Hooks Update:**
- [ ] All new endpoints have hooks
- [ ] Types match backend DTOs
- [ ] Components can import new hooks
- [ ] No TypeScript errors
- [ ] Admin dashboard uses new hooks

### **Three.js Integration:**
- [ ] Component renders without errors
- [ ] 2D/3D toggle works
- [ ] Heatmap colors display
- [ ] Mouse controls functional
- [ ] Mobile fallback works

### **Admin Module:**
- [ ] All 10 new endpoints created
- [ ] Authentication checks in place
- [ ] Validation on inputs
- [ ] API client methods added
- [ ] Frontend can consume endpoints

### **Email Templates:**
- [ ] HTML files created
- [ ] Template loader working
- [ ] Variables substitute correctly
- [ ] Mobile responsive
- [ ] Sent successfully via SMTP

---

## 🚀 AFTER QUICK WINS (Production Launch)

### **Testing:**
```bash
# Start all services
cd apps/api && pnpm dev
cd apps/admin && pnpm dev
cd apps/web && pnpm dev

# Test payment flow
curl -X POST http://localhost:3000/api/v1/payment/stripe/intent \
  -H "Content-Type: application/json" \
  -d '{"orderId":"...", "amount":1000}'

# Test new endpoints
curl http://localhost:3000/api/v1/admin/users \
  -H "Authorization: Bearer $TOKEN"

# Load test
ab -n 1000 -c 100 http://localhost:3001
```

### **Deployment checklist:**
```
[ ] All services build without errors
[ ] Docker images created
[ ] Environment variables configured
[ ] Database migrations applied
[ ] Redis connection verified
[ ] Stripe keys loaded
[ ] Email service configured
[ ] Webhooks registered
[ ] DNS configured
[ ] SSL certificates ready
[ ] Health checks passing
```

---

## 🎯 SUCCESS CRITERIA

**After 8 hours of focused work:**

```
✅ Stripe payments working
✅ React hooks updated (all endpoints)
✅ Three.js 3D rendering in SeatSelection
✅ Admin module 95% complete
✅ Email templates branded
✅ All 63 API endpoints functioning
✅ Frontend components connected
✅ No critical bugs found
✅ Ready for MVP beta launch
```

---

## 📞 COMMON ISSUES & SOLUTIONS

### **Stripe Integration Issues**
```
Problem: Webhook verification fails
Solution: Verify STRIPE_WEBHOOK_SECRET in .env
          Use correct raw body in webhook handler

Problem: Token invalid after payment
Solution: Check token format, expiration
          Verify publishable/secret key mismatch

Problem: CORS errors with Stripe.js
Solution: Add stripe.com to CORS whitelist
          Check Content Security Policy
```

### **Three.js Integration Issues**
```
Problem: Scene not rendering
Solution: Verify canvas element exists
          Check WebGL support in browser
          Ensure camera positioned correctly

Problem: Performance issues
Solution: Reduce seat count for testing
          Enable frustum culling
          Check mouse event handlers
```

### **React Hooks Issues**
```
Problem: Hooks query not firing
Solution: Check if component using hook
          Verify enabled flag if conditional
          Check useEffect dependencies

Problem: Type errors on new hooks
Solution: Ensure types match backend DTOs
          Check if @types packages installed
          Run tsc --noEmit to catch errors
```

---

## 🎓 RECOMMENDED READING (before starting)

1. **AUDIT_STATUS_MAY_17.md** - Current status (this doc)
2. **API_REFERENCE.md** - Stripe endpoints section
3. **FRONTEND_IMPLEMENTATION.md** - Component integration patterns
4. **3D_VISUALIZATION_GUIDE.md** - Three.js code samples
5. **QUICK_START_GUIDE.md** - Local testing commands

---

## 💡 PRO TIPS

1. **Work in parallel when possible:**
   - Start Stripe service in one editor
   - Update hooks in another
   - No dependencies between them

2. **Test incrementally:**
   - Create 1 endpoint, test immediately
   - Don't create all 10 then test
   - Catch errors early

3. **Keep components modular:**
   - Three.js = separate component
   - Stripe = separate service
   - Don't combine in one PR

4. **Commit frequently:**
   - Stripe complete → commit
   - Hooks updated → commit
   - Three.js working → commit
   - Makes rollback easier if needed

5. **Use Swagger/Postman:**
   - Test all new endpoints
   - Document request/response
   - Catch validation errors early

---

**Start with Stripe. That's your blocker for payments.**

*Time estimate: 2 hours if focused*  
*Difficulty: Medium (API integration)*  
*Impact: HIGH (enables MVP)*

---

*Next: Choose your starting point and ping when done!*
