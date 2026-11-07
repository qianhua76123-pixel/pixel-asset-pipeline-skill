(() => {
'use strict';
const $=id=>document.getElementById(id),E=window.RigEngine,M=window.SceneMovement,R=window.SceneRaster,D=window.RIG_LIVE_BUNDLE;
const names={down:'正面',right:'向右',up:'背面',left:'向左'},keyMap={KeyW:'up',ArrowUp:'up',KeyA:'left',ArrowLeft:'left',KeyS:'down',ArrowDown:'down',KeyD:'right',ArrowRight:'right'};
const textures=new Map(),held=new Map(),canvas=$('scene'),context=canvas.getContext('2d'),actorCanvas=document.createElement('canvas');actorCanvas.width=96;actorCanvas.height=96;const actorContext=actorCanvas.getContext('2d');
let actor=M.create(),model,sceneImage,ready=false,zoom=2,speed=1,gait='s12',palette='original',headStyle='original',outfit='original',outfitNote='',appearance={hair:'original',skin:'original'},last=0,raf=0;
const inputDirection=()=>[...held.values()].at(-1)||null;
function normalizeOutfit(){const c=model.characters.get('heqing'),r=E.resolveOutfit(c,outfit,actor.direction);if(r.fallback){outfit=r.effective;outfitNote=r.reason;}const select=$('outfit');select.value=outfit;for(const option of select.options)option.disabled=!E.outfitDirections(c,option.value).includes(actor.direction);$('outfit-note').textContent=outfitNote||(outfit==='moon-celadon-four-view'?'月白豆青汉服四向候选；共用原头脸、手鞋和动作，裙摆仍是刚性片。':'石青日常上衣四向候选；裤鞋沿用原衣，领口与色阶仍待统一。');}
function syncTechnicalLink(){$('technical-link').href='technical/index.html?view='+window.SceneHandoff.encode({outfit,headStyle,hair:appearance.hair,skin:appearance.skin,palette,gait,direction:actor.direction,action:actor.action,phase:actor.action==='walk'?actor.phase:0});}
function setZoom(){zoom=+$('zoom').value;canvas.width=Math.ceil(innerWidth/zoom);canvas.height=Math.ceil(innerHeight/zoom);canvas.style.width=canvas.width*zoom+'px';canvas.style.height=canvas.height*zoom+'px';context.imageSmoothingEnabled=false;if(ready)draw();}
function draw(){if(!ready)return;normalizeOutfit();syncTechnicalLink();const camera=M.camera(actor.x,actor.y,canvas.width,canvas.height),options={character:'heqing',direction:actor.direction,outfit,action:actor.action,phase:actor.action==='walk'?actor.phase:0,gait,palette,appearance,faceMode:'auto',blinkTimeMs:actor.blinkTimeMs,headStyle,equipment:{}};
 const result=R.render(E,model,textures,options,actor.x,actor.y);if(result.clippedPixels)throw Error('角色裁片越过固定动作画布');actorContext.putImageData(new ImageData(result.pixels,96,96),0,0);
 context.fillStyle='#293c32';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(sceneImage,-camera.x,-camera.y);context.drawImage(actorCanvas,result.origin[0]-camera.x,result.origin[1]-camera.y);
 if($('bones').checked){const j=result.pose.joints,point=p=>[Math.round(p[0]+actor.x-32-camera.x)+.5,Math.round(p[1]+actor.y-58-camera.y)+.5];context.lineWidth=1;for(const [a,b]of model.characters.get('heqing').bones){if(!j[a]||!j[b])continue;context.strokeStyle=b.endsWith('A')?'#f1b37b':'#92d2c4';context.beginPath();context.moveTo(...point(j[a]));context.lineTo(...point(j[b]));context.stroke();}for(const p of Object.values(j)){const [x,y]=point(p);context.fillStyle='#f3e7b9';context.fillRect(x-.5,y-.5,1,1);}}
 $('head-note').textContent=actor.direction==='up'?'背面保留真实后脑，不套用五官。':'原版 / A 使用本方向真实头片；行走中按独立时钟自然眨眼。';
 const p=Math.floor(actor.phase)+1;$('state-label').textContent=(actor.moving?'行走 '+p+'/8':'待机')+' · '+names[actor.direction];$('scale-label').textContent=`${zoom}×整数视野 · 896×512场景 · 慢步${15*speed} world px/s`;
 for(const b of document.querySelectorAll('[data-direction]'))b.setAttribute('aria-pressed',String(held.get('pointer')===b.dataset.direction));
}
function schedule(){if(!raf&&ready&&!document.hidden)raf=requestAnimationFrame(tick);}
function tick(now){raf=0;const dt=last?Math.min((now-last)/1000,.05):0;last=now;actor=M.step(actor,inputDirection(),dt,speed);draw();if(inputDirection()&&!document.hidden)schedule();else last=0;}
function stop(){held.clear();last=0;if(raf)cancelAnimationFrame(raf);raf=0;if(ready){actor=M.step(actor,null,0,speed);draw();}}
function setInput(id,direction){held.delete(id);held.set(id,direction);schedule();}
function release(id){held.delete(id);if(!held.size){if(raf)cancelAnimationFrame(raf);raf=0;last=0;actor=M.step(actor,null,0,speed);draw();}}
function editable(target){return target instanceof Element&&!!target.closest('select,input,textarea,button,a,summary');}
document.addEventListener('keydown',e=>{const direction=keyMap[e.code];if(!direction||editable(e.target))return;e.preventDefault();if(!held.has(e.code))setInput(e.code,direction);});document.addEventListener('keyup',e=>{if(keyMap[e.code]){release(e.code);if(!editable(e.target))e.preventDefault();}});
for(const b of document.querySelectorAll('[data-direction]')){b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);$('world').focus({preventScroll:true});setInput('pointer',b.dataset.direction);});for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,()=>release('pointer'));}
$('world').addEventListener('pointerdown',()=>{$('world').focus({preventScroll:true});});
$('zoom').addEventListener('change',()=>{setZoom();$('world').focus({preventScroll:true});});$('speed').addEventListener('change',()=>{speed=+$('speed').value;draw();$('world').focus({preventScroll:true});});$('bones').addEventListener('change',draw);
$('head-style').addEventListener('change',()=>{headStyle=$('head-style').value;draw();$('world').focus({preventScroll:true});});
$('outfit').addEventListener('change',()=>{outfit=$('outfit').value;outfitNote='';draw();$('world').focus({preventScroll:true});});
$('gait').addEventListener('change',()=>{gait=$('gait').value;draw();$('world').focus({preventScroll:true});});$('palette').addEventListener('change',()=>{palette=$('palette').value;draw();$('world').focus({preventScroll:true});});
for(const channel of ['hair','skin'])$(''+channel).addEventListener('change',()=>{appearance[channel]=$(channel).value;draw();$('world').focus({preventScroll:true});});
$('home').addEventListener('click',()=>{stop();const direction=actor.direction;actor=M.create();actor.direction=direction;draw();$('world').focus({preventScroll:true});});
window.addEventListener('resize',setZoom);window.addEventListener('blur',stop);window.addEventListener('pagehide',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
async function load(){model=E.createSceneModel(D);for(const channel of ['hair','skin']){const select=$(channel);for(const [id,name]of [['original','保留原色'],...Object.entries(D.appearance.presets[channel]).map(([id,p])=>[id,p.name])]){const o=document.createElement('option');o.value=id;o.textContent=name;select.append(o);}}
 sceneImage=new Image();sceneImage.src=window.SCENE_BUNDLE.image;await sceneImage.decode();if(sceneImage.naturalWidth!==896||sceneImage.naturalHeight!==512)throw Error('场景尺寸不符');
 await Promise.all(Object.entries(D.textures).map(async([file,url])=>{const image=new Image();image.src=url;await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);textures.set(file,E.textureInfo(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height));}));
 ready=true;$('notice').hidden=true;setZoom();$('world').focus({preventScroll:true});
}
load().catch(error=>{$('notice').hidden=false;$('notice').textContent='载入失败：'+error.message;});
})();
