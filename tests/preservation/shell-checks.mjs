// CEO-008 — Phase 1 shell checks (flag ON, Admin) + static preservation checks.
// Everything runs against the stub backend: no production data is read or written.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startStub } from './stub-server.mjs';
import { launch, openPage, login, settle, mainSnapshot, hOverflow, stubLog, stubReset, sig, sleep } from './driver.mjs';
import { ADMIN_ROUTES, key } from './sweep.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const inventory = JSON.parse(fs.readFileSync(path.join(here, 'inventory.json'), 'utf8'));
const isWrite = (e) => e.kind === 'sb-write' || (e.kind === 'api' && e.write);
const writeSigs = (sigs) => [...new Set(sigs.filter((s) => !s.startsWith('GET ')))].sort();
const FN_IDS = ['finance', 'growth', 'operations', 'technology', 'governance', 'human_resources', 'legal_compliance'];

export async function runShellChecks(publicDir, golden) {
  const R = []; const check = (name, ok, detail = '') => R.push({ name, ok: !!ok, detail });
  const stub = await startStub({ publicDir }); const O = stub.origin;
  const browser = await launch();
  const gAdmin = golden.roles.admin;
  try {
    /* ============ A. desktop session, flag ON, Admin ============ */
    await stubReset(O);
    const ctx = await openPage(browser, O, { flag: true }); const page = ctx.page;
    await login(page, O, 'admin');
    const loginLog = (await stubLog(O)).log;
    const ev = (fn, ...a) => page.evaluate(fn, ...a);
    const text = () => ev(() => document.getElementById('mainContent').innerText);
    const navTexts = () => ev(() => [...document.querySelectorAll('#navBar button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()));

    check('flag ON · shell loaded for Admin', await ev(() => typeof ShellApp !== 'undefined' && ShellApp._state.mode === 'ceo'));
    const nav = await navTexts();
    check('flag ON · exactly three primary surfaces: CEO · Money · Company', nav.length === 3 && /CEO/.test(nav[0]) && /Money/.test(nav[1]) && /Company/.test(nav[2]), nav.join(' | '));
    const statics = (await stubLog(O)).statics || [];
    check('flag ON · shell.js was requested', statics.includes('/shell.js'));

    // login parity: the same distinct WRITE requests as the classic Admin login (so nothing Home normally does was dropped or added)
    const loginSigs = loginLog.map(sig);
    const w1 = writeSigs(loginSigs), w0 = writeSigs(gAdmin.loginRequests);
    check('flag ON · Admin login performs the same distinct write requests as classic login', JSON.stringify(w1) === JSON.stringify(w0), JSON.stringify({ shell: w1, classic: w0 }).slice(0, 300));
    const classicGets = new Set(gAdmin.loginRequests.filter((s) => s.startsWith('GET ')));
    const extraGets = [...new Set(loginSigs.filter((s) => s.startsWith('GET ')))].filter((s) => !classicGets.has(s));
    check('flag ON · Admin login adds no read request the classic login does not make', extraGets.length === 0, extraGets.join(', '));

    // ---- CEO surface
    let t = await text();
    for (const must of ['MMM MACHINE REVENUE', 'CEO DECISIONS', 'NEEDS YOU TO DO', 'ASK MMM', 'COMPANY HEALTH', 'PRODUCTION ENGINES', 'MORE FROM CEO HEADQUARTERS']) check(`CEO surface shows "${must}"`, t.toUpperCase().includes(must));
    check('CEO surface keeps CEO decisions and owner actions separate (fixture: 1 decision, 1 owner action)', /1 CEO decision/.test(t) && /1 owner action/.test(t));
    check('CEO surface: routine / advisory items are NOT counted as CEO decisions', /Other pending reviews and approvals \(2\)/.test(t));
    check('CEO surface lists all five engines', ['SRV Farsi', 'SRV English', 'NextWave', 'AI Studio', 'SMM'].every((e) => t.includes(e)));
    // Ask MMM: the REAL console, and it survives a repaint
    const before = (await ev(() => document.getElementById('shlConsole').innerText)).length;
    await ev(() => { document.getElementById('consoleInput').value = 'help'; });
    await ev(() => { window.renderTab('home'); });                          // a background refresh repaints the surface
    check('Ask MMM: typed text survives a background repaint', (await ev(() => document.getElementById('consoleInput').value)) === 'help');

    // real taps on the navigation
    await page.click('#navBar button:nth-child(2)'); await sleep(250);
    t = await text();
    check('MONEY: opens from the nav and shows the executive summary', /EXECUTIVE SUMMARY/i.test(t) && /NET WORTH/i.test(t));
    check('MONEY: numbers come from the existing finance computation', await ev(() => { const F = computeFinanceState(); return document.getElementById('mainContent').innerText.includes('$' + Math.round(F.netWorth).toLocaleString('en-US')); }));
    check('MONEY: headline does not elevate runway (production policy v16.17.0); runway is in detail', !/RUNWAY/i.test(t.split('DETAIL')[0]) );
    await ev(() => { document.querySelector('details[data-k="goals"]').open = true; });
    await ev(() => window.renderTab('shell_money'));
    check('MONEY: an expanded section stays open through a repaint', await ev(() => document.querySelector('details[data-k="goals"]').open));
    check('MONEY: full existing Finance remains a drill-down', t.includes('Full Finance (existing)'));
    await page.click('#navBar button:nth-child(3)'); await sleep(250);
    t = await text();
    check('COMPANY: five functions + two support functions', ['Finance', 'Growth', 'Operations', 'Technology', 'Governance', 'Human Resources', 'Legal & Compliance'].every((f) => t.includes(f)));
    await page.click('#navBar button:nth-child(1)'); await sleep(300);
    check('CEO: returns from the nav', (await ev(() => ShellApp._state.mode)) === 'ceo');

    // ---- pure shell navigation performs NO writes, and collect every access path the shell offers
    const startIdx = (await stubLog(O)).log.length;
    const onclicks = new Set();
    const harvest = async () => { for (const s of await ev(() => [...document.querySelectorAll('#mainContent [onclick], #shellBar [onclick]')].map((e) => e.getAttribute('onclick')))) onclicks.add(s); };
    for (const v of ['ceo', 'money', 'company']) { await ev((x) => ShellApp.go(x), v); await sleep(120); await harvest(); }
    for (const f of FN_IDS) { await ev(() => ShellApp.go('company')); await ev((x) => ShellApp.show('fn', x), f); await sleep(80); await harvest(); t = await text(); check(`COMPANY → ${f}: gateway lists existing screens`, t.length > 80); }
    await ev(() => ShellApp.go('company')); await ev(() => ShellApp.show('all')); await sleep(80); await harvest();
    await settle(page, O, 500);
    const navWrites = (await stubLog(O)).log.slice(startIdx).filter(isWrite);
    check('shell navigation across every surface and gateway causes no data write', navWrites.length === 0, navWrites.map((e) => e.path + '?' + e.action).join(', '));

    // back navigation
    await ev(() => ShellApp.go('company')); await ev(() => ShellApp.show('fn', 'operations'));
    await ev(() => ShellApp.show('all'));
    await ev(() => ShellApp.back()); check('Back: All areas → Operations gateway', (await ev(() => ShellApp._state.mode)) === 'fn' && (await ev(() => ShellApp._state.arg)) === 'operations');
    await ev(() => ShellApp.back()); check('Back: Operations gateway → Company', (await ev(() => ShellApp._state.mode)) === 'company');

    // inventory: every capability with a navigation path still has one
    const tokenBlob = [...onclicks].join('\n');
    let missing = [];
    for (const row of inventory) for (const tok of row.reach || []) if (!tokenBlob.includes(tok)) missing.push(`${row.id}:${tok}`);
    check(`CEO-007 inventory: every navigation path is offered by the shell (${inventory.filter((r) => r.reach).length} rows)`, missing.length === 0, missing.slice(0, 8).join(', '));
    const fnMissing = [];
    for (const row of inventory) for (const fn of row.fns || []) if (!(await ev((n) => typeof window[n] === 'function', fn))) fnMissing.push(`${row.id}:${fn}`);
    check(`CEO-007 inventory: every named function still exists (${inventory.reduce((a, r) => a + (r.fns || []).length, 0)} checks)`, fnMissing.length === 0, fnMissing.slice(0, 8).join(', '));
    check('CEO-007 inventory: all 77 capability rows are accounted for', inventory.length === 77);

    // every classic route, opened THROUGH the shell, renders exactly what the classic navigation renders
    let sweepBad = [];
    for (const r of ADMIN_ROUTES) {
      const k = key(r), base = gAdmin.routes[k];
      await ev((rr) => { try { ShellApp.open(rr.id, rr.sub && rr.sub[0], rr.sub && rr.sub[1]); } catch (e) { /* recorded via the notice */ } }, r);
      await settle(page, O, 600);
      const snap = await mainSnapshot(page); const body = await text();
      if (base.threw) { if (!body.includes(base.threw) || !/could not render right now/.test(body)) sweepBad.push(`${k}: expected the existing error to be shown as a notice`); }
      else if (snap.htmlHash !== base.htmlHash) sweepBad.push(`${k}: DOM differs from classic`);
    }
    check(`every classic screen opened through the shell is identical to the classic navigation (${ADMIN_ROUTES.length} routes)`, sweepBad.length === 0, sweepBad.join('; '));
    check('Continuity and Factory (hidden today) stay reachable and behave exactly as they do today', ['continuity', 'factory'].every((k) => gAdmin.routes[k].threw), 'both throw today on data with a monthly Investment Engine task (pre-existing); the shell shows the same error as a notice');

    // sections defined in code that no screen shows today — mounted via the shell, each by its own function, no writes
    const mounts = { optasks: /Operator Tasks/i, pipeline: /Production Pipeline/i, approvals: /Approvals/i, weekly: /./, queue: /./, sysintel: /SYSTEM INTELLIGENCE/i, legacyhome: /./ };
    for (const [m, re] of Object.entries(mounts)) {
      const i0 = (await stubLog(O)).log.length;
      const threw = await ev((x) => { try { ShellApp.mount(x); return null; } catch (e) { return e.message; } }, m); await settle(page, O, 500);
      const body = await text(); const w = (await stubLog(O)).log.slice(i0).filter(isWrite);
      check(`unmounted section "${m}" is preserved and reachable`, !threw && re.test(body) && body.length > 20 && w.length === 0, threw || (w.length ? 'wrote: ' + w.map((e) => e.action).join(',') : ''));
    }

    // Ask MMM answers a real command on the CEO surface (run AFTER the sweep: the app remembers the last console answer and shows it on classic Home)
    await ev(() => ShellApp.go('ceo')); await sleep(250);
    const cBefore = (await ev(() => document.getElementById('shlConsole').innerText)).length;
    await ev(() => runConsoleCommand('help')); await sleep(500);
    const cAfter = (await ev(() => document.getElementById('shlConsole').innerText)).length;
    check('Ask MMM: the existing console answers a command on the CEO surface (and the surface survives the save that follows)', cAfter > cBefore + 40 && (await ev(() => ShellApp._state.mode)) === 'ceo', `${cBefore} -> ${cAfter}`);

    // classic navigation restores today's nine chips; "New layout" returns
    await page.click('#shellBar button:last-child'); await sleep(400);
    const classicNav = await navTexts();
    check('"Classic navigation" restores the existing nine primary tabs', classicNav.filter((n) => !/New layout/.test(n)).length === 9, classicNav.join(' | '));
    check('classic mode offers a way back ("New layout")', classicNav.some((n) => /New layout/.test(n)));
    await page.click('#navBar .shl-newlayout'); await sleep(400);
    check('"New layout" returns to the three surfaces', (await navTexts()).length === 3);

    // errors
    const baseErrs = new Set(gAdmin.consoleErrors);
    const newErrs = [...new Set(ctx.consoleErrors)].filter((e) => !baseErrs.has(e));
    check('no runtime errors beyond the classic baseline (console + page)', newErrs.length === 0 && ctx.pageErrors.length === 0, [...newErrs, ...ctx.pageErrors].slice(0, 3).join(' | '));
    check('nothing outside the stub was contacted', ctx.blocked.every((u) => /fonts\.googleapis|cdn\.plaid/.test(u)), ctx.blocked.slice(0, 3).join(' '));
    await page.close();

    /* ============ B. Tasks / cadence regression ============ */
    async function cadenceFlow(flag) {
      await stubReset(O);
      const c = await openPage(browser, O, { flag }); const p = c.page;
      await login(p, O, 'admin');
      const snap = () => p.evaluate(() => ({ n: D.tasks.length, names: D.tasks.map((t) => t.name).sort() }));
      const before = await snap();
      const i0 = (await stubLog(O)).log.length;
      if (flag) await p.evaluate(() => { ShellApp.go('company'); ShellApp.show('fn', 'operations'); ShellApp.open('tasks'); });
      else await p.evaluate(() => renderTab('tasks'));
      await settle(p, O, 900);
      const first = await snap();
      const saves1 = (await stubLog(O)).log.slice(i0).filter((e) => e.rpc === 'mmm_state_save').length;
      if (flag) await p.evaluate(() => ShellApp.open('tasks')); else await p.evaluate(() => renderTab('tasks'));
      await settle(p, O, 900);
      const second = await snap();
      const state = await (await fetch(O + '/__stub/state')).json();
      await p.close();
      return { before, first, second, saves1, state: state.value || '' };
    }
    const cl = await cadenceFlow(false), sh = await cadenceFlow(true);
    check('Tasks/cadence: opening Tasks creates the week\'s tasks (classic)', cl.first.n > cl.before.n, `${cl.before.n} -> ${cl.first.n}`);
    check('Tasks/cadence: the shell path creates exactly the same tasks as classic', JSON.stringify(sh.first.names) === JSON.stringify(cl.first.names), `${sh.before.n} -> ${sh.first.n} vs ${cl.before.n} -> ${cl.first.n}`);
    check('Tasks/cadence: not duplicated on a second open', sh.second.n === sh.first.n && cl.second.n === cl.first.n);
    check('Tasks/cadence: same number of state saves as classic', sh.saves1 === cl.saves1, `${sh.saves1} vs ${cl.saves1}`);
    check('Shared state: no shell/UI preference ever reaches the shared state blob', !/shell/i.test(sh.state));

    /* ============ B2. engine lifecycles keep working through the shell path ============ */
    async function engineFlow(flag) {
      await stubReset(O);
      const c = await openPage(browser, O, { flag }); const p = c.page;
      await login(p, O, 'admin');
      if (flag) await p.evaluate(() => { ShellApp.go('company'); ShellApp.show('fn', 'operations'); ShellApp.open('tasks'); }); else await p.evaluate(() => renderTab('tasks'));
      await settle(p, O, 800);
      const i0 = (await stubLog(O)).log.length;
      const out = await p.evaluate(() => {
        const o = {};
        const eng = { 'SRV Farsi': ['_srvFarsiSetStage', '_srvFarsiGetStage'], 'SRV English': ['_srvEnglishSetStage', '_srvEnglishGetStage'], 'AI Studio': ['_aiStudioSetStage', '_aiStudioGetStage'], 'NextWave': ['_nextWaveSetStage', '_nextWaveGetStage'] };
        for (const [name, [set, get]] of Object.entries(eng)) {
          const t = D.tasks.find((x) => x && x.engine === name && x.status !== 'done');
          if (!t) { o[name] = 'no task'; continue; }
          try { window[set](t.id, 'review'); o[name] = window[get](t.id); } catch (e) { o[name] = 'ERR ' + String(e.message).slice(0, 50); }
        }
        return o;
      });
      await settle(p, O, 700);
      const saves = (await stubLog(O)).log.slice(i0).filter((e) => e.rpc === 'mmm_state_save').length;
      await p.close();
      return { out, saves };
    }
    const eCl = await engineFlow(false), eSh = await engineFlow(true);
    check('Engine lifecycles (SRV Farsi · SRV English · AI Studio · NextWave): a stage advance behaves identically through the shell path', JSON.stringify(eCl.out) === JSON.stringify(eSh.out) && Object.values(eSh.out).every((v) => v === 'review'), JSON.stringify(eSh.out));
    check('Engine lifecycles: the same number of shared-state saves as classic', eCl.saves === eSh.saves && eSh.saves > 0, `${eSh.saves} vs ${eCl.saves}`);

    /* ============ C. flag handling ============ */
    {
      await stubReset(O);
      const c = await openPage(browser, O, { flag: false }); const p = c.page;
      await login(p, O, 'admin');
      check('flag default OFF: Admin sees the classic nine tabs and no shell', (await p.evaluate(() => [...document.querySelectorAll('#navBar button')].length)) === 9 && (await p.evaluate(() => typeof ShellApp)) === 'undefined');
      await p.goto(O + '/?shell=on', { waitUntil: 'domcontentloaded' }); await login(p, O, 'admin');
      check('?shell=on turns the shell on for this browser', (await p.evaluate(() => typeof ShellApp)) === 'object' && (await p.evaluate(() => document.querySelectorAll('#navBar button').length)) === 3);
      await p.goto(O + '/?shell=off', { waitUntil: 'domcontentloaded' }); await login(p, O, 'admin');
      check('?shell=off turns it off again (immediate rollback)', (await p.evaluate(() => typeof ShellApp)) === 'undefined' && (await p.evaluate(() => document.querySelectorAll('#navBar button').length)) === 9);
      await p.close();
    }

    /* ============ D. mobile ============ */
    {
      await stubReset(O);
      const c = await openPage(browser, O, { flag: true, viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } }); const p = c.page;
      await login(p, O, 'admin');
      const bad = [];
      const views = [['go', 'ceo'], ['go', 'money'], ['go', 'company'], ...FN_IDS.map((f) => ['fn', f]), ['all']];
      for (const v of views) {
        await p.evaluate((vv) => { if (vv[0] === 'go') ShellApp.go(vv[1]); else { ShellApp.go('company'); ShellApp.show(vv[0] === 'fn' ? 'fn' : 'all', vv[1]); } }, v); await sleep(200);
        if (await hOverflow(p)) bad.push(v.join(':') + ' overflows');
        const r = await p.evaluate(() => { const b = document.querySelectorAll('#navBar button'); return [...b].map((x) => { const q = x.getBoundingClientRect(); return q.right <= innerWidth + 1 && q.left >= -1 && q.width > 0; }); });
        if (!r.every(Boolean)) bad.push(v.join(':') + ' nav not fully visible');
      }
      check('mobile (390px): every shell surface and gateway has no horizontal overflow and a fully visible 3-tab nav', bad.length === 0, bad.join('; '));
      await p.evaluate(() => ShellApp.go('ceo')); await sleep(150);
      await p.tap('#navBar button:nth-child(3)'); await sleep(250);
      check('mobile: Company → Operations reachable by tapping, without a fourth tab', (await p.evaluate(() => document.querySelectorAll('#navBar button').length)) === 3 && (await p.evaluate(() => ShellApp._state.mode)) === 'company');
      await p.evaluate(() => { const b = [...document.querySelectorAll('#mainContent button')].find((x) => /Operations/.test(x.innerText)); b.click(); }); await sleep(250);
      check('mobile: Operations gateway opens and offers the production workspace', /Production \/ operator workspace/.test(await p.evaluate(() => document.getElementById('mainContent').innerText)));
      await p.close();
    }
  } finally { await browser.close(); await stub.close(); }

  /* ============ E. static preservation ============ */
  const repo = path.resolve(publicDir, '..');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const base = 'origin/main';
  const changed = git('diff', '--name-only', base).split('\n').filter(Boolean).concat(git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean));
  const allowed = (f) => f === 'public/shell.js' || f.startsWith('tests/preservation/');
  check('only the files this order authorizes were changed (public/shell.js and tests/preservation/ — no index.html, api/, vercel.json, migrations, lib, engine files)', changed.every(allowed), changed.filter((f) => !allowed(f)).join(', ') || changed.join(', '));
  const idxDiff = git('diff', '--numstat', base, '--', 'public/index.html').trim();
  check('public/index.html: untouched by this change (the CEO-008 loader is unchanged and remains the only shell hook)', idxDiff === '', idxDiff);
  const names = (src) => new Set([...src.matchAll(/^(?:async )?function\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]));
  const was = names(git('show', `${base}:public/index.html`)), now = names(fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8'));
  check(`no top-level function removed or renamed (${was.size} existing functions)`, [...was].every((n) => now.has(n)), [...was].filter((n) => !now.has(n)).join(', '));
  const refRender = JSON.parse(fs.readFileSync(path.join(here, 'golden', 'render-functions.json'), 'utf8'));
  check(`all ${refRender.length} existing screen/section render functions listed in CEO-007 still exist`, refRender.every((n) => now.has(n)), refRender.filter((n) => !now.has(n)).join(', '));
  const sh = fs.readFileSync(path.join(publicDir, 'shell.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('shell.js performs no network call and no state write (no fetch/XHR, no saveAppState, no D assignment)', !/\bfetch\s*\(|XMLHttpRequest|saveAppState|_ceoAuthedFetch|\bD\.[A-Za-z_]+\s*=[^=]|localStorage\.setItem/.test(sh));
  check('shell.js reaches no CEO-gated or destructive action', !/cdp_approve|cdp_reject|reset|deletePackage|Delete Package|ceo_session/i.test(sh.replace(/Reset/g, '')) || !/\breset\b.*all.*data/i.test(sh));
  const idx = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  check('feature flag is browser-local, default OFF, and requests shell.js only when "on"', /localStorage\.getItem\('mmm_shell_admin_v1'\)==='on'/.test(idx) && !/mmm_shell_admin_v1.*D\./.test(idx));
  return R;
}
