(() => {
'use strict';
const $=id=>document.getElementById(id),E=window.RigEngine,data=window.RIG_LIVE_BUNDLE;
const directionNames={down:'正面',right:'向右',up:'背面',left:'向左'},paletteNames={original:'原色',indigo:'靛蓝',moss:'苔绿',clay:'赭棕',linen:'浅麻'},jointNames={shoulder:'肩',elbow:'肘',hip:'髋',knee:'膝'},limits={shoulder:45,elbow:70,hip:35,knee:60};
const state={character:'heqing',direction:'right',outfit:'original',action:'idle',faceMode:'auto',blinkTimeMs:0,transitionNote:'',phase:0,frame:0,time:0,mode:'continuous',gait:'s12',fps:10,palette:'original',dye:{},appearance:{hair:'original',skin:'original'},headStyle:'original',side:'B',angles:E.identityAngles(),equipment:{head:'',back:'',hand:''},adjustments:{},playing:false,finished:false,last:0,raf:0,ready:false};
const textures=new Map(),images=new Map(),sliders=new Map();let model,lastPartsKey='';
try{state.adjustments=JSON.parse(localStorage.getItem('nancun-hanfu-four-directions-integrated-v69-offsets')||'{}');}catch{}
const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',fn);return b;};
const char=()=>model.characters.get(state.character),offsets=()=>state.adjustments[state.character]||{};
function pause(){state.playing=false;state.last=0;if(state.raf)cancelAnimationFrame(state.raf);state.raf=0;if(state.ready)sync();}
function normalizeEquipmentAction(){const r=E.resolveAction(model,state);if(r.cancelled){pause();state.action='idle';state.phase=0;state.frame=0;state.time=0;state.finished=false;state.angles=E.identityAngles();state.transitionNote=r.reason;}}
function normalizeOutfit(){const r=E.resolveOutfit(char(),state.outfit,state.direction);if(r.fallback){state.outfit=r.effective;state.outfitNote=r.reason;}return r;}
function selectOutfit(id){state.outfit=id;state.outfitNote='';normalizeOutfit();render();}
function sync(){
 $('play').textContent=state.playing?'暂停':state.finished?'重新播放':'播放';$('play').setAttribute('aria-pressed',String(state.playing));
 for(const [id,value] of Object.entries({characters:state.character,directions:state.direction,outfits:state.outfit,actions:state.action,frames:String(state.frame),'motion-modes':state.mode,sides:state.side,palettes:state.palette}))for(const b of $(id).children)b.setAttribute('aria-pressed',String(b.dataset.value===value));
 for(const b of $('actions').children){const id=E.ACTIONS[b.dataset.value]?.equipment;b.disabled=!!id&&!model.equipment.get(id)?.directions.includes(state.direction);}
 $('head-style-row').hidden=!char().headStyles;
 const headView=E.resolveHeadStyle(char(),state.headStyle,state.direction);
 $('head-style').disabled=!(char().headStyles||[]).some(style=>E.resolveHeadStyle(char(),style.id,state.direction).effective===style.id);
 for(const option of $('head-style').options)option.disabled=E.resolveHeadStyle(char(),option.value,state.direction).effective!==option.value;
 $('head-direction-note').textContent=headView.fallback?'本方向暂用原侧脸；转回正面会保留所选方案。':headView.states?'只替换该方向的头部像素，保留原轮廓与比例。':'本方向没有五官变体，保留原头部。';
 $('head-style').value=state.headStyle;
 $('face-mode').disabled=!headView.states?.closed;
 $('face-mode').value=state.faceMode;
 $('face-direction-note').textContent=headView.states?.closed?'此方向有独立闭眼图；待机、行走时自然眨眼，暂停保留表情。':'此方向没有独立闭眼图；始终显示真实原头片，不套用正面或右侧表情。';
 $('body-appearance').hidden=state.character!==data.appearance?.character;
 for(const channel of ['hair','skin'])$(channel+'-color').value=state.appearance[channel];
 for(const b of $('directions').children)b.disabled=!char().directions.includes(b.dataset.value);
 for(const b of $('outfits').children){const entry=char().outfits.find(o=>o.id===b.dataset.value);b.disabled=!E.outfitDirections(char(),b.dataset.value).includes(state.direction);b.hidden=!!entry.uiHidden&&state.outfit!==entry.id;}
 $('outfit-direction-note').textContent=state.outfitNote||(state.character==='heqing'?(state.outfit==='moon-celadon-four-view'?'汉服四向共用骨架动作；裙为骨盆刚性片，未实现独立裙摆与布料模拟。':'石青上衣四向共用动作，裤鞋保持原衣；领口、扣袢与各向色阶尚待精修。'):'旧 B 衣装保留原有四向。');
 for(const [name,{input,output}] of sliders){const v=state.angles[state.side][name];input.value=v;output.value=`${v>0?'+':''}${v}°`;input.disabled=state.action==='hoe'&&!!model.equipment.get(state.equipment.hand)?.secondaryGrip&&state.direction==='down'&&(name==='shoulder'||name==='elbow');}
 for(const slot of ['head','back','hand'])$('equip-'+slot).value=state.equipment[slot];
 $('character-note').textContent=state.character==='heqing'?'原衣、石青上衣和月白豆青汉服均为四向候选。汉服替换原裤衣片；头脸、手鞋与骨架动作共用。':'旧 B 保留四向、三套衣装；装备仅有正面素材。';
 const channels=E.outfitDyeChannels(model,state.character,state.direction,state.outfit);
 for(const channel of E.DYE_CHANNELS){$('dye-row-'+channel).hidden=!channels.includes(channel);$('dye-'+channel).value=state.dye[channel]??'inherit';}
 $('separate-dyes').hidden=!channels.length;
 $('action-note').textContent=E.ACTIONS[state.action].loop?'此动作循环；换衣、换色、装备切换保留动作相位。':'此动作单次播放，蓄势、挥动与回收分时；到第八姿势停住。';
 $('ik-note').hidden=state.action!=='hoe';
 $('gait-row').hidden=state.character!=='heqing';$('gait-choice').value=state.gait;$('gait-note').textContent=state.gait==='original'?'原步态：保留作对照。':`支撑脚约束候选：12 world px 步幅；当前 ${(8/state.fps).toFixed(2)} 秒/周期。转向保留相位；尚未处理转向落脚与停步过渡。`;
}
function selectDirection(direction){if(!char().directions.includes(direction))return false;state.direction=direction;normalizeOutfit();normalizeEquipmentAction();render();return true;}
function makeOutfits(){const area=$('outfits');area.replaceChildren();for(const o of char().outfits){const b=button(o.name,()=>selectOutfit(o.id));b.dataset.value=o.id;area.append(b);}}
function drawBones(result){const c=$('bones').getContext('2d');c.clearRect(0,0,384,384);if(!$('show-bones').checked)return;const point=p=>[(p[0]+16+.5)*4,(p[1]+16+.5)*4],j=result.pose.joints;for(const [a,b] of char().bones||data.rig.bones){if(!j[a]||!j[b])continue;c.strokeStyle=b.endsWith('A')?'#d65f50':b.endsWith('B')?'#4386b1':'#a5842e';c.lineWidth=1.5;c.beginPath();c.moveTo(...point(j[a]));c.lineTo(...point(j[b]));c.stroke();}for(const [name,p] of Object.entries(j)){c.fillStyle=name.endsWith(state.side)?'#f7cd6d':'#fff7dc';c.strokeStyle='#314339';c.beginPath();c.arc(...point(p),2.2,0,Math.PI*2);c.fill();c.stroke();}for(const e of result.equipmentBindings){const p=point(e.slotPoint);c.fillStyle='#b44387';c.fillRect(p[0]-3,p[1]-3,6,6);}}
function refreshParts(result){const key=[state.character,state.direction,state.outfit,state.headStyle,result.faceState,...Object.values(state.equipment)].join('/');if(key===lastPartsKey)return;lastPartsKey=key;for(const id of ['shared-parts','garment-parts','equipment-parts'])$(id).replaceChildren();const parts=char().kind==='cutout'?E.outfitParts(char(),state.direction,state.outfit):data.attachments.bindings.filter(b=>b.direction===state.direction&&(b.category==='shared'||b.category===state.outfit));const shownParts=parts.map(p=>p.part==='head'?{...p,file:result.commands.find(c=>c.id===p.id)?.file||p.file}:p);for(const part of [...shownParts,...Object.values(state.equipment).map(id=>model.equipment.get(id)).filter(Boolean).map(e=>({...e,part:e.name,category:'equipment'}))]){const card=document.createElement('div');card.className='part-card';const title=document.createElement('div');title.className='part-head';const label=document.createElement('span');label.textContent=(part.underlap?'衔接片 · ':'')+(part.part||part.id);const link=document.createElement('a');link.href=data.textures[part.file];link.download=part.file.split('/').pop();link.textContent='原件';title.append(label,link);const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;const box=textures.get(part.file).bbox;if(box){const w=box[2]-box[0],h=box[3]-box[1],scale=Math.max(1,Math.min(4,Math.floor(120/Math.max(w,h))));ctx.drawImage(images.get(part.file),...box.slice(0,2),w,h,Math.floor((128-w*scale)/2),Math.floor((128-h*scale)/2),w*scale,h*scale);}card.append(title,canvas);$(part.category==='shared'?'shared-parts':part.category==='equipment'?'equipment-parts':'garment-parts').append(card);}}
function render(){if(!state.ready)return;normalizeOutfit();const result=E.renderScene(model,textures,{...state,phase:state.mode==='continuous'?state.phase:state.frame,adjustments:offsets()}),ctx=$('sprite').getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,96,96);if($('show-art').checked)ctx.putImageData(new ImageData(result.pixels,96,96),0,0);drawBones(result);sync();refreshParts(result);adjustmentMode();const f=state.phase-state.frame,phase=state.mode==='continuous'&&f>.001?`${state.frame+1}→${(E.ACTIONS[state.action].loop?(state.frame+1)%8+1:Math.min(8,state.frame+2))} · ${Math.round(f*100)}%`:`${state.frame+1}/8`;$('pose-caption').textContent=`${char().name} · ${E.ACTIONS[state.action].name} · ${phase} · ${E.ACTIONS[state.action].labels[state.frame]}`;$('render-proof').textContent=`实时变换 ${result.stats.partDraws} 个裁片 · 整身帧图 0 张${result.grip.enabled?' · '+(result.ik.enabled?'双手':'主手')+'实际握点误差 '+Math.max(result.grip.primaryError,result.grip.secondaryError||0).toFixed(2)+' px':''}`;const warnings=[...result.warnings];if(state.transitionNote)warnings.unshift(state.transitionNote);if(result.stats.clippedPixels)warnings.push(`${result.stats.clippedPixels} 个部件像素超出96格，请减小偏移或角度`);$('clipping').hidden=!warnings.length;$('clipping').textContent=warnings.join('；');}
function tick(now){state.raf=0;if(!state.playing||document.hidden){state.last=0;return;}const dt=state.last?Math.min(now-state.last,150):0;state.last=now;state.time+=dt*state.fps/10;state.blinkTimeMs+=dt;const timing=E.actionTiming(state.action,state.time);state.phase=timing.phase;state.frame=Math.floor(state.phase)%8;state.finished=timing.finished;render();if(timing.finished){pause();return;}state.raf=requestAnimationFrame(tick);}
function setFrame(i){pause();state.frame=(i+8)%8;state.phase=state.frame;state.time=E.timeAtKey(state.action,state.frame);state.finished=false;render();}
function selectAction(id){pause();state.transitionNote='';state.action=id;state.time=0;state.phase=0;state.frame=0;state.finished=false;state.angles=E.identityAngles();if(E.ACTIONS[id].equipment)state.equipment.hand=E.ACTIONS[id].equipment;refreshAdjustment();render();}
function adjustmentMode(){const item=model?.equipment.get($('adjust-item').value);$('adjust-mode').textContent=item?.slot==='hand'?(state.action==='hoe'&&item.secondaryGrip?'双手：XY 移动双手握柄目标；角度绕主握点转动，超出手臂范围会提示。':'单手：XY 是装备局部偏移；显示实际握柄间隙，不自动改变手臂。'):'头饰 / 背篓：XY 为绑定关节的局部偏移。';}
function refreshAdjustment(){const select=$('adjust-item'),previous=select.value;select.replaceChildren();for(const id of Object.values(state.equipment).filter(Boolean)){const item=model.equipment.get(id),o=document.createElement('option');o.value=id;o.textContent=item.name;select.append(o);}if([...select.options].some(o=>o.value===previous))select.value=previous;for(const axis of ['x','y','angle'])$('adjust-'+axis).value=offsets()[select.value]?.[axis]||0;$('adjust-controls').hidden=!select.options.length;if(select.value!==previous)$('offset-status').textContent='';adjustmentMode();}
const lookKey='nancun-hanfu-four-directions-integrated-v69-look';
function savedLook(){return {version:1,character:state.character,headStyle:state.headStyle,outfit:state.outfit,palette:state.palette,dye:{...state.dye},appearance:{...state.appearance},equipment:{...state.equipment}};}
function restoreLook(){
 try {
  const raw=JSON.parse(localStorage.getItem(lookKey)||localStorage.getItem('nancun-right-outfit-integrated-v59-look')||'null');
  if(!raw){$('look-status').textContent='还没有保存过搭配。';return false;}
  if(raw.version!==1||typeof raw!=='object'||Array.isArray(raw))throw Error('搭配格式不支持');
  const character=model.characters.has(raw.character)?raw.character:'heqing',direction=model.characters.get(character).directions.includes(state.direction)?state.direction:'down';
  const result=E.resolveAppearance(model,{character,direction,outfit:raw.outfit,headStyle:raw.headStyle,palette:raw.palette,dye:raw.dye,equipment:raw.equipment});
  const body=E.resolveBodyAppearance(model,character,raw.appearance);
  for(const key of ['character','direction','outfit','palette','dye','headStyle'])state[key]=result.options[key];
  state.outfitNote=result.outfitResolution.fallback?result.outfitResolution.reason:'';
  state.equipment={head:'',back:'',hand:'',...result.options.equipment};state.appearance=body.values;
  normalizeEquipmentAction();
  $('look-status').textContent=[...result.warnings,...body.warnings].length?'已恢复搭配；'+[...result.warnings,...body.warnings].join('；'):'已恢复上次保存的搭配。';return true;
 }catch(error){$('look-status').textContent='无法读取已存搭配：'+error.message;return false;}
}
function applyHandoff(){
 const snapshot=window.SceneHandoff.read(location.search,E,model,data.appearance);
 if(snapshot.kind==='absent')return false;
 if(snapshot.kind==='invalid'){$('look-status').textContent=snapshot.reason;return true;}
 const value=snapshot.value;
 for(const key of ['character','direction','outfit','headStyle','palette','appearance','gait','action','phase'])state[key]=value[key];
 state.frame=Math.floor(state.phase);state.time=E.timeAtKey(state.action,state.frame)+(state.phase-state.frame)*E.ACTIONS[state.action].durations[state.frame];
 state.playing=false;state.finished=false;state.last=0;state.raf=0;state.outfitNote=snapshot.warnings.join('；');
 $('look-status').textContent='已接续村院当前搭配与姿势，已暂停。'+(snapshot.warnings.length?' '+snapshot.warnings.join('；'):'');return true;
}
function setup(){
$('gait-choice').addEventListener('change',()=>{state.gait=$('gait-choice').value;render();});
for(const style of model.characters.get('heqing').headStyles||[]){const o=document.createElement('option');o.value=style.id;o.textContent=style.name;$('head-style').append(o);}
$('head-style').addEventListener('change',()=>{state.headStyle=$('head-style').value;render();});
for(const channel of ['hair','skin']){const select=$(channel+'-color');for(const [id,preset]of Object.entries(data.appearance?.presets?.[channel]||{})){const option=document.createElement('option');option.value=id;option.textContent=preset.name;select.append(option);}select.addEventListener('change',()=>{state.appearance[channel]=select.value;render();});}

for(const c of model.characters.values()){const b=button(c.name,()=>{pause();state.character=c.id;if(!c.headStyles)state.headStyle='original';if(!c.directions.includes(state.direction))state.direction='down';state.outfit='original';state.outfitNote='';state.angles=E.identityAngles();makeOutfits();refreshAdjustment();render();});b.dataset.value=c.id;$('characters').append(b);}makeOutfits();
for(const [id,choices] of [['directions',directionNames],['palettes',paletteNames],['sides',{A:'人物左侧',B:'人物右侧'}],['motion-modes',{continuous:'连续骨骼',sampled:'8 姿势取样'}]])for(const [key,label] of Object.entries(choices)){const b=button(label,()=>{if(id==='directions'){selectDirection(key);return;}else if(id==='palettes')state.palette=key;else if(id==='sides')state.side=key;else state.mode=key;render();});b.dataset.value=key;$(id).append(b);}
for(const a of Object.values(E.ACTIONS)){const b=button(a.name,()=>selectAction(a.id));b.dataset.value=a.id;$('actions').append(b);}for(let i=0;i<8;i++){const b=button(String(i+1),()=>setFrame(i));b.dataset.value=String(i);b.setAttribute('aria-label',`关键姿势 ${i+1}`);$('frames').append(b);}
for(const slot of ['head','back','hand']){const select=$('equip-'+slot);for(const item of model.equipment.values())if(item.slot===slot){const o=document.createElement('option');o.value=item.id;o.textContent=item.name;select.append(o);}select.addEventListener('change',()=>{state.equipment[slot]=select.value;state.transitionNote='';normalizeEquipmentAction();refreshAdjustment();render();});}
for(const [name,label] of Object.entries(jointNames)){const wrap=document.createElement('label');wrap.className='joint-control';const title=document.createElement('span');title.textContent=label;const input=document.createElement('input');input.type='range';input.min=-limits[name];input.max=limits[name];input.step='.5';input.setAttribute('aria-label',label+'关节角度偏移');const output=document.createElement('output');input.addEventListener('input',()=>{const v=+input.value;pause();state.angles[state.side][name]=v;render();});wrap.append(title,input,output);$('joint-sliders').append(wrap);sliders.set(name,{input,output});}
$('play').addEventListener('click',()=>{if(state.playing)pause();else{if(state.finished){state.time=0;state.phase=0;state.frame=0;state.finished=false;}state.playing=true;state.last=0;sync();state.raf=requestAnimationFrame(tick);}});$('previous').addEventListener('click',()=>setFrame(state.frame-1));$('next').addEventListener('click',()=>setFrame(state.frame+1));$('fps').addEventListener('change',()=>{state.fps=+$('fps').value;sync();});$('reset-angles').addEventListener('click',()=>{pause();state.angles=E.identityAngles();render();});$('show-bones').addEventListener('change',render);$('show-art').addEventListener('change',render);$('show-parts').addEventListener('change',()=>{$('parts-area').hidden=!$('show-parts').checked;});
for(const channel of E.DYE_CHANNELS){const select=$('dye-'+channel);for(const [id,name] of Object.entries(paletteNames)){const option=document.createElement('option');option.value=id;option.textContent=name;select.append(option);}select.addEventListener('change',()=>{if(select.value==='inherit')delete state.dye[channel];else state.dye[channel]=select.value;render();});}
$('reset-dyes').addEventListener('click',()=>{state.dye={};render();});
$('save-look').addEventListener('click',()=>{try{localStorage.setItem(lookKey,JSON.stringify(savedLook()));$('look-status').textContent='已记住这套搭配，下次打开自动恢复。';}catch(error){$('look-status').textContent='保存失败：'+error.message;}});
$('restore-look').addEventListener('click',()=>{if(restoreLook()){makeOutfits();refreshAdjustment();render();}});
$('face-mode').addEventListener('change',()=>{state.faceMode=$('face-mode').value;render();});
$('adjust-item').addEventListener('change',()=>{$('offset-status').textContent='';refreshAdjustment();});for(const axis of ['x','y','angle'])$('adjust-'+axis).addEventListener('input',()=>{const id=$('adjust-item').value;if(!id)return;state.adjustments[state.character]??={};state.adjustments[state.character][id]??={};state.adjustments[state.character][id][axis]=+$('adjust-'+axis).value;render();});$('save-offset').addEventListener('click',()=>{localStorage.setItem('nancun-hanfu-four-directions-integrated-v69-offsets',JSON.stringify(state.adjustments));$('offset-status').textContent='已保存在这个浏览器';});$('reset-offset').addEventListener('click',()=>{const id=$('adjust-item').value;if(state.adjustments[state.character])delete state.adjustments[state.character][id];refreshAdjustment();render();$('offset-status').textContent='已还原，点击保存可记住';});
window.addEventListener('blur',pause);window.addEventListener('pagehide',pause);document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>{if(e.matches)pause();});}
async function load(){if(!data||!E)throw Error('请完整解压，保留离线数据和引擎。');model=E.createSceneModel(data);await Promise.all(Object.entries(data.textures).map(async([file,url])=>{const image=new Image();image.src=url;await image.decode();const w=image.naturalWidth,h=image.naturalHeight,c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);textures.set(file,E.textureInfo(ctx.getImageData(0,0,w,h).data,w,h));images.set(file,image);}));if(!applyHandoff())restoreLook();setup();state.ready=true;$('notice').hidden=true;$('app').hidden=false;refreshAdjustment();render();}
load().catch(e=>{$('notice').textContent='载入失败：'+e.message;});
})();
