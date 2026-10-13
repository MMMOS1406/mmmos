// CEO-010 — role-switching safety regression checks (defect F-1 from CEO-009).
// An Admin uses the CEO / Money / Company shell, logs out, and another user signs in WITHOUT reloading the page.
// The previous user's shell navigation, state and content must not remain visible or reachable.
// Everything runs against the stub backend: no production data is read or written.
import { startStub } from './stub-server.mjs';
import { launch, openPage, login, settle, mainSnapshot, hOverflow, stubLog, stubReset, sig, sleep } from './driver.mjs';

const isWrite = (e) => e.kind === 'sb-write' || (e.kind === 'api' && e.write);
const SURF = ['ceo', 'money', 'company'];

/** Everything on the page that belongs to the shell's presentation. For a non-Admin it must be empty. */
const chromeOf = (page) => page.evaluate(() => ({
  bar: !!document.getElementById('shellBar'),
  shlNodes: document.querySelectorAll('[class*="shl-"]:not(style)').length,
  wide: document.getElementById('mainContent').classList.contains('shl-wide'),
  chip: !!document.querySelector('.shl-newlayout'),
  tab: typeof currentTab === 'string' ? currentTab : null,
  mode: window.ShellApp ? ShellApp._state.mode : 'no-shell',
  stack: window.ShellApp ? ShellApp._state.stack.length : 0,
  nav: [...document.querySelectorAll('#navBar button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()),
  user: typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null,
  classicKey: (() => { try { return sessionStorage.getItem('mmm_shell_classic'); } catch (e) { return 'ERR'; } })(),
}));
const clean = (c) => !c.bar && c.shlNodes === 0 && !c.wide && !c.chip && !/^shell_/.test(c.tab || '') && (c.mode === null || c.mode === 'no-shell') && c.stack === 0;
const logout = (page) => page.evaluate(() => logout());
/** What logout() does, minus the shell's own hook — proves the defence does not depend on one hook. */
const rawLogout = (page) => page.evaluate(() => { document.getElementById('loginScreen').style.display = 'flex'; document.getElementById('appScreen').classList.remove('show'); currentUser = null; });

export async function runRoleSwitchChecks(publicDir) {
  const R = []; const check = (name, ok, detail = '') => R.push({ name, ok: !!ok, detail });
  const stub = await startStub({ publicDir }); const O = stub.origin;
  const browser = await launch();
  try {
    // ---- references: what each role looks like on a fresh page with the shell flag OFF (today's behaviour)
    const ref = {};
    for (const role of ['admin', 'family', 'va']) {
      await stubReset(O);
      const c = await openPage(browser, O, { flag: false }); await login(c.page, O, role);
      ref[role] = { chrome: await chromeOf(c.page), snap: await mainSnapshot(c.page) };
      await c.page.close();
    }
    let lastDiff = '';
    const sameAsFresh = async (page, role) => {
      const c = await chromeOf(page), s = await mainSnapshot(page);
      const navSame = JSON.stringify(c.nav) === JSON.stringify(ref[role].chrome.nav), hashSame = s.htmlHash === ref[role].snap.htmlHash;
      if (!(navSame && hashSame)) {
        const a = ref[role].snap.text, b = s.text; let i = 0; while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
        lastDiff = `nav ${navSame ? 'same' : c.nav.join('|') + ' vs ' + ref[role].chrome.nav.join('|')}; html ${hashSame ? 'same' : 'differs'}; text@${i}: fresh «${a.slice(Math.max(0, i - 30), i + 60)}» vs now «${b.slice(Math.max(0, i - 30), i + 60)}»`;
      }
      return navSame && hashSame;
    };

    // ---- flag ON page; Admin works in the shell, in a way that leaves as much state behind as possible
    await stubReset(O);
    const ctx = await openPage(browser, O, { flag: true }); const page = ctx.page; const ev = (fn, ...a) => page.evaluate(fn, ...a);
    await login(page, O, 'admin');
    const seedAdmin = async (how) => {
      if (how === 'legacy') await ev(() => { ShellApp.go('company'); ShellApp.show('fn', 'operations'); ShellApp.open('finance'); });
      else if (how === 'all') await ev(() => { ShellApp.go('company'); ShellApp.show('all'); });
      else if (how === 'classic') await ev(() => ShellApp.classic());
      else if (how === 'money') await ev(() => ShellApp.go('money'));
      await sleep(250);
    };
    await seedAdmin('legacy');
    const adminChrome = await chromeOf(page);
    check('setup: the Admin session really has shell chrome to leave behind (bar, legacy mode, shell_* alias possible)', adminChrome.bar && adminChrome.mode === 'legacy' && adminChrome.stack > 0);

    // ===== 1. Admin → Logout → Family
    await logout(page); await sleep(150);
    let c = await chromeOf(page);
    check('1. Admin → logout: shell bar, shell state, wide layout and shell_* tab are all gone', clean(c), JSON.stringify(c).slice(0, 220));
    check('1. Admin → logout: nothing of the Admin\'s navigation or content stays in the hidden app screen', c.nav.length === 0 && (await ev(() => document.getElementById('mainContent').innerText.trim().length)) === 0);
    await login(page, O, 'family'); c = await chromeOf(page);
    check('1. Admin → logout → Family: Family sees exactly its own navigation and nothing from the shell', clean(c) && c.user === 'family' && (await sameAsFresh(page, 'family')), `nav=${c.nav.join('|')} tab=${c.tab} bar=${c.bar} shl=${c.shlNodes}`);

    // ===== 7. direct attempts, as Family, to reach shell routes / state
    const attempts = [
      ['ShellApp.go ceo', () => ShellApp.go('ceo')], ['ShellApp.go money', () => ShellApp.go('money')], ['ShellApp.go company', () => ShellApp.go('company')],
      ['ShellApp.show all', () => ShellApp.show('all')], ['ShellApp.show fn finance', () => ShellApp.show('fn', 'finance')], ['ShellApp.show fn operations', () => ShellApp.show('fn', 'operations')],
      ['ShellApp.open tasks', () => ShellApp.open('tasks')], ['ShellApp.open system/settings', () => ShellApp.open('system', 'setSystemSub', 'settings')], ['ShellApp.open continuity', () => ShellApp.open('continuity')],
      ['ShellApp.mount approvals', () => ShellApp.mount('approvals')], ['ShellApp.mount optasks', () => ShellApp.mount('optasks')], ['ShellApp.mount legacyhome', () => ShellApp.mount('legacyhome')],
      ['ShellApp.back', () => ShellApp.back()], ['ShellApp.classic', () => ShellApp.classic()], ['ShellApp.newLayout', () => ShellApp.newLayout()],
    ];
    const tabAttempts = ['shell_money', 'shell_company', 'shell_ceo', 'shell_fn', 'shell_all', 'shell_anything'];
    async function directAttempts(role, label) {
      const before = await mainSnapshot(page); const i0 = (await stubLog(O)).log.length; const bad = [];
      for (const [n, fn] of attempts) {
        const j0 = (await stubLog(O)).log.length;
        await ev((f) => { try { (new Function('return ' + f))()(); } catch (e) { /* denial may throw or no-op */ } }, fn.toString());
        const cc = await chromeOf(page); const after = await mainSnapshot(page);
        const reqs = (await stubLog(O)).log.slice(j0);
        if (!clean(cc)) bad.push(`${n}: shell chrome appeared`);
        if (after.htmlHash !== before.htmlHash) bad.push(`${n}: content changed`);
        if (reqs.length) bad.push(`${n}: ${reqs.length} request(s)`);
      }
      check(`7. ${label}: every direct ShellApp.* call is refused — nothing rendered, nothing requested (${attempts.length} calls)`, bad.length === 0, bad.slice(0, 4).join('; '));
      const bad2 = [];
      for (const t of tabAttempts) {
        await ev((x) => { try { renderTab(x); } catch (e) { /* ignore */ } }, t); await settle(page, O, 350);
        const cc = await chromeOf(page); if (!clean(cc)) bad2.push(`renderTab('${t}') -> shell chrome / alias (${cc.tab})`);
      }
      await ev(() => { try { syncState(); } catch (e) { /* ignore */ } }); await settle(page, O, 300);
      if (!clean(await chromeOf(page))) bad2.push('syncState -> shell chrome');
      const writes = (await stubLog(O)).log.slice(i0).filter(isWrite);
      check(`7. ${label}: renderTab('shell_*') and syncState never produce shell content or a shell_* tab`, bad2.length === 0, bad2.slice(0, 4).join('; '));
      check(`7. ${label}: no write request came from any of those attempts`, writes.length === 0, writes.map((e) => e.action || e.rpc).join(','));
      { const ok = await sameAsFresh(page, role); check(`7. ${label}: ${role} still sees exactly its own workspace afterwards`, ok, ok ? '' : lastDiff); }
    }
    await directAttempts('family', 'Family');

    // ===== 2. Admin → Logout → VA   (and VA direct attempts)
    await logout(page); await sleep(150);
    await login(page, O, 'admin'); await seedAdmin('all'); await logout(page); await sleep(150);
    await login(page, O, 'va'); c = await chromeOf(page);
    check('2. Admin → logout → VA: VA sees exactly its own navigation and nothing from the shell', clean(c) && c.user === 'va' && (await sameAsFresh(page, 'va')), `nav=${c.nav.join('|')} tab=${c.tab} bar=${c.bar} shl=${c.shlNodes}`);
    await directAttempts('va', 'VA');

    // ===== 3 / 4. Family → Logout → Admin, VA → Logout → Admin
    for (const role of ['family', 'va']) {
      await logout(page); await sleep(150);
      await login(page, O, role); await logout(page); await sleep(150);
      await login(page, O, 'admin'); await sleep(300); c = await chromeOf(page);
      check(`${role === 'family' ? 3 : 4}. ${role === 'family' ? 'Family' : 'VA'} → logout → Admin: Admin gets the three surfaces on the CEO view, with no ${role} content`, c.user === 'admin' && c.nav.length === 3 && /CEO/.test(c.nav[0]) && c.mode === 'ceo' && c.stack === 0, `nav=${c.nav.join('|')} mode=${c.mode}`);
      check(`${role === 'family' ? 3 : 4}. Admin role is fully intact afterwards (all surfaces and the shell bar work)`, await ev(() => { try { ShellApp.go('money'); ShellApp.go('company'); ShellApp.show('all'); ShellApp.go('ceo'); return ShellApp._state.mode === 'ceo' && document.getElementById('mainContent').innerText.includes('MACHINE REVENUE'); } catch (e) { return false; } }));
    }

    // ===== 5. Admin → Logout → Admin: previous Admin view / history must not be resumed
    await seedAdmin('legacy'); await ev(() => { sessionStorage.setItem('mmm_shell_classic', '1'); });
    await logout(page); await sleep(150);
    c = await chromeOf(page);
    check('5. Admin → logout: the per-tab "classic navigation" preference is cleared too', c.classicKey === null && clean(c), `classicKey=${c.classicKey}`);
    await login(page, O, 'admin'); await sleep(300); c = await chromeOf(page);
    check('5. Admin → logout → Admin: lands on the CEO surface with an empty history (previous view is not resumed)', c.mode === 'ceo' && c.stack === 0 && c.nav.length === 3 && !/^shell_(fn|all)/.test(c.tab || ''), `mode=${c.mode} stack=${c.stack} tab=${c.tab}`);

    // ===== 6. repeated switching, every step checked
    const seq = ['family', 'admin', 'va', 'admin', 'family', 'va', 'family', 'admin', 'va', 'admin', 'admin', 'family'];
    const badSeq = []; let prev = 'admin';
    for (const role of seq) {
      if (prev === 'admin') await seedAdmin(['legacy', 'all', 'money', 'classic'][badSeq.length % 4]);
      await logout(page); await sleep(100); const lo = await chromeOf(page); if (!clean(lo)) badSeq.push(`after logout of ${prev}: not clean`);
      await login(page, O, role); await sleep(200); const cc = await chromeOf(page);
      if (role === 'admin') { if (!(cc.nav.length === 3 && cc.mode === 'ceo' && cc.stack === 0)) badSeq.push(`admin after ${prev}: ${cc.nav.join('|')} mode=${cc.mode}`); }
      else { if (!clean(cc) || cc.user !== role) badSeq.push(`${role} after ${prev}: chrome leaked ${JSON.stringify(cc).slice(0, 120)}`); else if (!(await sameAsFresh(page, role))) badSeq.push(`${role} after ${prev}: differs from a fresh ${role} session`); }
      prev = role;
    }
    check(`6. repeated role switching (${seq.length} transitions, Admin state seeded before each logout): every step is clean and correct`, badSeq.length === 0, badSeq.slice(0, 3).join(' | '));

    // ===== defence in depth: the shell must not depend on its own logout hook
    await login(page, O, 'admin').catch(() => {}); // no-op when already signed in as admin
    let st = await chromeOf(page); if (st.user !== 'admin') { await logout(page); await login(page, O, 'admin'); }
    await seedAdmin('legacy');
    await rawLogout(page); await sleep(150); c = await chromeOf(page);
    check('defence: even if logout() were bypassed, the shell removes the previous user\'s chrome as soon as the app screen closes', clean(c), JSON.stringify(c).slice(0, 200));
    await login(page, O, 'family'); c = await chromeOf(page);
    check('defence: …and a following Family sign-in is clean', clean(c) && c.user === 'family' && (await sameAsFresh(page, 'family')));

    // ===== 8. browser Back / bfcache restore after logout
    await logout(page); await login(page, O, 'admin'); await seedAdmin('all'); await logout(page);
    await ev(() => { const b = document.createElement('div'); b.id = 'shellBar'; b.className = 'shl-bar'; b.textContent = 'stale'; document.getElementById('appScreen').insertBefore(b, document.getElementById('mainContent')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await sleep(100); c = await chromeOf(page);
    check('8. page restored from the browser back/forward cache while logged out: stale shell chrome is removed', clean(c), JSON.stringify(c).slice(0, 160));
    const url = page.url(); await page.goto('about:blank'); await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}); await sleep(600);
    const afterBack = await ev(() => ({ login: getComputedStyle(document.getElementById('loginScreen')).display !== 'none', app: document.getElementById('appScreen').classList.contains('show'), bar: !!document.getElementById('shellBar') }));
    check('8. browser Back after logout: the login screen is shown and no shell chrome is present', afterBack.login && !afterBack.app && !afterBack.bar && page.url() === url, JSON.stringify(afterBack));
    await login(page, O, 'va'); c = await chromeOf(page);
    check('8. …and signing in as VA afterwards is clean', clean(c) && (await sameAsFresh(page, 'va')));
    check('no runtime errors on any of the role-switching pages beyond the classic baseline', ctx.pageErrors.length === 0, ctx.pageErrors.slice(0, 2).join(' | '));
    await page.close();

    // ===== 9. flag OFF with shell.js already present in the page (flag turned off mid-session): Admin gets classic, nothing stale
    {
      await stubReset(O);
      const x = await openPage(browser, O, { flag: true }); const p = x.page;
      await login(p, O, 'admin'); await p.evaluate(() => { ShellApp.go('company'); ShellApp.show('all'); });
      await p.evaluate(() => localStorage.removeItem('mmm_shell_admin_v1'));
      await p.evaluate(() => { renderNav(); renderTab('home'); }); await settle(p, O, 500);
      const cc = await chromeOf(p);
      check('9. shell flag turned OFF mid-session: Admin is back on the classic nine tabs with no shell chrome', clean(cc) && cc.nav.filter((n) => !/New layout/.test(n)).length === 9, `nav=${cc.nav.length} bar=${cc.bar}`);
      await p.evaluate(() => { try { ShellApp.show('all'); } catch (e) { /* refused */ } });
      check('9. …and ShellApp.* is refused while the flag is OFF', clean(await chromeOf(p)));
      await p.close();
    }

    // ===== 10. flag ON, authorised Admin session: shell still fully works (the existing 111 checks cover depth; spot-check here)
    {
      await stubReset(O);
      const x = await openPage(browser, O, { flag: true }); const p = x.page;
      await login(p, O, 'admin');
      const ok = await p.evaluate(() => { try { ShellApp.go('money'); ShellApp.go('company'); ShellApp.show('fn', 'operations'); ShellApp.open('tasks'); ShellApp.back(); ShellApp.show('all'); ShellApp.mount('approvals'); ShellApp.back(); ShellApp.classic(); const chip = !!document.querySelector('.shl-newlayout'); ShellApp.newLayout(); return chip && ShellApp._state.mode === 'ceo' && document.querySelectorAll('#navBar button').length === 3; } catch (e) { return String(e); } });
      check('10. flag ON, authorised Admin: every surface, drill-down, Back, Classic navigation and New layout still work', ok === true, String(ok));
      await p.close();
    }

    // ===== mobile (390px): Admin → logout → Family and → VA
    {
      await stubReset(O);
      const x = await openPage(browser, O, { flag: true, viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } }); const p = x.page;
      await login(p, O, 'admin'); await p.evaluate(() => { ShellApp.go('company'); ShellApp.show('fn', 'operations'); ShellApp.open('finance'); });
      const bad = [];
      for (const role of ['family', 'va', 'admin']) {
        await p.evaluate(() => logout()); await sleep(100); await login(p, O, role); await sleep(250);
        const cc = await chromeOf(p); const nav = await p.evaluate(() => [...document.querySelectorAll('#navBar button')].map((b) => { const q = b.getBoundingClientRect(); return q.right <= innerWidth + 1 && q.left >= -1; }));
        if (await hOverflow(p)) bad.push(`${role}: horizontal overflow`);
        if (role !== 'admin' && !clean(cc)) bad.push(`${role}: shell chrome leaked`);
        if (role === 'admin' && cc.nav.length !== 3) bad.push(`admin: nav=${cc.nav.length}`);
        if (!nav.every(Boolean)) bad.push(`${role}: nav not fully visible`);
        if (role === 'admin') await p.evaluate(() => { ShellApp.go('company'); ShellApp.show('fn', 'operations'); });
      }
      check('mobile (390px): Admin → Family → VA → Admin switching is clean, nothing overflows, and the nav is fully visible each time', bad.length === 0, bad.join('; '));
      await p.close();
    }
  } finally { await browser.close(); await stub.close(); }
  return R;
}
