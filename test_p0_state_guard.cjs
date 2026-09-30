// Extracts the real guard + persist functions from public/index.html and exercises them with mocked fetch.
const fs=require('fs');const h=fs.readFileSync(process.argv[2],'utf8');
const s=h.indexOf('let _sbFinanceVerified=false;');const e=h.indexOf('\n}\n',h.indexOf('function _reportFinanceSaveFailure'))+3; // through the save helpers
const persistSrc=h.slice(s,e);
const ls=h.indexOf('async function loadAppState(){');const le=h.indexOf('// 2. Load packages from Supabase',ls);
const loadHeadSrc=h.slice(ls,le)+'\n return financeLoaded; }';
let results=[],pass=0,fail=0;const ok=(n,c)=>{c?pass++:fail++;results.push((c?'PASS ':'FAIL ')+n);};
async function run(fetchImpl){
  const ctx={SUPABASE_URL:'x',SUPABASE_KEY:'k',SB_FINANCE_KEY:'mmm_finance_v118',D:{availableCash:1},posts:0,applied:null,
    console:{log(){},error(){}},AbortSignal:{timeout(){return null}},applyFinanceState(v){ctx.applied=v}};
  ctx.fetch=async(u,o)=>{if(o&&o.method==='POST')ctx.posts++;return fetchImpl(u,o)};
  const f=new Function(...Object.keys(ctx),persistSrc+'\n'+loadHeadSrc+'\nreturn {load:loadAppState,persist:_persistFinancePayloadToSupabase};');
  return {ctx,api:f(...Object.values(ctx))};
}
(async()=>{
  // A: load times out -> save must be blocked, no POST sent
  let {ctx,api}=await run(async(u,o)=>{if(!o||!o.method)throw new Error('timeout');return {ok:true,text:async()=>''}});
  await api.load(); ok('load failure -> save returns false',(await api.persist({tasks:[]}))===false); ok('load failure -> zero POSTs',ctx.posts===0);
  // B: load HTTP 500 -> blocked
  ({ctx,api}=await run(async(u,o)=>(!o||!o.method)?{ok:false,status:500}:{ok:true,text:async()=>''}));
  await api.load(); ok('HTTP 500 load -> save blocked',(await api.persist({}))===false && ctx.posts===0);
  // C: normal load -> save allowed
  ({ctx,api}=await run(async(u,o)=>(!o||!o.method)?{ok:true,json:async()=>[{value:'{"tasks":[1,2,3]}'}]}:{ok:true,text:async()=>''}));
  await api.load(); ok('normal load applies server state',ctx.applied&&ctx.applied.tasks.length===3); ok('normal load -> save allowed',(await api.persist({tasks:[1,2,3]}))===true && ctx.posts===1);
  // D: fresh install (row absent) -> save allowed
  ({ctx,api}=await run(async(u,o)=>(!o||!o.method)?{ok:true,json:async()=>[]}:{ok:true,text:async()=>''}));
  await api.load(); ok('row absent (first run) -> save allowed',(await api.persist({}))===true);
  // E: server trigger rejects -> returns false
  ({ctx,api}=await run(async(u,o)=>(!o||!o.method)?{ok:true,json:async()=>[{value:'{}'}]}:{ok:false,status:400,text:async()=>'{"code":"P0001","message":"MMM_STATE_GUARD: blocked catastrophic shrink"}'}));
  await api.load(); ok('server guard rejection -> save returns false',(await api.persist({}))===false);
  // F: corrupt JSON in row -> not verified -> blocked
  ({ctx,api}=await run(async(u,o)=>(!o||!o.method)?{ok:true,json:async()=>[{value:'{bad'}]}:{ok:true,text:async()=>''}));
  try{await api.load();}catch(e){} ok('unparseable server row -> save blocked',(await api.persist({}))===false && ctx.posts===0);
  console.log(results.join('\n'));console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
})();
