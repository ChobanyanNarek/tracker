---
name: project-roles-payment
description: Role system and Ameriabank vPOS payment/subscription feature added to pm-tracker
metadata: 
  node_type: memory
  type: project
  originSessionId: 065f8334-85f9-4e91-8753-6c7100ae2f5f
  modified: 2026-08-12T14:07:57.498Z
---

Added roles + subscription in Aug 2026.

**Roles:**
- `SUPER_ADMIN` = new role for Narek only — accesses Admin Panel (Users + Payments tabs)
- `ADMIN` still works as a fallback for Admin Panel access
- `USER` / `CREATOR` = regular paying user

**Subscription flow:**
- After login, `App.tsx` calls `GET /payment/status` to check `subscriptionActive`
- Super admins skip the check
- If not active → `PaywallScreen` shown (blocks app entirely)
- User clicks Subscribe → frontend calls `POST /payment/init` → backend calls Ameriabank InitPayment → returns `paymentUrl` → frontend redirects
- After payment, Ameriabank redirects back with `?orderID=&paymentID=` → frontend calls `GET /payment/status` → if active, enters app

**Payment provider:** Ameriabank vPOS 3.1 (REST API)
- Test URL: `https://servicestest.ameriabank.am/VPOS/`
- Doc: `/Users/narekchobanyan/Downloads/vPOS_Eng_3.1.docx`
- Price: 10 AMD/month

**Backend endpoints needed:**
- `POST /payment/init` → body `{plan: 'monthly'}` → returns `{paymentUrl, orderId, paymentId}`
- `POST /payment/confirm` → body `{orderId, paymentId}` → backend calls GetPaymentDetails, marks subscription
- `GET /payment/status` → returns `{subscriptionActive, subscriptionUntil, trialUntil, lastPayment}`
- `GET /admin/pm-tracker/payments` → returns `{payments: AdminPayment[]}`
- `POST /admin/pm-tracker/users/:id/subscription` → body `{months}` → manually grant subscription

**Why:** Monetization — 10 AMD/month. Block non-paying users. Super admin sees all users + payment history.

**How to apply:** When working on backend, implement these 5 endpoints. Frontend is complete.
