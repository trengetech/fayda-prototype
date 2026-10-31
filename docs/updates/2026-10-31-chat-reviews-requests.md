# Update 2026-10-31 — Chat, contact, reviews, requests, onboarding

The founder approved these changes after reviewing the prototype. This file is the **delta** since the first handoff.

The reference implementation is in `prototype/`. To see exactly what changed in the prototype since the previous commit, run `git diff HEAD~1 -- prototype/`. `2026-10-31-engine.diff` is the rules-engine part of that diff.

**Implement against the real stack (NestJS + Postgres + Expo).** Don't copy the prototype's UI code. Merge the decisions in section 8 into `docs/DECISIONS.md`.

## 1. Data model additions

| Entity | Fields |
|---|---|
| `seller_profiles` (extend) | `categories[]` (≥1, from the category list), `maps_url` (required), `google_profile_url?`, `social_url?` (Instagram/Facebook), `contact_phone?`, `contact_whatsapp?` (at least one), `sla_confirm_hours` ∈ {1, 2, 4, 6, 12, 24, 48}, `sla_ship_days` ∈ {1, 2, 3, 5, 7} |
| `buyer_profiles` (extend) | `contact_phone?`, `contact_whatsapp?` (at least one), `agreement_version`, `agreement_accepted_at` |
| `chat_threads` | `id`, `kind` (`ORDER` \| `REQUEST`), `order_id?`, `request_id?`, `response_id?`, `buyer_user_id`, `seller_id`, `seller_user_id`, `buyer_read_at`, `seller_read_at`, timestamps |
| `chat_messages` | `id`, `thread_id`, `from` (`BUYER` \| `SELLER` \| `SYSTEM`), `type` (`TEXT` \| `MEDIA` \| `LISTING`), `text?`, `media_id?`, `listing_id?`, `created_at` |
| `reviews` | `id`, `order_id` (unique), `buyer_user_id`, `seller_id`, `listing_id`, `rating` 1–5, `text`, `media[]` (≤4 image/video), `created_at`, `edited_at?` |
| `buyer_requests` | `id`, `buyer_user_id`, `category`, `title`, `description?`, `size?`, `budget_paise?`, `media[]` (≥1 image, ≤4), `status` (`OPEN` \| `CLOSED` \| `EXPIRED`), `expires_at` (+7 days), `reached_count` |
| `request_responses` | `id`, `request_id`, `seller_id` (unique per request), `text?`, `price_paise?`, `media[]` (≥1 image), `status` (`SENT` \| `WANTED` \| `DECLINED`), `thread_id?`, `listing_id?` |

## 2. Rules (see `engine.js` and the 7 new tests in `engine.test.js`, listed in section 7)

**Seller onboarding validation**
- **Maps link:** must be https on `maps.app.goo.gl`, `goo.gl/maps/…`, `google.<tld>/maps…` or `maps.google.<tld>`.
- **Google profile link (optional):** a Maps link, `g.page`, `share.google`, `business.google.com`, `g.co`, or a Google path.
- **Social link (optional):** https on `instagram.com`, `facebook.com`, `m.facebook.com` or `fb.com`, with a non-empty path.
- **Contact:** phone and WhatsApp are 10-digit Indian mobile numbers (`^[6-9]\d{9}$`). At least one is required.
- **Declared timings:** confirm-hours and ship-days must be values from the allowed sets.

**Buyer onboarding**
- The agreement checkbox is required.
- Store the agreement version (`draft-2026-10`) and the acceptance timestamp.

**Chat**
- **Order thread:** created automatically with every order, starting with a SYSTEM message.
- **Request thread:** created when the buyer marks a response "I want this".
- **Who can send:** only the thread's buyer and seller.
- **Listing cards:** only the seller can send one, and only for their own `ACTIVE` listing.
- **Unread count:** messages from the other side after that party's `read_at`.
- **Notifications:** every message notifies the other party.
- **Real-time:** push via Socket.IO (event carries the id, then the client refetches).

**Contact visibility**
- **Open orders only:** seller phone/WhatsApp go to the buyer, and buyer phone/WhatsApp go to the seller, only while the order is `PLACED`, `CONFIRMED` or `SHIPPED`.
- **Never public:** these numbers never appear in feed, listing, shop or search payloads (add contract tests).

**Reviews**
- **Who can review:** the buyer of the order, any time after the order is placed.
- **Editing:** one review per order; saving again updates it and sets `edited_at`. Omitting media keeps the existing media.
- **Low ratings:** a rating ≤ 2 needs text of at least 10 characters.
- **Seller stats** add `rating` (average, 1 decimal place) and `review_count`. Return them with every public seller view.
- **Notifications:** the seller is notified of every new or updated review.

**Buy again**
- On a buyer order, offered when the listing is `ACTIVE`.
- Direct listing: go straight to checkout if the same size is available, otherwise to the product page to pick a size.
- Website listing: open the product page.

**Requests**
- **Who is notified on create:** every seller whose categories include the request's category, excluding the buyer's own shop. Store `reached_count`.
- **Responding:** only sellers in that category; one response per seller; the request must be `OPEN`; a photo is required. The buyer is notified.
- **"I want this"** sets `WANTED`, opens a `REQUEST` thread, and notifies the seller. **"Not for me"** sets `DECLINED` and notifies the seller.
- **Listing from a request:** publishing a listing with `fromResponseId` (for a `WANTED` response owned by this seller) auto-posts a `LISTING` message in that thread and stores `response.listing_id`.
- **Closing:** the buyer can close a request. The sweep expires `OPEN` requests after 7 days.

## 3. API (suggested; follow the existing audience-scoped pattern)

```
Buyer:
  POST  /v1/buyer/profile                 (+contact, agreementAccepted)
  PATCH /v1/buyer/profile/contact
  GET   /v1/buyer/orders/:id               (+seller.contact if open, seller.sla, seller.stats, review, buyAgain, unread, threadId)
  PUT   /v1/buyer/orders/:id/review
  POST  /v1/buyer/requests                 GET /v1/buyer/requests[/:id]   POST /v1/buyer/requests/:id/close
  POST  /v1/buyer/responses/:id/want       POST /v1/buyer/responses/:id/decline
Seller:
  POST  /v1/seller/profile                 (+categories, links, contact, sla)   PATCH /v1/seller/profile
  GET   /v1/seller/orders/:id              (+buyerContact if open, review, unread, threadId)
  GET   /v1/seller/requests                POST /v1/seller/requests/:id/responses
  POST  /v1/seller/listings                (+fromResponseId)
  GET   /v1/seller/reviews
Both:
  GET   /v1/{buyer|seller}/threads         GET /v1/{buyer|seller}/threads/:id
  POST  /v1/{buyer|seller}/threads/:id/messages   POST /v1/{buyer|seller}/threads/:id/read
Public:
  GET   /v1/shops/:id/reviews              (seller public view now includes rating, reviewCount, links, sla, categories)
```

## 4. Buyer app changes

- **Onboarding:**
  - Add a contact section: phone (prefilled with the login number) and WhatsApp.
  - Add a user agreement card with a "Read the full agreement" dialog and a required checkbox.
  - The button now reads "Agree and start shopping".
- **Ratings:** show ★ rating (count) on every reel (under the seller name), search tile, product seller card and shop header. Show "No reviews yet" when there are none.
- **Product seller card:** add "Confirms payment within X · ships within N days".
- **Shop:**
  - Show the shop location, Google profile and Instagram/Facebook link buttons.
  - Show the declared times and the actual typical confirm time.
  - Add Listings / Reviews tabs. Reviews show stars, text, photos and videos (tap to view), and "Verified order".
- **Orders list:**
  - Add a Messages icon with an unread badge, and a badge for unread messages on each order row.
  - Add a **Buy again** button and a **Rate seller** shortcut to each row.
  - The Orders tab badge shows the unread chat count.
- **Order detail:**
  - A Contact seller card with the rating, the declared times plus actual typical time, and the buttons:
    - Chat in app, with an unread badge;
    - WhatsApp, as `https://wa.me/91<n>?text=…` with the order number prefilled;
    - Call, as `tel:+91<n>`.
  - Phone and WhatsApp are hidden when the order is closed.
  - **Buy again.**
  - Your review: a form (star picker, text, up to 4 photos/videos, and the honesty/ban notice) or the posted review with Edit.
- **Chat screen:**
  - Shows the timeline and SYSTEM messages.
  - Supports attaching a photo.
  - Listing cards say "View and buy" and open the product.
  - Mark the thread read when it's opened.
- **Search:** add a "Can't find it? Ask sellers" card that opens the request form (category, title, details, size, budget, photo, "Send to N sellers").
- **Profile:**
  - Contact for orders (editable), Your requests, Messages, User agreement.
  - The request detail screen shows responses (seller with rating, photos, price, message) with "I want this" / "Not for me" / "Open chat", and a "Close request" action.

## 5. Seller app changes

- **Onboarding is now 3 steps:**
  1. Shop + **categories you sell**.
  2. **Location and contact:** Maps link, Google profile, Instagram/Facebook, phone/WhatsApp, declared confirm time and ship time.
  3. Payment.
- **Code of Conduct** adds: confirm and ship within your declared times; resolve disputes directly; Fayda may ban accounts for misleading listings or behaviour.
- **New Requests tab** (6 tabs total):
  - **New** shows requests in my categories: photo, title, details, size, budget, buyer first name. Each has "I have this — send a photo", which opens a sheet with photo, price and message.
  - **Responded** shows the status. When the buyer wants the item, it offers Open chat and **Create listing**.
- **Create listing from a request:**
  - The editor is prefilled: title, category, description and size from the request; photo and price from the response; mode Fixed.
  - On publish, it navigates to the chat with the toast "Published and shared in the chat".
- **Chat:**
  - Has a "Share a listing" action that picks from live listings.
  - In a request thread, the header shows the request and a Create listing button.
- **Order detail:** a Contact buyer card (chat, WhatsApp, call while the order is open) and the buyer's review if one exists.
- **Dashboard:** action cards for unread messages and new requests, plus a Messages icon. The Orders app bar also gets a Messages icon.
- **Shop tab:**
  - "What buyers see": declared times, categories, contact modes.
  - Link buttons.
  - Reviews list.
  - Edit shop now includes categories, links, contact and timings.

## 6. Android specifics

- **WhatsApp and phone** open via `Linking.openURL`: `https://wa.me/91XXXXXXXXXX?text=…` and `tel:+91XXXXXXXXXX`. Handle failure: if no app is installed, show a toast with the number to copy.
- **Media:** review and request photos and videos use the existing media upload-intent flow and picker limits. Chat photos are images only.
- **Real-time:** update chat in real time between two devices via Socket.IO, so it works across phones, not just in one app.

## 7. Acceptance criteria (on two physical Android phones)

1. A new buyer can't finish sign-up without accepting the agreement and giving a phone or WhatsApp number.
2. A new seller can't finish onboarding without a category, a valid Maps link, a contact number and both declared timings. Invalid Google, Instagram or Facebook links are rejected.
3. Buyer places an order. Both phones show the order chat. Messages appear on the other phone within ~2 s, with unread badges, and clear when opened.
4. On an open order, the buyer sees WhatsApp (with the order number prefilled) and Call for the seller, and the seller sees the same for the buyer. After delivery, only chat remains.
5. Buyer posts a 4★ review with a photo. It appears on the seller's shop Reviews tab, and the rating updates on that seller's reels and tiles. A 2★ review without a reason is rejected.
6. Buy again opens checkout for the same size when it's in stock, and is hidden when the listing is paused.
7. Buyer posts a request with a photo in Footwear. Only Footwear sellers see it. A seller responds with a photo. The buyer taps "I want this" and a chat opens. The seller taps Create listing and publishes. The listing card appears in the buyer's chat, and tapping it opens the product page.
8. Contract tests: no phone or WhatsApp numbers in public payloads; no seller payment details or private rules, as before.
9. The 7 new domain tests in `prototype/test/engine.test.js` are ported and passing, and all earlier tests still pass. The new tests are:
   - "Seller onboarding validates categories, Google Maps link, social links, contact and declared timings"
   - "Buyer onboarding requires the user agreement and a phone or WhatsApp contact"
   - "Order chat: created with the order, only the two parties can write…"
   - "Contact details: … only on open orders, never public"
   - "Reviews: …"
   - "Buy again: …"
   - "Requests: …"
10. Existing accounts created before this update are asked to complete the missing fields (seller: categories, Maps link, contact, timings; buyer: contact, agreement) the next time they open the app. They aren't locked out.

## 8. Decisions to merge into `docs/DECISIONS.md`

| # | Decision | Status |
|---|---|---|
| D11 | In-app chat per order and per wanted request response. Text, photos, listing cards. | Approved |
| D12 | Contact for open orders: chat always available; seller and buyer each give a phone and/or WhatsApp, shown to the other party only while the order is open. | Approved (founder to confirm that "both sides" is the right reading) |
| D13 | Seller onboarding: categories, required Google Maps link, optional Google profile and Instagram/Facebook, contact, declared confirm/ship times. | Approved |
| D14 | Order page: Contact seller, declared + actual confirm time, Buy again. | Approved |
| D15 | Reviews: one per order after placement, editable, 1–5 stars (≤2 needs a reason), up to 4 photos/videos; rating on every listing; reviews public on the seller profile. | Approved |
| D16 | Buyer user agreement (disputes with the seller; Fayda doesn't resolve them; check reviews; honest feedback or ban) required at sign-up; ban right also in the seller Code of Conduct. | Approved; text is a draft pending legal review |
| D17 | Buyer requests by category with a photo → seller photo responses → "I want this" chat → listing auto-shared in chat. 7-day window. | Approved; window provisional |

**Open:**
- Should a listing created from a request be visible only to that buyer? It's currently public.
- Seller replies to reviews.
- An admin/moderation tool for bans.
- An area-level location option for home sellers who don't want to share an exact address.
