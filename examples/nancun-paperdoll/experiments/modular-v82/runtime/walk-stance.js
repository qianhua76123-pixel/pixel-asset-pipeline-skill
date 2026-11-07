(function(global,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.WalkStance=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
// Direction-measured hybrid walk candidate; no source texture changes.
const clone=x=>JSON.parse(JSON.stringify(x));
const PROJECTION={down:[0,.5],right:[1,0],up:[0,-.5],left:[-1,0]};
const CANDIDATES={s16:{stride:16,periodMs:800,lift:1.4,reach:.97,minBob:.23},s12:{stride:12,periodMs:800,lift:.9,reach:.97,minBob:.23}};
function track(cycles,side,c){
 const offset=side==='A'?0:.5,u=((cycles+offset)%1+1)%1,A=c.stride/4;
 if(u<.5)return {u,stance:true,forward:A-c.stride*u,lift:0,plantCycle:Math.floor(cycles+offset)};
 const p=(u-.5)*2;
 // Hermite endpoints df/du=-stride on both ends match the planted segment.
 const forward=-A-(c.stride/2)*p+3*c.stride*p*p-2*c.stride*p*p*p;
 return {u,stance:false,forward,lift:c.lift*Math.sin(Math.PI*p)**2,plantCycle:null};
}
function ikForward(f,v,L1,L2){
 const d=Math.hypot(f,v);if(d>=L1+L2||d<=Math.abs(L1-L2))throw Error('Unreachable sagittal target');
 const along=(L1*L1-L2*L2+d*d)/(2*d),height=Math.sqrt(Math.max(0,L1*L1-along*along));
 // Positive-forward knee pole, fixed across both half-cycles and target x sign.
 return {knee:[along*f/d+height*v/d,along*v/d-height*f/d],ankle:[f,v]};
}
function makePose(E,scene,direction,phase,c){
 const bind=E.bindPose(scene,'heqing',direction),r=bind.joints,pose=clone(bind),j=pose.joints,projection=PROJECTION[direction],cycles=phase/8;
 const legacy=E.poseAtPhase(scene.legacy,direction,phase),tracks={},spec={},world={},arms=[];let bob=c.minBob;
 for(const s of ['A','B']){
  const h=r['hip'+s],k=r['knee'+s],a=r['ankle'+s],t=track(cycles,s,c),side=direction==='right'||direction==='left',sign=direction==='left'?-1:1;
  const L1=side?Math.hypot(k[0]-h[0],k[1]-h[1]):Math.abs(k[1]-h[1]),L2=side?Math.hypot(a[0]-k[0],a[1]-k[1]):Math.abs(a[1]-k[1]);
  const f=t.forward+(side?sign*(a[0]-h[0]):0),height=a[1]-h[1],reach=c.reach*(L1+L2);
  if(Math.abs(f)>=reach)throw Error('Stride exceeds measured leg reach');
  bob=Math.max(bob,height-t.lift-Math.sqrt(reach*reach-f*f));tracks[s]=t;spec[s]={L1,L2,f,height,lateral:[k[0]-h[0],a[0]-k[0]]};
 }
 for(const n of ['head','neck','pelvis','shoulderA','shoulderB','hipA','hipB'])j[n][1]+=bob;
 for(const s of ['A','B']){
  const sp=spec[s],t=tracks[s],h=j['hip'+s],sol=ikForward(sp.f,sp.height-bob-t.lift,sp.L1,sp.L2);
  const project=(v,name)=>(direction==='right'||direction==='left')?[h[0]+projection[0]*v[0],h[1]+v[1]]:[r[name][0]+projection[0]*v[0],h[1]+v[1]+projection[1]*v[0]];
  j['knee'+s]=project(sol.knee,'knee'+s);j['ankle'+s]=project(sol.ankle,'ankle'+s);
  j['toe'+s]=j['ankle'+s].map((v,i)=>v+r['toe'+s][i]-r['ankle'+s][i]);pose.feet[s].sole=clone(j['toe'+s]);
  world[s]={hip:[0,0],knee:sol.knee,ankle:sol.ankle,spec:sp,track:t};
  // Preserve original shoulder/elbow silhouette swing, with exact source bone
  // lengths in sagittal (right) or 3-D lateral/depth/height (front/back) space.
  for(const [a,b]of [['shoulder','elbow'],['elbow','wrist']]){
   const an=a+s,bn=b+s,wa=legacy.worldJoints[an],wb=legacy.worldJoints[bn],theta=Math.atan2(wb[0]-wa[0],-(wb[2]-wa[2])),dx=r[bn][0]-r[an][0],dy=r[bn][1]-r[an][1];
   if(direction==='right'||direction==='left'){const sign=projection[0],fdx=sign*dx,v=[sign*(fdx*Math.cos(theta)+dy*Math.sin(theta)),dy*Math.cos(theta)-fdx*Math.sin(theta)];j[bn]=[j[an][0]+v[0],j[an][1]+v[1]];arms.push({bone:[an,bn],vector:v,restLength:Math.hypot(dx,dy)});}
   else {j[bn]=[j[an][0]+dx+projection[0]*dy*Math.sin(theta),j[an][1]+dy*Math.cos(theta)+projection[1]*dy*Math.sin(theta)];arms.push({bone:[an,bn],vector:[dx,dy*Math.sin(theta),dy*Math.cos(theta)],restLength:Math.hypot(dx,dy)});}
  }
 }
 pose.frameIndex=phase;pose.bodyBobY=bob;pose.cloth=clone(legacy.cloth);pose._study={candidate:c,tracks,world,arms,bob,actorWorld:cycles*c.stride,projection};return pose;
}
return {CANDIDATES,PROJECTION,track,ikForward,makePose};

});
