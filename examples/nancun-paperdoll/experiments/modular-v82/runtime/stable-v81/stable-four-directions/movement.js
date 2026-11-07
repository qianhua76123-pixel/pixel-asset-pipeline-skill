(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SceneMovement=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const STRIDE=12,WORLD_SPEED=15,PROJECTION={down:[0,.5],right:[1,0],up:[0,-.5],left:[-1,0]};
const BOUNDS={left:404,right:466,top:286,bottom:338};
function create(){return {x:420,y:326,direction:'right',phase:0,worldDistance:0,moving:false,action:'idle',blinkTimeMs:0};}
function step(state,direction,seconds,multiplier=1,bounds=BOUNDS){
 if(!Number.isFinite(seconds)||seconds<0)throw Error('Invalid elapsed time');
 if(![1,2,3].includes(multiplier))throw Error('Unsupported synchronized speed');
 const s={...state};s.moving=false;s.action='idle';
 if(!direction)return s;
 if(!PROJECTION[direction])throw Error('Unsupported direction');
 s.direction=direction;const v=PROJECTION[direction],distance=WORLD_SPEED*multiplier*seconds;
 s.x=Math.max(bounds.left,Math.min(bounds.right,s.x+v[0]*distance));s.y=Math.max(bounds.top,Math.min(bounds.bottom,s.y+v[1]*distance));
 const dx=s.x-state.x,dy=s.y-state.y,actualWorld=Math.hypot(dx,dy/.5);
 if(actualWorld>1e-8){s.phase=(s.phase+actualWorld/STRIDE*8)%8;s.worldDistance+=actualWorld;s.moving=true;s.action='walk';s.blinkTimeMs+=seconds*1000;}
 return s;
}
function camera(x,y,viewWidth,viewHeight,sceneWidth=896,sceneHeight=512){
 const axis=(point,view,size)=>Math.round(view>=size?(size-view)/2:Math.max(0,Math.min(size-view,point-view/2)));
 return {x:axis(x,viewWidth,sceneWidth),y:axis(y-16,viewHeight,sceneHeight)};
}
return {STRIDE,WORLD_SPEED,PROJECTION,BOUNDS,create,step,camera};
});
