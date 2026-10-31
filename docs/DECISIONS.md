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
| D10 | Report/block and push notifications: not built yet. (Reviews are decided: see D15.) | Open |

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

## Chat, contact, reviews, requests (update 31 Oct 2026, from `docs/updates/`)

| # | Decision | Status |
|---|---|---|
| D11 | In-app chat per order and per wanted request response. Text, photos, listing cards. | Approved |
| D12 | Contact for open orders: chat is always available; seller and buyer each give a phone and/or WhatsApp, shown to the other party **only while the order is `PLACED`, `CONFIRMED` or `SHIPPED`**, and never in any public payload. | Approved (the brief asks the founder to confirm that "both sides" is the intended reading) |
| D13 | Seller onboarding is 3 steps: shop and categories; location and contact (required Google Maps link, optional Google profile and Instagram/Facebook, phone and/or WhatsApp, declared confirm and ship times); payment. | Approved |
| D14 | Order page: Contact seller, declared and actual confirm time, Buy again. | Approved |
| D15 | Reviews: one per order, editable, 1 to 5 stars (2 or fewer needs a reason of 10+ characters), up to 4 photos or videos. Rating shown on every listing; reviews public on the seller profile. **A buyer can review only an order that reached `CONFIRMED`** (founder, 31 Oct 2026; the brief said "any time after placement"). A later cancellation does not remove the right to review. | Approved |
| D16 | Buyer user agreement (disputes are with the seller, Fayda doesn't resolve them; check reviews; honest feedback or ban) required at sign-up; ban right also in the seller Code of Conduct. Version `draft-2026-10`. | Approved; text is a draft pending legal review |
| D17 | Buyer requests by category with a photo, seller photo responses, "I want this" opens a chat, the new listing is shared in that chat automatically. Requests close after 7 days. | Approved; the 7-day window is provisional |
| D18 | No separate milestone for this update: the onboarding fields go into M3.1, and chat, reviews and requests are built inside M3.4 (Orders), with Socket.IO. `expo-image-picker` approved for photos and videos. | Approved (founder, 31 Oct 2026) |

**Open:** Should a listing created from a request be visible only to that buyer? (Currently public.) Seller replies to reviews. An admin or moderation tool for bans. An area-level location option for home sellers who don't want to share an exact address.

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
| I-3 | ~~No remote git and no CI for now.~~ **Superseded 31 Oct 2026.** The remote is the private repo `trengetech/fayda-prototype`; `dev` is the default branch. CI is GitHub Actions: typecheck, lint and test on every push to `dev` and every pull request, with a throwaway Postgres service container for the API tests (no cloud credentials in CI). It was green on its first PR, including a clean-clone install. The `docker compose` criterion stays replaced by cloud Supabase (I-1). | Approved 31 Oct 2026 |
| I-4 | M3.0 is split. **3.0a:** monorepo, domain, contracts, API, migrations, health and meta, OpenAPI, ₹ formatter, tests. **3.0b:** ui tokens, fonts, api-client, both Expo apps, gallery, Prototype banner, emulator run. | Proposed |
| I-5 | TypeScript 6.0.x, not 7 (typescript-eslint supports only below 6.1). `nestjs-zod` is not used (it supports Nest 10/11 only); a small Zod validation pipe and `@asteasolutions/zod-to-openapi` replace it. | Proposed |
| I-6 | Extra libraries approved for 3.0a: `postgres` (Drizzle driver), `@asteasolutions/zod-to-openapi`, `uuid` (UUIDv7 keys; installed when first used in M3.1), `@fastify/helmet`, `@fastify/cors`. Expo SDK 58's bundled dependencies are approved as a group in 3.0b. | Proposed |
| I-7 | Money on the wire is integer paise; offers must be whole rupees (multiples of 100). Timers (5 s counter, 2 min decline, 24 h offer expiry, 12 h agreement, reservation and 48 h order expiry) are due-timestamp columns processed by a 1 s sweep with `FOR UPDATE SKIP LOCKED`, plus a lazy check on read. | Proposed |
| I-8 | Free-tier risks to verify: Supabase pauses idle free projects, and Oracle can reclaim idle Always Free VMs. Plan a daily keep-alive. | Proposed |
| I-9 | Media sits behind one upload-intent interface with swappable adapters. **Now:** a local-disk adapter (the API writes files to a folder on the VM and serves them by URL). The apps never know which adapter is active. | Approved 31 Oct 2026 |
| I-10 | **Later (production):** images on Cloudflare R2 through `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (the API signs a short-lived URL and the phone uploads straight to R2); video on Cloudflare Stream through its direct-creator-upload REST endpoint with plain `fetch`, no SDK. Exact versions are verified against Node 24 and recorded in `docs/TECH_STACK.md` before anything is installed. A Cloudflare account is needed only at the switch. | Approved 31 Oct 2026 |
| I-11 | Limits of the disk adapter: dev and demo only. VM had 40 GB free and 954 MB RAM on 31 Oct 2026; no backup; no video transcoding. Uploads must live outside any folder that `infra/deploy-api.sh` replaces or rolls back; the M3.2 plan confirms the path. | Approved 31 Oct 2026 |

## Still open (business)

- **B2 monetisation.** Commission is hard to enforce without payment flow, so subscription or listing fees are more likely.
- **B7 seller verification / KYC.**
- **B8 refunds and disputes.** Sellers handle these directly; Fayda's role is still undefined.
- **B13 serviceability.**
- **B15 languages.**
- **B16 content policy.**
- **B18 legal entity, IP and store accounts.**
- **Legal review** of marketplace/intermediary obligations, even without payments.
