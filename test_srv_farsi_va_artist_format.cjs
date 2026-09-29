// SRV Farsi — VA Artist/Format selection: behavioral tests against the REAL functions extracted
// from public/index.html (setter, split-mood, stage lookup, and the real weekly cadence creator).
// Run: node test_srv_farsi_va_artist_format.cjs public/index.html
const fs=require('fs');
const h=fs.readFileSync(process.argv[2]||'public/index.html','utf8');
function fn(name){const s=h.indexOf('function '+name+'(');if(s<0)throw new Error('missing '+name);const e=h.indexOf('\n}\n',s);return h.slice(s,e+2);}
function cst(name){const s=h.indexOf('const '+name+'=');const e=h.indexOf(';\n',s);return h.slice(s,e+2);}
const src=[fn('_srvFarsiSplitMood'),fn('_srvFarsiGetStage'),fn('_srvFarsiVaSetArtistFormat'),fn('_getEngineState'),fn('_isEnginePaused'),
  fn('_isoOfDay'),fn('_isoDateForDayName'),fn('_currentWeekIsoForDayName'),fn('_slotKey'),fn('_engineNameMatches'),cst('_AUTO_ASSIGN_TERMINAL'),
  fn('_autoAssignChannelFor'),fn('_autoAssignPlatformFor'),fn('_autoAssignContentTypeFor'),fn('autoCreateCadenceTasksForCurrentWeek')].join('\n');
let pass=0,fail=0;const out=[];const ok=(n,c,extra)=>{c?pass++:fail++;out.push((c?'PASS ':'FAIL ')+n+(extra?'  '+extra:''));};
function world(){
  const W={D:{tasks:[],srvFarsiLifecycleStages:{},cadenceAutoCreatedSlots:{},engineState:{}},rotationCalls:0,saves:0};
  W.ENGINES_CONFIG=[{id:'srv_farsi',name:'SRV Farsi',type:'song',weeklyCapacity:99,cadenceDays:['Monday','Tuesday','Wednesday','Thursday'],longFormDay:'Friday',modes:['Female — Emotional']}];
  const mods=['Male — Happy','Female — Romantic','Duet — Emotional','Male — Romantic','Female — Happy','Duet — Romantic'];
  W._srvFarsiNextMode=()=>mods[(W.rotationCalls++)%mods.length];
  const env={D:W.D,ENGINES_CONFIG:W.ENGINES_CONFIG,_srvFarsiNextMode:W._srvFarsiNextMode,engineWeeklyLoad:()=>0,_srvFarsiBuildTrigger:()=>{},
    saveAppState:()=>{W.saves++},renderTab:()=>{},currentTab:'tasks',currentUser:(W.user={id:'va'}),console:{log(){},warn(){},error(){}}};
  const f=new Function(...Object.keys(env),src+'\nreturn {set:_srvFarsiVaSetArtistFormat,cadence:autoCreateCadenceTasksForCurrentWeek,split:_srvFarsiSplitMood};');
  const api=f(...Object.values(env));W.set=(...a)=>{W.user.id='va';return api.set(...a)};W.cadence=()=>{W.user.id='admin';return api.cadence()};W.split=api.split;return W;
}
const farsi=W=>W.D.tasks.filter(t=>t.engine==='SRV Farsi');
const slotSig=W=>farsi(W).map(t=>t.id+'|'+t.isoDate+'|'+t.day).sort().join(',');

// 1. Baseline cadence creates the week, and is idempotent
let W=world();W.cadence();
const shorts=farsi(W).filter(t=>t.contentFormat!=='long'),longT=farsi(W).find(t=>t.contentFormat==='long');
ok('cadence creates 4 Shorts + 1 Friday Long',shorts.length===4&&!!longT&&longT.day==='Friday',`shorts=${shorts.length} long=${!!longT}`);
const n0=W.D.tasks.length,rot0=W.rotationCalls,sig0=slotSig(W);
W.cadence();ok('cadence re-run creates nothing (baseline)',W.D.tasks.length===n0);

// 2. Artist change on a Short: only the artist part of mood changes
const s1=shorts[0];const before=JSON.stringify({isoDate:s1.isoDate,day:s1.day,status:s1.status});
const moodPart=s1.mood.split(' — ')[1];
W.set(String(s1.id),'artist','Duet');
ok('artist -> Duet, mood kept',s1.mood==='Duet — '+moodPart,s1.mood);
ok('artist change keeps Short format',s1.contentType==='Short Video'&&s1.isLong===false&&s1.contentFormat==='short');
ok('day/isoDate/status untouched',JSON.stringify({isoDate:s1.isoDate,day:s1.day,status:s1.status})===before);
ok('override recorded (by/at/from/to)',s1.vaOverrides.length===1&&s1.vaOverrides[0].by==='va'&&s1.vaOverrides[0].to==='Duet'&&!!s1.vaOverrides[0].at);

// 3. Short -> Long on another Short
const s2=shorts[1];W.set(String(s2.id),'format','Long');
ok('Short -> Long sets generate/build fields',s2.contentFormat==='long'&&s2.contentType==='Long Script'&&s2.isLong===true);
ok('Short -> Long keeps original slot as short',s2.cadenceSlotFormat==='short');
ok('name reflects new format',/^SRV Farsi — Long · /.test(s2.name),s2.name);

// 4. Friday Long -> Short
W.set(String(longT.id),'format','Short');
ok('Long -> Short sets fields',longT.contentFormat==='short'&&longT.contentType==='Short Video'&&longT.isLong===false&&longT.cadenceSlotFormat==='long');

// 5. Schedule unchanged: cadence creates no replacement tasks and never advances rotation
const n1=W.D.tasks.length;W.cadence();W.cadence();
ok('cadence after overrides creates NOTHING (no schedule change)',W.D.tasks.length===n1,`${n1}->${W.D.tasks.length}`);
ok('same task ids/days/dates as before overrides',slotSig(W)===sig0);
ok('rotation pointer never advanced by overrides',W.rotationCalls===rot0,`calls ${rot0}->${W.rotationCalls}`);

// 6. Negative control: without the cadenceSlotFormat guard the cadence WOULD re-create slots
const X=world();X.cadence();const xs=farsi(X).find(t=>t.contentFormat!=='long'),xl=farsi(X).find(t=>t.contentFormat==='long');
X.set(String(xs.id),'format','Long');X.set(String(xl.id),'format','Short');
delete xs.cadenceSlotFormat;delete xl.cadenceSlotFormat;const xn=X.D.tasks.length;X.cadence();
ok('negative control: guard is what prevents re-creation',X.D.tasks.length>xn,`without guard ${xn}->${X.D.tasks.length}`);

// 7. Locks and scope
const s3=shorts[2];W.D.srvFarsiLifecycleStages[String(s3.id)]='review';const m3=s3.mood;
W.set(String(s3.id),'artist','Female');W.set(String(s3.id),'format','Long');
ok('locked after generate (review stage): no change',s3.mood===m3&&s3.contentFormat!=='long');
W.D.tasks.push({id:900,engine:'AI Studio',mood:'x',contentType:'Short Video',name:'AI'});
W.set('900','format','Long');W.set('900','artist','Male');
ok('other engine task ignored',W.D.tasks.find(t=>t.id===900).contentType==='Short Video'&&!W.D.tasks.find(t=>t.id===900).cadenceSlotFormat);
const s4=shorts[3];const snap=JSON.stringify(s4);W.set(String(s4.id),'artist','Robot');W.set(String(s4.id),'format','Medium');W.set(String(s4.id),'mood','Happy');
ok('invalid values / fields ignored',JSON.stringify(s4)===snap);
const saves=W.saves;W.set(String(s4.id),'artist',W.split(s4.mood).artist);
ok('re-selecting current value is a no-op',W.saves===saves&&JSON.stringify(s4)===snap);

// 8. Untouched tasks keep baseline cadence semantics (no cadenceSlotFormat stamped)
ok('non-overridden tasks not stamped',!s4.cadenceSlotFormat&&!shorts[2].cadenceSlotFormat);

console.log(out.join('\n'));console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
