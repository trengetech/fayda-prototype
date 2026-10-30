import asyncio, re
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as pw:
    b=await pw.chromium.launch(); p=await b.new_page(viewport={"width":1280,"height":900}); errs=[]; p.on("pageerror", lambda e: errs.append(str(e)))
    await p.goto("http://localhost:8790/dist/local.html"); await p.evaluate("localStorage.clear()"); await p.reload(); await p.wait_for_timeout(1000)
    B=p.locator('[data-app=buyer]')
    await B.get_by_placeholder("10-digit mobile number").fill("9700012345"); await B.get_by_role("button", name="Send code").click()
    await B.locator("input.otp").fill("123456"); await B.get_by_role("button", name="Verify and continue").click(); await p.wait_for_timeout(300)
    print("new buyer → onboarding:", await B.get_by_text("Where should we deliver?").count()==1)
    await B.get_by_role("button", name="Save address and start shopping").click(); await p.wait_for_timeout(200)
    print("validation shown:", await B.get_by_text("Enter your name.").count()==1)
    await B.locator("#ob-fullname").fill("Kiran Rao"); await B.locator("#ob-line1").fill("Plot 7"); await B.locator("#ob-line2").fill("Miyapur"); await B.locator("#ob-pin").fill("500049")
    await B.get_by_role("button", name="Save address and start shopping").click(); await p.wait_for_timeout(400)
    print("new buyer in feed:", await B.locator(".reel").count()>0)
    await B.locator(".tab", has_text="Profile").click(); await p.wait_for_timeout(200)
    print("profile shows new user:", await B.get_by_text("Kiran Rao").count()>0 and await B.get_by_text("Miyapur").count()>0)
    print("errors:", errs)
    await b.close()
asyncio.run(main())
