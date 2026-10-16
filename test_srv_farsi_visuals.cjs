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
ok('Long: title side is a masked veil that dissolves into the photo',/_farsiLongVeil/.test(comp)&&/destination-in/.test(comp));
ok('photo never shrinks below its edge while animating (zoom floor 1, pan limited to the zoom margin)',/const z=Math\.max\(1,zoom\|\|1\)/.test(panel)&&/\*\(z-1\)\*0\.9/.test(panel));
ok('Long: romanized line is a restrained sans (no monospace caps block)',/500 \$\{Math\.round\(W\*0\.0195\)\}px 'Vazirmatn'/.test(comp)&&!/IBM Plex Mono', monospace`;\s*\n\s*ctx\.fillStyle='rgba\(253,246,232,0\.82\)'/.test(comp));
ok('Long/Short: title type is cream, not pure white',(comp.match(/#fdf6e8/g)||[]).length>=2&&!/fillStyle='#fff(fff)?'/.test(comp));
ok('Short: lyric line larger and cream with a deep soft shadow',/600 \$\{Math\.round\(W\*0\.054\)\}px 'Noto Nastaliq Urdu'/.test(comp)&&/shadowColor='rgba\(8,4,2,0\.92\)'/.test(comp));
ok('Short: cover frame shows the lyric line (not captured mid fade-in)',/const alpha=skipFade\?1:/.test(comp));
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

// ── 3. Shared visual pool: ONE pool per artist x mood, used by Shorts and Longs ──
const path=require('path');const pubDir=path.dirname(process.argv[2]||'public/index.html');
const farsiCfg=(()=>{const s=h.indexOf('{id:"srv_farsi"');const e=h.indexOf('\n  {id:"srv_english"',s);return h.slice(s,e);})();
ok('no separate Short/Long library remains for SRV Farsi',!/avatarLibrary/.test(farsiCfg)&&/avatarPool:\{/.test(farsiCfg));
const pools=(()=>{const s=farsiCfg.indexOf('avatarPool:{');const e=farsiCfg.lastIndexOf('}},');return new Function('return {'+farsiCfg.slice(s,e)+'}}')().avatarPool;})();
const src=e=>typeof e==='string'?e:e.src;
const plist=[];for(const a of Object.keys(pools))for(const m of Object.keys(pools[a]))plist.push([a+'.'+m,pools[a][m]]);
ok('9 pools: 3 artists x 3 moods, no format level',plist.length===9&&Object.keys(pools).sort().join()==='duet,female,male'&&Object.values(pools).every(x=>Object.keys(x).sort().join()==='emotional,happy,romantic'));
const missing=plist.flatMap(([k,arr])=>arr.map(src).filter(u=>fs.existsSync(pubDir)&&!fs.existsSync(path.join(pubDir,u))));
ok('every pool image exists on disk',missing.length===0,missing.slice(0,2).join(','));
ok('no image is listed twice anywhere',new Set(plist.flatMap(([k,arr])=>arr.map(src))).size===plist.reduce((n,[k,arr])=>n+arr.length,0));
ok('every image belongs to its pool (artist + mood in the file name)',plist.every(([k,arr])=>{const [a,m]=k.split('.');return arr.every(e=>src(e).includes('_'+a+'_'+m+'_'));}));
ok('every pool has more than two images',plist.every(([k,arr])=>arr.length>2),plist.map(([k,arr])=>k+'='+arr.length).join(' '));
ok('landscape sources carry a subject focal point for the 9:16 crop',plist.every(([k,arr])=>arr.every(e=>!/\/long\//.test(src(e))||(typeof e==='object'&&e.fx>0&&e.fx<1))));
out.push('INFO usable images per pool: '+plist.map(([k,arr])=>k+'='+arr.length).join(' ')+' | total '+plist.reduce((n,[k,arr])=>n+arr.length,0));
out.push('INFO missing to reach 6 per pool: '+plist.map(([k,arr])=>k+'='+Math.max(0,6-arr.length)).join(' ')+' | total '+plist.reduce((n,[k,arr])=>n+Math.max(0,6-arr.length),0));
// real picker on the REAL pools: every rebuild moves to the next source, whole pool before any repeat
{ const Dr={};const pk=new Function('D',nested('    function _farsiPickAvatar(pool,bucketKey){')+'\nreturn _farsiPickAvatar;')(Dr);
  let allOk=true;for(const [k,arr] of plist){const got=Array.from({length:arr.length+1},()=>src(pk(arr,k)));
    if(new Set(got.slice(0,arr.length)).size!==arr.length||got[arr.length]!==got[0])allOk=false;}
  ok('REAL pools: A -> B -> C -> D -> A in every one of the 9 pools',allOk);
  ok('REAL pools: each pool keeps its own pointer',Object.keys(Dr.srvFarsiAvatarIdx).sort().join()===plist.map(x=>x[0]).sort().join()&&Object.values(Dr.srvFarsiAvatarIdx).every(v=>v===1)); }
const build0=top('_srvFarsiBuildTrigger');
ok('build picks by artist.mood (no format in the pointer key), so Short and Long share the rotation',/_farsiPickAvatar\(_fPool,_fGroup\+'\.'\+_fMoodKey\)/.test(build0)&&!/_fFormatKey/.test(build0));
ok('build passes the focal point to both the Short and the Long render',(build0.match(/avatarFocusX:_fAvFocus\.x, avatarFocusY:_fAvFocus\.y/g)||[]).length===2);
// ── Fix pass: face-first framing (the real expressions from the painter) ──
{ const a=panel.indexOf('const fx='),b=panel.indexOf('const z=Math.max');
  const frame=new Function('iw','ih','px','py','pw','ph','aim','avatarFocusX','avatarFocusY','avatarFaceW','let faceX=px+pw*aim.x, faceY=py+ph*aim.y, faceR=pw*0.2;'+panel.slice(a,b)+'\nreturn {sx,sy,sw,sh,sc,cover,faceX,faceY,faceW:fw*iw*sc};');
  const LONG={x:0.60,y:0.40,face:0.21}, CARD={x:0.5,y:0.37,face:0.30};
  const inside=(r,iw,ih)=>r.sx>=-1e-6&&r.sy>=-1e-6&&r.sx+r.sw<=iw+1e-6&&r.sy+r.sh<=ih+1e-6;
  let allIn=true,faceIn=true,faceBig=true,notSoft=true,n=0; const worst=[];
  for(const [key,pool] of plist) for(const e of pool){
    const land=/\/long\//.test(e.src), iw=land?1672:941, ih=land?941:1672;
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
  ok('camera moves about the face (zoom + pan pivot on the face, not the panel centre)',/ctx\.translate\(faceX\+\(o\.panX\|\|0\)\*mx,faceY\+\(o\.panY\|\|0\)\*my\); ctx\.scale\(z,z\); ctx\.translate\(-faceX,-faceY\)/.test(panel));
  ok('photo is drawn with high-quality smoothing and real colour',/imageSmoothingQuality='high'/.test(panel)&&!/ctx\.filter='[^']*grayscale/.test(panel)); }
// ── Fix pass: motion ──
{ const atmo=(()=>{const s2=h.indexOf('  function _drawFarsiAtmo(');return h.slice(s2,h.indexOf('\n  }\n',s2));})();
  const sp=atmo.match(/p\.y0-\(([\d.]+)\+([\d.]+)\*d\)\*t/);
  ok('particles rise faster than before (was 0.077 of the frame height per second)',sp&&parseFloat(sp[1])>0.077&&parseFloat(sp[1])+parseFloat(sp[2])>=0.2,sp&&('now '+sp[1]+' to '+(parseFloat(sp[1])+parseFloat(sp[2])).toFixed(3)));
  ok('particle field is denser (was 20-22)',/_srvFarsiMoodKey\(mood\)==='happy'\?46:42/.test(h));
  ok('three depth layers: drifting bokeh + particles + (Emotional) rain',/for\(let i=0;i<7;i\+\+\)/.test(atmo)&&/_farsiAtmoKind==='particle'/.test(atmo)&&/d\.y0\+0\.46\*t/.test(atmo));
  ok('no per-particle blur filter (sprite stamping keeps the denser field real-time)',!/ctx\.filter=`blur/.test(atmo)&&/drawImage\(sp,/.test(atmo));
  const z=comp.match(/const zoom=1\.09\+_live\*\(\(([\d.]+)\*_farsiIntensityMul\)\*_cyc\((\d+),0\)\+([\d.]+)\*_cyc\(([\d.]+),1\)\)/);
  ok('camera push is stronger and quicker (was +/-2.8% over 15-20s)',z&&parseFloat(z[1])>0.028&&parseInt(z[2])<15,z&&('now +/-'+(z[1]*100)+'% over '+z[2]+'s plus a '+z[4]+'s breath'));
  ok('camera zoom can never drop below 1 at any intensity (no photo edge revealed)',z&&1.09-parseFloat(z[1])*1.3-parseFloat(z[3])>=1);
  ok('camera also pans, and a light sweep crosses the photo',/panX:panX,panY:panY,sweep:sweep/.test(comp)&&(comp.match(/panX:panX,panY:panY,sweep:sweep/g)||[]).length===2);
  ok('Short backdrop drifts (blurred photo + moving gradient)',/_farsiShortBg/.test(comp)&&/_cyc\(17,0\)/.test(comp)&&/_cyc\(21,0\)/.test(comp)); }
// ── Fix pass: text animation ──
{ ok('ease-out slide helper; the cover/thumbnail capture is always the settled frame',/const _in=function\(a,b\)\{ if\(skipFade\)return 1;/.test(comp)&&/const _live=skipFade\?0:1;/.test(comp));
  const long=comp.slice(comp.indexOf('if(!isShort){'),comp.indexOf('// ── SHORT (visual benchmark)'));
  const short=comp.slice(comp.indexOf('// ── SHORT (visual benchmark)'));
  ok('Long: title, Latin title and wordmark each slide in from the title side, staggered',/ctx\.translate\(\(1-pT\)\*_dir\*W\*0\.09/.test(long)&&/ctx\.translate\(\(1-pF\)\*_dir\*W\*0\.07/.test(long)&&/ctx\.translate\(\(1-pW\)\*_dir\*W\*0\.05/.test(long)&&/_in\(0\.35,1\.30\)/.test(long)&&/_in\(0\.75,1\.60\)/.test(long)&&/_in\(1\.05,1\.90\)/.test(long));
  ok('Long: slide direction follows the title side (left or right)',/const _dir=titleSide==='left'\?-1:1;/.test(long));
  ok('Short: title slides in from the right, Latin title from the left',/ctx\.translate\(\(1-pT\)\*W\*0\.10,0\)/.test(short)&&/ctx\.translate\(-\(1-pF\)\*W\*0\.10,0\)/.test(short));
  ok('Short: header slides down, card rises, footer slides up',/ctx\.translate\(0,-\(1-pH\)\*H\*0\.04\)/.test(short)&&/\(1-pC\)\*H\*0\.025/.test(short)&&/ctx\.translate\(0,\(1-pFo\)\*H\*0\.03\)/.test(short));
  ok('Short: each lyric line slides in from alternating sides',/\(\(idx%2\)\?-1:1\)\*W\*0\.07/.test(short));
  // ── Fix pass: Short text information ──
  ok('Short: channel header',/fillText\('SILK ROAD VOICES',W\/2/.test(short)&&/fillText\('PERSIAN LOVE SONGS',W\/2/.test(short));
  ok('Short: cover card carries Farsi title, Latin title and genre',/_srvFitFarsiTitle\(ctx,_rawTitle,cW-_cPad\*2/.test(short)&&/String\(titleFinglish\)\.toUpperCase\(\),W\/2,_finY/.test(short)&&/fillText\('PERSIAN LOVE SONG',W\/2,_genreY\)/.test(short));
  ok('Short: brand + follow line',/const _brand='SRV FARSI'/.test(short)&&/آهنگ‌های بیشتر در کانال ما/.test(short));
  const ys=[...short.matchAll(/Math\.round\(H\*(0\.\d+)\)/g)].map(m=>parseFloat(m[1]));
  ok('Short: all text sits inside the platform safe zones (below the top 8%, above the bottom 15%)',Math.min(...ys)>=0.08&&Math.max(...ys)<=0.85,'y range '+Math.min(...ys)+' to '+Math.max(...ys));
  ok('Short: lyric keeps the benchmark treatment (Nastaliq, cream, deep shadow)',/600 \$\{Math\.round\(W\*0\.054\)\}px 'Noto Nastaliq Urdu'/.test(short)&&/rgba\(8,4,2,0\.92\)/.test(short)); }
// ── Fix pass: fonts ready before the cover, rotation visible at Approve ──
ok('fonts are loaded with the real title/lyric text before the cover is captured',/_srvFarsiEnsureFonts\(\[title,titleFinglish,hookText,lyrics\]\.join\(' '\)\)/.test(h)&&/document\.fonts\.load\("600 58px 'Noto Nastaliq Urdu'",_txt\)/.test(h));
ok('build records which pool image it used',/pkg\._srvVisualPoolPos=\{n:_fPool\.indexOf\(_fPicked\)\+1,of:_fPool\.length/.test(build0));
ok('Approve stage shows "Image N of M" so a Rebuild\'s rotation is visible',/Image \$\{Number\(pkg\._srvVisualPoolPos\.n\)\|\|'\?'\} of \$\{Number\(pkg\._srvVisualPoolPos\.of\)/.test(h));
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

console.log(out.join('\n'));console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
})();
