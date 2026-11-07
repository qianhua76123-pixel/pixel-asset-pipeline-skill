/* Pure runtime cutout engine. No image loading, DOM, atlas or pre-rendered frames. */
(function (global, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.RigEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DIRECTIONS = ['down', 'right', 'up', 'left'];
  const PALETTES = {original:null, indigo:[82,112,135], moss:[112,128,84], clay:[166,109,79], linen:[185,169,131]};
  const DYE_CHANNELS = ['top','bottom','trim'];
  const defaultDyeGroup = part => /^(thigh|shin|pelvis|skirt)/.test(part)?'bottom':/^(belt|trim)/.test(part)?'trim':'top';
  const identityAngles = () => ({A:{shoulder:0,elbow:0,hip:0,knee:0},B:{shoulder:0,elbow:0,hip:0,knee:0}});
  const clone = value => JSON.parse(JSON.stringify(value));
  const radians = degrees => degrees*Math.PI/180;
  function roundEven(value) {const floor=Math.floor(value),fraction=value-floor;return Math.abs(fraction-.5)<1e-9?(floor%2===0?floor:floor+1):Math.round(value);}
  function rotate(point, pivot, degrees) {const a=radians(degrees),c=Math.cos(a),s=Math.sin(a),x=point[0]-pivot[0],y=point[1]-pivot[1];return [pivot[0]+c*x-s*y,pivot[1]+s*x+c*y];}
  function poseWithAngles(source, angles=identityAngles()) {
    const pose=clone(source),j=pose.joints;
    for(const side of ['A','B']) {
      const a=angles[side]||{};
      for(const name of ['elbow','wrist'])j[name+side]=rotate(j[name+side],j['shoulder'+side],a.shoulder||0);
      j['wrist'+side]=rotate(j['wrist'+side],j['elbow'+side],a.elbow||0);
      for(const name of ['knee','ankle','toe'])j[name+side]=rotate(j[name+side],j['hip'+side],a.hip||0);
      pose.feet[side].sole=rotate(pose.feet[side].sole,j['hip'+side],a.hip||0);
      for(const name of ['ankle','toe'])j[name+side]=rotate(j[name+side],j['knee'+side],a.knee||0);
      pose.feet[side].sole=rotate(pose.feet[side].sole,j['knee'+side],a.knee||0);
    }
    return pose;
  }
  function apply(matrix, point) {const [a,b,c,d,e,f]=matrix;return [a*point[0]+c*point[1]+e,b*point[0]+d*point[1]+f];}
  function inverse(matrix) {const [a,b,c,d,e,f]=matrix,det=a*d-b*c;if(Math.abs(det)<1e-10)throw Error('Degenerate transform');return [d/det,-b/det,-c/det,a/det,(c*f-d*e)/det,(b*e-a*f)/det];}
  function boneMatrix(source, target, width=1) {
    const [p0,p1]=source,[q0,q1]=target,p=[p1[0]-p0[0],p1[1]-p0[1]],q=[q1[0]-q0[0],q1[1]-q0[1]],pl=Math.hypot(...p),ql=Math.hypot(...q);
    if(pl<.1||ql<.1)return [1,0,0,1,roundEven(q0[0]-p0[0]),roundEven(q0[1]-p0[1])];
    const ux=p[0]/pl,uy=p[1]/pl,nx=-uy,ny=ux,vx=q[0]/pl,vy=q[1]/pl,mx=-q[1]/ql*width,my=q[0]/ql*width;
    const a=vx*ux+mx*nx,b=vy*ux+my*nx,c=vx*uy+mx*ny,d=vy*uy+my*ny;
    return [a,b,c,d,q0[0]-a*p0[0]-c*p0[1],q0[1]-b*p0[0]-d*p0[1]];
  }
  function rotateTranslate(pivot, target, degrees) {const a=radians(degrees),c=Math.cos(a),s=Math.sin(a);return [c,s,-s,c,target[0]-c*pivot[0]+s*pivot[1],target[1]-s*pivot[0]-c*pivot[1]];}
  function uniqueMap(entries,label){const map=new Map();for(const [key,value]of entries){if(map.has(key))throw Error('Duplicate '+label+': '+key);map.set(key,value);}return map;}
  function createModel(data) {
    const bindingMap=uniqueMap(data.attachments.bindings.map(b=>[`${b.category}/${b.direction}/${b.part}`,b]),'part binding');
    const poseMap=uniqueMap(data.rig.poses.map(p=>[`${p.direction}/${p.frameIndex}`,p]),'pose');
    const recordMap=new Map(data.transforms.renders.map(r=>[`${r.outfit}/${r.direction}/${r.frame}`,r]));
    return {data,bindingMap,poseMap,recordMap};
  }
  const lerp = (a,b,t) => a+(b-a)*t;
  const lerpVector = (a,b,t) => a.map((v,i)=>lerp(v,b[i],t));
  const wrapAngle = a => Math.atan2(Math.sin(a),Math.cos(a));
  const lerpAngle = (a,b,t) => a+wrapAngle(b-a)*t;
  function projectWorld(model,direction,point) {
    const projection=model.data.rig.projection[direction],root=model.data.rig.root;
    return root.map((v,i)=>v+projection.forward[i]*point[0]+projection.anatomicalLeft[i]*point[1]-(i===1?point[2]:0));
  }
  function poseAtPhase(model,direction,phase) {
    const wrapped=((phase%8)+8)%8,index=Math.floor(wrapped),t=wrapped-index,a=model.poseMap.get(`${direction}/${index}`),b=model.poseMap.get(`${direction}/${(index+1)%8}`);
    if(t<1e-10)return clone(a);
    const pose=clone(a),aw=a.worldJoints,bw=b.worldJoints,world={};
    // These anchors translate with the body. Limb chains are rebuilt from local
    // sagittal angles and their original lengths, not interpolated screen pixels.
    for(const name of ['root','pelvis','neck','head','hipA','hipB','shoulderA','shoulderB'])world[name]=lerpVector(aw[name],bw[name],t);
    function chain(parent,middle,tip) {
      const angle=(w,p,c)=>Math.atan2(w[c][0]-w[p][0],-(w[c][2]-w[p][2]));
      const upper=lerpAngle(angle(aw,parent,middle),angle(bw,parent,middle),t);
      const localLower=lerpAngle(wrapAngle(angle(aw,middle,tip)-angle(aw,parent,middle)),wrapAngle(angle(bw,middle,tip)-angle(bw,parent,middle)),t);
      for(const [from,to,theta] of [[parent,middle,upper],[middle,tip,upper+localLower]]) {
        const length=Math.hypot(aw[to][0]-aw[from][0],aw[to][2]-aw[from][2]);
        const lateral=lerp(aw[to][1]-aw[from][1],bw[to][1]-bw[from][1],t);
        world[to]=[world[from][0]+length*Math.sin(theta),world[from][1]+lateral,world[from][2]-length*Math.cos(theta)];
      }
    }
    for(const side of ['A','B']) {
      chain('shoulder'+side,'elbow'+side,'wrist'+side);chain('hip'+side,'knee'+side,'ankle'+side);
      const ankle='ankle'+side,toe='toe'+side;
      const toeOffset=lerpVector(aw[toe].map((v,i)=>v-aw[ankle][i]),bw[toe].map((v,i)=>v-bw[ankle][i]),t);
      world[toe]=world[ankle].map((v,i)=>v+toeOffset[i]);
      const soleOffset=lerpVector(a.feet[side].soleWorld.map((v,i)=>v-aw[ankle][i]),b.feet[side].soleWorld.map((v,i)=>v-bw[ankle][i]),t);
      const sole=world[ankle].map((v,i)=>v+soleOffset[i]);
      pose.feet[side].soleWorld=sole;pose.feet[side].sole=projectWorld(model,direction,sole);pose.feet[side].solePixel=pose.feet[side].sole.map(roundEven);
      pose.feet[side].heelRaise=lerp(a.feet[side].heelRaise,b.feet[side].heelRaise,t);
    }
    pose.worldJoints=world;
    for(const [name,point] of Object.entries(world)) {
      const ap=projectWorld(model,direction,aw[name]),bp=projectWorld(model,direction,bw[name]);
      const bias=lerpVector(a.joints[name].map((v,i)=>v-ap[i]),b.joints[name].map((v,i)=>v-bp[i]),t);
      pose.joints[name]=projectWorld(model,direction,point).map((v,i)=>v+bias[i]);
    }
    pose.jointsPixel=Object.fromEntries(Object.entries(pose.joints).map(([name,point])=>[name,point.map(roundEven)]));
    pose.bodyBobY=lerp(a.bodyBobY,b.bodyBobY,t);
    pose.cloth.skirtHemLateralOffset=lerp(a.cloth.skirtHemLateralOffset,b.cloth.skirtHemLateralOffset,t);
    pose.runtimeInterpolation={from:index,to:(index+1)%8,fraction:t,method:'local bone angles + fixed sagittal lengths + shared projection',drawOrder:'held at preceding key pose',footLock:false};
    return pose;
  }
  function targetBone(name,joints) {
    const s=name.at(-1);
    if(name.startsWith('upperArm'))return [joints['shoulder'+s],joints['elbow'+s]];
    if(name.startsWith('lowerArm'))return [joints['elbow'+s],joints['wrist'+s]];
    if(name.startsWith('thigh'))return [joints['hip'+s],joints['knee'+s]];
    if(name.startsWith('shin'))return [joints['knee'+s],joints['ankle'+s]];
    return [joints.neck,joints.pelvis];
  }
  function commands(model,direction,frame,outfit,angles=identityAngles(),poseOverride=null) {
    const phase=((frame%8)+8)%8,keyIndex=Math.floor(phase),pose=poseWithAngles(poseOverride||poseAtPhase(model,direction,phase),angles),j=pose.joints,bind=model.data.attachments.directionSourceBind[direction];
    const record=model.recordMap.get(`${outfit}/${direction}/${keyIndex}`),back=[],front=[],cloth=[];
    const make=(category,part,matrix,extra={})=>({category,part,file:model.bindingMap.get(`${category}/${direction}/${part}`).file,matrix,...extra});
    for(const side of ['A','B']) {
      const sole=pose.feet[side].sole,rotation=(angles[side]?.hip||0)+(angles[side]?.knee||0),source=[bind.feet[side],58];
      const matrix=rotation?rotateTranslate(source,sole,rotation):[1,0,0,1,roundEven(sole[0]-source[0]),roundEven(sole[1]-source[1])];
      back.push(make('shared','shoe'+side,matrix));
      const hand=make('shared','hand'+side,boneMatrix(bind.arms[side].slice(1),[j['elbow'+side],j['wrist'+side]]));
      (pose.drawOrder.indexOf('arm'+side)>pose.drawOrder.indexOf('torso')?front:back).push(hand);
    }
    const sourceHead=[bind.neck[0],model.data.rig.bindPoses[direction].joints.head[1]];
    front.push(make('shared','head',pose.torsoAngle?rotateTranslate(sourceHead,j.head,pose.torsoAngle):[1,0,0,1,roundEven(j.head[0]-sourceHead[0]),roundEven(j.head[1]-sourceHead[1])]));
    const partMap=new Map(record.parts.map(p=>[p.part,p]));
    for(const name of record.partOrder) {
      const part=partMap.get(name);if(!part)continue;
      if(name==='skirt')cloth.push(make(outfit,name,null,{rowShear:{center:bind.center,bob:pose.bodyBobY,sway:pose.cloth.skirtHemLateralOffset}}));
      else cloth.push(make(outfit,name,boneMatrix(part.sourceBone,targetBone(name,j),part.widthFactor??1),{widthFactor:part.widthFactor??1}));
    }
    return {pose,commands:[...back,...cloth,...front],sharedBodyCommands:[...back,...front]};
  }
  function textureInfo(pixels,width=64,height=64) {
    let left=width,top=height,right=0,bottom=0,count=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[(y*width+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x+1);top=Math.min(top,y);bottom=Math.max(bottom,y+1);count++;}
    return {pixels,width,height,bbox:count?[left,top,right,bottom]:null,opaquePixels:count};
  }
  function dye(rgb,palette,profile=null) {
    if(!palette)return rgb;
    if(profile?.mode==='material-ramp'){
      if(Math.max(...rgb)<=profile.protectMaxRgb)return rgb;
      const luma=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722,index=luma<profile.sourceLumaStops[0]?0:luma<profile.sourceLumaStops[1]?1:2;
      return palette.map(c=>Math.max(0,Math.min(255,Math.round(c*profile.targetFactors[index]))));
    }
    if(Math.max(...rgb)<70)return rgb;
    const light=(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722)/160;
    return palette.map(c=>Math.max(0,Math.min(255,Math.round(c*light))));
  }
  function stamp(output,texture,matrix,palette=null,sourceBox=null,dyeMask=null,channelMasks=[],dyeProfile=null) {
    const box=sourceBox||texture.bbox;if(!box)return {clipped:0,pixels:0};
    const corners=[[box[0],box[1]],[box[2],box[1]],[box[0],box[3]],[box[2],box[3]]].map(p=>apply(matrix,p));
    const x0=Math.floor(Math.min(...corners.map(p=>p[0])))-1,x1=Math.ceil(Math.max(...corners.map(p=>p[0])))+1,y0=Math.floor(Math.min(...corners.map(p=>p[1])))-1,y1=Math.ceil(Math.max(...corners.map(p=>p[1])))+1;
    const inv=inverse(matrix),size=Math.sqrt(output.length/4);let clipped=0,count=0;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++) {
      const sample=apply(inv,[x+.5,y+.5]),sx=Math.floor(sample[0]+1e-9),sy=Math.floor(sample[1]+1e-9);
      if(sx<box[0]||sx>=box[2]||sy<box[1]||sy>=box[3]||sx<0||sy<0||sx>=texture.width||sy>=texture.height)continue;
      const si=(sy*texture.width+sx)*4;if(!texture.pixels[si+3])continue;
      if(x<0||x>=size||y<0||y>=size){clipped++;continue;}
      const canDye=!dyeMask||dyeMask.pixels[(sy*dyeMask.width+sx)*4+3]>0;
      let pixelPalette=palette;
      if(canDye)for(const channel of channelMasks)if(channel.texture.pixels[si+3]){pixelPalette=channel.palette;break;}
      const i=(y*size+x)*4,color=dye([texture.pixels[si],texture.pixels[si+1],texture.pixels[si+2]],canDye?pixelPalette:null,dyeProfile);
      output[i]=color[0];output[i+1]=color[1];output[i+2]=color[2];output[i+3]=texture.pixels[si+3];count++;
    }
    return {clipped,pixels:count};
  }
  function render(model,textures,direction,frame,outfit,angles=identityAngles(),paletteName='original') {
    const plan=commands(model,direction,frame,outfit,angles),output=new Uint8ClampedArray(64*64*4);let clipped=0,draws=0,pixelWrites=0;
    for(const command of plan.commands) {
      const texture=textures.get(command.file);if(!texture)throw Error('Missing attachment: '+command.file);
      const palette=command.category==='shared'?null:PALETTES[paletteName];
      if(command.rowShear){const r=command.rowShear;for(let y=41;y<57;y++){const dx=roundEven(32-r.center+r.sway*(y-41)/15),dy=roundEven(r.bob);const result=stamp(output,texture,[1,0,0,1,dx,dy],palette,[0,y,64,y+1]);clipped+=result.clipped;pixelWrites+=result.pixels;}}
      else {const result=stamp(output,texture,command.matrix,palette);clipped+=result.clipped;pixelWrites+=result.pixels;}
      draws++;
    }
    return {...plan,pixels:output,stats:{partDraws:draws,pixelWrites,clippedPixels:clipped,wholeFrameImages:0}};
  }
  // v13: actions are skeletal key data, never whole-character frame images.
  const ACTIONS={
    idle:{id:'idle',name:'待机',loop:true,durations:[400,300,260,300,300,260,300,280],labels:['静候','吸气','舒肩','停息','呼气','回落','微动','归位']},
    walk:{id:'walk',name:'行走',loop:true,durations:Array(8).fill(100),labels:['A触地','A下沉','A经过','A上升','B触地','B下沉','B经过','B上升']},
    sword:{id:'sword',name:'挥剑',loop:false,equipment:'iron-sword',durations:[140,210,90,65,110,160,230,240],labels:['持剑','蓄势','提腕','挥出','随势','回收','收剑','停稳']},
    hoe:{id:'hoe',name:'挥锄',loop:false,equipment:'wood-hoe',durations:[180,220,180,100,90,160,220,280],labels:['握柄','起锄','抬高','落锄','低点','停顿','回柄','站稳']}
  };
  function actionTiming(action,timeMs){const a=ACTIONS[action],total=a.durations.reduce((s,v)=>s+v,0);let t=Math.max(0,timeMs);if(a.loop)t%=total;else if(t>=total)return {phase:7,finished:true,total};for(let k=0;k<8;k++){if(t<a.durations[k])return {phase:k+(k===7&&!a.loop?0:t/a.durations[k]),finished:false,total};t-=a.durations[k];}return {phase:7,finished:!a.loop,total};}
  function timeAtKey(action,key){return ACTIONS[action].durations.slice(0,key).reduce((s,v)=>s+v,0);}
  // Pure clocks: paused previews keep their expression; no hidden wall-clock state.
  function faceAtTime(timeMs, action='idle', mode='auto') {
    if(mode==='closed')return 'closed';
    if(mode==='open'||!['idle','walk'].includes(action))return 'open';
    const t=((Math.max(0,Number(timeMs)||0)%4800)+4800)%4800;
    return t>=4100&&t<4190?'closed':'open';
  }
  function resolveAction(scene, options) {
    const requested=options.action||'idle', config=ACTIONS[requested];
    if(!config)throw Error('Unknown action');
    if(!config.equipment)return {requestedAction:requested,action:requested,phase:options.phase||0,cancelled:false};
    const item=scene.equipment.get(options.equipment?.hand),direction=options.direction||'down';
    const valid=item?.id===config.equipment&&item.directions.includes(direction);
    return valid?{requestedAction:requested,action:requested,phase:options.phase||0,cancelled:false}:
      {requestedAction:requested,action:'idle',phase:0,cancelled:true,reason:'手持装备或朝向不支持'+config.name+'，已取消动作并回到待机'};
  }
  function resolveAppearance(scene, options) {
    const character=options.character||'heqing', c=scene.characters.get(character);
    if(!c)throw Error('Unknown character: '+character);
    const direction=options.direction||'down';
    if(!c.directions.includes(direction))throw Error('Unsupported character direction');
    let outfit=options.outfit||'original';const warnings=[],equipment={};
    let headStyle=options.headStyle||'original';if(!(c.headStyles||[{id:'original'}]).some(style=>style.id===headStyle)){headStyle='original';warnings.push('头部风格不存在，已恢复原版');}
    if(!c.outfits.some(o=>o.id===outfit)){outfit=c.outfits[0].id;warnings.push('衣装不存在，已恢复默认衣装');}
    for(const slot of ['head','back','hand']){
      const id=options.equipment?.[slot];if(!id)continue;
      const item=scene.equipment.get(id);
      if(!item){warnings.push('装备不存在，已忽略：'+id);continue;}
      if(item.slot!==slot){warnings.push(item.name+'不能放在此装备槽，已忽略');continue;}
      equipment[slot]=id;
    }
    let palette=options.palette||'original';if(!Object.hasOwn(PALETTES,palette)){palette='original';warnings.push('色板不存在，已恢复原色');}
    let phase=options.phase??0;if(typeof phase!=='number'||!Number.isFinite(phase)){phase=0;warnings.push('动作相位无效，已恢复起始姿势');}
    const dye={};
    if(options.dye&&typeof options.dye==='object'&&!Array.isArray(options.dye))for(const [channel,value] of Object.entries(options.dye)){
      if(!DYE_CHANNELS.includes(channel)){warnings.push('未知衣料分区已忽略：'+channel);continue;}
      if(!Object.hasOwn(PALETTES,value)){warnings.push('分区色板无效，沿用整体色调：'+channel);continue;}
      dye[channel]=value;
    }
    return {options:{...options,character,direction,outfit,equipment,palette,phase,dye,headStyle},warnings};
  }
  function validateDyeProfile(profile){
    if(!profile)return;
    if(profile.mode!=='material-ramp'||!Number.isInteger(profile.protectMaxRgb)||profile.protectMaxRgb<0||profile.protectMaxRgb>255||profile.sourceLumaStops?.length!==2||!profile.sourceLumaStops.every(Number.isFinite)||profile.sourceLumaStops[0]<0||profile.sourceLumaStops[1]>255||profile.sourceLumaStops[0]>=profile.sourceLumaStops[1]||profile.targetFactors?.length!==3||!profile.targetFactors.every(x=>Number.isFinite(x)&&x>=0&&x<=1))throw Error('Invalid explicit material dyeProfile');
  }
  function validateCharacterOutfits(character){
    const parts=uniqueMap(character.attachments.map(a=>[a.id,a]),'character attachment');
    uniqueMap(character.outfits.map(o=>[o.id,o]),'outfit');
    if(character.headStyles){
      uniqueMap(character.headStyles.map(style=>[style.id,style]),'head style');
      if(!character.headStyles.some(style=>style.id==='original'))throw Error('Head styles require original fallback');
      for(const style of character.headStyles)for(const state of ['open','closed'])if(!style.states?.[state]?.file||!style.states[state].sha256||!character.directions.includes(style.direction))throw Error('Incomplete head style: '+style.id);
    }
    for(const part of parts.values()){
      validateDyeProfile(part.dyeProfile);
      if(part.dyeProfile&&(!part.dyeMask||part.category==='shared'))throw Error('Material profile requires explicit garment dyeMask');
      if(part.layerOrder!==undefined&&!Number.isFinite(part.layerOrder))throw Error('Invalid layerOrder: '+part.id);
      if(part.dyeGroup!=null&&!DYE_CHANNELS.includes(part.dyeGroup))throw Error('Unknown dye group: '+part.id);
      if(part.dyeChannels&&!part.dyeMask)throw Error('Dye channels require a protective base mask: '+part.id);
      for(const [channel,file]of Object.entries(part.dyeChannels||{}))if(!DYE_CHANNELS.includes(channel)||typeof file!=='string'||!file)throw Error('Invalid dye channel: '+part.id);
    }
    for(const outfit of character.outfits){
      if(!outfit.parts?.length)throw Error('Outfit has no actual parts: '+outfit.id);
      uniqueMap(outfit.parts.map(id=>[id,id]),'outfit part reference');
      for(const id of outfit.parts)if(!parts.has(id))throw Error('Invalid outfit part: '+id);
    }
  }
  function createSceneModel(data){const legacy=createModel(data),characters=new Map();characters.set('old-b',{id:'old-b',name:'旧 B · 四向机制',directions:DIRECTIONS,outfits:[{id:'original',name:'原版'},{id:'rural',name:'乡村日常服'},{id:'hanfu',name:'汉服'}],kind:'legacy',bones:data.rig.bones});for(const c of data.characters||[]){if(characters.has(c.id))throw Error('Duplicate character: '+c.id);validateCharacterOutfits(c);characters.set(c.id,{...c,kind:'cutout'});}return {data,legacy,characters,equipment:uniqueMap((data.equipment?.items||[]).map(e=>[e.id,e]),'equipment')};}
  function bindPose(scene,character,direction){const c=scene.characters.get(character);if(!c||!c.directions.includes(direction))throw Error('Character direction is unavailable');const b=c.kind==='legacy'?scene.data.rig.bindPoses[direction]:c.bindPoses[direction],j=clone(b.joints);return {direction,frameIndex:0,joints:j,bodyBobY:0,torsoAngle:0,feet:b.feet?clone(b.feet):{A:{sole:clone(j.toeA)},B:{sole:clone(j.toeB)}},cloth:{skirtHemLateralOffset:0},drawOrder:['legB','legA','pelvis','torso','armA','armB'],wristTwist:{A:0,B:0}};}
  function walkForCharacter(scene,character,direction,phase){const c=scene.characters.get(character),source=poseAtPhase(scene.legacy,direction,phase);if(c.kind==='legacy')return source;const pose=bindPose(scene,character,direction),rest=clone(pose.joints),j=pose.joints,w=source.worldJoints,bob=source.bodyBobY;
    for(const name of ['head','neck','pelvis','shoulderA','shoulderB','hipA','hipB'])j[name][1]+=bob;
    for(const side of ['A','B']){for(const [p,m,t] of [['shoulder','elbow','wrist'],['hip','knee','ankle']])for(const [from,to] of [[p,m],[m,t]]){const a=from+side,b=to+side,theta=Math.atan2(w[b][0]-w[a][0],-(w[b][2]-w[a][2])),length=Math.abs(rest[b][1]-rest[a][1]);j[b]=[j[a][0]+rest[b][0]-rest[a][0],j[a][1]+length*Math.cos(theta)+.5*length*Math.sin(theta)];}const ankle='ankle'+side,toe='toe'+side;j[toe]=[j[ankle][0]+rest[toe][0]-rest[ankle][0],j[ankle][1]+rest[toe][1]-rest[ankle][1]+source.feet[side].heelRaise];pose.feet[side].sole=clone(j[toe]);}
    pose.bodyBobY=bob;pose.drawOrder=clone(source.drawOrder);pose.cloth=clone(source.cloth);return pose;
  }
  const swordShoulder=[0,25,65,85,20,-25,-8,3],swordElbow=[8,35,65,45,-5,-15,10,5],swordBlade=[-10,-35,-75,-25,65,115,35,-5],swordTorso=[0,-3,-6,-2,6,5,2,0];
  const hoeY=[1.5,-1,-3,2,2.5,4,4,1.5],hoeX=[-2,-2.5,-6,-6,-1.5,-2,-3.5,-2],hoeBlade=[55,65,75,100,125,115,75,50],hoeTorso=[0,-2,-4,1,8,8,3,0];
  function actionKey(scene,character,direction,action,key){let p=bindPose(scene,character,direction);const j=p.joints,angles=identityAngles();p.frameIndex=key;
    if(action==='idle'){
      // One native pixel of chest rise remains readable after nearest sampling.
      // Feet stay planted; head shape is still protected by integer translation.
      const breath=[0,-.3,-.7,-1,-.7,-.25,0,.2][key];
      for(const n of ['head','neck','shoulderA','shoulderB','elbowA','elbowB','wristA','wristB'])j[n][1]+=breath;
      p.bodyBobY=breath;
      angles.A.shoulder=[0,-1,-3,-4,-2,0,2,1][key];
      angles.B.shoulder=[0,1,2,3,1,0,-1,-.5][key];
      angles.A.elbow=[0,-4,-7,-9,-5,-1,3,1][key];
      angles.B.elbow=[0,3,5,7,3,-1,-4,-2][key];
    }
    if(action==='sword'){angles.B.shoulder=swordShoulder[key];angles.B.elbow=swordElbow[key];angles.A.shoulder=[0,-4,-9,-12,-5,6,2,0][key];angles.A.elbow=[0,5,12,18,5,-3,2,1][key];p.torsoAngle=swordTorso[key];p.wristTwist.B=swordBlade[key]-swordShoulder[key]-swordElbow[key]-p.torsoAngle;}
    if(action==='hoe'){p.torsoAngle=hoeTorso[key];p.twoHand={offset:[hoeX[key],hoeY[key]],angle:hoeBlade[key],enabled:true};}
    if(p.torsoAngle){for(const n of ['head','neck','shoulderA','shoulderB','elbowA','elbowB','wristA','wristB'])j[n]=rotate(j[n],j.pelvis,p.torsoAngle);}
    p=poseWithAngles(p,angles);return p;
  }
  function interpolateScreenPose(a,b,t){const p=clone(a),j=p.joints;for(const n of ['root','head','neck','pelvis','shoulderA','shoulderB','hipA','hipB'])j[n]=lerpVector(a.joints[n],b.joints[n],t);
    const theta=(v,from,to)=>Math.atan2(v[to][1]-v[from][1],v[to][0]-v[from][0]);
    for(const side of ['A','B']){for(const [from,mid,to] of [['shoulder','elbow','wrist'],['hip','knee','ankle']]){const n0=from+side,n1=mid+side,n2=to+side,upper=lerpAngle(theta(a.joints,n0,n1),theta(b.joints,n0,n1),t),lower=upper+lerpAngle(wrapAngle(theta(a.joints,n1,n2)-theta(a.joints,n0,n1)),wrapAngle(theta(b.joints,n1,n2)-theta(b.joints,n0,n1)),t);for(const [u,v,angle] of [[n0,n1,upper],[n1,n2,lower]]){const length=Math.hypot(a.joints[v][0]-a.joints[u][0],a.joints[v][1]-a.joints[u][1]);j[v]=[j[u][0]+Math.cos(angle)*length,j[u][1]+Math.sin(angle)*length];}}const ankle='ankle'+side,toe='toe'+side,offset=lerpVector(a.joints[toe].map((v,i)=>v-a.joints[ankle][i]),b.joints[toe].map((v,i)=>v-b.joints[ankle][i]),t);j[toe]=j[ankle].map((v,i)=>v+offset[i]);p.feet[side].sole=clone(j[toe]);p.wristTwist[side]=lerp(a.wristTwist?.[side]||0,b.wristTwist?.[side]||0,t);}
    p.bodyBobY=lerp(a.bodyBobY,b.bodyBobY,t);p.torsoAngle=lerp(a.torsoAngle,b.torsoAngle,t);if(a.twoHand)p.twoHand={enabled:true,offset:lerpVector(a.twoHand.offset,b.twoHand.offset,t),angle:lerp(a.twoHand.angle,b.twoHand.angle,t)};return p;
  }
  function actionPose(scene,character,direction,action,phase){if(!ACTIONS[action])throw Error('Unknown action');if(action==='walk')return walkForCharacter(scene,character,direction,phase);const a=ACTIONS[action],p=a.loop?((phase%8)+8)%8:Math.max(0,Math.min(7,phase)),i=Math.floor(p),t=p-i,first=actionKey(scene,character,direction,action,i);return t<1e-10?first:interpolateScreenPose(first,actionKey(scene,character,direction,action,a.loop?(i+1)%8:Math.min(7,i+1)),t);}
  // Fixed bend pole: screen-x sorting flips branches when a tool crosses the shoulder line.
  // A uses negative and B positive oriented area, independent of world target angle.
  function solveTwoBone(shoulder,elbow,wrist,target,side){const l1=Math.hypot(elbow[0]-shoulder[0],elbow[1]-shoulder[1]),l2=Math.hypot(wrist[0]-elbow[0],wrist[1]-elbow[1]),raw=Math.hypot(target[0]-shoulder[0],target[1]-shoulder[1]),d=Math.max(Math.abs(l1-l2)+1e-5,Math.min(l1+l2-1e-5,raw)),u=raw>1e-8?[(target[0]-shoulder[0])/raw,(target[1]-shoulder[1])/raw]:[0,1],along=(l1*l1-l2*l2+d*d)/(2*d),height=Math.sqrt(Math.max(0,l1*l1-along*along)),center=[shoulder[0]+u[0]*along,shoulder[1]+u[1]*along],e1=[center[0]-u[1]*height,center[1]+u[0]*height],e2=[center[0]+u[1]*height,center[1]-u[0]*height],e=side==='A'?e2:e1,w=[shoulder[0]+u[0]*d,shoulder[1]+u[1]*d];return {elbow:e,wrist:w,error:Math.hypot(w[0]-target[0],w[1]-target[1]),lengths:[l1,l2]};}
  function forearmDelta(pose,rest,side){const angle=j=>Math.atan2(j['wrist'+side][1]-j['elbow'+side][1],j['wrist'+side][0]-j['elbow'+side][0]);return wrapAngle(angle(pose.joints)-angle(rest.joints))*180/Math.PI;}
  function palmOffset(character,side){return character==='heqing'?(side==='B'?[-.5,1]:[0,1.5]):[0,.5];}
  function palmPoint(character,pose,rest,side){const off=rotate(palmOffset(character,side),[0,0],forearmDelta(pose,rest,side));return pose.joints['wrist'+side].map((v,i)=>v+off[i]);}
  function solvePalm(character,pose,rest,side,target){
    const shoulder=pose.joints['shoulder'+side],rs=rest.joints['shoulder'+side],re=rest.joints['elbow'+side],rw=rest.joints['wrist'+side],off=palmOffset(character,side),elbow=re.map((v,i)=>v-rs[i]+shoulder[i]),palm=rw.map((v,i)=>v+off[i]-rs[i]+shoulder[i]);
    const solved=solveTwoBone(shoulder,elbow,palm,target,side),restAngle=Math.atan2(rw[1]+off[1]-re[1],rw[0]+off[0]-re[0]),targetAngle=Math.atan2(solved.wrist[1]-solved.elbow[1],solved.wrist[0]-solved.elbow[0]),forearm=rotate(rw.map((v,i)=>v-re[i]),[0,0],(targetAngle-restAngle)*180/Math.PI);
    pose.joints['elbow'+side]=solved.elbow;pose.joints['wrist'+side]=solved.elbow.map((v,i)=>v+forearm[i]);return Math.hypot(...palmPoint(character,pose,rest,side).map((v,i)=>v-target[i]));
  }
  function gearMatrix(scene,character,pose,rest,item,adjust={}){let point,angle=pose.torsoAngle||0;if(item.slot==='hand'){point=palmPoint(character,pose,rest,'B');angle=pose.twoHand?.enabled?pose.twoHand.angle:forearmDelta(pose,rest,'B')+(pose.wristTwist?.B||0);}else{if(item.slot==='head')angle=0;const joint=item.slot==='head'?'head':'neck',reference=scene.characters.get('heqing')?.bindPoses.down.joints||rest.joints,placement=item.heqingRestPlacement||(item.slot==='head'?[32,20]:[32,34]),offset=placement.map((v,i)=>v-reference[joint][i]),rot=rotate(offset,[0,0],angle);point=pose.joints[joint].map((v,i)=>v+rot[i]);if(item.slot==='head')point=point.map(roundEven);}const offset=rotate([Number(adjust.x)||0,Number(adjust.y)||0],[0,0],angle);point=point.map((v,i)=>v+offset[i]);angle+=(item.bindAngleDeg||0)+(Number(adjust.angle)||0);return {matrix:rotateTranslate(item.pivot,point,angle),slotPoint:point,angle};}
  function outfitParts(character,direction,outfit){
    const allowed=new Set(character.outfits.find(o=>o.id===outfit)?.parts||[]);
    return character.attachments.filter(b=>b.direction===direction&&(b.category==='shared'||allowed.has(b.id)));
  }
  function outfitDyeChannels(scene,character,direction,outfit){
    const c=scene.characters.get(character);
    if(c.kind==='legacy')return ['top','bottom'];
    const channels=new Set();
    for(const b of outfitParts(c,direction,outfit))if(b.category!=='shared'){
      channels.add(b.dyeGroup||defaultDyeGroup(b.part));
      for(const name of Object.keys(b.dyeChannels||{}))channels.add(name);
    }
    return DYE_CHANNELS.filter(name=>channels.has(name));
  }
  function customCommands(character,direction,outfit,pose,faceState='open',headStyle='original'){
    const result=[];
    for(const b of outfitParts(character,direction,outfit)){
      const target=b.targetBone?.map(n=>pose.joints[n]);let matrix;
      if(b.part==='head'||b.part==='hairFront'){
        const rest=character.bindPoses[direction].joints.head;
        matrix=[1,0,0,1,roundEven(pose.joints.head[0]-rest[0]),roundEven(pose.joints.head[1]-rest[1])];
      }else if(target&&b.sourceBone)matrix=boneMatrix(b.sourceBone,target,b.widthFactor??1);
      else{
        const joint=b.bindJoint||'head';
        matrix=rotateTranslate(b.pivot,pose.joints[joint],pose.torsoAngle||0);
      }
      result.push({id:b.id,part:b.part,category:b.category,file:(b.part==='head'?(character.headStyles?.find(style=>style.id===headStyle&&style.direction===direction)?.states[faceState]?.file||(character.faceVariants?.[faceState]?.direction===direction?character.faceVariants[faceState].file:b.file)):b.file),matrix,underlap:!!b.underlap,drawOrder:b.drawOrder||0,layerOrder:b.layerOrder,dyeMask:b.dyeMask,dyeGroup:b.dyeGroup||defaultDyeGroup(b.part),dyeChannels:b.dyeChannels,dyeProfile:b.dyeProfile});
    }
    const rank=n=>n==='head'?80:n==='hairFront'?90:n.startsWith('shoe')?12:n.startsWith('thigh')||n.startsWith('shin')?15:n==='pelvis'?20:n==='torso'?30:n.startsWith('upperArm')||n.startsWith('lowerArm')?45:n.startsWith('hand')?50:35;
    const order=part=>Number.isFinite(part.layerOrder)?part.layerOrder:part.underlap?-1000:rank(part.part);
    result.sort((a,b)=>order(a)-order(b)||a.drawOrder-b.drawOrder);
    return result;
  }
  function sceneCommands(scene,options){const appearance=resolveAppearance(scene,options);options=appearance.options;const resolution=resolveAction(scene,options),action=resolution.action,phase=resolution.phase,faceState=faceAtTime(options.blinkTimeMs,action,options.faceMode||'open');const {character='heqing',direction='down',outfit='original',angles=identityAngles(),equipment={},adjustments={}}=options,c=scene.characters.get(character);if(!c||!c.directions.includes(direction))throw Error('Unsupported character direction');const rest=bindPose(scene,character,direction),pose=poseWithAngles(actionPose(scene,character,direction,action,phase),angles),warnings=[...appearance.warnings,...(resolution.cancelled?[resolution.reason]:[])],active=[];for(const slot of ['head','back','hand']){const item=scene.equipment.get(equipment[slot]);if(!item)continue;if(!item.directions.includes(direction)){warnings.push(item.name+'只有正面素材，此方向隐藏');continue;}active.push(item);}
    const tool=active.find(e=>e.slot==='hand'),ik={enabled:false},grip={enabled:!!tool};
    // In two-hand mode, XY moves the authored hand target once. It is not a
    // second equipment translation after IK. Rotation remains about the pivot.
    const placements={};
    if(action==='hoe'&&tool?.secondaryGrip){
      const adjust=adjustments[tool.id]||{},middleY=(rest.joints.shoulderA[1]+rest.joints.shoulderB[1])/2;
      const baseTarget=rotate([rest.joints.pelvis[0]+pose.twoHand.offset[0],middleY+pose.twoHand.offset[1]],rest.joints.pelvis,pose.torsoAngle||0);
      const shift=rotate([Number(adjust.x)||0,Number(adjust.y)||0],[0,0],pose.twoHand.angle);
      const target=baseTarget.map((v,i)=>v+shift[i]);
      ik.enabled=true;ik.primaryTarget=target;
      ik.primaryTargetError=solvePalm(character,pose,rest,'B',target);
      const placement=gearMatrix(scene,character,pose,rest,tool,{...adjust,x:0,y:0});
      placements[tool.id]=placement;
      ik.secondaryTarget=apply(placement.matrix,tool.secondaryGrip);
      ik.secondaryTargetError=solvePalm(character,pose,rest,'A',ik.secondaryTarget);
    }
    let list=c.kind==='legacy'?commands(scene.legacy,direction,Math.floor(phase)%8,outfit,identityAngles(),pose).commands:customCommands(c,direction,outfit,pose,faceState,options.headStyle);const equipmentBindings=[];
    for(const item of active){const placement=placements[item.id]||gearMatrix(scene,character,pose,rest,item,adjustments[item.id]),cmd={id:item.id,part:item.name,category:'equipment',slot:item.slot,file:item.file,matrix:placement.matrix};equipmentBindings.push({id:item.id,slot:item.slot,pivot:item.pivot,slotPoint:placement.slotPoint,matrix:placement.matrix,secondaryGrip:item.secondaryGrip});if(item.slot==='back')list.unshift(cmd);else if(item.slot==='head')list.push(cmd);else{const hands=list.filter(c=>!c.underlap&&((c.part==='handB')||(ik.enabled&&c.part==='handA')));list=list.filter(c=>!hands.includes(c));list.push(cmd,...hands);}}
    // Measure the final matrix actually drawn, never the pre-offset solver target.
    if(tool){
      const binding=equipmentBindings.find(b=>b.id===tool.id);
      grip.primaryPoint=apply(binding.matrix,tool.pivot);
      grip.primaryError=Math.hypot(...grip.primaryPoint.map((v,i)=>v-palmPoint(character,pose,rest,'B')[i]));
      if(ik.enabled){
        grip.secondaryPoint=apply(binding.matrix,tool.secondaryGrip);
        grip.secondaryError=Math.hypot(...grip.secondaryPoint.map((v,i)=>v-palmPoint(character,pose,rest,'A')[i]));
        ik.primaryError=grip.primaryError;ik.secondaryError=grip.secondaryError;
        if(Math.max(ik.primaryTargetError,ik.secondaryError)>.35)warnings.push('当前双手目标超出可达范围，未拉长骨段；可还原装备位置');
      }else if(grip.primaryError>.35)warnings.push('单手装备校准偏移使掌心与握点相距 '+grip.primaryError.toFixed(2)+' px；此模式不重解手臂，请还原 XY 或检查挂点');
    }
    return {pose,commands:list,character:c,rest,ik,grip,equipmentBindings,warnings,resolution,faceState,effectiveOptions:appearance.options};
  }
  // V17 uses explicit per-attachment semantic indices; no face-wide RGB inference.
  const appearanceCache=new WeakMap();
  function resolveBodyAppearance(scene,character,requested={}) {
    const contract=scene.data.appearance,values={},warnings=[];
    for(const channel of ['hair','skin']) {
      const value=requested?.[channel]||'original';
      if(character!==contract?.character||value==='original')values[channel]='original';
      else if(contract.presets?.[channel]?.[value])values[channel]=value;
      else {values[channel]='original';warnings.push('未知'+(channel==='hair'?'发色':'肤色')+'，已保留原色');}
    }
    return {values,warnings};
  }
  function appearanceTexture(scene,textures,file,selection) {
    const source=textures.get(file);if(!source)throw Error('Missing actual part: '+file);
    const binding=scene.data.appearance?.bindings?.[file];
    if(!binding)return source;
    const active=Object.keys(binding.materialMasks||{}).filter(channel=>selection[channel]!=='original');
    if(!active.length)return source;
    let byTextures=appearanceCache.get(scene);if(!byTextures){byTextures=new WeakMap();appearanceCache.set(scene,byTextures);}
    let cache=byTextures.get(textures);if(!cache){cache=new Map();byTextures.set(textures,cache);}
    const key=JSON.stringify([file,selection.hair,selection.skin]),previous=cache.get(key);
    if(previous?.source===source)return previous.texture;
    const pixels=new Uint8ClampedArray(source.pixels),occupied=new Uint8Array(pixels.length/4);
    for(const [channel,maskFile]of Object.entries(binding.materialMasks||{})) {
      if(!['hair','skin'].includes(channel))throw Error('Unknown body material: '+channel);
      const mask=textures.get(maskFile);if(!mask)throw Error('Missing body material mask: '+maskFile);
      if(mask.width!==source.width||mask.height!==source.height)throw Error('Body material mask dimensions differ: '+maskFile);
      const preset=selection[channel]==='original'?null:scene.data.appearance.presets[channel][selection[channel]];
      const tierCount=scene.data.appearance.tierCounts[channel];
      for(let n=0;n<pixels.length;n+=4) {
        if(!mask.pixels[n+3])continue;
        const tier=mask.pixels[n];
        if(mask.pixels[n+3]!==255||source.pixels[n+3]!==255||occupied[n/4]||tier>=tierCount)throw Error('Invalid body material coverage/index: '+maskFile);
        occupied[n/4]=1;
        if(preset){const rgb=preset.ramp[tier];if(!rgb||rgb.length!==3)throw Error('Incomplete body material ramp: '+channel);pixels.set(rgb,n);}
      }
    }
    const texture=textureInfo(pixels,source.width,source.height);cache.set(key,{source,texture});return texture;
  }
  function renderScene(scene,textures,options={}){
    const plan=sceneCommands(scene,options),body=resolveBodyAppearance(scene,plan.character.id,options.appearance),output=new Uint8ClampedArray(96*96*4);plan.warnings.push(...body.warnings);plan.bodyAppearance=body.values;let clipped=0,pixelWrites=0;
    const paletteFor=group=>PALETTES[plan.effectiveOptions.dye[group]??plan.effectiveOptions.palette];
    for(const command of plan.commands){
      const texture=appearanceTexture(scene,textures,command.file,body.values);
      const shared=command.category==='shared'||command.category==='equipment';
      const tint=shared?null:paletteFor(command.dyeGroup||defaultDyeGroup(command.part));
      const mask=command.dyeMask?textures.get(command.dyeMask):null;
      if(command.dyeMask&&!mask)throw Error('Missing required dye mask: '+command.dyeMask);
      if(mask&&(mask.width!==texture.width||mask.height!==texture.height))throw Error('Dye mask dimensions differ: '+command.dyeMask);
      const channels=[];
      for(const [name,file] of Object.entries(command.dyeChannels||{})){
        const channel=textures.get(file);
        if(!channel)throw Error('Missing required dye channel mask: '+file);
        if(channel.width!==texture.width||channel.height!==texture.height)throw Error('Dye channel dimensions differ: '+file);
        channels.push({texture:channel,palette:shared?null:paletteFor(name)});
      }
      if(command.rowShear){
        const r=command.rowShear;
        for(let y=41;y<57;y++){const dx=roundEven(32-r.center+r.sway*(y-41)/15)+16,dy=roundEven(r.bob)+16;const s=stamp(output,texture,[1,0,0,1,dx,dy],tint,[0,y,64,y+1],mask,channels,command.dyeProfile);clipped+=s.clipped;pixelWrites+=s.pixels;}
      }else{
        const m=command.matrix.slice();m[4]+=16;m[5]+=16;const s=stamp(output,texture,m,tint,null,mask,channels,command.dyeProfile);clipped+=s.clipped;pixelWrites+=s.pixels;
      }
    }
    return {...plan,pixels:output,canvas:[96,96],actorOffset:[16,16],stats:{partDraws:plan.commands.length,clippedPixels:clipped,pixelWrites,wholeFrameImages:0}};
  }
  return {DIRECTIONS,PALETTES,DYE_CHANNELS,ACTIONS,outfitParts,outfitDyeChannels,customCommands,identityAngles,roundEven,rotate,poseWithAngles,apply,inverse,boneMatrix,createModel,poseAtPhase,commands,textureInfo,dye,stamp,render,createSceneModel,bindPose,actionPose,faceAtTime,resolveAction,resolveAppearance,actionTiming,timeAtKey,solveTwoBone,palmPoint,gearMatrix,sceneCommands,resolveBodyAppearance,appearanceTexture,renderScene};
});
