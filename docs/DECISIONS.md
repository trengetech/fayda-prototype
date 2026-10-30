# Fayda — Decisions

Status as of 30 Oct 2026. **Approved** = founder decided. **Implemented, awaiting confirmation** = built in the prototype, but the founder hasn't explicitly confirmed it. **Provisional** = a placeholder value. **Open** = not decided.

## Product model

| # | Decision | Status |
|---|---|---|
| D1 | Working name **Fayda**. Brand, domain and package ids are not final. | Open (B1) |
| D2 | Two apps (Buyer, Seller) sharing one backend and one identity per phone number. | Approved |
| D3 | Launch: Hyderabad, fashion first; the data model supports any category. | Approved |
| D4 | **Fayda does not handle payments.** Buyers pay sellers directly by **UPI ID, UPI QR code, bank transfer or payment link. No cash on delivery.** | Approved |
| D5 | **Fayda does not handle delivery.** Sellers deliver. Shipment details are optional: courier, tracking no., tracking link, expected date, note. | Approved |
| D6 | **Only the seller confirms each order step.** The buyer only views status. | Approved |
| D7 | Each listing chooses a channel: **Pay me directly** (Fayda order) or **My website** (product URL). | Approved |
| D8 | Website deals: a **pre-set code or link** for the auto-accept price (and the auto-counter price if used). The seller enters a **code or link manually** whenever they accept or counter by hand. | Approved |
| D9 | Home feed is full-screen vertical reels with a Buy + Make offer pair. | Implemented, awaiting confirmation (B29) |
| D10 | Reviews/ratings, report/block, push notifications: not built yet. | Open |

## Bargaining

| # | Decision | Status |
|---|---|---|
| B-1 | Listing modes: Fixed, Private, Public, Both. In Public offers other buyers see amounts, never names. | Approved |
| B-2 | Private rules per listing: **lowest price accepted automatically** (A), optional **auto-counter price** (C ≥ A), optional **auto-decline below** (D < A). | Approved |
| B-3 | **Auto-counter fires 5 s after every buyer offer below A.** The buyer sees it as the seller's own counter (no "automatic" label). It never goes higher than the seller's last counter. It stops at the 6-offer limit. | Approved |
| B-4 | Auto-decline is delayed by 2 minutes, to stop buyers probing the seller's floor. | Provisional |
| B-5 | Turn-taking with counters that must converge: a buyer's counter must go up and stay below the seller's counter; a seller's counter must go down and stay above the buyer's offer. | Approved |
| B-6 | Website listings: an automatic accept settles at **A (the code's price)**, even if the buyer offered more. | Implemented, awaiting confirmation |
| B-7 | Hide "automatic" from buyers for automatic **accepts and declines** too. Buyers get no information at all that any reply was automatic. | Approved (31 Oct 2026) |

## Orders

| # | Decision | Status |
|---|---|---|
| O-1 | Direct order: buyer picks a method → `PLACED` → seller "Payment received" (`CONFIRMED`) → optional `SHIPPED` → `DELIVERED`. Seller can cancel with a reason; stock is restored unless the reason is "out of stock". | Approved |
| O-2 | Payment instructions show the seller's details plus the order number to use as the payment note. UPI uses a `upi://pay` deep link with the amount and note filled in. | Approved |
| O-3 | Seller payment details are shown **only** to the buyer of an order that is `PLACED`, and hidden after confirmation. Never on public screens. Encrypt at rest in production. | Approved |
| O-4 | Website deal: the buyer opens the code or link → an order record is created (`PLACED`, no address) → the seller confirms "Order received". | Approved |
| O-5 | Website **Buy now** at list price creates **no order** (Fayda can't see the seller's site); it is counted as a website visit only. | Implemented, awaiting confirmation |
| O-6 | Unconfirmed orders expire after **48 h**, restock, and count against the seller's public record. | Provisional value |
| O-7 | Public seller record: delivered / total, median time to confirm, cancelled, unconfirmed. | Approved |

## Provisional values (approval pending)

| Value | Setting |
|---|---|
| Offer expiry | 24 h (seller can choose 6–72 h) |
| Offers per negotiation | 6 |
| New negotiations per buyer per listing | 3 per 24 h |
| Minimum offer | 10% of the list price |
| Checkout window after agreement | 12 h, 1 unit reserved |
| Auto-counter delay | 5 s |
| Auto-decline delay | 2 min |
| Seller order confirmation window | 48 h |
| Reel length | up to 60 s |
| Media per listing | up to 6 |

## Infrastructure and build (proposed, 31 Oct 2026)

| # | Decision | Status |
|---|---|---|
| I-1 | No Docker. All environments are cloud: Supabase Postgres, two projects in Mumbai (`fayda-dev`, `fayda-test`). The API runs through the transaction pooler (6543, prepared statements off); migrations and tests use the session pooler (5432). Tests wipe `fayda-test` and must never point at dev. | Proposed |
| I-2 | API host: Oracle Cloud Always Free VM in Hyderabad (Ubuntu 24.04, 1 GB RAM + 2 GB swap), Caddy for HTTPS, systemd unit. Name: `fayda.140-245-219-163.sslip.io` (no domain yet). Build on the laptop, never on the VM. | Proposed |
| I-3 | No remote git and no CI for now. A local `git init` (no remote) gives history. The M3.0 criteria about `docker compose` and CI are replaced by: migrations run against Supabase, and typecheck, lint and test run locally. | Proposed |
| I-4 | M3.0 is split. **3.0a:** monorepo, domain, contracts, API, migrations, health and meta, OpenAPI, ₹ formatter, tests. **3.0b:** ui tokens, fonts, api-client, both Expo apps, gallery, Prototype banner, emulator run. | Proposed |
| I-5 | TypeScript 6.0.x, not 7 (typescript-eslint supports only below 6.1). `nestjs-zod` is not used (it supports Nest 10/11 only); a small Zod validation pipe and `@asteasolutions/zod-to-openapi` replace it. | Proposed |
| I-6 | Extra libraries approved for 3.0a: `postgres` (Drizzle driver), `@asteasolutions/zod-to-openapi`, `uuid` (UUIDv7 keys; installed when first used in M3.1), `@fastify/helmet`, `@fastify/cors`. Expo SDK 58's bundled dependencies are approved as a group in 3.0b. | Proposed |
| I-7 | Money on the wire is integer paise; offers must be whole rupees (multiples of 100). Timers (5 s counter, 2 min decline, 24 h offer expiry, 12 h agreement, reservation and 48 h order expiry) are due-timestamp columns processed by a 1 s sweep with `FOR UPDATE SKIP LOCKED`, plus a lazy check on read. | Proposed |
| I-8 | Free-tier risks to verify: Supabase pauses idle free projects, and Oracle can reclaim idle Always Free VMs. Plan a daily keep-alive. | Proposed |

## Still open (business)

- **B2 monetisation.** Commission is hard to enforce without payment flow, so subscription or listing fees are more likely.
- **B7 seller verification / KYC.**
- **B8 refunds and disputes.** Sellers handle these directly; Fayda's role is still undefined.
- **B13 serviceability.**
- **B15 languages.**
- **B16 content policy.**
- **B18 legal entity, IP and store accounts.**
- **Legal review** of marketplace/intermediary obligations, even without payments.
