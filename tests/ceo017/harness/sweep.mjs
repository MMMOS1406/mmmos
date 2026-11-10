// CEO-008 Phase 0 — route sweep. Renders every classic route as each role against the stub and records, per route,
// a hash of the rendered DOM, the visible text, runtime errors, and the exact requests the app made.
import { startStub } from './stub-server.mjs';
import { launch, openPage, login, settle, mainSnapshot, hOverflow, stubLog, stubReset, sig } from './driver.mjs';

// Every classic route the production router can render. Order matters (cadence runs on first admin Tasks render).
export const ADMIN_ROUTES = [
  { id: 'home' }, { id: 'finance' }, { id: 'tasks' },
  { id: 'engines', sub: ['setEnginesSub', 'overview'] }, { id: 'engines', sub: ['setEnginesSub', 'analytics'] }, { id: 'engines', sub: ['setEnginesSub', 'packages'] },
  { id: 'marketing' }, { id: 'human_resources' }, { id: 'legal_compliance' },
  { id: 'system', sub: ['setSystemSub', 'settings'] }, { id: 'system', sub: ['setSystemSub', 'integrations'] },
  { id: 'system', sub: ['setSystemSub', 'engineering'] }, { id: 'system', sub: ['setSystemSub', 'brain_validation'] },
  { id: 'social_media_manager' },
  // hidden / legacy routes (reachable today only by calling the router)
  { id: 'constitution' }, { id: 'continuity' }, { id: 'factory' }, { id: 'packages' }, { id: 'analytics' }, { id: 'integrations' }, { id: 'settings' },
];
export const FAMILY_ROUTES = [{ id: 'home' }, { id: 'finance' }, { id: 'engines', sub: ['setEnginesSub', 'overview'] }];
export const VA_ROUTES = [{ id: 'tasks' }];
export const key = (r) => (r.sub ? `${r.id}:${r.sub[1]}` : r.id);

/** Render one role's routes. Returns {routes, errors, requests, overflow}. */
export async function sweepRole(browser, stub, role, routes, opts = {}) {
  await stubReset(stub.origin);
  const { page, consoleErrors, pageErrors, blocked } = await openPage(browser, stub.origin, opts);
  await login(page, stub.origin, role);
  const out = { routes: {}, loginRequests: (await stubLog(stub.origin)).log.map(sig) };
  for (const r of routes) {
    const before = (await stubLog(stub.origin)).log.length;
    const e0 = consoleErrors.length + pageErrors.length;
    const threw = await page.evaluate((route) => {
      try { renderTab(route.id); if (route.sub) { window[route.sub[0]](route.sub[1]); } return null; }
      catch (e) { return String(e && e.message).slice(0, 160); }
    }, r);
    await settle(page, stub.origin, 700);
    const snap = await mainSnapshot(page);
    const log = (await stubLog(stub.origin)).log.slice(before).map(sig);
    out.routes[key(r)] = { threw, ...snap, requests: log, errors: consoleErrors.slice(e0).concat(pageErrors.slice(Math.max(0, e0 - consoleErrors.length))) };
  }
  out.statics = (await stubLog(stub.origin)).statics || [];
  out.overflow = await hOverflow(page);
  out.consoleErrors = consoleErrors; out.pageErrors = pageErrors; out.blockedExternal = blocked;
  out.finalTaskCount = await page.evaluate(() => (typeof D !== 'undefined' && D.tasks ? D.tasks.length : -1));
  await page.close();
  return out;
}

export async function sweepAll(publicDir, opts = {}) {
  const stub = await startStub({ publicDir });
  const browser = await launch();
  try {
    const result = {};
    result.admin = await sweepRole(browser, stub, 'admin', ADMIN_ROUTES, opts);
    result.family = await sweepRole(browser, stub, 'family', FAMILY_ROUTES, opts);
    result.va = await sweepRole(browser, stub, 'va', VA_ROUTES, opts);
    result.unknownApi = [...stub.unknown];
    return result;
  } finally { await browser.close(); await stub.close(); }
}
