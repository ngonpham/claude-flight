/**
 * End-to-end: the Pacific 1942 page (pacific.html) in headless Chromium, driven like a player —
 * the title screen, the briefing, flying with the keyboard, pause — and a boss fight flown by the
 * autopilot on the last level, observed through `window.pacific`. No page errors anywhere. On a
 * software renderer (CI) the waits stretch; every test still runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import { detectGpu, e2eTimeScale, launchChrome, setE2ETimeScale, startViteServer, watchProblems, type E2EServer, type PageProblems } from '../support/e2e';

const STEP_TIMEOUT = 20 * 60_000;
let server: E2EServer;
let browser: Browser;
let page: Page;
let problems: PageProblems;

type Probe = { mode: string; phase: string; x: number; y: number; t: number; boss: string | null; screen: string | null };

function probe(p: Page): Promise<Probe | null> {
  return p.evaluate(() => {
    const w = window as unknown as { pacific?: { app: { mode: string; ui: { screenOpen: string | null } }; state: { phase: string; t: number; player: { x: number; y: number }; boss: { stage: string } | null } } };
    const g = w.pacific;
    if (!g) return null;
    const s = g.state;
    return { mode: g.app.mode, phase: s.phase, x: s.player.x, y: s.player.y, t: s.t, boss: s.boss?.stage ?? null, screen: g.app.ui.screenOpen };
  });
}

async function waitFor(p: Page, pred: (s: Probe) => boolean, what: string, ms = 15_000): Promise<Probe> {
  const t0 = Date.now();
  let last: Probe | null = null;
  for (;;) {
    last = await probe(p);
    if (last && pred(last)) return last;
    if (Date.now() - t0 > ms * e2eTimeScale()) throw new Error(`timed out waiting for ${what}; last = ${JSON.stringify(last)}`);
    await p.waitForTimeout(100);
  }
}

beforeAll(async () => {
  [server, browser] = await Promise.all([startViteServer(), launchChrome()]);
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const gpu = await detectGpu(page);
  if (gpu.software) setE2ETimeScale(Math.max(e2eTimeScale(), 8));
  problems = watchProblems(page);
  await page.goto(`${server.url}pacific.html?mute=1`, { waitUntil: 'load' });
  await waitFor(page, (s) => s.mode === 'title', 'the title screen', 60_000);
}, STEP_TIMEOUT);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('Pacific 1942 in Chrome', () => {
  it('has its title, the title screen and the attract demo behind it', async () => {
    expect(await page.title()).toBe('Bắn Máy Bay · Pacific 1942');
    expect(await page.locator('.pz-logo h1').textContent()).toBe('BẮN MÁY BAY');
    expect(await page.locator('.pz-lv').count()).toBe(10);
    // The demo runs: the autopilot's game time advances.
    const a = await probe(page);
    await page.waitForTimeout(1500 * e2eTimeScale());
    const b = await probe(page);
    expect(b!.t + (b!.phase === 'intro' ? 1 : 0)).toBeGreaterThan(a!.t);
  }, STEP_TIMEOUT);

  it('Xuất kích → the Pearl Harbor briefing → Enter → flying', async () => {
    await page.locator('.pz-go').first().click();
    await waitFor(page, (s) => s.mode === 'brief', 'the briefing');
    expect(await page.locator('.pz-screen.on h2').textContent()).toBe('Trân Châu Cảng');
    await page.keyboard.press('Enter');
    await waitFor(page, (s) => s.mode === 'play' && s.phase === 'waves', 'the waves', 30_000);
  }, STEP_TIMEOUT);

  it('the arrow keys fly the aircraft', async () => {
    const before = await probe(page);
    await page.keyboard.down('ArrowLeft');
    await waitFor(page, (s) => s.x < before!.x - 3, 'the aircraft moving left', 20_000);
    await page.keyboard.up('ArrowLeft');
  }, STEP_TIMEOUT);

  it('P pauses (the game time stops) and P resumes', async () => {
    await page.keyboard.press('KeyP');
    const p = await waitFor(page, (s) => s.mode === 'pause' && s.screen === 'pause', 'the pause screen');
    await page.waitForTimeout(800 * e2eTimeScale());
    const q = await probe(page);
    expect(q!.t).toBe(p.t);
    await page.keyboard.press('KeyP');
    await waitFor(page, (s) => s.mode === 'play' && s.screen === null, 'play again');
  }, STEP_TIMEOUT);

  it('Okinawa: the autopilot meets the Yamato', async () => {
    await page.goto(`${server.url}pacific.html?mute=1&level=10&play=1&god=1&auto=1`, { waitUntil: 'load' });
    await waitFor(page, (s) => s.mode === 'play' && s.phase === 'waves', 'level 10 waves', 60_000);
    await page.evaluate(() => (window as unknown as { pacific: { skipToBoss(): void } }).pacific.skipToBoss());
    await waitFor(page, (s) => s.boss === 'fight', 'the Yamato fighting', 60_000);
    expect(await page.locator('.pz-boss.on .n').textContent()).toMatch(/Yamato/);
  }, STEP_TIMEOUT);

  it('no page errors, console errors or failed requests', () => {
    expect(problems.all()).toEqual([]);
  });
});
