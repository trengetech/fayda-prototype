import asyncio, json, subprocess
from playwright.async_api import async_playwright
# Build a state shaped like the first published version (no paymentProfiles/dealCodes, old order statuses)
old = json.loads(subprocess.check_output(['node','-e',"""
require('./src/engine.js'); require('./src/seed.js');
const s = globalThis.FaydaSeed.createSeedState(Date.now());
delete s.paymentProfiles; delete s.dealCodes;
Object.values(s.orders).forEach(o => { o.status = 'DELIVERED'; delete o.channel; delete o.paymentMethod; });
Object.values(s.listings).forEach(l => delete l.checkout);
s.sessions = { buyer: Object.values(s.users).find(u=>u.phone==='9876543210').id, seller: Object.values(s.users).find(u=>u.phone==='9000011111').id };
console.log(JSON.stringify(s));
"""]))
async def main():
  async with async_playwright() as pw:
    b=await pw.chromium.launch(); p=await b.new_page(viewport={"width":1280,"height":900})
    errs=[]; p.on("pageerror", lambda e: errs.append(str(e)))
    await p.goto("http://localhost:8790/dist/local.html"); await p.evaluate("s=>localStorage.setItem('fayda-proto-state-v1', s)", json.dumps(old))
    await p.reload(); await p.wait_for_timeout(1500)
    print("root children:", await p.evaluate("document.getElementById('root').children.length"))
    print("errors:", errs[:2])
    await b.close()
asyncio.run(main())
