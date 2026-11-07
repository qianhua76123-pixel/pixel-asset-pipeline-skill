(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SceneHandoff=factory();})(typeof window==='object'?window:globalThis,function(){
'use strict';
const FIELDS=['v','outfit','headStyle','hair','skin','palette','gait','direction','action','phase'];
function encode(value){return encodeURIComponent(JSON.stringify({v:1,outfit:value.outfit,headStyle:value.headStyle,hair:value.hair,skin:value.skin,palette:value.palette,gait:value.gait,direction:value.direction,action:value.action,phase:value.phase}));}
function read(search,E,scene,appearance){
 const params=new URLSearchParams(search);if(!params.has('view'))return {kind:'absent'};
 const invalid=()=>({kind:'invalid',reason:'链接参数无效，已按默认造型打开。'});
 try{
  const raws=params.getAll('view');if(raws.length!==1||raws[0].length>2048)return invalid();
  const value=JSON.parse(raws[0]);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==FIELDS.length||Object.keys(value).some(k=>!FIELDS.includes(k))||value.v!==1)return invalid();
  const c=scene.characters.get('heqing');
  if(!c||!c.directions.includes(value.direction)||!c.outfits.some(o=>o.id===value.outfit)||!(c.headStyles||[]).some(h=>h.id===value.headStyle))return invalid();
  for(const field of ['hair','skin'])if(typeof value[field]!=='string'||(value[field]!=='original'&&!Object.hasOwn(appearance.presets[field],value[field])))return invalid();
  if(typeof value.palette!=='string'||!Object.hasOwn(E.PALETTES,value.palette)||!['original','s12'].includes(value.gait)||!['idle','walk'].includes(value.action)||typeof value.phase!=='number'||!Number.isFinite(value.phase)||value.phase<0||value.phase>=8)return invalid();
  const resolved=E.resolveAppearance(scene,{character:'heqing',direction:value.direction,outfit:value.outfit,headStyle:value.headStyle,palette:value.palette,action:value.action,phase:value.phase,equipment:{}});
  const body=E.resolveBodyAppearance(scene,'heqing',{hair:value.hair,skin:value.skin});
  return {kind:'valid',value:{character:'heqing',direction:resolved.options.direction,outfit:resolved.options.outfit,headStyle:resolved.options.headStyle,palette:resolved.options.palette,appearance:body.values,gait:value.gait,action:value.action,phase:value.phase},warnings:[...resolved.warnings,...body.warnings]};
 }catch{return invalid();}
}
return Object.freeze({encode,read});
});
