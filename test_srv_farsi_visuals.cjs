// SRV Farsi visuals — colour treatment, thumbnails, rebuild image rotation. Real code extracted from
// public/index.html. Run: node test_srv_farsi_visuals.cjs public/index.html
const fs=require('fs');
const h=fs.readFileSync(process.argv[2]||'public/index.html','utf8');
let pass=0,fail=0;const out=[];const ok=(n,c,x)=>{c?pass++:fail++;out.push((c?'PASS ':'FAIL ')+n+(x?'  '+x:''));};
function top(name){const m=h.match(new RegExp('\\n(async )?function '+name+'\\('));if(!m)throw new Error('missing '+name);const s=m.index+1;return h.slice(s,h.indexOf('\n}\n',s)+2);}
function nested(sig){const s=h.indexOf(sig);if(s<0)throw new Error('missing '+sig);return h.slice(s,h.indexOf('\n    }\n',s)+6);}

(async()=>{
// ── 1. Black-and-white treatment removed, warm grade applied (Shorts and Longs share one painter) ──
const panel=(()=>{const s=h.indexOf('  function _drawFarsiPanel(');return h.slice(s,h.indexOf('\n  }\n',s));})();
ok('cover painter no longer applies grayscale',!/ctx\.filter='[^']*grayscale/.test(panel));
ok('cover painter no longer applies a single-colour duotone',!/globalCompositeOperation='color'/.test(panel));
ok('cover painter applies the warm soft-light grade',/globalCompositeOperation='soft-light'/.test(panel)&&/SRV_FARSI_WARM_GRADE_ALPHA/.test(panel));
ok('both layouts use that painter (Short panel + Long full-bleed)',(h.match(/_drawFarsiPanel\(/g)||[]).length===3);
const pal=new Function(h.slice(h.indexOf('const SRV_FARSI_MOOD_PALETTES={'),h.indexOf('};',h.indexOf('const SRV_FARSI_MOOD_PALETTES={'))+2)+';return SRV_FARSI_MOOD_PALETTES;')();
const warm=hex=>{const n=parseInt(hex.slice(1),16),r=n>>16,g=(n>>8)&255,b=n&255;return r>b;};
ok('every mood palette is warm (red > blue) incl. Emotional',Object.values(pal).every(p=>warm(p.tint)&&p.gradient.every(warm)&&warm(p.frame)),JSON.stringify(Object.fromEntries(Object.entries(pal).map(([k,v])=>[k,v.tint]))));
ok('old gray-blue Emotional colours are gone',!/#5f7290|#23283a|#9aa9c2/.test(h));

// ── 1b. Benchmark layout: frameless Long, readable Short lyric, restrained secondary line ──
const comp=(()=>{const s=h.indexOf('  function _drawFarsiComposedFrame(');return h.slice(s,h.indexOf('\n  // ── Main frame renderer',s));})();
ok('Long: photo drawn edge-to-edge with no border and no rounded frame',/_drawFarsiPanel\(panelX,panelTop,panelW,panelH,zoom,0,\{aim:/.test(comp)&&!/_drawFarsiPanel\(panelX[^\n]*border:true/.test(comp)&&/panelH=H, panelTop=0/.test(comp));
ok('Long: no framed-panel call remains',!/_drawFarsiPanel\([^)]*,18,true,true\)/.test(comp));
ok('Long: no dark veil behind the title — the cover photo runs full-width under it (face keeps its screen position and size; lighter edge vignette)',!/ctx\.drawImage\(_farsiLongVeil/.test(comp)&&/const panelW=W, panelH=H, panelTop=0, panelX=0;/.test(comp)&&/aim:\{x:isMirror\?0\.40\*0\.66:0\.34\+0\.60\*0\.66,y:0\.40,face:0\.21\*0\.66\}/.test(comp)&&/vignette:0\.16\}/.test(comp));
ok('still cover frame keeps the zoom floor 1 (no edge revealed)',/const z=Math\.max\(1,zoom\|\|1\)/.test(panel));
ok('Long: romanized line is a restrained sans (no monospace caps block)',/500 \$\{Math\.round\(W\*0\.0195\)\}px 'Vazirmatn'/.test(comp)&&!/IBM Plex Mono', monospace`;\s*\n\s*ctx\.fillStyle='rgba\(253,246,232,0\.82\)'/.test(comp));
ok('Long/Short: title type is cream, not pure white',(comp.match(/#fdf6e8/g)||[]).length>=2&&!/fillStyle='#fff(fff)?'/.test(comp));
{ const shortSec=comp.slice(comp.indexOf('// ── SHORT (visual benchmark)'));
  ok('Short: NO running lyric line (CEO 2026-10-25): no lyric text, no lyric timing, no lyric font in the Short layout',!/lyricLines|lyricTimings|_srvWrapLines\(ctx,line/.test(shortSec)&&/No running lyric line on SRV Farsi Shorts/.test(shortSec)); }
ok('Long keeps its own design (Long branch untouched by the Short lyric removal)',/_drawFarsiWordmark\(tx,_stackY\+_wordmarkGap,titleSide,_farsiPal\.frame\)/.test(comp));
ok('grade is light enough for natural skin tones (<= 0.25)',(()=>{const m=h.match(/const SRV_FARSI_WARM_GRADE_ALPHA=([0-9.]+)/);return m&&+m[1]>0&&+m[1]<=0.25;})());
const lum=hex=>{const n=parseInt(hex.slice(1),16);return 0.299*(n>>16)+0.587*((n>>8)&255)+0.114*(n&255);};
ok('Emotional is the darkest palette but still warm',lum(pal.emotional.gradient[0])<lum(pal.romantic.gradient[0])&&lum(pal.emotional.gradient[0])<lum(pal.happy.gradient[0])&&warm(pal.emotional.tint));

// ── 2. Rebuild image rotation: the real picker cycles the WHOLE pool before any reuse ──
const D={};
const pick=new Function('D',nested('    function _farsiPickAvatar(pool,bucketKey){')+'\nreturn _farsiPickAvatar;')(D);
const seq=(pool,key,n)=>Array.from({length:n},()=>pick(pool,key));
const p2=['A','B'],p4=['A','B','C','D'],p5=['A','B','C','D','E'];
ok('2-photo bucket: never the same photo twice in a row',seq(p2,'short.female.happy',6).join('')==='ABABAB');
ok('4-photo bucket: rotates through all 4 before repeating',seq(p4,'long.duet.romantic',9).join('')==='ABCDABCDA');
ok('5-photo bucket: rotates through all 5 before repeating',seq(p5,'short.male.emotional',11).join('')==='ABCDEABCDEA');
ok('buckets rotate independently (per format.artist.mood)',pick(p4,'short.duet.happy')==='A'&&D.srvFarsiAvatarIdx['long.duet.romantic']===1&&D.srvFarsiAvatarIdx['short.duet.happy']===1&&D.srvFarsiAvatarIdx['short.female.happy']===0);
const D2=JSON.parse(JSON.stringify(D));const pick2=new Function('D',nested('    function _farsiPickAvatar(pool,bucketKey){')+'\nreturn _farsiPickAvatar;')(D2);
ok('rotation position survives reload (persisted pointer)',pick2(p4,'long.duet.romantic')===pick(p4,'long.duet.romantic'));

// ── 3. Shared avatar library: ONE library per artist (female / male / duet), used by Shorts and Longs ──
const path=require('path');const pubDir=path.dirname(process.argv[2]||'public/index.html');
const farsiCfg=(()=>{const s=h.indexOf('{id:"srv_farsi"');const e=h.indexOf('\n  {id:"srv_english"',s);return h.slice(s,e);})();
ok('no separate Short/Long library and no per-mood pool remains for SRV Farsi',/avatarLibrary:\{/.test(farsiCfg)&&!/avatarPool/.test(farsiCfg)&&!/srv-farsi-avatars\/(long|short)\//.test(farsiCfg));
const pools=(()=>{const s=farsiCfg.indexOf('avatarLibrary:{');let d=0,i=s+'avatarLibrary:'.length;for(;;i++){if(farsiCfg[i]==='{')d++;else if(farsiCfg[i]==='}'){d--;if(!d)break;}}return new Function('return '+farsiCfg.slice(s+'avatarLibrary:'.length,i+1))();})();
const src=e=>e.src;
const plist=Object.keys(pools).map(a=>[a,pools[a]]);
ok('3 artist libraries (female, male, duet)',Object.keys(pools).sort().join()==='duet,female,male');
ok('library sizes match the approved folder: 21 female, 8 male, 8 duet (37)',pools.female.length===21&&pools.male.length===8&&pools.duet.length===8);
const missing=plist.flatMap(([k,arr])=>arr.flatMap(e=>[e.src,e.thumb]).filter(u=>fs.existsSync(pubDir)&&!fs.existsSync(path.join(pubDir,u))));
ok('every library image and its selector thumbnail exist on disk',missing.length===0,missing.slice(0,2).join(','));
ok('no image is listed twice anywhere',new Set(plist.flatMap(([k,arr])=>arr.map(src))).size===plist.reduce((n,[k,arr])=>n+arr.length,0));
ok('every image sits in its own artist folder and has a unique id',plist.every(([a,arr])=>arr.every(e=>e.src.includes('/library/'+a+'/')&&e.id.startsWith(a+'_')))&&new Set(plist.flatMap(([k,arr])=>arr.map(e=>e.id))).size===37);
{ let land=true; try{ const sz=f=>{const b=fs.readFileSync(path.join(pubDir,f));for(let i=2;i<b.length;){if(b[i]!==0xFF){i++;continue;}const m=b[i+1];if(m>=0xC0&&m<=0xC2)return [b.readUInt16BE(i+7),b.readUInt16BE(i+5)];i+=2+b.readUInt16BE(i+2);}return [0,0];};
    for(const [a,arr] of plist)for(const e of arr){const [w,h2]=sz(e.src);if(!(w===1672&&h2===941))land=false;} }catch(_){land=false;}
  ok('every source is one 16:9 landscape master (1672x941) — the Short crops the same file',land); }
// real picker on the REAL libraries: automatic choice cycles the whole artist library before any repeat
{ const Dr={};const pk=new Function('D',nested('    function _farsiPickAvatar(pool,bucketKey){')+'\nreturn _farsiPickAvatar;')(Dr);
  let allOk=true;for(const [k,arr] of plist){const got=Array.from({length:arr.length+1},()=>src(pk(arr,'lib.'+k)));
    if(new Set(got.slice(0,arr.length)).size!==arr.length||got[arr.length]!==got[0])allOk=false;}
  ok('REAL libraries: automatic Rebuild walks every image of the artist before repeating',allOk);
  ok('REAL libraries: each artist keeps its own pointer',Object.keys(Dr.srvFarsiAvatarIdx).sort().join()==='lib.duet,lib.female,lib.male'); }
const build0=top('_srvFarsiBuildTrigger');
ok('build: the operator\'s cover for this task wins; otherwise the artist rotation picks',/const _fManual=task&&task\.srvAvatarId&&task\.srvAvatarArtist===_fGroup\?_srvFarsiAvatarById\(_fGroup,task\.srvAvatarId\):null;/.test(build0)&&/const _fPicked=_fManual\|\|_farsiPickAvatar\(_fLibA,'lib\.'\+_fGroup\);/.test(build0));
ok('build: a manual cover never advances the rotation pointer (picker is only called when there is no manual choice)',/_fManual\|\|_farsiPickAvatar/.test(build0));
ok('build passes the face box to both the Short and the Long render',(build0.match(/avatarFocusX:_fAvFocus\.x, avatarFocusY:_fAvFocus\.y, avatarFaceW:_fAvFocus\.w/g)||[]).length===2);
ok('build records the cover used and whether it was chosen by hand',/pkg\._srvAvatarChoice=\{id:_fPicked\.id,artist:_fGroup,how:_fManual\?'manual':'auto'\}/.test(build0));
// Build-stage selector + per-task persistence (real functions, fake state)
{ const helpers=['_srvFarsiAvatarArtist','_srvFarsiAvatarLibrary','_srvFarsiAvatarById','_srvFarsiManualAvatar','_srvFarsiNextAvatar','_srvFarsiSelectAvatar'].map(top).join('\n');
  const mk=new Function('D','cfg','tasks','saves',helpers+`
    function _srvFarsiEngineConfig(){return cfg;} function _srvFarsiTaskById(id){return tasks.find(t=>String(t.id)===String(id));}
    function saveAppState(){saves.n++;} return {sel:_srvFarsiSelectAvatar,next:_srvFarsiNextAvatar,man:_srvFarsiManualAvatar,lib:_srvFarsiAvatarLibrary};`);
  const Dx={srvFarsiAvatarIdx:{'lib.female':3}}, tasks=[{id:1,mode:'Female — Romantic'},{id:2,mode:'Female — Happy'},{id:3,mode:'Duet — Happy'}], saves={n:0};
  const A=mk(Dx,{avatarLibrary:pools},tasks,saves);
  ok('Female task sees exactly the Female library (21), Duet task the Duet library (8)',A.lib('female').length===21&&A.lib('duet').length===8);
  ok('automatic preview = next image in the artist rotation',A.next(tasks[0]).how==='auto'&&A.next(tasks[0]).av.id===pools.female[3].id);
  A.sel(1,'female_07');
  ok('choosing a cover saves it on THAT task only and persists through the shared-state save',tasks[0].srvAvatarId==='female_07'&&tasks[0].srvAvatarArtist==='female'&&!tasks[1].srvAvatarId&&saves.n===1);
  ok('choosing a cover does not touch the rotation pointer',JSON.stringify(Dx.srvFarsiAvatarIdx)==='{"lib.female":3}');
  const reloaded=JSON.parse(JSON.stringify(tasks));const B=mk(Dx,{avatarLibrary:pools},reloaded,saves);
  ok('the choice survives a reload (it lives on the persisted task)',B.next(reloaded[0]).how==='manual'&&B.next(reloaded[0]).av.id==='female_07');
  A.sel(3,'female_02');
  ok('a Female cover cannot be put on a Duet task',!tasks[2].srvAvatarId);
  tasks[0].mode='Male — Romantic';
  ok('if the task\'s artist changes, the old artist\'s cover is ignored (back to automatic for the new artist)',A.man(tasks[0])===null&&A.next(tasks[0]).av.id.startsWith('male_'));
  tasks[0].mode='Female — Romantic'; A.sel(1,null);
  ok('"Back to automatic" clears the choice',!tasks[0].srvAvatarId&&A.next(tasks[0]).how==='auto'); }
const picker=top('_srvFarsiAvatarPickerHtml');
ok('Build stage shows the cover picker above the build button (VA and Admin share this lifecycle view)',/\$\{_srvFarsiAvatarPickerHtml\(task\)\}\n\s*<div[^\n]*STEP 3 — BUILD PACKAGE/.test(h));
ok('picker shows visual thumbnails (no filenames) for the whole artist library',/<img src="\$\{escHTML\(a\.thumb\|\|a\.src\)\}"/.test(picker)&&/lib\.map\(/.test(picker)&&!/\.jpg/.test(picker));
// ── Fix pass: face-first framing (the real expressions from the painter) ──
{ const a=panel.indexOf('const fx='),b=panel.indexOf('ctx.imageSmoothingEnabled=true',panel.indexOf('const fx='));
  const frame=new Function('iw','ih','px','py','pw','ph','aim','avatarFocusX','avatarFocusY','avatarFaceW','let faceX=px+pw*aim.x, faceY=py+ph*aim.y, faceR=pw*0.2;'+panel.slice(a,b)+'\nreturn {sx,sy,sw,sh,sc,cover,faceX,faceY,faceW:fw*iw*sc};');
  const LONG={x:0.60,y:0.40,face:0.21}, CARD={x:0.5,y:0.37,face:0.30};
  const inside=(r,iw,ih)=>r.sx>=-1e-6&&r.sy>=-1e-6&&r.sx+r.sw<=iw+1e-6&&r.sy+r.sh<=ih+1e-6;
  let allIn=true,faceIn=true,faceBig=true,notSoft=true,n=0; const worst=[];
  for(const [key,pool] of plist) for(const e of pool){
    const iw=1672, ih=941;
    for(const [nm,pw,ph,aim] of [['long',1267,1080,LONG],['card',929,1008,CARD]]){
      const r=frame(iw,ih,0,0,pw,ph,aim,e.fx,e.fy,e.fw); n++;
      if(!inside(r,iw,ih))allIn=false;
      // whole face (plus a margin) inside the panel
      if(!(r.faceX-r.faceW*0.55>=0&&r.faceX+r.faceW*0.55<=pw&&r.faceY-r.faceW*0.62>=0&&r.faceY+r.faceW*0.62<=ph)){faceIn=false;worst.push(key+':'+nm+':'+e.src.split('_').slice(-1));}
      if(r.faceW/pw<0.11)faceBig=false;
      if(r.sc>r.cover*1.7+1e-9)notSoft=false; } }
  ok('face framing: every pool image, Long panel + Short card ('+n+' crops) — crop stays inside the source',allIn);
  ok('face framing: the whole face is inside the frame for every image and both formats',faceIn,worst.join(' '));
  ok('face framing: the face is a prominent share of the frame for every image',faceBig);
  ok('face framing: enlargement is capped so the photo never goes soft',notSoft);
  ok('every pool entry carries a face box (fx, fy, fw)',plist.every(([k,pool])=>pool.every(e=>typeof e==='object'&&[e.fx,e.fy,e.fw].every(v=>typeof v==='number'&&v>0&&v<1))));
  ok('face light + face-centred vignette keep the face the brightest, clearest area',/createRadialGradient\(faceX,faceY,0,faceX,faceY,faceR\*2\.4\)/.test(panel)&&/createRadialGradient\(faceX,faceY,faceR\*1\.7/.test(panel));
  ok('camera is face-centred: the still frame zooms about the face; medium/close shots centre on the face like SRV English (pull 1)',/ctx\.translate\(faceX,faceY\); ctx\.scale\(z,z\); ctx\.translate\(-faceX,-faceY\);/.test(panel)&&/bcx\+\(fx-bcx\)\*F\.pull/.test(panel));
  ok('photo is drawn with high-quality smoothing and real colour',/imageSmoothingQuality='high'/.test(panel)&&!/ctx\.filter='[^']*grayscale/.test(panel)); }
// ── Motion / text shadow / snow (CEO 2026-10-27): SRV English motion feel, no text shadow, small top-down snow ──
{ const atmo=(()=>{const s2=h.indexOf('  function _drawFarsiAtmo(');return h.slice(s2,h.indexOf('\n  }\n',s2));})();
  const v2=fs.readFileSync(require('path').join(require('path').dirname(process.argv[2]||'public/index.html'),'srv-studio-v2/srv2-render.mjs'),'utf8');
  const V2M=new Function('return '+v2.match(/export const SRV2_MOTION = (\{[\s\S]*?\});/)[1])(), V2T=new Function('return '+v2.match(/export const SRV2_LONG_TIMING = (\{[^}]*\})/)[1])();
  const FS=new Function(h.slice(h.indexOf('const SRV_FARSI_SNOW='),h.indexOf('};',h.indexOf('const SRV_FARSI_SNOW='))+2)+';return SRV_FARSI_SNOW;')();
  // exact SRV English camera: run the SRV English module and the SRV Farsi copies on the same inputs
  const V2=await import(require('path').resolve(require('path').dirname(process.argv[2]||'public/index.html'),'srv-studio-v2/srv2-render.mjs'));
  const camSrc=['_srvFarsiCamRng','_srvFarsiCamSeed','_srvFarsiCamEase','_srvFarsiCamFade','_srvFarsiCamTimeline','_srvFarsiCamera','_srvFarsiCamRect'].map(top).join('\n');
  const CAMC=h.slice(h.indexOf('const SRV_FARSI_CAM='),h.indexOf('};',h.indexOf('const SRV_FARSI_CAM='))+2);
  const FC=new Function(CAMC+'\n'+camSrc+';return {C:SRV_FARSI_CAM,rng:_srvFarsiCamRng,seed:_srvFarsiCamSeed,tl:_srvFarsiCamTimeline,cam:_srvFarsiCamera,rect:_srvFarsiCamRect};')();
  ok('motion: SRV English framings, shot timing (20–28 s, 1.5 s dissolve, 6 % push) and camera numbers copied exactly',
    JSON.stringify(FC.C.framings)===JSON.stringify(V2.SRV2_FRAMINGS)&&FC.C.shotMin===V2.SRV2_LONG_TIMING.shotMin&&FC.C.shotMax===V2.SRV2_LONG_TIMING.shotMax&&FC.C.xfade===V2.SRV2_LONG_TIMING.xfade&&FC.C.push===V2.SRV2_LONG_TIMING.push&&
    ['overscan','breathe','breatheSec','breathe2','breathe2Sec','swaySec','sway2Sec','liftSec','swayAmt','shortZoomShare'].every(k=>FC.C[k]===V2.SRV2_MOTION[k]));
  const rA=V2.srv2Rng('x|y'), rB=FC.rng('x|y'); let same=true; for(let i=0;i<50;i++)if(rA()!==rB())same=false;
  ok('motion: identical shot timeline to srv2LongTimeline (same seeds, durations 45–360 s)',same&&[45,123.4,203.5,240,360].every(d=>['a|t','duet_06|تو جانِ منی','x'].every(sd=>JSON.stringify(FC.tl(d,sd))===JSON.stringify(V2.srv2LongTimeline({duration:d,seed:sd}).shots))));
  let camSame=true; for(let t=0;t<300;t+=0.37){const a=V2.srv2Camera(t,4242),b=FC.cam(t,4242);if(Math.abs(a.zoom-b.zoom)>1e-12||Math.abs(a.mx-b.mx)>1e-12||Math.abs(a.my-b.my)>1e-12)camSame=false;}
  ok('motion: identical breathing + sway to srv2Camera at every instant',camSame);
  let rectSame=true; for(const [s1,cx,cy,mx,my,sr] of [[1.06,0.5,0.4,0.3,-0.2,1.06],[1.3,0.55,0.36,-0.8,0.4,1.2],[1.12,0.2,0.9,0.8,0.8,1]]){const W=1920,H=1080,iw=1672,ih=941,base=Math.max(W/iw,H/ih);
    const a=V2.srv2CameraRect(iw,ih,W,H,s1,cx,cy,mx,my,sr),b=FC.rect(iw,ih,W,H,base,s1,cx,cy,mx,my,sr);for(const k of ['x','y','w','h'])if(Math.abs(a[k]-b[k])>1e-9)rectSame=false;}
  ok('motion: identical camera rectangle to srv2CameraRect (with SRV English\'s cover-fit base)',rectSame);
  const pnl=(()=>{const s2=h.indexOf('  function _drawFarsiPanel(');return h.slice(s2,h.indexOf('\n  }\n',s2));})();
  ok('motion: Long = SRV English shots (srv2ShotCameraRect: framing × eased push × overscan × breathing, sway inside the margin) + cross-dissolves',
    /const zz=F\.z\*\(1\+C\.push\*_srvFarsiCamEase\(pp\)\)\*C\.overscan\*cam\.zoom;/.test(pnl)&&/_srvFarsiCamRect\(iw,ih,pw,ph,sc,zz,bcx\+\(fx-bcx\)\*F\.pull,bcy\+\(fy\+F\.dy-bcy\)\*F\.pull,cam\.mx,cam\.my,F\.z\*C\.overscan\)/.test(pnl)&&
    /layers\.push\(\{r:shotRect\(pv\),a:1-_srvFarsiCamFade\(tt,cur\.start-hx,cur\.start\+hx\)\}\)/.test(pnl)&&/layers\.push\(\{r:shotRect\(nx\),a:_srvFarsiCamFade\(tt,nx\.start-hx,nx\.start\+hx\)\}\)/.test(pnl));
  { let inside=true; const iw=1672,ih=941,pw=1267,ph=1080,cover=Math.max(pw/iw,ph/ih),sc=Math.max(cover,1.3),C=FC.C;
    const shots=FC.tl(240,'edge'); for(let t=0;t<240;t+=0.25){const cam=FC.cam(t,99);for(const sh of shots){const F=C.framings[sh.framing];const pp=Math.max(-0.1,Math.min(1.1,(t-sh.start)/Math.max(1,sh.end-sh.start)));
      const zz=F.z*(1+C.push*(pp<0?0:pp>1?1:pp*pp*(3-2*pp)))*C.overscan*cam.zoom;for(const [fx,fy] of [[0.3,0.3],[0.55,0.36],[0.8,0.5]]){const r=FC.rect(iw,ih,pw,ph,sc,zz,0.5+(fx-0.5)*F.pull,0.45+(fy+F.dy-0.45)*F.pull,cam.mx,cam.my,F.z*C.overscan);if(r.x<-1e-6||r.y<-1e-6||r.x+r.w>iw+1e-6||r.y+r.h>ih+1e-6)inside=false;}}}
    ok('motion: the moving frame never leaves the photo (every shot, every instant of a 4-min song, three face positions)',inside); }
  ok('motion: Short card = srv2CardCameraRect (eased 6 % push over the Short × 45 % breathing, sway inside the margin)',
    /const zz=\(1\+C\.push\*_srvFarsiCamEase\(o\.cam\.p\)\)\*\(1\+\(cam\.zoom-1\)\*C\.shortZoomShare\);/.test(pnl)&&/_srvFarsiCamRect\(iw,ih,pw,ph,sc,zz,bcx,bcy,cam\.mx,cam\.my,1\)/.test(pnl));
  ok('motion: the composed frame drives it (timeline from the song length, seed from cover + title); cover/thumbnail keeps the still 1.045 framing',
    /_farsiCamShots=_srvFarsiCamTimeline\(targetDur,/.test(comp)&&/const _cam=_live\?_srvFarsiCamera\(t,_camSeed\):null;/.test(comp)&&/const zoom=1\.045, panX=0, panY=0;/.test(comp)&&(comp.match(/cam:_camOpt[,}]/g)||[]).length===2);
  ok('motion: copied into SRV Farsi, not imported (no SRV Studio module reference in the SRV Farsi path)',!/srv2-render|SRV2_MOTION\b/.test(comp)&&!/srv2-render|SRV2_MOTION\b/.test(atmo)&&!/srv2-render/.test(pnl));
  ok('motion: the face-aware base composition is unchanged (its centre/scale are SRV English\'s "wide" base)',/bcx=\(sx\+sw\/2\)\/iw, bcy=\(sy\+sh\/2\)\/ih;/.test(pnl)&&/sc=Math\.min\(Math\.max\(cover,Math\.min\(cover\*1\.7,1\.5\)\),Math\.max\(cover,\(aim\.face\*pw\)\/\(fw\*iw\)\)\);/.test(pnl));
  ok('encoding: SRV Farsi records at SRV English\'s bitrate (8 Mbps Long, 6 Mbps Short); every other channel unchanged at 1 Mbps',/videoBitsPerSecond: isFarsiComposed \? \(isShort \? 6_000_000 : 8_000_000\) : 1_000_000/.test(h));
  // text shadow
  const sh=(comp.match(/shadowColor/g)||[]).length;
  ok('text: no shadow on the Farsi title, Latin title, header or SRV FARSI brand (only the Short card keeps its drop shadow)',sh===1&&/ctx\.save\(\); ctx\.shadowColor='rgba\(0,0,0,0\.55\)'; ctx\.shadowBlur=Math\.round\(W\*0\.05\); ctx\.shadowOffsetY=Math\.round\(W\*0\.014\);\n\s*ctx\.fillStyle='#140a07'; ctx\.beginPath\(\);/.test(comp),'shadowColor uses: '+sh);
  ok('text: no replacement glow / drop-shadow filter on text',!/filter='drop-shadow|shadowBlur=Math\.round\(W\*0\.01/.test(comp));
  ok('Long title: drawn once in plain cream with a 1.2 px (@1920) edge softening so downscaled video shows no dark ring; the filter is reset right after',
    /ctx\.font=_titleFontStr\(_titleFit\.fontSize\); ctx\.fillStyle='#fdf6e8';\n(?:\s*\/\/[^\n]*\n)+\s*ctx\.filter='blur\('\+\(1\.2\*W\/1920\)\.toFixed\(2\)\+'px\)';\n\s*const titleBottomY=_srvDrawPreSplitLinesTop\(ctx,_titleFit\.lines,tx,titleTopY,_titleLineH\);\n\s*ctx\.filter='none';/.test(comp)&&(comp.match(/_srvDrawPreSplitLinesTop\(/g)||[]).length===1&&!/strokeText/.test(comp));
  ok('Short title untouched (no edge filter in the Short)',!/_fit\.lines\.forEach[^\n]*\n?[^\n]*blur/.test(comp)&&(comp.match(/ctx\.filter='blur/g)||[]).length===1);
  // snow: run the real _drawFarsiAtmo with a recording canvas
  const rec=[];const ctx={save(){},restore(){},drawImage(img,x,y,w,hh){rec.push({x,y,w,h:hh,a:this.globalAlpha});},beginPath(){},moveTo(){},lineTo(){},stroke(){},set globalAlpha(v){this._a=v;},get globalAlpha(){return this._a;},globalCompositeOperation:''};
  const genP=new Function(top('_srvMulberry32')+top('_srvFarsiGenParticles')+';return _srvFarsiGenParticles;')();
  const mk=(mood,W,H)=>new Function('ctx','W','H','_farsiAtmo','_farsiAtmoKind','_farsiGlowSprite','SRV_FARSI_SNOW','_farsiFlake','_farsiFace',atmo.trim()+'\n  }\nreturn _drawFarsiAtmo;')(ctx,W,H,genP(mood,7,mood==='happy'?FS.count.happy:FS.count.other),'particle',()=>({}),FS,{},null);
  let down=0,up=0,big=0,n=0,maxR=0,enterTop=0;const W=1920,H=1080;
  for(const mood of ['happy','romantic']){const draw=mk(mood,W,H);
    for(let t=5;t<200;t+=7){rec.length=0;draw(t);const A=rec.slice();rec.length=0;draw(t+0.5);const B=rec.slice();
      A.forEach((p,i)=>{const q=B[i];const dy=(q.y+q.h/2)-(p.y+p.h/2);if(Math.abs(dy)>H*0.5)return;dy>0?down++:up++;n++;maxR=Math.max(maxR,p.w/2);if(p.w/2>Math.min(W,H)/1080*4.6+1e-9)big++;});}
    rec.length=0;for(let t=0;t<120;t+=0.5){rec.length=0;draw(t);rec.forEach(p=>{if(p.y+p.h<0)enterTop++;});} }
  ok('snow: every flake moves TOP → DOWN (none rises)',up===0&&down>0,'down '+down+', up '+up);
  ok('snow: flakes re-enter from ABOVE the frame',enterTop>0);
  ok('snow: small but visible flakes — radius 2.2–4.6 px per 1080 px (no blobs), opacity 0.45–0.85 with a crisp core',big===0&&maxR<=4.6+1e-9&&maxR>=3&&FS.alpha[0]===0.45&&FS.alpha[1]===0.85&&/addColorStop\(0\.45,'rgba\(255,250,240,0\.95\)'\)/.test(atmo),'max radius '+maxR.toFixed(1)+' px @1080p');
  ok('snow: gentle fall 1.5–3% of the height per second, slight drift, no swirl',FS.fall[0]===0.015&&FS.fall[1]===0.030&&FS.sway<=0.005&&FS.drift<=0.003);
  ok('snow: the large bokeh "orbs" are gone',!/for\(let i=0;i<5;i\+\+\)/.test(atmo)&&!/W\*\(0\.11\+0\.045/.test(atmo));
  ok('snow: light density (42-46 flakes), faded out near the face (as SRV English), Emotional keeps its falling rain',FS.count.happy===46&&FS.count.other===42&&/a\*=Math\.max\(0,Math\.min\(1,\(dd-0\.55\)\/0\.6\)\)/.test(atmo)&&/d\.y0\+0\.20\*t/.test(atmo));
  ok('Long title holds still once it has slid in',/const _drift=0;/.test(comp));
  // hidden-tab render guard
  const guard=top('_srvFarsiRenderWatch')+top('_srvFarsiRenderVisible');
  const doc={hidden:false,_l:null,addEventListener(e,f){this._l=f;},removeEventListener(){this._l=null;}};let now=0;
  const run=async(hideMs)=>{const f=new Function('document','performance','_srvRenderVideo','SRV_FARSI_HIDDEN_MAX_MS',guard+';return _srvFarsiRenderVisible;')(doc,{now:()=>now},async()=>{now+=1000;if(hideMs){doc.hidden=true;doc._l();now+=hideMs;doc.hidden=false;doc._l();}now+=1000;return {blob:'ok'};},1500);
    try{return (await f({})).blob;}catch(e){return 'ERR '+e.message;}};
  const r1=await run(0), r2=await run(188000);
  ok('render guard: a render with the tab in front is accepted',r1==='ok');
  ok('render guard: a render made while the tab was hidden is refused with a clear message (nothing uploaded)',/^ERR the video froze because this tab was in the background for 188 s/.test(r2)&&/Nothing was uploaded/.test(r2),r2.slice(0,90));
  const bt=top('_srvFarsiBuildTrigger');
  ok('render guard: both SRV Farsi renders (Long + Short) go through it; the operator is told to keep the tab in front',(bt.match(/await _srvFarsiRenderVisible\(\{/g)||[]).length===2&&!/await _srvRenderVideo\(/.test(bt)&&/keep this tab open and in front/.test(bt)); }
// ── Fix pass: text animation ──
{ ok('ease-out slide helper; the cover/thumbnail capture is always the settled frame',/const _in=function\(a,b\)\{ if\(skipFade\)return 1;/.test(comp)&&/const _live=skipFade\?0:1;/.test(comp));
  const long=comp.slice(comp.indexOf('if(!isShort){'),comp.indexOf('// ── SHORT (visual benchmark)'));
  const short=comp.slice(comp.indexOf('// ── SHORT (visual benchmark)'));
  ok('Long: title, Latin title and wordmark each slide in from the title side, staggered',/ctx\.translate\(\(1-pT\)\*_dir\*W\*0\.09/.test(long)&&/ctx\.translate\(\(1-pF\)\*_dir\*W\*0\.07/.test(long)&&/ctx\.translate\(\(1-pW\)\*_dir\*W\*0\.05/.test(long)&&/_in\(0\.35,1\.30\)/.test(long)&&/_in\(0\.75,1\.60\)/.test(long)&&/_in\(1\.05,1\.90\)/.test(long));
  ok('Long: slide direction follows the title side (left or right)',/const _dir=titleSide==='left'\?-1:1;/.test(long));
  ok('Short: title slides in from the right, Latin title from the left',/ctx\.translate\(\(1-pT\)\*W\*0\.10,0\)/.test(short)&&/ctx\.translate\(-\(1-pF\)\*W\*0\.10,0\)/.test(short));
  ok('Short: header slides down, card rises, footer slides up',/ctx\.translate\(0,-\(1-pH\)\*H\*0\.04\)/.test(short)&&/\(1-pC\)\*H\*0\.025/.test(short)&&/ctx\.translate\(0,\(1-pFo\)\*H\*0\.03\)/.test(short));
  ok('Short: the cover card uses the space the lyric line used to take (no new clutter)',/cH=Math\.round\(H\*0\.585\)/.test(short)&&!/lyricLines|lyricTimings/.test(short));
  // ── Fix pass: Short text information ──
  ok('Short: channel header',/fillText\('SILK ROAD VOICES',W\/2/.test(short)&&/fillText\('PERSIAN LOVE SONGS',W\/2/.test(short));
  ok('Short: cover card carries Farsi title, Latin title and genre',/_srvFitFarsiTitle\(ctx,_rawTitle,cW-_cPad\*2/.test(short)&&/String\(titleFinglish\)\.toUpperCase\(\),W\/2,_finY/.test(short)&&/fillText\('PERSIAN LOVE SONG',W\/2,_genreY\)/.test(short));
  ok('Short: brand + follow line',/const _brand='SRV FARSI'/.test(short)&&/آهنگ‌های بیشتر در کانال ما/.test(short));
  const ys=[...short.matchAll(/Math\.round\(H\*(0\.\d+)\)/g)].map(m=>parseFloat(m[1]));
  ok('Short: all text sits inside the platform safe zones (below the top 8%, above the bottom 15%)',Math.min(...ys)>=0.08&&Math.max(...ys)<=0.85,'y range '+Math.min(...ys)+' to '+Math.max(...ys));
  ok('Short: title, Latin title, genre, header and brand/follow line are kept',/fillText\('SILK ROAD VOICES',W\/2/.test(short)&&/String\(titleFinglish\)\.toUpperCase\(\),W\/2,_finY/.test(short)&&/const _brand='SRV FARSI'/.test(short)); }
// ── Fix pass: fonts ready before the cover, rotation visible at Approve ──
ok('fonts are loaded with the real title/lyric text before the cover is captured',/_srvFarsiEnsureFonts\(\[title,titleFinglish,hookText,lyrics\]\.join\(' '\)\)/.test(h)&&/document\.fonts\.load\("600 58px 'Noto Nastaliq Urdu'",_txt\)/.test(h));
ok('build records which library image it used',/pkg\._srvVisualPoolPos=\{n:_fLibA\.indexOf\(_fPicked\)\+1,of:_fLibA\.length/.test(build0));
ok('Approve stage shows "Cover N of M" and whether it was chosen at Build',/Cover \$\{Number\(pkg\._srvVisualPoolPos\.n\)\|\|'\?'\} of \$\{Number\(pkg\._srvVisualPoolPos\.of\)/.test(h)&&/pkg\._srvAvatarChoice\.how==='manual'/.test(h));
ok('build passes the face box to both the Short and the Long render',(build0.match(/avatarFaceW:_fAvFocus\.w/g)||[]).length===2);


// ── 4. Thumbnails: real helper with mocked network ──
function env(setOk,uploadFails){
  const calls=[];
  const e={calls,console:{warn(){},log(){}},File:class{constructor(p,n,o){this.name=n;this.type=o&&o.type;this.size=p[0]&&p[0].size;}},
    _srvUploadToStorage:async(id,file,kind)=>{calls.push(['upload',id,file.name,file.type,kind]);if(uploadFails)throw new Error('upload thumb failed (500)');return 'https://x/storage/'+id+'/thumb.jpg';},
    fetch:async(u,o)=>{if(String(u).startsWith('data:'))return {blob:async()=>({size:1234})};
      calls.push(['api',u,JSON.parse(o.body)]);return {status:setOk?200:500,json:async()=>setOk?{ok:true,videoId:JSON.parse(o.body).videoId}:{ok:false,error:'yt_thumb_failed'}};}};
  e._publishFetch=e.fetch; // SRV-STUDIO-V2-017: publishing calls go through _publishFetch (same request + the session)
  e.fn=new Function(...Object.keys(e),top('_srvFarsiSetYouTubeThumbnail')+'\nreturn _srvFarsiSetYouTubeThumbnail;')(...Object.values(e));return e;
}
{ const e=env(true);const pkg={id:'pkg_1',_srvThumbDataUrl:'data:image/jpeg;base64,AAAA'};const r=await e.fn(pkg,'vidLONG');
  ok('thumbnail: cover uploaded to storage as JPEG',e.calls[0][0]==='upload'&&e.calls[0][3]==='image/jpeg'&&e.calls[0][4]==='thumb');
  ok('thumbnail: set on YouTube for the right video and engine',e.calls[1][1].includes('set_yt_thumbnail')&&e.calls[1][2].videoId==='vidLONG'&&e.calls[1][2].engine==='SRV Farsi'&&e.calls[1][2].thumbUrl===pkg._srvThumbUrl);
  ok('thumbnail: success recorded on the package',r.ok===true&&pkg.thumbnailSetOnYoutube===true&&pkg.thumbnailError===null);
  ok('thumbnail: inline image dropped after upload',!pkg._srvThumbDataUrl&&!!pkg._srvThumbUrl);
  const n=e.calls.length;await e.fn(pkg,'vidLONG');
  ok('thumbnail: retry reuses the stored cover (no second upload)',e.calls.filter(c=>c[0]==='upload').length===1&&e.calls.length===n+1); }
{ const e=env(false);const pkg={id:'pkg_2',_srvThumbDataUrl:'data:image/jpeg;base64,AAAA'};const r=await e.fn(pkg,'vidSHORT');
  ok('thumbnail: YouTube refusal is non-fatal and recorded',r.ok===false&&pkg.thumbnailSetOnYoutube===false&&pkg.thumbnailError==='yt_thumb_failed'); }
{ const e=env(true,true);const pkg={id:'pkg_3',_srvThumbDataUrl:'data:image/jpeg;base64,AAAA'};const r=await e.fn(pkg,'v');
  ok('thumbnail: storage failure is non-fatal and recorded',r.ok===false&&pkg.thumbnailSetOnYoutube===false&&/upload thumb failed/.test(pkg.thumbnailError)); }
{ const e=env(true);const pkg={id:'pkg_4'};const r=await e.fn(pkg,'v');
  ok('thumbnail: no cover captured -> reported, nothing sent',r.ok===false&&pkg.thumbnailError==='no_cover_captured'&&e.calls.length===0); }
const build=top('_srvFarsiBuildTrigger'),runPub=top('_srvFarsiRunPublish'),pubYT=top('_srvFarsiPublishYouTube');
ok('build stores a cover for Shorts and Longs, and a rebuild invalidates the old thumbnail',(build.match(/delete pkg\._srvThumbUrl;pkg\.thumbnailSetOnYoutube=false;/g)||[]).length===2);
ok('Long publish sets the YouTube thumbnail',/_srvFarsiSetYouTubeThumbnail\(pkg,_longYtId\)/.test(runPub));
ok('Short publish sets the YouTube thumbnail',/_srvFarsiSetYouTubeThumbnail\(pkg,_ytId\)/.test(pubYT));
const rv=top('_srvRenderVideo');
ok('renderer captures a clean cover for SRV Farsi Shorts too',/_thumbCaptureMode = isFarsiComposed;/.test(rv)&&/if\(!isShort\|\|isFarsiComposed\)/.test(rv));

// ── 5. Other engines untouched ──
ok('SRV English build keeps its own (unchanged) thumbnail line',/if\(longResult\.thumbDataUrl\)pkg\._srvThumbDataUrl=longResult\.thumbDataUrl;/.test(top('_srvEnglishBuildTrigger')));
ok('non-Farsi renders still capture Long-only covers',/if\(!isShort\|\|isFarsiComposed\)/.test(rv));

// ── Publishing: playlists, AI Use, description ──
{ const ops=fs.readFileSync(path.join(path.dirname(process.argv[2]||'public/index.html'),'..','api','ops.js'),'utf8');
  const runPub=top('_srvFarsiRunPublish'), pubYT=top('_srvFarsiPublishYouTube'), plf=top('_srvFarsiPublishPlaylists');
  const pl=new Function('_srvFarsiPlaylistCategory',plf+'\nreturn _srvFarsiPublishPlaylists;')(new Function(top('_srvFarsiPlaylistCategory')+'\nreturn _srvFarsiPlaylistCategory;')());
  const cases=[['Female — Romantic',true,'romantic'],['Female — Romantic',false,'short'],['Male — Emotional',false,'short'],['Duet — Happy',true,'happy'],['Duet — Emotional',true,'emotional'],['Male — Happy',false,'short']];
  ok('playlists: Long → its mood playlist; Short → Shorts ONLY, whatever its mood',cases.every(([m,L,want])=>pl({mood:m},L).join()===want),cases.map(([m,L])=>m+(L?' Long':' Short')+'='+pl({mood:m},L).join('+')).join(' | '));
  ok('both SRV Farsi uploads send the playlists chosen at Approve and AI Use = YES',/farsiPlaylists:_srvFarsiPlaylistSelection\(pkg,_farsiPubTask,isLong\)\.ids/.test(runPub)&&/containsSyntheticMedia:true/.test(runPub)&&/farsiPlaylists:_srvFarsiPlaylistSelection\(pkg,_farsiPubTask,false\)\.ids/.test(pubYT)&&/containsSyntheticMedia:true/.test(pubYT)&&!/playlistCategory:_farsiPlaylistCat/.test(runPub+pubYT));
  const mapSrc=ops.slice(ops.indexOf('const SRV_FARSI_PLAYLISTS = {'),ops.indexOf('};',ops.indexOf('const SRV_FARSI_PLAYLISTS = {'))+2);
  const MAP=new Function(mapSrc.replace('const SRV_FARSI_PLAYLISTS = ','return '))();
  ok('server: approved existing playlists by ID (Romantic+Happy → Happy Romantic 🌹, Emotional → Emotional ❤️, Short → |Shorts)',
    MAP.romantic.id==='PL64rNOGmVdtKzlinRGxx3xxyKTxXqCku3'&&MAP.happy.id==='PL64rNOGmVdtKzlinRGxx3xxyKTxXqCku3'&&MAP.emotional.id==='PL64rNOGmVdtLS9WmXx0B1FyRf3MldJbnF'&&MAP.short.id==='PL64rNOGmVdtIM7hfzvb6U9yNPZncyf7Bh'&&
    MAP.romantic.title==='Silk Road Voices | Happy Romantic 🌹'&&MAP.emotional.title==='Silk Road Voices | Emotional ❤️'&&MAP.short.title==='Silk Road Voices |Shorts');
  const resolve=new Function('SRV_FARSI_PLAYLISTS',ops.slice(ops.indexOf('function _srvFarsiResolvePlaylists('),ops.indexOf('\n}\n',ops.indexOf('function _srvFarsiResolvePlaylists('))+2)+'\nreturn _srvFarsiResolvePlaylists;')(MAP);
  const ids=k=>resolve(k).map(t=>t.id).join();
  ok('server: Long = mood playlist only, Short = mood + Shorts, by ID; unknown keys dropped',ids(['romantic'])==='PL64rNOGmVdtKzlinRGxx3xxyKTxXqCku3'&&ids(['happy','short'])==='PL64rNOGmVdtKzlinRGxx3xxyKTxXqCku3,PL64rNOGmVdtIM7hfzvb6U9yNPZncyf7Bh'&&ids(['emotional','short'])==='PL64rNOGmVdtLS9WmXx0B1FyRf3MldJbnF,PL64rNOGmVdtIM7hfzvb6U9yNPZncyf7Bh'&&ids(['bogus'])==='');
  ok('server: SRV Farsi never creates, renames or name-matches playlists at upload',!/_ytGetOrCreatePlaylist|_srvFarsiListPlaylists/.test(ops.slice(ops.indexOf("if (engine === 'SRV Farsi' && Array.isArray(farsiPlaylists)"),ops.indexOf("} else if (playlistCategory && youtubeVideoId && engine !== 'SRV Farsi')"))));
  ok('client: Approve shows the approved playlist names',/const SRV_FARSI_PLAYLIST_NAMES=\{romantic:'Silk Road Voices \| Happy Romantic 🌹',happy:'Silk Road Voices \| Happy Romantic 🌹',emotional:'Silk Road Voices \| Emotional ❤️',short:'Silk Road Voices \|Shorts'\};/.test(h));
  const up=ops.slice(ops.indexOf('async function youtubeUploadVideo('),ops.indexOf('\n}\n',ops.indexOf('async function youtubeUploadVideo(')));
  ok('server: SRV Farsi never uses the legacy create-if-missing playlist path',/else if \(playlistCategory && youtubeVideoId && engine !== 'SRV Farsi'\)/.test(up));
  ok('server: AI Use is the structured YouTube field status.containsSyntheticMedia',/metadata\.status\.containsSyntheticMedia = true;/.test(up));
  ok('server: the Persian AI line is no longer appended for SRV Farsi (other engines unchanged)',/const _isSrvFarsi = engine === 'SRV Farsi';/.test(up)&&/if \(!_isSrvFarsi && hasFarsiChars && !\/هوش مصنوعی\/\.test\(descClean\)\)/.test(up)&&/if \(!_isSrvFarsi && !hasFarsiChars/.test(up));
  ok('client: the SRV Farsi description builder contains no AI sentence',!/هوش مصنوعی/.test(top('_srvFarsiYouTubeDescription')));
  ok('VA screens show AI Use / Altered content: YES (set automatically), no manual Studio step left',(h.match(/AI Use \/ Altered content: YES<\/strong>/g)||[]).length===2&&!/AI Disclosure required:/.test(h)); }
console.log(out.join('\n'));console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
})();
