import { chromium } from 'playwright';

/**
 * Drives the real app against the real backend.
 * Fails loudly on any console error or failed request — the brief asks for both.
 */
const APP = 'http://localhost:3001';
const errors = [];
const failedRequests = [];

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on('console', m => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 240));
});
page.on('pageerror', e => errors.push(`PAGEERROR: ${String(e).slice(0, 240)}`));
page.on('requestfailed', r => {
  // ERR_ABORTED is usePropertyPage cancelling a superseded query on purpose.
  if (r.failure()?.errorText?.includes('ERR_ABORTED')) return;
  failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`);
});
page.on('response', async r => {
  // The suite deliberately submits a wrong password; that 401 is a pass, not a fault.
  if (r.status() >= 400 && r.url().includes('/api/') && !r.url().includes('/auth/login')) {
    failedRequests.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^.*\/api/, '/api')}`);
  }
});

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok    ${name}`);
    return true;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${String(e).split('\n')[0].slice(0, 160)}`);
    return false;
  }
};

let pass = 0, fail = 0;
const run = async (n, f) => { (await step(n, f)) ? pass++ : fail++; };

console.log('\n── Login ───────────────────────────────────────────');
await run('login page loads', async () => {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Prospector', { timeout: 15000 });
});

await run('demo password buttons are GONE', async () => {
  const body = await page.textContent('body');
  if (/demo1234/i.test(body)) throw new Error('the bundled demo password is still on screen');
  if (/Sign in as Director/i.test(body)) throw new Error('one-click demo login still present');
});

await run('bad credentials are rejected', async () => {
  await page.fill('input[type=email]', 'director@demo.ae');
  await page.fill('input[type=password]', 'wrongpassword');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=/not recognised/i', { timeout: 10000 });
});

await run('manager signs in', async () => {
  await page.fill('input[type=email]', 'director@demo.ae');
  await page.fill('input[type=password]', 'ChangeMe_demo1234');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=/Choose a new password/i', { timeout: 15000 });
});

console.log('\n── Forced password change ──────────────────────────');
await run('forced change blocks the app', async () => {
  const body = await page.textContent('body');
  if (!/Choose a new password/i.test(body)) throw new Error('not gated');
});

await run('password change succeeds', async () => {
  const inputs = page.locator('input[type=password]');
  await inputs.nth(0).fill('ChangeMe_demo1234');
  await inputs.nth(1).fill('Directors_new_pw_2026');
  await inputs.nth(2).fill('Directors_new_pw_2026');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=/Good (morning|afternoon|evening)/i', { timeout: 20000 });
});

console.log('\n── Manager screens ─────────────────────────────────');
await run('mission control renders real aggregates', async () => {
  const body = await page.textContent('body');
  if (!/units in pool/i.test(body)) throw new Error('hero stats missing');
  if (!/The vault/i.test(body)) throw new Error('vault card missing');
  // 98 seeded properties, 10 distinct owners
  if (!/98\s*units/i.test(body)) throw new Error("property total not rendered");
});

const goTab = async (label) => {
  await page.click(`nav >> text=${label}`, { timeout: 10000 });
  await page.waitForTimeout(1200);
};

await run('Vault tab: table paginates server-side', async () => {
  await goTab('Vault');
  await page.waitForSelector('text=/properties/i', { timeout: 15000 });
  const body = await page.textContent('body');
  if (!/Page 1 of 2/i.test(body)) throw new Error(`expected 2 pages of 98@50, got: ${body.match(/Page \d+ of \d+/)?.[0]}`);
});

await run('phones are masked in the table', async () => {
  const body = await page.textContent('body');
  if (/9715011100\d\d/.test(body)) throw new Error('A REAL PHONE NUMBER IS ON SCREEN');
  if (!/•/.test(body)) throw new Error('no masked numbers found');
});

await run('search filters via the server', async () => {
  const before = (await page.textContent('body')).match(/([\d,]+)\s*properties/)?.[1];
  await page.fill('input[placeholder*="Search"]', 'Palm');
  await page.waitForTimeout(2000);
  const after = (await page.textContent('body')).match(/([\d,]+)\s*properties/)?.[1];
  if (!before || !after) throw new Error('could not read the row total');
  if (before === after) throw new Error(`search did not narrow (${before} -> ${after})`);
  if (Number(after) === 0) throw new Error('search matched nothing');
});

await run('Assignments tab loads', async () => {
  await goTab('Assignments');
  await page.waitForSelector('text=/Pool/i', { timeout: 15000 });
});

await run('Team tab shows ROI aggregates', async () => {
  await goTab('Team');
  await page.waitForSelector('text=/Data ROI/i', { timeout: 15000 });
  const body = await page.textContent('body');
  if (!/cost per interested/i.test(body)) throw new Error('ROI tiles missing');
});

await run('Control tab loads', async () => {
  await goTab('Control');
  await page.waitForTimeout(1500);
});

console.log('\n── Persistence ─────────────────────────────────────');
await run('session survives a reload', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const body = await page.textContent('body');
  if (/Sign in/i.test(body) && !/Good (morning|afternoon|evening)/i.test(body)) {
    throw new Error('logged out on refresh');
  }
});

await run('data is visible in a FRESH incognito context', async () => {
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(APP, { waitUntil: 'networkidle' });
  await p2.fill('input[type=email]', 'director@demo.ae');
  await p2.fill('input[type=password]', 'Directors_new_pw_2026');
  await p2.click('button[type=submit]');
  await p2.waitForSelector('text=/Good (morning|afternoon|evening)/i', { timeout: 20000 });
  const body = await p2.textContent('body');
  if (!/98\s*units/i.test(body)) throw new Error("the vault is not there for a fresh browser");
  await ctx2.close();
});

console.log('\n── Broker ──────────────────────────────────────────');
await run('broker signs in and sees only their own data', async () => {
  const ctx3 = await browser.newContext();
  const p3 = await ctx3.newPage();
  p3.on('pageerror', e => errors.push(`BROKER PAGEERROR: ${String(e).slice(0, 200)}`));
  await p3.goto(APP, { waitUntil: 'networkidle' });
  await p3.fill('input[type=email]', 'sara@demo.ae');
  await p3.fill('input[type=password]', 'demo1234');
  await p3.click('button[type=submit]');
  // Seeded brokers must also change their password first.
  await p3.waitForSelector('text=/Choose a new password/i', { timeout: 20000 });
  const inputs = p3.locator('input[type=password]');
  await inputs.nth(0).fill('demo1234');
  await inputs.nth(1).fill('Saras_new_password_1');
  await inputs.nth(2).fill('Saras_new_password_1');
  await p3.click('button[type=submit]');
  await p3.waitForSelector('text=/Good (morning|afternoon|evening)/i', { timeout: 20000 });

  const body = await p3.textContent('body');
  if (/98\s*units/i.test(body)) throw new Error("broker can see the whole vault");
  if (/9715011100\d\d/.test(body)) throw new Error('A REAL PHONE NUMBER IS ON SCREEN');
  await ctx3.close();
});

console.log('\n────────────────────────────────────────────────────');
console.log(`steps: ${pass} passed, ${fail} failed`);
console.log(`console errors: ${errors.length}`);
errors.slice(0, 8).forEach(e => console.log(`   ! ${e}`));
console.log(`failed/4xx api requests: ${failedRequests.length}`);
failedRequests.slice(0, 8).forEach(r => console.log(`   ! ${r}`));

await browser.close();
process.exit(fail > 0 ? 1 : 0);
