// SRV Farsi P1 safety — behavioral tests against the REAL functions extracted from public/index.html:
// identity (A/B/C), per-task test mode (D/E/F), stuck-engine warning (H), other engines untouched (I).
// Analytics exclusion (G) is covered by tests/srv/test_srv_farsi_analytics_view.mjs (real Postgres).
// Run: node test_srv_farsi_p1_safety.cjs public/index.html
const fs=require('fs');
const h=fs.readFileSync(process.argv[2]||'public/index.html','utf8');
function fn(name){const m=h.match(new RegExp('\\n(async )?function '+name.replace(/\$/g,'\\$')+'\\('));if(!m)throw new Error('missing '+name);const s=m.index+1;return h.slice(s,h.indexOf('\n}\n',s)+2);}
function cst(name){const s=h.indexOf('const '+name+'=');if(s<0)throw new Error('missing const '+name);return h.slice(s,h.indexOf(';\n',s)+2);}
const NAMES=['_srvFarsiIsTask','_srvFarsiTaskUid','_srvFarsiTaskById','_srvFarsiTaskByUid','_srvFarsiTaskForPkg','_srvFarsiEnsureIdentity',
  '_srvFarsiIsTestTask','_srvFarsiStageMap','_srvFarsiGetStage','_srvFarsiSetStage','_srvFarsiPkgForTask','_srvFarsiCancelTask',
  '_srvFarsiStuckEngineStatus','_srvFarsiStuckEngineWarningHtml','engineWeeklyLoad','_engineNameMatches','_getEngineState','_setEngineState',
  '_isEnginePaused','_isoOfDay','_isoDateForDayName','_currentWeekIsoForDayName','_slotKey','_autoAssignChannelFor','_autoAssignPlatformFor',
  '_autoAssignContentTypeFor','autoCreateCadenceTasksForCurrentWeek','vaAddTestTask','_quickGenerateTest'];
const src=NAMES.map(fn).join('\n')+'\n'+cst('_AUTO_ASSIGN_TERMINAL');
let pass=0,fail=0;const out=[];const ok=(n,c,x)=>{c?pass++:fail++;out.push((c?'PASS ':'FAIL ')+n+(x?'  '+x:''));};
function world(){
  const W={D:{tasks:[],packages:[],srvFarsiLifecycleStages:{},cadenceAutoCreatedSlots:{},engineState:{},enginePaused:{}},nextCalls:0,peekCalls:0,saves:0,generated:[]};
  W.ENGINES_CONFIG=[
    {id:'srv_farsi',name:'SRV Farsi',type:'song',weeklyCapacity:3,cadenceDays:['Monday','Tuesday','Wednesday','Thursday'],longFormDay:'Friday',modes:['Female — Emotional']},
    {id:'nextwave',name:'NextWave',type:'video',weeklyCapacity:3,cadenceDays:['Monday','Tuesday','Wednesday'],modes:['Finance']}];
  const mods=['Male — Happy','Female — Romantic','Duet — Emotional','Male — Romantic'];
  const env={D:W.D,ENGINES_CONFIG:W.ENGINES_CONFIG,currentUser:(W.user={id:'admin'}),currentTab:'tasks',
    _srvFarsiNextMode:()=>mods[(W.nextCalls++)%mods.length],_srvFarsiPeekNextMode:()=>{W.peekCalls++;return mods[W.nextCalls%mods.length];},
    _srvFarsiBuildTrigger:()=>{},saveAppState:()=>{W.saves++;},saveData:()=>{W.saves++;},renderTab:()=>{},closeExec:()=>{},confirm:()=>true,
    vaFarsiGeneratePackage:id=>{W.generated.push(id);},openFactory:()=>{},alert:()=>{},escHTML:x=>String(x),vaFocusTaskId:undefined,
    console:{log(){},warn(){},error(){}},document:{getElementById:()=>({})},window:{scrollTo(){}},renderVAOperatorMode:()=>''};
  const api=new Function(...Object.keys(env),src+'\nreturn {'+NAMES.join(',')+'};')(...Object.values(env));
  Object.assign(W,api);W.asAdmin=()=>{W.user.id='admin';};return W;
}
const clone=o=>JSON.parse(JSON.stringify(o));
const srvTask=(id,createdAt,x={})=>({id,engine:'SRV Farsi',name:'SRV Farsi — Male — Happy · Short (auto-created)',mood:'Male — Happy',status:'assigned',createdAt,isoDate:'2026-10-01',...x});
const pkg=(taskId,engine,generatedAt,x={})=>({id:'pkg_'+Math.random().toString(36).slice(2),taskId,engine,generatedAt,...x});

// ── A. Identity is immutable and unique ─────────────────────────────────────
{
  const W=world();const t=srvTask(5,1790000000000);W.D.tasks.push(t,srvTask(7,1790000000500),{id:5,engine:'NextWave',createdAt:1790000000000});
  const u=W._srvFarsiTaskUid(t);
  ok('A: srvUid is deterministic from createdAt + id',u==='srvf_1790000000000_5',u);
  W._srvFarsiEnsureIdentity();
  ok('A: identity stamped on SRV tasks only',t.srvUid===u&&!W.D.tasks[2].srvUid);
  t.status='generating';t.mood='Duet — Romantic';t.name='renamed';W._srvFarsiEnsureIdentity();
  ok('A: identity immutable across edits and repeated stamping',W._srvFarsiTaskUid(t)===u&&t.srvUid===u);
  const reused=srvTask(5,1790099999999);
  ok('A: a reused numeric id gets a different identity',W._srvFarsiTaskUid(reused)!==u);
  ok('A: no identity without createdAt (unresolved, never invented)',W._srvFarsiTaskUid(srvTask(9,undefined))===null);
  ok('A: numeric lookup never returns another engine\'s task',W._srvFarsiTaskById(5)===t);
  W.D.tasks.push(srvTask(7,1790000000900));
  ok('A: duplicate SRV numeric ids -> refuse (null), never first-match',W._srvFarsiTaskById(7)===null);
}
// ── B. Package linkage cannot resolve the wrong task ───────────────────────
{
  const W=world();const created=Date.parse('2026-09-27T04:18:05Z');const t=srvTask(100,created);W.D.tasks.push(t);
  const aug=pkg(100,'SRV Farsi','2026-08-17T17:53:16Z',{isTest:true,youtube_video_id:'old'});   // August pkg, same numeric id
  const nw=pkg(100,'NextWave','2026-09-28T10:00:00Z');                                          // other engine, same id, later
  W.D.packages.push(aug,nw);
  ok('B: August package (predates task) never binds to the September task',W._srvFarsiPkgForTask(t)===null);
  const legacy=pkg(100,'SRV Farsi','2026-09-27T05:00:00Z');W.D.packages.push(legacy);
  ok('B: legacy package generated after task creation binds deterministically',W._srvFarsiPkgForTask(t)===legacy);
  const uidPkg=pkg(100,'SRV Farsi','2026-09-27T06:00:00Z',{srvTaskUid:W._srvFarsiTaskUid(t)});W.D.packages.push(uidPkg);
  ok('B: identity-stamped package wins',W._srvFarsiPkgForTask(t)===uidPkg);
  ok('B: other engine\'s package never returned',W._srvFarsiPkgForTask(t).engine==='SRV Farsi');
  // task 100 deleted, id reused later: the old stamped package must not follow the number
  W.D.tasks=[];const t2=srvTask(100,Date.parse('2026-10-05T00:00:00Z'));W.D.tasks.push(t2);
  ok('B: stamped package of a deleted task does not attach to the reused id',W._srvFarsiPkgForTask(t2)===null);
  ok('B: package -> task via identity refuses the reused-id task',W._srvFarsiTaskForPkg(uidPkg)===null);
  ok('B: non-SRV task never gets an SRV package',W._srvFarsiPkgForTask({id:100,engine:'NextWave',createdAt:1})===null);
}
// ── C. Historical ambiguous links are not guessed ───────────────────────────
{
  const W=world();const noCreated=srvTask(12,undefined);W.D.tasks.push(noCreated);W.D.packages.push(pkg(12,'SRV Farsi','2026-09-01T00:00:00Z'));
  ok('C: task without createdAt -> unresolved (no package guessed)',W._srvFarsiPkgForTask(noCreated)===null);
  const a=srvTask(13,1790000000000),b=srvTask(13,1790000009999);W.D.tasks.push(a,b);W.D.packages.push(pkg(13,'SRV Farsi','2026-10-10T00:00:00Z'));
  ok('C: two SRV tasks sharing a numeric id -> neither gets a legacy package',W._srvFarsiPkgForTask(a)===null&&W._srvFarsiPkgForTask(b)===null);
  // stages: a stale numeric stage must not leak into a task created after the identity epoch
  const W2=world();W2.D.srvFarsiLifecycleStages={'40':'done'};const old=srvTask(41,1700000000000);W2.D.tasks.push(old);W2.D.srvFarsiLifecycleStages['41']='review';
  ok('C: pre-epoch task keeps its existing numeric stage (migration)',W2._srvFarsiGetStage(41)==='review');
  const reusedTask=srvTask(40,Date.now()+1000);W2.D.tasks.push(reusedTask);
  ok('C: task created after the epoch does NOT inherit a stale "done" stage from a reused id',W2._srvFarsiGetStage(40)==='generate');
  W2._srvFarsiSetStage(40,'review');
  ok('C: stages written under the immutable identity',W2.D.srvFarsiLifecycleStages[W2._srvFarsiTaskUid(reusedTask)]==='review'&&W2._srvFarsiGetStage(40)==='review');
  W2._srvFarsiCancelTask(40);
  ok('C: cancel clears both identity and numeric stage keys',!W2.D.srvFarsiLifecycleStages[W2._srvFarsiTaskUid(reusedTask)]&&!W2.D.srvFarsiLifecycleStages['40']);
}
// ── D/F. Quick Generate: never switches SRV engine state, never advances rotation ─
{
  const W=world();W.D.engineState={};const before=clone(W.D.engineState);
  W._quickGenerateTest('srv_farsi','SRV Farsi','long');
  const t=W.D.tasks.find(x=>x.engine==='SRV Farsi');
  ok('D: SRV Quick Generate leaves engine state untouched',JSON.stringify(W.D.engineState)===JSON.stringify(before)&&W._getEngineState('SRV Farsi')==='running');
  ok('D: test identity is on the task (isTest + srvUid)',t&&t.isTest===true&&!!t.srvUid&&/\[TEST\]/.test(t.name));
  ok('D: generation started for that test task',W.generated.length===1&&W.generated[0]===String(t.id));
  ok('F: rotation peeked only, never advanced',W.nextCalls===0&&W.peekCalls===1,`next=${W.nextCalls} peek=${W.peekCalls}`);
  const W3=world();W3._quickGenerateTest('nextwave','NextWave','short');
  ok('I: other engines keep existing Quick Generate behaviour (engine-wide test)',W3._getEngineState('NextWave')==='test');
}
// ── E. Production cadence continues while test tasks exist ─────────────────
{
  const base=world();base.asAdmin();base.autoCreateCadenceTasksForCurrentWeek();
  const prodBase=base.D.tasks.filter(t=>t.engine==='SRV Farsi').map(t=>(t.contentFormat==='long'?'L':'S')+t.isoDate).sort().join(',');
  const W=world();
  for(let i=0;i<5;i++)W._quickGenerateTest('srv_farsi','SRV Farsi',i===0?'long':'short');
  const fri=W._currentWeekIsoForDayName('Friday');W.D.tasks.filter(t=>t.contentFormat==='long').forEach(t=>t.isoDate=fri); // test Long sitting on the production Friday
  ok('E: test tasks do not consume SRV weekly capacity',W.engineWeeklyLoad('SRV Farsi')===0,'load='+W.engineWeeklyLoad('SRV Farsi'));
  W.asAdmin();W.autoCreateCadenceTasksForCurrentWeek();
  const prod=W.D.tasks.filter(t=>t.engine==='SRV Farsi'&&!W._srvFarsiIsTestTask(t)).map(t=>(t.contentFormat==='long'?'L':'S')+t.isoDate).sort().join(',');
  ok('E: cadence creates the same production tasks as with no tests present',prod===prodBase&&prod.length>0,'with-tests='+prod+' | baseline='+prodBase);
  ok('E: production Friday Long created despite a test Long on Friday',W.D.tasks.some(t=>t.engine==='SRV Farsi'&&!W._srvFarsiIsTestTask(t)&&t.contentFormat==='long'));
  ok('E: SRV engine still running',W._getEngineState('SRV Farsi')==='running');
  const legacyTest={id:900,engine:'SRV Farsi',name:'SRV Farsi — Male — Happy · Long [TEST]',assignmentReason:'[manual-test] vaAddTestTask v13.69.74 long',status:'assigned'};
  ok('E: legacy test tasks (pre-isTest) recognised by creator stamp',W._srvFarsiIsTestTask(legacyTest));
}
// ── H. Stuck-engine warning: SRV only, warning only ────────────────────────
{
  const W=world();W.D.tasks.push(srvTask(1,1,{isoDate:'2020-01-01'}),srvTask(2,2,{isoDate:'2099-01-01'}));
  ok('H: no warning while SRV running',W._srvFarsiStuckEngineStatus()===null&&W._srvFarsiStuckEngineWarningHtml()==='');
  W._setEngineState('SRV Farsi','test');const snap=JSON.stringify(W.D);
  const st=W._srvFarsiStuckEngineStatus();const html=W._srvFarsiStuckEngineWarningHtml();
  ok('H: warning when SRV not running with pending production tasks',st&&st.pending===2&&st.due===1&&/SRV Farsi engine is TEST/.test(html),JSON.stringify(st));
  ok('H: warning changes no state',JSON.stringify(W.D)===snap);
  const W2=world();W2._setEngineState('SRV Farsi','paused');W2.D.tasks.push(srvTask(3,3,{isTest:true}),srvTask(4,4,{status:'done'}));
  ok('H: no warning when only test/finished SRV tasks are open',W2._srvFarsiStuckEngineStatus()===null);
  const W3=world();W3._setEngineState('NextWave','paused');W3.D.tasks.push({id:5,engine:'NextWave',status:'assigned',createdAt:5});
  ok('H: another engine being paused never triggers the SRV warning',W3._srvFarsiStuckEngineStatus()===null);
}
// ── I. Other engines untouched by SRV helpers ──────────────────────────────
{
  const W=world();W.D.tasks.push({id:1,engine:'NextWave',status:'assigned',isTest:true,name:'x [TEST]'},{id:2,engine:'AI Studio',status:'assigned',assignmentReason:'[manual-test]'});
  ok('I: other engines\' tasks (even test-looking) still count toward their load',W.engineWeeklyLoad('NextWave')===1&&W.engineWeeklyLoad('AI Studio')===1);
  ok('I: SRV test predicate is false for every non-SRV task',!W.D.tasks.some(t=>W._srvFarsiIsTestTask(t)));
}
console.log(out.join('\n'));console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
