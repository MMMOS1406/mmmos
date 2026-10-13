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
ok('Long: photo drawn edge-to-edge with no border and no rounded frame',/_drawFarsiPanel\(panelX,panelTop,panelW,panelH,_zoomL,0,false,false\)/.test(comp)&&/panelH=H, panelTop=0/.test(comp));
ok('Long: no framed-panel call remains',!/_drawFarsiPanel\([^)]*,18,true,true\)/.test(comp));
ok('Long: title side is a masked veil that dissolves into the photo',/_farsiLongVeil/.test(comp)&&/destination-in/.test(comp));
ok('Long: photo never shrinks below its edge while animating',/const _zoomL=1\.03\+\(zoom-1\)/.test(comp));
ok('Long: romanized line is a restrained sans (no monospace caps block)',/500 \$\{Math\.round\(W\*0\.0185\)\}px 'Vazirmatn'/.test(comp)&&!/IBM Plex Mono', monospace`;\s*\n\s*ctx\.fillStyle='rgba\(253,246,232,0\.82\)'/.test(comp));
ok('Long/Short: title type is cream, not pure white',(comp.match(/#fdf6e8/g)||[]).length>=3);
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
// focal crop maths (the real expressions from the painter)
{ const pn=(()=>{const s=h.indexOf('  function _drawFarsiPanel(');return h.slice(s,h.indexOf('\n  }\n',s));})();
  const a=pn.indexOf('const _fx='),b=pn.indexOf('\n',pn.indexOf('else { sw=iw;'));
  const crop=new Function('iw','ih','pw','ph','avatarFocusX','avatarFocusY','const ir=iw/ih,pr=pw/ph;let sw,sh,sx,sy;'+pn.slice(a,b)+'\nreturn {sx,sy,sw,sh};');
  const L=crop(1672,941,1080,1920,0.33,undefined);            // landscape source -> 9:16 Short, subject at 33%
  ok('landscape -> Short crop is centred on the subject and stays inside the image',Math.abs((L.sx+L.sw/2)/1672-0.33)<0.01&&L.sx>=0&&L.sx+L.sw<=1672&&Math.round(L.sh)===941);
  const C=crop(1672,941,1080,1920,undefined,undefined);
  ok('no focal point -> centred crop (previous behaviour)',Math.abs((C.sx+C.sw/2)/1672-0.5)<0.001);
  const E=crop(1672,941,1080,1920,0.02,undefined);
  ok('extreme focal point is clamped to the image edge',E.sx===0);
  const P=crop(941,1672,1229,1080,undefined,undefined);       // portrait source -> Long subject panel
  ok('portrait -> Long crop keeps the upper (face) area',Math.abs(P.sy-(1672-P.sh)*0.2)<0.001&&P.sw===941); }

// ── 4. Thumbnails: real helper with mocked network ──
function env(setOk,uploadFails){
  const calls=[];
  const e={calls,console:{warn(){},log(){}},File:class{constructor(p,n,o){this.name=n;this.type=o&&o.type;this.size=p[0]&&p[0].size;}},
    _srvUploadToStorage:async(id,file,kind)=>{calls.push(['upload',id,file.name,file.type,kind]);if(uploadFails)throw new Error('upload thumb failed (500)');return 'https://x/storage/'+id+'/thumb.jpg';},
    fetch:async(u,o)=>{if(String(u).startsWith('data:'))return {blob:async()=>({size:1234})};
      calls.push(['api',u,JSON.parse(o.body)]);return {status:setOk?200:500,json:async()=>setOk?{ok:true,videoId:JSON.parse(o.body).videoId}:{ok:false,error:'yt_thumb_failed'}};}};
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
