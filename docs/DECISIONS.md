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
| B-1 | Listing modes are **two**: **Buy now only** (`BUY_NOW`, fixed price) and **Buy now + offers** (`BOTH`). Bargaining is always private: there is no public bargaining and no "bargaining only" mode. Supersedes the earlier Fixed / Private / Public / Both. | Approved (founder, 31 Oct 2026) |
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
| Offer expiry | The seller chooses per listing, for bargaining offers only: **30 min, 1 h, 3 h, 6 h or 24 h** (default 24 h; the default is provisional) |
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
| I-12 | Seller UPI QR upload and check is built in M3.2 (it shares the upload-intent flow). Decoder: `expo-camera` (`Camera.scanFromURLAsync` on the picked image; first-party, bundled with SDK 58, latest 58.0.14 on 31 Oct 2026), so no third-party decoding library. The `pa=` value must match the UPI ID the seller entered. **Spike first:** the Expo docs do not say whether it accepts a local file URI or needs camera permission, so M3.2 proves it on the emulator and a physical phone before building on it. Fallback if it fails: `jsQR` (pure JS, unmaintained) plus an image-pixel decoder, which needs a new approval. | Approved 31 Oct 2026 |
| I-13 | Video upload cap is **80 MB** per file (provisional). The phone enforces the 60 s reel length; the server enforces size only, since the disk adapter does not probe duration. | Approved 31 Oct 2026 (provisional value) |
| I-15 | Negotiations are stored as the domain aggregate: one row per negotiation, with `offers`, `events` and `agreement` as JSON (at most 6 offers, always read and written whole). `next_due_at` holds the earliest due time (auto-counter, auto-decline, offer expiry, agreement lapse) and drives the 1 s sweep and a lazy check on read. Lock order is always size row, then negotiation. Real-time uses Socket.IO with one room per person per app; events carry ids only and are sent after commit. | Proposed |
| I-16 | Wrong sign-in codes are counted in the database table `otp_attempts` (one atomic upsert per wrong code), not in API memory, so more than one API process can run. Same limits as before: 5 wrong codes, 5-minute lock. | Approved 31 Oct 2026 |
| I-14 | Extra Expo SDK 58 modules approved for M3.2: `expo-file-system` (streamed uploads, so a video is never loaded into memory), `expo-video-thumbnails` (the seller's phone makes a poster image when a video is picked, so feed cards have a picture and R2/Stream later need no change). `expo-image-picker`, `expo-camera` and `expo-video` are already approved (D18, I-12, stack table). Exact versions are recorded in `docs/TECH_STACK.md` when installed. | Approved 31 Oct 2026 |
| I-17 | Order numbers come from a database identity column (`orders.seq`, bigint, from 100001) and are shown as `FD-<seq>`. Never repeats, never runs out, and the format can change later without touching stored data. | Proposed |
| I-18 | An order is one row with snapshots (price, delivery address, listing title, size label, cover). Placing one takes a unit from stock; an agreed price consumes the held reservation and marks the negotiation `PURCHASED`. A unique index allows one order per agreement. Lock order stays: size row, then negotiation. Cancel or 48 h expiry restocks once, except for the reason "Out of stock". | Proposed |
| I-19 | Review and request photos are served by the public media route with an unguessable id; they are **not access-controlled** (reviews and requests are meant to be seen). **Chat photos are access-checked (M3.5, 1 Nov 2026):** they are served only by `GET /v1/{buyer|seller}/threads/photos/:mediaId` to the two people in the thread the photo was sent in; anyone else gets the same 404 as a file that does not exist. The public route refuses them, an unsent chat photo has no URL, and the apps load them with the bearer token. Cache header is `private`. Still open for the R2 move (I-10): signed, short-lived URLs instead of streaming through the API. | Chat photos approved by the founder (1 Nov 2026); the rest proposed |
| I-20 | Buyers upload through `/v1/buyer/media/*`, sellers through `/v1/seller/media/*`; each app may upload only for its own purposes (buyer: review, request, chat; seller: listing, UPI QR, request, chat). | Proposed |
| I-21 | Realtime events beyond negotiations (`order.updated`, `chat.updated`, `request.updated`) carry ids only and are published after commit, through the same Socket.IO rooms. | Proposed |
| I-22 | The buyer listing says which payment methods a seller offers (`checkout.payMethods`: names only, never the details) so checkout can show only real choices. | Proposed |
| I-23 | **Follows** are rows in one generic table `follows(follower_user_id, target_type, target_id, created_at)` with a unique edge and indexes both ways, so following other things later (a collection, a person) needs a new `target_type` and an existence check, not a new table. Only `SELLER` exists today. The target has no database foreign key (it is polymorphic); the service checks the shop exists, and a shop is never deleted today. Follow and unfollow are idempotent (PUT and DELETE on `/v1/buyer/follows/sellers/:id`). A person can follow at most 1,000 shops (abuse guard), checked under a per-person lock so two taps at once cannot pass the limit. You cannot follow your own shop. | Founder asked for an expandable table (1 Nov 2026); details proposed |
| I-24 | **Listing tags**: up to 8 per listing, 2 to 24 letters, numbers, spaces or hyphens, stored lower case in `listings.tags` (text array, GIN index). Public: shown on the product page and matched by search. Sending no `tags` on an edit keeps the old ones; sending `[]` clears them. | Founder asked for tags in search (1 Nov 2026); limits proposed |
| I-25 | **Search** (v1): the buyer's words (at most 5, 2+ letters each) must each match, case-insensitively, one of: title, category, tags, description, shop name, shop handle. Plain `ILIKE` with wildcards escaped, no extension. Fine for a few thousand listings; **known limit:** it scans, and the GIN index on `tags` is not used by this search yet (it is there for exact-tag matching and the trigram or full-text step). Facets are computed on each request (no cache yet). Next step when needed: `pg_trgm` or a generated `tsvector` with a GIN index. Filters: category, price range, size in stock, open to offers; sorts: newest, price low to high, price high to low, each with a stable keyset cursor. | Proposed |
| I-26 | **Feed scopes**: For You is every live listing, newest first (**no ranking or personalisation yet**; a ranking function can replace the order later without changing the API). Following is the same list limited to followed shops. The feed lives at `/v1/buyer/feed` and carries `following` and `ownShop` per card. | Proposed |
| I-27 | **Reels playback**: one `expo-video` player plays at a time (muted, looping), the next reel's player is created early and held paused so a swipe starts quickly, and nothing else is mounted. Playback pauses when the app is in the background or another screen covers the reels. A tap pauses or resumes; Sound on and off is one switch for the whole feed. Buy and Make offer open the product page (Make offer with the offer sheet open). **Still to verify on a mid-range phone:** how early ExoPlayer starts buffering a paused player, and memory with two players. | Proposed; needs a phone test |
| I-28 | **Likes and saves** are rows in generic `likes` and `saves` tables shaped like `follows` (person, `target_type`, `target_id`; unique edge; target index), so liking a comment or saving a shop later needs a new type, not a new table. Only listings today. Like and save are repeat-safe (PUT, DELETE). A like or a save needs a live listing that is not your own (a shop would only inflate its own numbers); a save also needs room under 1,000 saves (saves on a listing that is later paused still count until the person removes them; the Saved list shows live listings only) (checked under a per-person lock). Taking either back is always allowed. A like is public as a number only, a save is private; the seller sees counts, never who. The owner's reply as the shop may go on a paused listing (a question can arrive just before it is paused), never on a draft. Counts come from grouped queries per page (no stored counters yet; if a feed ranking ever needs them, add counters then). | Proposed |
| I-29 | **Comments** are flat public text on a live listing (the foundation's P0 Q&A): 1 to 300 characters (counted as characters, so an emoji is one), at most 20 per person per hour, no editing, no replies or threads. The author or the listing's owner can remove one: it is hidden everywhere and kept in the database with who removed it. People are shown by first name; the owner's own comments are labelled as the shop ("Seller"). A comment on someone else's listing writes a `NEW_COMMENT` notification for the seller (the notification centre is M3.7) and a real-time `comment.created` event. A post takes a `clientKey` and an `Idempotency-Key` so a retry cannot post twice. **Not built: report and block (D10).** Google Play's user-generated-content policy expects an in-app way to report objectionable content and block users, so this is a **release blocker for a public launch**, not for the internal APK. | Proposed |
| I-30 | **Share** uses the phone's share sheet with the title, the price and a link that opens the listing in the app (`faydabuyer://listing/<id>` from the app's own scheme). It works for people who have the app. Links that work without the app, and rich previews, need a web domain and universal links (foundation P1). | Proposed |

## Still open (business)

- **B2 monetisation.** Commission is hard to enforce without payment flow, so subscription or listing fees are more likely.
- **B7 seller verification / KYC.**
- **B8 refunds and disputes.** Sellers handle these directly; Fayda's role is still undefined.
- **B13 serviceability.**
- **B15 languages.**
- **B16 content policy.**
- **B18 legal entity, IP and store accounts.**
- **Legal review** of marketplace/intermediary obligations, even without payments.
