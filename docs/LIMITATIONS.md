# Known limitations (internal Android build, M3.8)

For anyone demoing or testing the internal APKs. Written 1 Nov 2026 from `docs/PROGRESS.md` and `docs/DECISIONS.md`. Each line says what is true now; "later" names where it is planned. If a limit is fixed, delete its line and note it in `PROGRESS.md`.

## Simulated, not real
- **Sign-in is a dev code (`123456`)**, not a real SMS. Both apps show a "Prototype" banner for this reason.
- **Fayda never handles money or delivery.** Buyers pay the seller directly (UPI, bank transfer, payment link). The app cannot confirm that a payment happened; the seller confirms the order.
- The agreement and Code of Conduct texts are drafts and say so.

## Tested on the emulator only
- **No physical phone test of M3.3 to M3.8** (the founder will do this). Not exercised on a device: a real UPI app, WhatsApp and Call links, photos from a real camera, reel playback and memory on a mid-range phone (two video players, I-27).
- **Push is proven** on the emulator, and through the live server to APKs installed on the emulator, with the app closed. Not yet proven on a physical phone.
- **iOS is not built.** iOS follows Android from the same code (I-32); it needs an Apple Developer account and a push key.

## Release readiness (internal use only)
- APKs use the **dev package ids** (`com.fayda.buyer.dev`, `com.fayda.seller.dev`) and are **signed with the debug key**: fine on your own phones, not accepted for the Play Store, which needs your own release key. Package ids cannot change after a Play Store release, so they must be final before then.
- Firebase (push) is set up for the dev ids only. Staging and prod ids are later (L2).
- The database is the dev one, shared with the live dev server. No backups beyond the host's own. The dev data holds no real people.
- Builds are made on the founder's Mac (`infra/build-apk.sh`); EAS cloud builds are not set up.
- Media is stored on the API server's disk (no backup, no video transcoding); Cloudflare R2 and Stream come later (I-10, I-11). The 60 s reel limit is checked on the phone only.
- Brand name, legal entity and store accounts are not final.

## Product gaps
- **No moderation tool.** Reports sit in the `reports` table (status OPEN); nobody is emailed. An admin console is later work (L1). Play's user-generated-content policy is met by in-app report and block, but a public release needs someone to act on reports.
- **For You is newest first, with no ranking**, and **search is a plain word match** over title, description and tags (I-25, I-26). Better search and ranking is the planned milestone M3.9 (I-39).
- **Comment counts** on cards and the product page include comments from people you have blocked by default; set `COMMENT_COUNT_MODE=viewer` on the server to leave them out (I-36). The comment list always hides them.
- **Comments are flat**: no replies to replies, edits, or likes on comments.
- **Saves are private** (I-28): the seller sees counts, buyers never do.
- **Views** are product-page opens, once per person per listing per hour, your own opens excluded, and only from 1 Nov 2026. Reel impressions and shop-page visits are not counted.
- **Notifications:** read ones are deleted after 90 days and unread after 180 (checked hourly); a kind switched off is hidden, not deleted. No quiet hours, and one notification per chat message.
- **The shared link** opens the app only where it is installed; there is no web page yet.
- Following a shop sends no notification.
- The seller sees the buyer's first name, or "Buyer" if none.
- Review, request and chat photos stream through the API (access-checked for chat, I-19).

## Behaviour to know about
- **Version check (I-40):** apps and server must be deployed together, or the new app shows a note ("newer than the server") and some screens fail. A test (`packages/contracts/test/contract-guard.test.ts`, run by `pnpm test` and CI) fails when a contract change would break an older app and `CONTRACT_LEVEL` was not raised; it compares the contracts and the routes in the OpenAPI document, not the server code, so a breaking change in a route that has no contract is not seen. There is no store link on the "please update" screen yet (to do during production setup, L3).
- Offer countdowns are computed when a screen draws, not ticking.
- Changing a listing's rules does not change timers on offers already pending.
- Accepting at the exact moment a seller pauses a listing can leave an agreement on a paused listing; ordering then refuses it.
- The socket checks the sign-in only when it connects; a session that ends later keeps its socket until the next reconnect.
- A lost reply during a token refresh signs the app out (the retry is treated as theft). Rare and safe.
- Messages sent in the same millisecond have no guaranteed order.
- After a form field is corrected, its old validation message stays until the next Save (address form).
- The sign-in limit is 20 a minute per address on the live server; scripts and demos that sign in many times must wait.

## Demo data
- `infra/seed/seed-demo.mjs` creates 3 demo shops, 9 listings with generated placeholder pictures (plain gradients; run `infra/seed/refresh-demo-media.mjs` afterwards for the illustrated pictures and 60-second reels), 2 buyers and a little history. `infra/seed/unseed-demo.mjs --delete` removes exactly those rows (dry run by default). Uploaded picture files stay on the server's disk.
- Placeholder pictures are plain gradients, so cards look simple. That is the data, not a display fault.
