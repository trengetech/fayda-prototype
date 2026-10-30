import asyncio, re
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as pw:
    b=await pw.chromium.launch(); p=await b.new_page(viewport={"width":1280,"height":900})
    await p.goto("http://localhost:8790/dist/local.html"); await p.evaluate("localStorage.clear()"); await p.reload(); await p.wait_for_timeout(1000)
    B=p.locator('[data-app=buyer]'); S=p.locator('[data-app=seller]')
    async def login(ph, label):
      await ph.get_by_role("button", name=re.compile(label)).first.click(); await ph.get_by_role("button", name="Send code").click(); await ph.locator("input.otp").fill("123456"); await ph.get_by_role("button", name="Verify and continue").click(); await p.wait_for_timeout(300)
    await login(S, "Indigo Threads"); await login(B, "Aarav Sharma")
    await B.locator(".tab", has_text="Search").click(); await B.get_by_placeholder(re.compile("Search kurtas")).fill("hand-block"); await B.locator(".tile").first.click()
    await B.locator(".page .chip", has_text=re.compile(r"^M$")).click(); await B.get_by_role("button", name="Make offer").click()
    await B.locator("#offer-amt").fill("1950"); await B.get_by_role("button", name=re.compile("Send offer")).click(); await p.wait_for_timeout(6500)
    print("step 3 counter 2,299:", "Seller countered ₹2,299" in await B.inner_text())
    await B.get_by_role("button", name="Counter", exact=True).click(); await B.locator("input[id^=counter-]").fill("2100"); await B.get_by_role("button", name="Send counter").click(); await p.wait_for_timeout(6500)
    print("step 4 repeat 2,299:", "Seller countered ₹2,299" in await B.inner_text())
    await B.get_by_role("button", name="Counter", exact=True).click(); await B.locator("input[id^=counter-]").fill("2200"); await B.get_by_role("button", name="Send counter").click(); await p.wait_for_timeout(500)
    print("step 5 accepted at 2,200:", "Price agreed: ₹2,200" in await B.inner_text())
    await S.locator(".tab", has_text="Offers").click(); await p.wait_for_timeout(200)
    print("step 6 Priya Chanderi offer in Reply:", await S.locator(".listrow", has_text="Chanderi").filter(has_text="Priya").count()==1)
    await b.close()
asyncio.run(main())
