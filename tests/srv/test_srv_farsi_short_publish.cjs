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
    ${block}
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
  ok('UI: start, length, slider, range, Preview, Create',/srvf-short-start-200/.test(html)&&/srvf-short-dur-200/.test(html)&&/type="range"/.test(html)&&/of 3:42/.test(html)&&/Preview this section/.test(html)&&/Create Short from this Long/.test(html)); }
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
  ok('defaults: Romantic Short → Happy Romantic + Shorts',d('Female — Romantic',false)===HR+','+SH);
  ok('defaults: Happy Short → Happy Romantic + Shorts',d('Male — Happy',false)===HR+','+SH);
  ok('defaults: Emotional Short → Emotional + Shorts',d('Duet — Emotional',false)===EM+','+SH);
  const pkg={id:'p1',srvPlaylistSel:{ids:[SH,'PLbogus'],none:false}};
  ok('override: the saved selection wins over the recommendation (unknown ids dropped)',F._srvFarsiPlaylistSelection(pkg,{mood:'Female — Romantic'},true).ids.join()===SH);
  const html=F._srvFarsiPublishPanelHtml({id:200,mood:'Male — Emotional'},{id:'p2'},false);
  ok('panel: three approved playlists as checkboxes, recommended ones pre-ticked and badged',(html.match(/data-srvf-pl="/g)||[]).length===3&&/data-srvf-pl="PL64rNOGmVdtLS9WmXx0B1FyRf3MldJbnF" checked/.test(html)&&/data-srvf-pl="PL64rNOGmVdtIM7hfzvb6U9yNPZncyf7Bh" checked/.test(html)&&!/data-srvf-pl="PL64rNOGmVdtKzlinRGxx3xxyKTxXqCku3" checked/.test(html)&&(html.match(/recommended<\/span>/g)||[]).length===2);
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
// ── 8. other businesses untouched ──
{ const main=require('child_process').execFileSync('git',['-C',repo,'show','origin/main:public/index.html'],{encoding:'utf8',maxBuffer:1<<28});
  const fnOf=(src,name)=>{const m=src.match(new RegExp('\\n(async )?function '+name+'\\('));if(!m)return null;const s=m.index+1;return src.slice(s,src.indexOf('\n}\n',s)+2);};
  const names=[...main.matchAll(/\n(?:async )?function (_srvEnglish\w*|_nextWave\w*|_aiStudio\w*|_smm\w*|srvEnglish\w*|nextWave\w*|renderSRVEnglish\w*|renderNextWave\w*)\(/g)].map(m=>m[1]);
  const changed=names.filter(n=>fnOf(main,n)!==fnOf(h,n));
  ok('other businesses: every SRV English / NextWave / AI Studio / SMM function byte-identical to main ('+names.length+' checked)',names.length>50&&changed.length===0,changed.slice(0,5));
  ok('shared publish helpers untouched (_assignPublishSlot, _nextPublishSlotCandidates, _publishFetch)',['_assignPublishSlot','_nextPublishSlotCandidates','_publishFetch'].every(n=>fnOf(main,n)===fnOf(h,n))); }
console.log(out.join('\n'));console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
