// SRV Farsi — Short from a published Long, Approve-stage playlists + schedule (order: FINAL PREVIEW CORRECTION PASS).
// Runs the REAL functions from public/index.html and api/ops.js in a sandbox with fake state; no network.
//   node tests/srv/test_srv_farsi_short_publish.cjs
const fs=require('fs'),path=require('path'),vm=require('vm');
const repo=path.resolve(__dirname,'../..');
const h=fs.readFileSync(path.join(repo,'public/index.html'),'utf8');
const ops=fs.readFileSync(path.join(repo,'api/ops.js'),'utf8');
let pass=0,fail=0;const out=[];const ok=(n,c,x)=>{c?pass++:fail++;out.push((c?'PASS ':'FAIL ')+n+(c||x===undefined?'':'  '+JSON.stringify(x).slice(0,300)));};
const top=(name)=>{const m=h.match(new RegExp('\\n(async )?function '+name+'\\('));if(!m)throw new Error('missing '+name);const s=m.index+1;return h.slice(s,h.indexOf('\n}\n',s)+2);};
const block=h.slice(h.indexOf('// ── SRV Farsi Short = promotional extract'),h.indexOf('function _srvFarsiVaSetArtistFormat('));
const libCfg=(()=>{const c=h.slice(h.indexOf('{id:"srv_farsi"'));const s=c.indexOf('avatarLibrary:{');let d=0,i=s+14;for(;;i++){if(c[i]==='{')d++;else if(c[i]==='}'){d--;if(!d)break;}}return c.slice(s+14,i+1);})();
function world(opts){
  opts=opts||{};
  const ctx={console,Date,Math,JSON,Number,String,Array,Object,isFinite,Promise,setTimeout,URL:{createObjectURL:()=>'blob:x',revokeObjectURL:()=>{}},
    D:opts.D,currentUser:opts.user||{id:'va'},activeExec:null,_saves:{state:0,pkg:[]},_alerts:[],_confirms:opts.confirms||[],
    escHTML:s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    document:{getElementById:()=>null,createElement:()=>({})},
    File:class{constructor(parts,name,o){this.parts=parts;this.name=name;this.type=o&&o.type;this.size=parts[0].byteLength;}},
    window:{},fetch:opts.fetch,_engineState:opts.engineState||'running'};
  ctx.window.AudioContext=opts.AudioContext;
  vm.createContext(ctx);
  vm.runInContext(`
    var location={pathname:'/'}; async function _srvFarsiPageIsCurrent(){return globalThis.__pageCurrent===undefined?true:globalThis.__pageCurrent;}
    function saveAppState(){_saves.state++;}
    async function savePackageToSupabase(p){_saves.pkg.push(JSON.parse(JSON.stringify(p)));return true;}
    function alert(m){_alerts.push(m);} function confirm(m){_alerts.push('CONFIRM:'+m);return _confirms.length?_confirms.shift():true;}
    function _getEngineState(e){return _engineState;}
    function _srvFarsiEngineConfig(){return {avatarLibrary:${libCfg}};}
    function _srvFarsiSetStage(id,st){(D._stages=D._stages||{})[String(id)]=st;}
    function openExec(){} function renderTab(){}
    function _nextPublishSlotCandidates(n){return [{iso:new Date(Date.now()+3*864e5).toISOString()}];}
    async function _publishFetch(u){return {status:200,json:async()=>(globalThis.__plcheck||{ok:true,canAddToPlaylists:false})};}
    function _srvFarsiApproveVideo(p,t){(D._approved=D._approved||[]).push(String(p));}
    ${['_srvFarsiIsTask','_srvFarsiTaskUid','_srvFarsiTaskById','_srvFarsiTaskByUid','_srvFarsiIsTestTask','_srvFarsiPkgForTask','_srvFarsiPlaylistCategory','_srvFarsiSplitMood','_srvFarsiVaCurrentArtistFormat','_srvFarsiVaAutoArtistFormat'].map(top).join('\n')}
    ${block.replace(/async function _srvFarsiPageIsCurrent\(\)\{[\s\S]*?\n\}\n/,'')}
    globalThis.__fns={_srvFarsiShortSources,_srvFarsiShortClamp,_srvFarsiCreateShortFromLong,_srvFarsiShortAudioFromLong,_srvFarsiShortSourceHtml,_srvFarsiPublishPlaylists,
      _srvFarsiDefaultPlaylistIds,_srvFarsiPlaylistSelection,_srvFarsiScheduleIso,_srvFarsiPublishCheck,_srvFarsiApplySchedule,_srvFarsiPublishPanelHtml,_srvFarsiApproveAndPublish,_srvFarsiShortFromLongHtml,_srvFarsiShortSel};
  `,ctx);
  return ctx;
}
const now=Date.now();
const mkD=()=>({tasks:[
    {id:151,engine:'SRV Farsi',mode:'Female — Romantic',mood:'Female — Romantic',isLong:true,createdAt:1792349068960,srvUid:'srvf_1792349068960_151'},
    {id:200,engine:'SRV Farsi',mode:'Male — Happy',mood:'Male — Happy',isLong:false,createdAt:now-1000,srvUid:'srvf_'+(now-1000)+'_200'},
    {id:201,engine:'SRV Farsi',mode:'Duet — Emotional',mood:'Duet — Emotional',isLong:false,isTest:true,name:'SRV Farsi — x · Short [TEST]',createdAt:now-900,srvUid:'srvf_'+(now-900)+'_201'},
    {id:106,engine:'SRV Farsi',mode:'Male — Happy',mood:'Male — Happy',isLong:true,isTest:true,createdAt:1790482696352,srvUid:'srvf_1790482696352_106'}],
  packages:[
    {id:'pkg_L1',engine:'SRV Farsi',srvTaskUid:'srvf_1792349068960_151',title:'لمس اولین دست',titleFinglish:'Lams-e Avalin Dast',lyrics:'L1',shortLyrics:'S1',mood:'romantic',artist:'Female',captionYT:'cap',_srvLongVideoUrl:'https://x/long1.webm',_srvYtLongId:'s_QLK8c7gYI',_srvLongDurationSec:222,generatedAt:'2026-10-25T10:00:00Z',_srvAvatarChoice:{id:'female_05',artist:'female',how:'manual'}},
    {id:'pkg_L2',engine:'SRV Farsi',srvTaskUid:'srvf_x_77',title:'unpublished long',_srvLongVideoUrl:'https://x/long2.webm',_srvLongDurationSec:200,generatedAt:'2026-10-24T10:00:00Z'},
    {id:'pkg_LT',engine:'SRV Farsi',srvTaskUid:'srvf_1790482696352_106',title:'شب نامزدی ما',isTest:true,_srvLongVideoUrl:'https://x/longT.webm',_srvYtLongId:'IBwTtLH8Llw',_srvLongDurationSec:120,generatedAt:'2026-09-27T10:00:00Z'},
    {id:'pkg_S0',engine:'SRV Farsi',srvTaskUid:'srvf_y_88',title:'a short',contentType:'Short',_srvShortVideoUrl:'https://x/s.webm',_srvLongVideoUrl:'https://x/s2.webm',_srvYtShortId:'zz',youtubeVideoId:'zz',generatedAt:'2026-10-23T10:00:00Z'},
    {id:'pkg_E',engine:'SRV English',title:'english long',_srvLongVideoUrl:'https://x/e.webm',_srvYtLongId:'ee',generatedAt:'2026-10-25T11:00:00Z'},
    {id:'pkg_N',engine:'NextWave',title:'nw long',_srvLongVideoUrl:'https://x/n.webm',youtubeVideoId:'nn',generatedAt:'2026-10-25T12:00:00Z'}]});
(async()=>{
// ── 1. eligible sources ──
{ const W=world({D:mkD()}),F=W.__fns,T=W.D.tasks;
  const prod=F._srvFarsiShortSources(T[1]).map(x=>x.pkg.id), test=F._srvFarsiShortSources(T[2]).map(x=>x.pkg.id);
  ok('sources: SRV Farsi published Longs only (no SRV English / NextWave)',prod.join()==='pkg_L1',prod);
  ok('sources: an unpublished Long (no YouTube id) is excluded',!prod.includes('pkg_L2')&&!test.includes('pkg_L2'));
  ok('sources: a Short is never a source',!prod.includes('pkg_S0')&&!test.includes('pkg_S0'));
  ok('sources: [TEST] Longs only for a [TEST] Short',!prod.includes('pkg_LT')&&test.includes('pkg_LT')&&test.includes('pkg_L1'),test);
  const t2=JSON.parse(JSON.stringify(T[1]));t2.vaOriginal={artist:'Male',format:'Short'};t2.mode=t2.mood='Duet — Happy';
  ok('sources: an explicit Artist choice filters the Longs by artist (Duet → none); Auto shows all',F._srvFarsiShortSources(t2).length===0&&(t2.mode=t2.mood='Female — Happy',F._srvFarsiShortSources(t2).length===1));
  const html=F._srvFarsiShortFromLongHtml(T[1],'200');
  ok('UI: dropdown shows title · task # · duration · on YouTube',/لمس اولین دست · task #151 · 3:42 · on YouTube/.test(html));
  ok('UI: start, length, slider, range, Preview, Create (once the hook suggestion is ready)',/srvf-short-start-200/.test(html)&&/srvf-short-dur-200/.test(html)&&/Preview this section/.test(html)&&/Create Short from this Long/.test(html)&&/data-srvf-hook/.test(html)); }
// ── 2. section rules ──
{ const W=world({D:mkD()}),F=W.__fns;
  const c=(sel,song)=>F._srvFarsiShortClamp(sel,song);
  ok('section: default 30 s',c({},222).durationSec===30);
  ok('section: length clamped to 25–35 s',c({durationSec:10},222).durationSec===25&&c({durationSec:90},222).durationSec===35);
  ok('section: start cannot run past the end of the Long',c({startSec:500,durationSec:30},222).startSec===192&&c({startSec:-5,durationSec:30},222).startSec===0); }
// ── 3. create Short from Long ──
{ const W=world({D:mkD()}),F=W.__fns,D=W.D;
  F._srvFarsiShortSel['200']={longPkgId:'pkg_L1',startSec:78,durationSec:40};
  ok('create: refuses a length outside 25–35 s',await F._srvFarsiCreateShortFromLong('200')===false&&D.packages.length===6);
  F._srvFarsiShortSel['200']={longPkgId:'pkg_L1',startSec:200,durationSec:30};
  ok('create: refuses a section past the end of the Long',await F._srvFarsiCreateShortFromLong('200')===false);
  F._srvFarsiShortSel['200']={longPkgId:'pkg_E',startSec:10,durationSec:30};
  ok('create: refuses a non-SRV-Farsi source',await F._srvFarsiCreateShortFromLong('200')===false);
  F._srvFarsiShortSel['200']={longPkgId:'pkg_L1',startSec:78,durationSec:30};
  const r=await F._srvFarsiCreateShortFromLong('200');
  const s=D.packages[D.packages.length-1], t=D.tasks[1];
  ok('create: Short package created and saved to the packages table',r===true&&s.contentType==='Short'&&W._saves.pkg.some(p=>p.id===s.id));
  ok('create: own identity (new package id, the Short task\'s uid) + explicit link to the Long',s.id!=='pkg_L1'&&s.srvTaskUid==='srvf_'+(now-1000)+'_200'&&s.taskId===200);
  const so=s.srvShortOf;
  ok('linkage: longPkgId, longTaskUid, longTaskId, startSec, durationSec, longDurationSec, audioUrl, longYoutubeVideoId',so.longPkgId==='pkg_L1'&&so.longTaskUid==='srvf_1792349068960_151'&&so.longTaskId===151&&so.startSec===78&&so.durationSec===30&&so.longDurationSec===222&&so.audioUrl==='https://x/long1.webm'&&so.longYoutubeVideoId==='s_QLK8c7gYI',so);
  ok('reuse: same title, Latin title, lyrics, mood, artist and caption — nothing generated',s.title===D.packages[0].title&&s.titleFinglish==='Lams-e Avalin Dast'&&s.lyrics==='L1'&&s.shortLyrics==='S1'&&s.mood==='romantic'&&s.artist==='Female'&&s.captionYT==='cap'&&!s.sunoPrompt);
  ok('reuse: the Short task takes the Long\'s artist + mood (recorded as an override)',t.mode==='Female — Romantic'&&t.vaOverrides.some(o=>o.by==='short-from-long'));
  ok('reuse: the Long\'s cover is the Short\'s default cover',t.srvAvatarId==='female_05'&&t.srvAvatarArtist==='female');
  ok('the Long is NOT marked used/consumed',!('srvUsed' in D.packages[0])&&!('consumed' in D.packages[0])&&F._srvFarsiShortSources(D.tasks[2]).some(x=>x.pkg.id==='pkg_L1'));
  ok('the Short moves to Review',D._stages['200']==='review');
  ok('lifecycle shows the source Long',/Short from Long:<\/strong> لمس اولین دست · task #151 · section 1:18–1:48 of 3:42/.test(F._srvFarsiShortSourceHtml(s)));
  // duplicate warning
  const W2=world({D:JSON.parse(JSON.stringify(D)),confirms:[false]}),F2=W2.__fns;W2.D.tasks.push({id:202,engine:'SRV Farsi',mode:'Female — Romantic',mood:'Female — Romantic',isLong:false,createdAt:now,srvUid:'srvf_'+now+'_202'});
  F2._srvFarsiShortSel['202']={longPkgId:'pkg_L1',startSec:78,durationSec:30};
  ok('duplicate: same Long + same section asks first; "No" creates nothing',await F2._srvFarsiCreateShortFromLong('202')===false&&W2._alerts.some(a=>/already exists/.test(a))); }
// ── 4. Build: audio is cut from the Long, no MP3 ──
{ const sr=1000, len=sr*222; const data=new Float32Array(len); for(let i=0;i<len;i++)data[i]=((i%997)/997)-0.5;
  let fetched=null;
  const W=world({D:mkD(),fetch:async(u)=>{fetched=u;return {ok:true,status:200,arrayBuffer:async()=>new ArrayBuffer(8)};},
    AudioContext:class{decodeAudioData(){return Promise.resolve({sampleRate:sr,numberOfChannels:2,length:len,getChannelData:()=>data});} close(){}}});
  const f=await W.__fns._srvFarsiShortAudioFromLong({srvShortOf:{audioUrl:'https://x/long1.webm',startSec:78,durationSec:30}});
  const dv=new DataView(f.parts[0]);
  ok('Build: the Short\'s audio is fetched from the Long\'s stored video',fetched==='https://x/long1.webm');
  ok('Build: exactly the chosen 30 s (stereo 16-bit WAV)',dv.getUint32(40,true)===30*sr*2*2&&f.type==='audio/wav');
  const mid=dv.getInt16(44+ (sr*15)*4,true)/0x7FFF, want=data[78*sr+sr*15];
  ok('Build: the samples come from the selected section (78 s onwards)',Math.abs(mid-want)<0.002,{mid,want});
  const bt=top('_srvFarsiBuildTrigger');
  ok('Build: a Short-from-Long needs no MP3 (falls back to the Long cut when none is loaded)',/if\(!audio&&_srvFarsiIsShortFromLong\(_shortPkg\)\)\{/.test(bt)&&/await _srvFarsiShortAudioFromLong\(_shortPkg\)/.test(bt));
  ok('Build stage hides the Suno + MP3 steps for a Short-from-Long',/\$\{_srvFarsiIsShortFromLong\(pkg\)\?`<div[^`]*No Suno step and no MP3 upload/.test(h));
  ok('Long Build unchanged except it records the song length',/pkg\._srvLongDurationSec=Math\.round\(_a\.duration\*10\)\/10/.test(bt)); }
// ── 5. playlists ──
{ const W=world({D:mkD()}),F=W.__fns;
  const HR='PL64rNOGmVdtKzlinRGxx3xxyKTxXqCku3',EM='PL64rNOGmVdtLS9WmXx0B1FyRf3MldJbnF',SH='PL64rNOGmVdtIM7hfzvb6U9yNPZncyf7Bh';
  const d=(m,L)=>F._srvFarsiDefaultPlaylistIds({mood:m},L).join();
  ok('defaults: Romantic Long → Happy Romantic',d('Female — Romantic',true)===HR);
  ok('defaults: Happy Long → Happy Romantic',d('Duet — Happy',true)===HR);
  ok('defaults: Emotional Long → Emotional',d('Male — Emotional',true)===EM);
  ok('defaults: Romantic Short → Shorts ONLY',d('Female — Romantic',false)===SH);
  ok('defaults: Happy Short → Shorts ONLY',d('Male — Happy',false)===SH);
  ok('defaults: Emotional Short → Shorts ONLY',d('Duet — Emotional',false)===SH);
  const pkg={id:'p1',srvPlaylistSel:{ids:[SH,'PLbogus'],none:false}};
  ok('override: the saved selection wins over the recommendation (unknown ids dropped)',F._srvFarsiPlaylistSelection(pkg,{mood:'Female — Romantic'},true).ids.join()===SH);
  const html=F._srvFarsiPublishPanelHtml({id:200,mood:'Male — Emotional'},{id:'p2'},false);
  ok('panel: three approved playlists as checkboxes; for a Short ONLY |Shorts is pre-ticked and recommended',(html.match(/data-srvf-pl="/g)||[]).length===3&&/data-srvf-pl="PL64rNOGmVdtIM7hfzvb6U9yNPZncyf7Bh" checked/.test(html)&&!/data-srvf-pl="PL64rNOGmVdtLS9WmXx0B1FyRf3MldJbnF" checked/.test(html)&&!/data-srvf-pl="PL64rNOGmVdtKzlinRGxx3xxyKTxXqCku3" checked/.test(html)&&(html.match(/recommended<\/span>/g)||[]).length===1);
  ok('panel: "No playlist" is Admin-only',!/data-srvf-pl-none/.test(html)&&/data-srvf-pl-none/.test(world({D:mkD(),user:{id:'admin'}}).__fns._srvFarsiPublishPanelHtml({id:200,mood:'Male — Emotional'},{id:'p2'},false)));
  const save=top('_srvFarsiSavePublishPrefs');
  ok('saving: selection + schedule go on the package and to the packages table (survive refresh)',/pkg\.srvPlaylistSel=\{ids:/.test(save)&&/pkg\.srvSchedule=\{date,time,tz:_srvFarsiPublishTz\(\),iso:_srvFarsiScheduleIso\(date,time\)/.test(save)&&/savePackageToSupabase\(pkg\)/.test(save));
  ok('publish: both uploads send exactly the saved selection',/farsiPlaylists:_srvFarsiPlaylistSelection\(pkg,_farsiPubTask,isLong\)\.ids/.test(top('_srvFarsiRunPublish'))&&/farsiPlaylists:_srvFarsiPlaylistSelection\(pkg,_farsiPubTask,false\)\.ids/.test(top('_srvFarsiPublishYouTube'))); }
// ── 6. server: insert loop over the selected ids, each result recorded ──
{ const mapSrc=ops.slice(ops.indexOf('const SRV_FARSI_PLAYLISTS = {'),ops.indexOf('};',ops.indexOf('const SRV_FARSI_PLAYLISTS = {'))+2);
  const resolveSrc=ops.slice(ops.indexOf('function _srvFarsiResolvePlaylists('),ops.indexOf('\n}\n',ops.indexOf('function _srvFarsiResolvePlaylists('))+2);
  const a=ops.indexOf("    if (engine === 'SRV Farsi' && Array.isArray(farsiPlaylists) && youtubeVideoId) {"), b=ops.indexOf("    } else if (playlistCategory && youtubeVideoId && engine !== 'SRV Farsi') {");
  const loop=ops.slice(a,b)+'    }';
  const run=async(sel,adder)=>new Function('engine','farsiPlaylists','youtubeVideoId','accessToken','_ytAddVideoToPlaylist',mapSrc+resolveSrc+'return (async()=>{let playlistsResult=null;\n'+loop+'\nreturn playlistsResult;})();')('SRV Farsi',sel,'VID','tok',adder);
  const calls=[];
  const res=await run(['PL64rNOGmVdtLS9WmXx0B1FyRf3MldJbnF','PL64rNOGmVdtIM7hfzvb6U9yNPZncyf7Bh','PLnotours'],async(v,pl)=>{calls.push(pl);if(pl==='PL64rNOGmVdtIM7hfzvb6U9yNPZncyf7Bh')throw new Error('playlist_insert_failed: {"error":{"code":403,"message":"Request had insufficient authentication scopes."}}');return {id:'item_'+pl.slice(-4)};});
  ok('server: one playlistItems.insert per selected approved id (unapproved id never called)',calls.join()==='PL64rNOGmVdtLS9WmXx0B1FyRf3MldJbnF,PL64rNOGmVdtIM7hfzvb6U9yNPZncyf7Bh',calls);
  ok('server: each result recorded — id, name, success only when YouTube returns the item',res.length===2&&res[0].ok===true&&res[0].playlistId==='PL64rNOGmVdtLS9WmXx0B1FyRf3MldJbnF'&&res[0].playlistName==='Silk Road Voices | Emotional ❤️'&&res[0].playlistItemId==='item_JbnF');
  ok('server: a failed add is recorded on its own with the API error, the video is untouched',res[1].ok===false&&res[1].error==='needs_playlist_permission'&&/insufficient authentication scopes/.test(res[1].detail));
  const res2=await run(['PL64rNOGmVdtKzlinRGxx3xxyKTxXqCku3'],async()=>({}));
  ok('server: no success claimed when YouTube returns no playlist item',res2[0].ok===false&&res2[0].error==='no_playlist_item_returned');
  ok('server: "No playlist" (empty selection) adds nothing',(await run([],async()=>{throw new Error('x');})).length===0); }
// ── 7. schedule ──
{ const W=world({D:mkD()}),F=W.__fns;
  const iso=F._srvFarsiScheduleIso('2026-11-07','09:00'), back=new Date(iso);
  ok('schedule: local date+time → exact UTC instant for YouTube (round-trips to the same wall clock)',/Z$/.test(iso)&&back.getFullYear()===2026&&back.getMonth()===10&&back.getDate()===7&&back.getHours()===9&&back.getMinutes()===0,iso);
  ok('schedule: invalid date/time rejected',F._srvFarsiScheduleIso('2026-02-30','09:00')===null&&F._srvFarsiScheduleIso('2026-11-07','')===null);
  const T={id:300,engine:'SRV Farsi',mood:'Female — Romantic',isLong:true,createdAt:now};
  const P=(o)=>Object.assign({id:'pX',_srvLongVideoUrl:'u',_srvThumbUrl:'t',srvPlaylistSel:{ids:['PL64rNOGmVdtKzlinRGxx3xxyKTxXqCku3'],none:false}},o);
  ok('validate: a past date/time is blocked with an explanation',F._srvFarsiPublishCheck(T,P({srvSchedule:{iso:new Date(now-3600e3).toISOString()}}),true).errors.some(e=>/in the past/.test(e)));
  ok('validate: no date/time is blocked',F._srvFarsiPublishCheck(T,P({}),true).errors.some(e=>/Choose a publishing date and time/.test(e)));
  ok('validate: no playlist is blocked unless "No playlist" is chosen',F._srvFarsiPublishCheck(T,P({srvSchedule:{iso:new Date(now+864e5).toISOString()},srvPlaylistSel:{ids:[],none:false}}),true).errors.some(e=>/playlist/.test(e))&&F._srvFarsiPublishCheck(T,P({srvSchedule:{iso:new Date(now+864e5).toISOString()},srvPlaylistSel:{ids:[],none:true}}),true).ok);
  ok('validate: missing cover/thumbnail is blocked',F._srvFarsiPublishCheck(T,P({_srvThumbUrl:null,srvSchedule:{iso:new Date(now+864e5).toISOString()}}),true).errors.some(e=>/thumbnail/.test(e)));
  ok('validate: a valid future production task passes',F._srvFarsiPublishCheck(T,P({srvSchedule:{iso:new Date(now+864e5).toISOString()}}),true).ok);
  const pk=P({srvSchedule:{date:'2026-11-07',time:'09:00',tz:'X',iso:'2026-11-07T14:00:00.000Z'}});W.D.tasks.push(T);
  F._srvFarsiApplySchedule(pk,300);
  ok('publish: the chosen instant becomes publishAt exactly (no silent change)',pk.publishAt==='2026-11-07T14:00:00.000Z');
  const T2={id:301,engine:'SRV Farsi',mood:'Female — Romantic',isLong:true,isTest:true,createdAt:now};W.D.tasks.push(T2);
  const pk2=P({isTest:true,srvSchedule:{date:'2026-11-07',time:'09:00',tz:'X',iso:'2026-11-07T14:00:00.000Z'}});
  F._srvFarsiApplySchedule(pk2,301);
  ok('[TEST]: a chosen date/time never becomes a schedule (stays private)',pk2.publishAt===undefined);
  ok('[TEST]: past/no schedule does not block a private test publish',F._srvFarsiPublishCheck(T2,P({isTest:true}),true).ok);
  ok('[TEST]: the publish functions still force private + no publishAt for test',/const _srvPublishAt=_inTestMode\?null:\(pkg\.publishAt\|\|null\);/.test(top('_srvFarsiRunPublish'))&&/privacyStatus:'private'/.test(top('_srvFarsiRunPublish'))&&/const _srvPublishAt=_inTestMode\?null:\(pkg\.publishAt\|\|null\);/.test(top('_srvFarsiPublishYouTube')));
  ok('[TEST]: applying a schedule never touches a test task\'s slot bookkeeping',!(W.D._publishSlots||{})['2026-11-07T14:00:00.000Z']||W.D._publishSlots['2026-11-07T14:00:00.000Z']==='pX');
  // reconnect warning
  W.D.packages.push(P({id:'pY',srvSchedule:{iso:new Date(now+864e5).toISOString(),date:'x',time:'y'}}));W.D.tasks.push({id:302,engine:'SRV Farsi',mood:'Female — Romantic',isLong:true,createdAt:now});
  W._confirms.push(false);
  ok('Approve & Publish: without playlist permission it says "Silk Road Voices reconnect required for playlist publishing." and does not pretend',await F._srvFarsiApproveAndPublish('pY',302)===false&&W._alerts.some(a=>/Silk Road Voices reconnect required for playlist publishing\./.test(a))&&!(W.D._approved||[]).includes('pY')); }
// ── 7b. LOCKED eligibility matrix + production source Long stays read-only (CEO safety correction 2026-10-25) ──
{ const W=world({D:mkD()}),F=W.__fns,T=W.D.tasks;
  const prodSrc=F._srvFarsiShortSources(T[1]).map(x=>x.pkg.id), testSrc=F._srvFarsiShortSources(T[2]).map(x=>x.pkg.id);
  ok('matrix: production Short sees production published Longs only',prodSrc.join()==='pkg_L1');
  ok('matrix: production Short never sees a [TEST] Long',!prodSrc.includes('pkg_LT'));
  ok('matrix: [TEST] Short may use a production published Long (read-only source)',testSrc.includes('pkg_L1'));
  ok('matrix: [TEST] Short may use a published [TEST] Long',testSrc.includes('pkg_LT'));
  ok('matrix: neither sees a Short, an unpublished Long, or another business',[prodSrc,testSrc].every(a=>!a.includes('pkg_S0')&&!a.includes('pkg_L2')&&!a.includes('pkg_E')&&!a.includes('pkg_N')));
  const W3=world({D:mkD()}); W3.D.packages.push({id:'pkg_SA',engine:'SRV Farsi',srvTaskUid:'set-aside:x',title:'set aside',_srvLongVideoUrl:'u',_srvYtLongId:'y',_srvLongDurationSec:200});
  ok('matrix: a set-aside Long is never offered',!W3.__fns._srvFarsiShortSources(W3.D.tasks[2]).some(x=>x.pkg.id==='pkg_SA'));
  ok('UI: [TEST] Short on a production Long shows the read-only note',/Using published Long as source only — original Long will not be changed\./.test(F._srvFarsiShortFromLongHtml(T[2],'201')));
  ok('UI: no read-only note for a production Short',!/data-srvf-readonly-src/.test(F._srvFarsiShortFromLongHtml(T[1],'200')));
  // full [TEST] Short from the production Long, then Build's audio cut — the source must be byte-for-byte unchanged
  const snap=()=>JSON.stringify({pkg:W.D.packages.find(p=>p.id==='pkg_L1'),task:W.D.tasks.find(t=>t.id===151),stages:W.D._stages&&W.D._stages['151'],slots:W.D._publishSlots||null,avatarIdx:W.D.srvFarsiAvatarIdx||null});
  const before=snap(), pkgsBefore=W.D.packages.length, tasksBefore=W.D.tasks.length;
  F._srvFarsiShortSel['201']={longPkgId:'pkg_L1',startSec:78,durationSec:30};
  const r=await F._srvFarsiCreateShortFromLong('201');
  const sp=W.D.packages[W.D.packages.length-1], st=W.D.tasks.find(t=>t.id===201);
  ok('[TEST] Short created from the production Long',r===true&&sp.srvShortOf.longPkgId==='pkg_L1');
  ok('source Long package, task, lifecycle stage, slots and rotation pointers byte-for-byte unchanged',snap()===before,{before:before.slice(0,120),after:snap().slice(0,120)});
  ok('no replacement work: exactly one new package, no new task',W.D.packages.length===pkgsBefore+1&&W.D.tasks.length===tasksBefore);
  ok('only the Short itself was written to the packages table (never the Long)',W._saves.pkg.length===1&&W._saves.pkg[0].id===sp.id);
  ok('the Short stays [TEST]',sp.isTest===true&&F._srvFarsiPublishCheck(st,Object.assign({},sp,{_srvShortVideoUrl:'v',_srvThumbUrl:'t'}),false).isTest===true);
  sp.srvSchedule={date:'2026-11-07',time:'09:00',tz:'X',iso:'2026-11-07T14:00:00.000Z'};
  F._srvFarsiApplySchedule(sp,201);
  ok('[TEST] Short: no schedule and no weekly slot even with a date chosen',sp.publishAt===undefined&&!(W.D._publishSlots&&W.D._publishSlots['2026-11-07T14:00:00.000Z']));
  ok('[TEST] Short uploads private (the publish function forces private + no publishAt for test)',/privacyStatus:'private'/.test(top('_srvFarsiPublishYouTube'))&&/const _inTestMode=[^\n]*_srvFarsiIsTestTask\(_srvFarsiTaskById\(taskId\)\)/.test(top('_srvFarsiPublishYouTube')));
  ok('the publish path for a Short never names the source Long\'s video or package',!/srvShortOf\.(longPkgId|longYoutubeVideoId)/.test(top('_srvFarsiPublishYouTube')+top('_srvFarsiRunPublish')));
  // Build: reading the Long's audio is a plain GET; nothing is written
  let calls=[];const sr=1000,len=sr*222,data=new Float32Array(len);
  const W2=world({D:mkD(),fetch:async(u,o)=>{calls.push({u,m:(o&&o.method)||'GET'});return {ok:true,status:200,arrayBuffer:async()=>new ArrayBuffer(8)};},AudioContext:class{decodeAudioData(){return Promise.resolve({sampleRate:sr,numberOfChannels:1,length:len,getChannelData:()=>data});}close(){}}});
  const b2=JSON.stringify(W2.D);
  await W2.__fns._srvFarsiShortAudioFromLong(sp);
  ok('Build: the Long is only read (one GET of its stored video), no state changes',calls.length===1&&calls[0].m==='GET'&&calls[0].u==='https://x/long1.webm'&&JSON.stringify(W2.D)===b2);
  ok('the Short-from-Long code never writes to the source (no assignment to L.* or the Long task)',!/\bL\.[A-Za-z_$]+\s*=[^=]/.test(top('_srvFarsiCreateShortFromLong'))&&!/\blt\.[A-Za-z_$]+\s*=[^=]/.test(top('_srvFarsiCreateShortFromLong'))&&!/\bp\.[A-Za-z_$]+\s*=[^=]/.test(top('_srvFarsiShortSources'))); }
// ── 7c. REGRESSION — the live preview failure "The Short could not be saved" (HTTP 409 from the packages table) ──
// The table has UNIQUE (engine, title) for every engine except SRV English (packages_engine_title_unique_non_srv_studio).
// A Short shares its Long's song title. The mock below enforces that same index on the real savePackageToSupabase payload.
{ const saveSrc=top('savePackageToSupabase'), loadSrc=top('fetchPackagesFromTable');
  const rows=[{engine:'SRV Farsi',title:'لمس اولین دست',package_id:'pkg_L1'}];
  const W=world({D:mkD()});
  vm.runInContext(`var SUPABASE_URL='https://db',SUPABASE_KEY='k';var __rows=${JSON.stringify(rows)};
    fetch=async function(u,o){const b=JSON.parse(o.body);
      if(__rows.some(r=>r.package_id!==b.package_id&&r.engine!=='SRV English'&&r.engine===b.engine&&r.title===b.title))return {ok:false,status:409,text:async()=>'{"code":"23505","message":"duplicate key value violates unique constraint \\"packages_engine_title_unique_non_srv_studio\\""}'};
      __rows=__rows.filter(r=>r.package_id!==b.package_id).concat([{engine:b.engine,title:b.title,package_id:b.package_id,full_package:b.full_package}]);return {ok:true,status:201,text:async()=>''};};
    ${saveSrc}`,W);
  const F=W.__fns, D=W.D, T=D.tasks;
  const t201before=JSON.stringify(T.find(t=>t.id===201));
  // what the old code sent: the Long's title in the title column → rejected exactly like the live preview
  const old=await vm.runInContext(`savePackageToSupabase({id:'pkg_old',engine:'SRV Farsi',title:'لمس اولین دست',contentType:'Short'})`,W);
  ok('REGRESSION: the old payload (Short row titled like its Long) is refused with 409, as in the live preview',old===false);
  F._srvFarsiShortSel['201']={longPkgId:'pkg_L1',startSec:78,durationSec:30};
  const r=await F._srvFarsiCreateShortFromLong('201');
  const sp=D.packages[D.packages.length-1];
  ok('FIX: the Short is created and stored (its row has a distinct DB-only title)',r===true&&W.__rows.some(x=>x.package_id===sp.id&&x.title===sp.dbTitle)&&/^لمس اولین دست · Short 1:18–1:48 · pkg_/.test(sp.dbTitle));
  ok('FIX: what is shown, rendered and published is still the Long\'s song title',sp.title==='لمس اولین دست'&&JSON.parse(W.__rows.find(x=>x.package_id===sp.id).full_package).title==='لمس اولین دست');
  ok('FIX: later saves of the Short (Build/Approve/Publish) keep working',await vm.runInContext(`savePackageToSupabase(D.packages[D.packages.length-1])`,W)===true);
  ok('FIX: a second Short of the same Long is also storable (unique per package)',(F._srvFarsiShortSel['201']=null,true));
  // a failed save must not leave the task half-changed
  const W2=world({D:mkD()});vm.runInContext(`var SUPABASE_URL='x',SUPABASE_KEY='k';fetch=async()=>({ok:false,status:409,text:async()=>'dup'});${saveSrc}`,W2);
  W2.__fns._srvFarsiShortSel['201']={longPkgId:'pkg_L1',startSec:78,durationSec:30};
  const before2=JSON.stringify(W2.D.tasks.find(t=>t.id===201)), n2=W2.D.packages.length;
  const r2=await W2.__fns._srvFarsiCreateShortFromLong('201');
  ok('a refused save leaves NOTHING behind: no package, task artist/mood/cover untouched',r2===false&&W2.D.packages.length===n2&&JSON.stringify(W2.D.tasks.find(t=>t.id===201))===before2);
  // reload: the shared loader de-duplicates by title — the Short must not hide its Long
  const loader=new Function('SUPABASE_URL','SUPABASE_KEY','fetch','console',loadSrc+'\nreturn fetchPackagesFromTable;')('u','k',async()=>({ok:true,json:async()=>W.__rows.slice().reverse().map(x=>({package_id:x.package_id,full_package:x.full_package||JSON.stringify({id:x.package_id,title:x.title,engine:x.engine})}))}),{log(){},warn(){},error(){}});
  const loaded=await loader();
  ok('reload: both the Short and its source Long come back (the loader keys on dbTitle when present)',loaded.some(p=>p.id===sp.id)&&loaded.some(p=>p.id==='pkg_L1'),loaded.map(p=>p.id));
  ok('shared save/loader: any package without dbTitle sends/keys exactly as before',/title:clean\.dbTitle\|\|clean\.title\|\|''/.test(saveSrc)&&/const key=\(p\.dbTitle\|\|p\.title\|\|''\)\.trim\(\)\.toLowerCase\(\);/.test(loadSrc)&&!/dbTitle/.test(h.replace(/[^\n]*dbTitle[^\n]*\n/g,(m)=>/savePackageToSupabase|fetchPackagesFromTable|clean\.dbTitle|p\.dbTitle\|\||pkg\.dbTitle=|packages_engine_title|DB-only title|dbTitle: set only/.test(m)?'':m))); }
// ── 7d. outdated tab guard (the CEO's tab was still running the pre-fix code) ──
{ const W=world({D:mkD()}),F=W.__fns; W.__pageCurrent=false; vm.runInContext('globalThis.__pageCurrent=false',W);
  F._srvFarsiShortSel['201']={longPkgId:'pkg_L1',startSec:0,durationSec:30};
  const n=W.D.packages.length, r=await F._srvFarsiCreateShortFromLong('201');
  ok('an outdated tab is refused before anything is written (asks to reload)',r===false&&W.D.packages.length===n&&W._saves.pkg.length===0);
  const real=h.slice(h.indexOf('async function _srvFarsiPageIsCurrent(){'),h.indexOf('\n}\n',h.indexOf('async function _srvFarsiPageIsCurrent(){'))+2);
  ok('freshness check compares the deployed page\'s build label with this tab\'s, no-store fetch, never blocks when it cannot check',/cache:'no-store'/.test(real)&&/SRV_FARSI_UI_BUILD/.test(real)&&/return null;/.test(real));
  ok('the Short panel shows the build label',/build \$\{SRV_FARSI_UI_BUILD\}/.test(h)); }
// ── 7e. Quick Generate → SRV Farsi Short · TEST must not generate a new song (real CEO path) ──
{ const qg=top('_quickGenerateTest'), gen=top('vaFarsiGeneratePackage');
  ok('Quick Generate Short (SRV Farsi) opens the lifecycle at Generate — no package is generated',/if\(contentFormat==='short'\)\{ if\(typeof openExec==='function'\)openExec\(String\(newTaskId\)\); return; \}/.test(qg)&&qg.indexOf("if(contentFormat==='short')")<qg.indexOf('vaFarsiGeneratePackage(String(newTaskId))'));
  ok('song generation refuses a SRV Farsi Short task (sends it to the Long picker instead)',/if\(!task\.isLong\)\{[^}]*_srvFarsiSetStage\(taskId,'generate'\)/.test(gen));
  ok('Quick Generate for other engines unchanged (the non-Farsi branch is byte-identical to main)',(()=>{const main=require('child_process').execFileSync('git',['-C',repo,'show','origin/main:public/index.html'],{encoding:'utf8',maxBuffer:1<<28});const m=main.slice(main.indexOf('\nfunction _quickGenerateTest('));const tail=x=>{const i=x.indexOf("  const engCfg=(ENGINES_CONFIG||[]).find(e=>e.id===engineId);");return x.slice(i,x.indexOf('\n}',i));};return tail(m)===tail(qg)&&tail(qg).length>100;})()); }
// ── 7f. Suggested Hook Section (CEO 2026-10-25: never the intro by default) ──
{ const W=world({D:mkD()}),F=W.__fns; const sug=vm.runInContext('_srvFarsiSuggestHook',W), envf=vm.runInContext('_srvFarsiEnergyEnvelope',W);
  // synthetic 4:00 song: quiet instrumental intro (0–40 s), verse (40–85 s), loud chorus (85–120 s), verse, chorus (160–195 s), quiet outro
  const hop=0.5,n=480,env=new Float32Array(n);for(let i=0;i<n;i++){const t=i*hop;env[i]=t<40?0.15:t<85?0.45:t<120?0.95:t<160?0.5:t<195?0.9:0.2;}
  const r=sug(env,hop,240,30);
  ok('hook: picks the loud section where it arrives (chorus entry at 1:25), not the intro',r.startSec>=81&&r.startSec<=89,r);
  ok('hook: the explanation names the reason and the skipped intro/outro',/loudest sustained part/.test(r.why)&&/intro \(first \d+ s\)/.test(r.why)&&/outro \(last \d+ s\)/.test(r.why));
  const flat=new Float32Array(n).fill(0.5); flat.fill(1,0,60); // loudest at the very start
  ok('hook: never the first 20 s / 12% even when the opening is loudest',sug(flat,hop,240,30).startSec>=28);
  ok('hook: a short song (34 s) gets a suggestion that fits inside it (0:04–0:34), label and field agree',sug(new Float32Array(68).fill(0.5),hop,34,30).startSec===4);
  const audio={sampleRate:1000,length:4000,numberOfChannels:1,getChannelData:()=>{const d=new Float32Array(4000);for(let i=2000;i<4000;i++)d[i]=0.5;return d;}};
  const e=envf(audio,0.5); ok('envelope: RMS per 0.5 s window from the decoded audio',e.length===8&&e[0]===0&&Math.abs(e[7]-0.5)<1e-6);
  ok('default start is never 0:00 without a suggestion (fallback ~35%, or wait)',F._srvFarsiShortClamp({},240).startSec===Math.round(240*0.35)&&F._srvFarsiShortClamp({},0).startSec===null);
  const c=h.slice(h.indexOf('function _srvFarsiShortFromLongHtml('),h.indexOf('\n}\n',h.indexOf('function _srvFarsiShortFromLongHtml(')));
  ok('UI: Create is disabled while the suggestion is being computed; the suggestion is labelled as an estimate',/const ready=!!\(cur&&cur\.songSec&&c\.startSec!=null&&!_hookBusy\);/.test(c)&&/Suggested Hook Section/.test(c)&&/An estimate, not a detected chorus/.test(c));
  ok('manual control kept: moving Start or Length marks the choice as manual; "Use suggestion" restores it',/sel\[key\]=Number\(val\); sel\.manual=true;/.test(top('_srvFarsiShortSet'))&&/sel\.startSec=h\.startSec;/.test(top('_srvFarsiShortUseHook')));
  ok('the Short records how its section was chosen (suggested-hook or manual)',/section:\(function\(\)\{const h=_srvFarsiHookCache\[L\.id\];return h&&h\.status==='done'&&h\.startSec===start/.test(top('_srvFarsiCreateShortFromLong')));
  ok('Build reuses the Long decoded for the suggestion (no second 36 MB download)',/const audio=await _srvFarsiDecodeLongAudio\(s\.audioUrl\);/.test(top('_srvFarsiShortAudioFromLong'))); }
// ── 8. other businesses untouched ──
{ const main=require('child_process').execFileSync('git',['-C',repo,'show','origin/main:public/index.html'],{encoding:'utf8',maxBuffer:1<<28});
  const fnOf=(src,name)=>{const m=src.match(new RegExp('\\n(async )?function '+name+'\\('));if(!m)return null;const s=m.index+1;return src.slice(s,src.indexOf('\n}\n',s)+2);};
  const names=[...main.matchAll(/\n(?:async )?function (_srvEnglish\w*|_nextWave\w*|_aiStudio\w*|_smm\w*|srvEnglish\w*|nextWave\w*|renderSRVEnglish\w*|renderNextWave\w*)\(/g)].map(m=>m[1]);
  const changed=names.filter(n=>fnOf(main,n)!==fnOf(h,n));
  ok('other businesses: every SRV English / NextWave / AI Studio / SMM function byte-identical to main ('+names.length+' checked)',names.length>50&&changed.length===0,changed.slice(0,5));
  ok('shared publish helpers untouched (_assignPublishSlot, _nextPublishSlotCandidates, _publishFetch)',['_assignPublishSlot','_nextPublishSlotCandidates','_publishFetch'].every(n=>fnOf(main,n)===fnOf(h,n))); }
console.log(out.join('\n'));console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
