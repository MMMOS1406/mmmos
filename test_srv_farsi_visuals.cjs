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

// ── 3. Asset pool audit: manifest vs files ──
const lib=(()=>{const s=h.indexOf('avatarLibrary:{',h.indexOf('id:"srv_farsi"'));const e=h.indexOf('\n   }},',s);return new Function('return {'+h.slice(s,e)+'\n   }}')().avatarLibrary;})();
const buckets=[];for(const f of Object.keys(lib))for(const a of Object.keys(lib[f]))for(const m of Object.keys(lib[f][a]))buckets.push([f+'.'+a+'.'+m,lib[f][a][m]]);
ok('18 buckets (2 formats x 3 artists x 3 moods)',buckets.length===18);
const missing=buckets.flatMap(([k,arr])=>arr.filter(u=>!fs.existsSync(require('path').join(require('path').dirname(process.argv[2]||'public/index.html'),u))));
ok('every manifest photo exists on disk',missing.length===0,missing.slice(0,2).join(','));
const counts=buckets.map(([k,arr])=>k+'='+arr.length);
ok('per-bucket image counts recorded',true,counts.join(' '));
const thin=buckets.filter(([k,arr])=>arr.length<3).map(([k])=>k);
out.push('INFO buckets with fewer than 3 photos (cannot rotate beyond two): '+thin.length+'/18');

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
