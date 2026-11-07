(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SceneRaster=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
// Preserve source transforms/materials. Add only the fractional world translation
// before nearest-neighbor rasterization; never rasterize-then-subpixel-shift a body.
function render(E,model,textures,options,x,y){
 const plan=E.sceneCommands(model,options),body=E.resolveBodyAppearance(model,plan.character.id,options.appearance),pixels=new Uint8ClampedArray(96*96*4);
 const origin=[Math.floor(x)-48,Math.floor(y)-74],offset=[16+x-Math.floor(x),16+y-Math.floor(y)];let clipped=0;
 const paletteFor=group=>E.PALETTES[plan.effectiveOptions.dye[group]??plan.effectiveOptions.palette];
 for(const c of plan.commands){
  if(c.rowShear)throw Error('Scene candidate supports measured cutout pieces, not legacy row-shear');
  const texture=E.appearanceTexture(model,textures,c.file,body.values),shared=c.category==='shared'||c.category==='equipment',tint=shared?null:paletteFor(c.dyeGroup||'top');
  const mask=c.dyeMask?textures.get(c.dyeMask):null;
  if(c.dyeMask&&(!mask||mask.width!==texture.width||mask.height!==texture.height))throw Error('Required garment mask missing or wrong size: '+c.dyeMask);
  const channels=Object.entries(c.dyeChannels||{}).map(([name,file])=>{const m=textures.get(file);if(!m||m.width!==texture.width||m.height!==texture.height)throw Error('Required dye channel missing or wrong size: '+file);return {texture:m,palette:shared?null:paletteFor(name)};});
  const matrix=c.matrix.slice();matrix[4]+=offset[0];matrix[5]+=offset[1];clipped+=E.stamp(pixels,texture,matrix,tint,null,mask,channels,c.dyeProfile).clipped;
 }
 return {...plan,pixels,origin,offset,clippedPixels:clipped};
}
return {render};
});
