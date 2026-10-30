import asyncio, re
from playwright.async_api import async_playwright
URL="http://localhost:8790/dist/local.html"
R=[]
def rec(n, ok, note=""): R.append(ok); print(("PASS " if ok else "FAIL ")+n+(" — "+note if note else ""))
async def main():
  async with async_playwright() as pw:
    b=await pw.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    # Desktop: upload real video + photo, publish, check buyer reel plays video
    ctx=await b.new_context(viewport={"width":1280,"height":900}); p=await ctx.new_page(); errs=[]; p.on("pageerror", lambda e: errs.append(str(e)))
    await p.goto(URL); await p.evaluate("localStorage.clear()"); await p.reload(); await p.wait_for_timeout(1000)
    B=p.locator('[data-app=buyer]'); S=p.locator('[data-app=seller]')
    async def login(ph, label):
      await ph.get_by_role("button", name=re.compile(label)).first.click(); await ph.get_by_role("button", name="Send code").click()
      await ph.locator("input.otp").fill("123456"); await ph.get_by_role("button", name="Verify and continue").click(); await p.wait_for_timeout(300)
    await login(S, "Meher"); await login(B, "Priya")
    await S.get_by_role("button", name="New listing").first.click(); await p.wait_for_timeout(200)
    await S.locator("input[type=file]").set_input_files(["/tmp/reel.webm", "/tmp/photo.jpg"]); await p.wait_for_timeout(1500)
    rec("Video + photo uploaded to editor", await S.locator(".upload-cell").count()==2 and await S.locator(".upload-cell video").count()==1)
    await S.locator("#le-title").fill("Mirror-work clutch")
    await S.locator(".chip", has_text="Accessories").click()
    await S.get_by_role("button", name="One size").click()
    await S.get_by_label(re.compile("Stock for")).first.fill("3"); await S.locator("#le-price").fill("1499")
    await S.get_by_role("button", name="Private", exact=True).click()
    await S.get_by_role("button", name="Publish").click(); await p.wait_for_timeout(500)
    rec("Published with real media", await S.get_by_text("Mirror-work clutch").count()>0)
    # buyer feed: find the reel and check the video element is playing
    reels = B.locator(".reel"); n = await reels.count(); idx=None
    for i in range(n):
      if "Mirror-work clutch" in await reels.nth(i).inner_text(): idx=i
    rec("New reel in buyer feed", idx is not None, f"position {idx}")
    await B.locator(".reels").evaluate(f"(el)=>el.scrollTo(0, el.clientHeight*{idx})"); await p.wait_for_timeout(1200)
    playing = await reels.nth(idx).locator("video").evaluate("v=>!v.paused && v.readyState>=2")
    rec("Uploaded video autoplays when its reel is active", playing)
    rec("Mute toggle shown for video", await reels.nth(idx).get_by_role("button", name="Unmute").count()==1)
    await reels.nth(idx).get_by_role("button", name="Make offer").click()
    await B.locator("#offer-amt").fill("1200"); await B.get_by_role("button", name=re.compile("Send offer")).click(); await p.wait_for_timeout(300)
    rec("No-rule listing: offer goes to seller (manual)", "Waiting for the seller" in await B.inner_text())
    await S.locator(".tab", has_text="Offers").click() if await S.locator(".page").count()==0 else None
    await p.screenshot(path="/home/claude/shots/media.png")
    await ctx.close()
    # Mobile narrow + dark mode
    ctx=await b.new_context(viewport={"width":390,"height":844}, color_scheme="dark", is_mobile=True, has_touch=True); p=await ctx.new_page(); p.on("pageerror", lambda e: errs.append(str(e)))
    await p.goto(URL+"#seller"); await p.wait_for_timeout(1200)
    rec("Narrow: one app at a time, hash selects seller", await p.locator('[data-app=seller]').count()==1 and await p.locator('[data-app=buyer]').count()==0)
    await p.screenshot(path="/home/claude/shots/mobile-dark-seller.png")
    await p.get_by_role("button", name="Buyer", exact=True).click(); await p.wait_for_timeout(500)
    rec("Narrow: switch to buyer app", await p.locator('[data-app=buyer]').count()==1)
    await p.get_by_role("button", name=re.compile("Aarav")).click(); await p.get_by_role("button", name="Send code").click(); await p.locator("input.otp").fill("123456"); await p.get_by_role("button", name="Verify and continue").click(); await p.wait_for_timeout(600)
    await p.screenshot(path="/home/claude/shots/mobile-dark-buyer.png")
    await p.locator(".tab", has_text="Offers").click(); await p.wait_for_timeout(300)
    await p.locator(".listrow").first.click(); await p.wait_for_timeout(400)
    await p.screenshot(path="/home/claude/shots/mobile-dark-offer.png")
    bg = await p.evaluate("getComputedStyle(document.querySelector('.phone')).backgroundColor")
    rec("Dark theme applied", bg in ("rgb(22, 23, 27)",), bg)
    rec("No page errors", not errs, "; ".join(errs[:3]))
    print(f"\n{sum(R)}/{len(R)} passed"); await b.close()
asyncio.run(main())
