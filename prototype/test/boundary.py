import asyncio, json, subprocess
from playwright.async_api import async_playwright
bad = subprocess.check_output(['node','-e',"""require('./src/engine.js');require('./src/seed.js');const s=globalThis.FaydaSeed.createSeedState(Date.now());s.sessions.buyer=Object.keys(s.users)[3];s.sellers={};console.log(JSON.stringify(s));"""]).decode()
async def main():
  async with async_playwright() as pw:
    b=await pw.chromium.launch(); p=await b.new_page(viewport={"width":1280,"height":900})
    await p.goto("http://localhost:8790/dist/local.html"); await p.evaluate("s=>localStorage.setItem('fayda-proto-state-v1', s)", bad); await p.reload(); await p.wait_for_timeout(1200)
    print("boundary shown:", await p.get_by_text("The prototype hit an error").count()==1)
    await p.get_by_role("button", name="Reset demo data").click(); await p.wait_for_timeout(1500)
    print("recovered:", await p.locator('[data-app=buyer]').count()==1)
    await b.close()
asyncio.run(main())
