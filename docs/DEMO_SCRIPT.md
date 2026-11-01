# Demo script: two Android phones

**Status: part-run on one Android emulator on 1 Nov 2026 (live server, the final phone APKs); not yet run on two physical phones** (deferred by the founder). One emulator means the two apps were swapped, not run side by side.

**Seen on the emulator:**
- Part 1 (all): the fixed-price shirt has only Buy; checkout had the saved address already selected; the order screen showed the payment note, UPI ID and Pay in a UPI app; with no UPI app the app said "No UPI app could open. Pay to the UPI ID ... and write FD-... as the note."
- Part 2 steps 1 to 5: ₹1,500 on the kurta was answered with "Seller countered ₹2,299" within about 10 seconds (the 5 second timing was not measured), labelled "Seller replied" with nothing to say it was automatic; ₹2,250 on another size showed "Agreed at ₹2,250. One unit is held for you for 12 h." and Place order at ₹2,250 worked.
- Part 3 steps 1 to 2: the seller saw both waiting orders; Payment received moved the order, then Add shipment details and Mark delivered appeared; the buyer's notification centre listed the counter, the acceptance, order confirmed and order delivered in the buyer's words.
- Part 4 (partly): a Report and Block link was shown on another person's comment.

**Not run yet:** Part 2 step 6 (the 2 minute auto-decline); Part 3 steps 3 and 4 (the push and the shop record); Part 4 chat and the report and block flows; Part 5 (one identity).

**Push on the emulator was not seen.** After Payment received and Mark delivered the server sent the pushes (within 0.1 s) and Expo's receipts for the current token said `ok` (Google's push service accepted them), but nothing showed in the notification shade. The emulator was showing a Google Play services "Account action required" notice at the time, which may be why; unconfirmed. An earlier attempt was invalid because the app had been force-stopped (Android does not deliver pushes to a force-stopped app). To test push, leave the app in the background or swipe it away from recents; do not force-stop it. Push to a physical phone remains the open check.

Steps marked *expected* below that are not in the list above come from the rules and tests; confirm them on the phones and correct this file.

Time: about 15 minutes. Phone A runs the **Fayda Seller** app, phone B the **Fayda Buyer** app. Both talk to the dev server, so what one does the other sees within a few seconds.

## Before you start

- Install both internal APKs (see `infra/README.md`; built against `https://fayda.140-245-219-163.sslip.io`). Allow notifications on both.
- Seed the demo data (once): `node infra/seed/seed-demo.mjs https://fayda.140-245-219-163.sslip.io --yes`. Undo: `cd apps/api && node --env-file=.env ../../infra/seed/unseed-demo.mjs --delete`.
- Sign-in code for every number is **123456** (simulated OTP; both apps show a "Prototype" banner).

| Who | Phone number | App | Shop / name |
|---|---|---|---|
| Seller 1 | 9000011111 | Seller | Indigo Threads (UPI, bargaining on) |
| Seller 2 | 9000033333 | Seller | Loom & Co. |
| Seller 3 | 9000022222 | Seller | Meher's Closet |
| Buyer 1 | 9876543210 | Buyer | Aarav Sharma |
| Buyer 2 | 9123456789 | Buyer | Priya Nair (has an order waiting for the seller) |

Start: Phone A signed in as **9000011111**, phone B as **9876543210**. (Same number signs in to both apps as one person; try it at the end.)

## Part 1: browse and buy at the listed price (3 min)

1. **B:** open the feed. Nine listings appear. Open **Mul cotton shirt** (Loom & Co., fixed price): no offer button, only buy.
2. **B:** pick size, tap buy (the saved address is already selected). The order screen shows the seller's payment details (UPI ID, **Pay in a UPI app**). *Expected:* with no UPI app installed, the app says so instead of failing.
3. **Say:** Fayda never takes the money. The buyer pays the seller directly and the seller moves the order forward.

## Part 2: bargaining, seller's private rules (5 min)

Use **Hand-block printed cotton kurta** (₹2,499). Private rules set by the seller, never shown to the buyer: accept at ₹2,199 or more, counter at ₹2,299.

1. **A:** open the kurta in the seller app and show the private rules (only the seller sees them).
2. **B:** open the kurta, **Make an offer** of **₹1,500**. *Expected:* after about 5 seconds a counter arrives that looks like the seller's own reply (₹2,299). The buyer cannot tell it was automatic.
3. **B:** counter or accept. **A:** the offer shows in the inbox with the whole timeline.
4. **B:** offer **₹2,250** on another size. *Expected:* accepted automatically.
5. **B:** place the order from the agreed price.
6. **Chanderi silk kurta set** (₹4,899, decline below ₹3,500): **B** offers ₹2,000. *Expected:* declined after about 2 minutes.
7. **Say:** the seller sets the rules once; the buyer sees a conversation.

## Part 3: the seller moves the order (3 min)

1. **A:** Orders. Two are waiting: the one from Priya (seeded) and the new one from Aarav.
2. **A:** confirm one (with shipping details if wanted), then mark delivered. **B:** the order status changes; the buyer can only view it.
3. **B:** the notification arrives. Close the buyer app completely, confirm another order on A, and see the push. *Expected:* tapping the push opens that order.
4. **A:** open the shop record: delivered, total, median time to confirm. Dashboard shows the last 7 and 30 days.

## Part 4: chat, comments, safety (3 min)

1. **B:** in the order, open the chat and send a message. **A:** it appears within seconds.
2. **B:** on the kurta, post a comment. **A:** the notification arrives; tapping opens the comments. Reply as the shop.
3. **B:** on a comment from someone else, **Report** (pick a reason) and **Block**. The blocked person's comments disappear from B's list. **Blocked people** shows them with **Unblock**.

## Part 5: one identity (1 min)

Sign in on phone B to the **Seller** app with **9876543210**: same person, a buyer who can also open a shop. Sign out again (the push token is removed on sign-out).

## Reset

Run the unseed command above, then the seed again, to get back to a clean demo. Do this before each run.

## If something fails

- 429 "Too many requests": wait a minute (sign-in is limited to 20 a minute).
- No push: check notification permission, and that the app was built against the live server URL.
- Anything unexpected: note the screen and the time, and add it to `docs/PROGRESS.md` under M3.8 known limits.
