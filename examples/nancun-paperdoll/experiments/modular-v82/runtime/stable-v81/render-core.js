/* V81 identity/wardrobe adapter. Source engine and native textures remain immutable. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.VillageWardrobe=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function createRenderer(E,data,textures){
 const spec=data.v81;if(!spec)throw Error('V81 bundle contract missing');const manifest=spec.manifest,models=new Map(),masked=new Map();
 const base=data.characters.find(c=>c.id==='heqing');if(!base)throw Error('Shared source rig missing');
 const byOutfit=new Map(spec.outfits.map(p=>[p.id,p]));
 function modelFor(identity){
  if(models.has(identity))return models.get(identity);
  const item=spec.characters.find(c=>c.id===identity);if(!item)throw Error('真实角色素材尚未接入：'+identity);
  const c=clone(base),removed=new Set(c.attachments.filter(p=>['head','hairFront','neckSkin'].includes(p.part)).map(p=>p.id));
  c.directions=['down'];c.bindPoses={down:c.bindPoses.down};c.walkProjection={down:c.walkProjection.down};delete c.headStyles;delete c.faceVariants;
  c.attachments=c.attachments.filter(p=>p.direction==='down'&&!removed.has(p.id));
  const newHeads=item.attachments.map(p=>({...clone(p),category:'shared'}));c.attachments.push(...newHeads);
  const present=new Set(c.attachments.map(p=>p.id)),headIds=newHeads.map(p=>p.id),original=clone(base.outfits.find(o=>o.id==='original'));
  original.directions=['down'];original.parts=[...new Set(original.parts.filter(id=>present.has(id)).concat(headIds))];c.outfits=[original];
  for(const pack of spec.outfits){
   for(const p of pack.attachments){if(present.has(p.id))throw Error('Duplicate outfit attachment '+p.id);c.attachments.push(clone(p));present.add(p.id);}
   const parts=(pack.parts||pack.attachments.map(p=>p.id)).filter(id=>!removed.has(id));for(const id of parts)if(!present.has(id))throw Error('Missing shared/new piece '+id);
   c.outfits.push({id:pack.id,name:pack.name,directions:['down'],parts:[...new Set([...parts,...headIds])]});
  }
  const sceneData={...data,characters:[c]},scene=E.createSceneModel(sceneData),attachments=new Map(c.attachments.map(p=>[p.id,p]));
  const entry={scene,character:c,attachments,identity:item};models.set(identity,entry);return entry;
 }
 function maskedTexture(file,maskFile,bodyOnly=false){
  if(bodyOnly)return null;if(!maskFile)throw Error('Independent garment needs explicit garmentMask: '+file);
  const key=file+'|'+maskFile;if(masked.has(key))return masked.get(key);
  const source=textures.get(file),mask=textures.get(maskFile);if(!source||!mask||source.width!==mask.width||source.height!==mask.height)throw Error('Garment mask missing or wrong size: '+file);
  const pixels=new Uint8ClampedArray(source.pixels);for(let n=0;n<pixels.length;n+=4){if(mask.pixels[n+3]){if(!source.pixels[n+3])throw Error('Garment mask outside source: '+file);}else pixels.fill(0,n,n+4);}
  const result=E.textureInfo(pixels,source.width,source.height);masked.set(key,result);return result;
 }
 function prepare(options){
  const identity=options.character||manifest.defaults.character,outfit=options.outfit||manifest.defaults.outfit;if(!identity||!outfit)throw Error('等待本批真实角色与衣装素材');if(!byOutfit.has(outfit))throw Error('真实衣装素材尚未接入：'+outfit);
  const entry=modelFor(identity),settings={character:'heqing',direction:'down',outfit,action:options.action||'idle',phase:options.phase||0,gait:'s12',equipment:{},faceMode:'open',headStyle:'original',palette:options.palette||'original',dye:options.dye||{},appearance:options.appearance||entry.identity.defaultAppearance||{hair:'original',skin:'original'}};
  if(!['idle','walk'].includes(settings.action))throw Error('V81 only previews front idle/walk');
  const plan=E.sceneCommands(entry.scene,settings),head=plan.commands.find(c=>c.part==='head');
  for(const cmd of plan.commands)if(entry.attachments.get(cmd.id)?.headAnchored){if(!head)throw Error('headAnchored part without head');cmd.matrix=head.matrix.slice();}
  const commands=options.garmentOnly?plan.commands.filter(cmd=>{const p=entry.attachments.get(cmd.id);return cmd.category!=='shared'&&!p?.bodyOnly&&p?.contentRole!=='skin';}):plan.commands;
  return {entry,settings,plan,commands};
 }
 function render(options={}){
  const {entry,settings,plan,commands}=prepare(options),size=options.canvasSize===64?64:96,padding=size===64?0:16,pixels=new Uint8ClampedArray(size*size*4),body=E.resolveBodyAppearance(entry.scene,'heqing',settings.appearance);let clipped=0;
  for(const cmd of commands){const p=entry.attachments.get(cmd.id),shared=cmd.category==='shared';let texture=options.garmentOnly?maskedTexture(cmd.file,p.garmentMask):E.appearanceTexture(entry.scene,textures,cmd.file,body.values);
   const tint=shared?null:E.PALETTES[settings.dye[cmd.dyeGroup]??settings.palette],mask=cmd.dyeMask?textures.get(cmd.dyeMask):null,channels=Object.entries(cmd.dyeChannels||{}).map(([name,file])=>({texture:textures.get(file),palette:E.PALETTES[settings.dye[name]??settings.palette]}));
   if(cmd.dyeMask&&!mask)throw Error('Dye mask missing: '+cmd.dyeMask);if(channels.some(x=>!x.texture))throw Error('Dye channel missing');
   const matrix=cmd.matrix.slice();matrix[4]+=padding;matrix[5]+=padding;clipped+=E.stamp(pixels,texture,matrix,tint,null,mask,channels,cmd.dyeProfile).clipped;
  }
  return {...plan,pixels,commands,canvas:[size,size],padding,clippedPixels:clipped,identity:entry.identity.id,outfit:settings.outfit,garmentOnly:!!options.garmentOnly};
 }
 function parts(options={}){const {entry,commands}=prepare({...options,garmentOnly:true});return commands.map(cmd=>{const p=entry.attachments.get(cmd.id);return {id:cmd.id,part:cmd.part,underlap:!!cmd.underlap,file:cmd.file,texture:maskedTexture(cmd.file,p.garmentMask),sourceBone:p.sourceBone,targetBone:p.targetBone,bindJoint:p.bindJoint};});}
 return {manifest,render,parts,modelFor,textures};
}
return {createRenderer};
});
