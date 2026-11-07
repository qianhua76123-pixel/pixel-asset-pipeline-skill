extends RefCounted
# Direct four-view port of frozen V69/V51 walk-stance S12 and idle curves.
# Only bind joints, parameters and eight authored legacy arm keys are runtime inputs.
var data:Dictionary
func _init(input:Dictionary):data=input
func wrap_angle(a:float)->float:return atan2(sin(a),cos(a))
func mix_angle(a:float,b:float,t:float)->float:return a+wrap_angle(b-a)*t
func angle(w:Dictionary,a:String,b:String)->float:return atan2(w[b][0]-w[a][0],-(w[b][2]-w[a][2]))
func screen_angle(j:Dictionary,a:String,b:String)->float:return atan2(j[b][1]-j[a][1],j[b][0]-j[a][0])
func length(a:Array,b:Array)->float:return sqrt(pow(b[0]-a[0],2)+pow(b[1]-a[1],2))
func track(cycles:float,side:String)->Dictionary:
 var offset=0.0 if side=='A' else .5
 var u=fposmod(cycles+offset,1.0);var stride=float(data.walk.stride);var amplitude=stride/4.0
 if u<.5:return {'u':u,'stance':true,'forward':amplitude-stride*u,'lift':0.0,'plantCycle':floor(cycles+offset)}
 var p=(u-.5)*2.0
 return {'u':u,'stance':false,'forward':-amplitude-(stride/2.0)*p+3.0*stride*p*p-2.0*stride*p*p*p,'lift':data.walk.lift*pow(sin(PI*p),2),'plantCycle':null}
func walk_pose(direction:String,phase:float)->Dictionary:
 var view=data.views[direction];var rest=view.bind;var joints=rest.duplicate(true);var cycles=phase/8.0;var tracks={};var specs={};var world={};var bob=float(data.walk.minBob)
 var side_view=direction in ['right','left'];var sign=-1.0 if direction=='left' else 1.0
 for side in ['A','B']:
  var h=rest['hip'+side];var k=rest['knee'+side];var a=rest['ankle'+side];var motion=track(cycles,side)
  var l1=length(h,k) if side_view else absf(k[1]-h[1]);var l2=length(k,a) if side_view else absf(a[1]-k[1])
  var f=float(motion.forward)+(sign*(a[0]-h[0]) if side_view else 0.0);var height=float(a[1]-h[1]);var reach=data.walk.reach*(l1+l2)
  assert(absf(f)<reach,'Unreachable source stride')
  bob=maxf(bob,height-motion.lift-sqrt(reach*reach-f*f));tracks[side]=motion;specs[side]={'l1':l1,'l2':l2,'f':f,'height':height}
 for id in ['head','neck','pelvis','shoulderA','shoulderB','hipA','hipB']:joints[id][1]+=bob
 var wrapped=fposmod(phase,8.0);var index=int(floor(wrapped));var blend=wrapped-index;var a_world=view.legacy[index];var b_world=view.legacy[(index+1)%8]
 for side in ['A','B']:
  var spec=specs[side];var motion=tracks[side];var h=joints['hip'+side];var f=spec.f;var vertical=spec.height-bob-motion.lift
  var distance=sqrt(f*f+vertical*vertical);assert(distance<spec.l1+spec.l2 and distance>absf(spec.l1-spec.l2))
  var along=(spec.l1*spec.l1-spec.l2*spec.l2+distance*distance)/(2.0*distance);var height=sqrt(maxf(0.0,spec.l1*spec.l1-along*along))
  var knee=[along*f/distance+height*vertical/distance,along*vertical/distance-height*f/distance];var ankle=[f,vertical]
  for pair in [['knee',knee],['ankle',ankle]]:
   var name=pair[0]+side;var v=pair[1]
   joints[name]=[h[0]+view.projection[0]*v[0],h[1]+v[1]] if side_view else [rest[name][0],h[1]+v[1]+view.projection[1]*v[0]]
  joints['toe'+side]=[joints['ankle'+side][0]+rest['toe'+side][0]-rest['ankle'+side][0],joints['ankle'+side][1]+rest['toe'+side][1]-rest['ankle'+side][1]]
  world[side]={'knee':knee,'ankle':ankle,'l1':spec.l1,'l2':spec.l2,'track':motion}
  var shoulder='shoulder'+side;var elbow='elbow'+side;var wrist='wrist'+side
  var first=mix_angle(angle(a_world,shoulder,elbow),angle(b_world,shoulder,elbow),blend)
  var second=first+mix_angle(wrap_angle(angle(a_world,elbow,wrist)-angle(a_world,shoulder,elbow)),wrap_angle(angle(b_world,elbow,wrist)-angle(b_world,shoulder,elbow)),blend)
  for segment in [[shoulder,elbow,first],[elbow,wrist,second]]:
   var parent=segment[0];var child=segment[1];var theta=segment[2];var dx=rest[child][0]-rest[parent][0];var dy=rest[child][1]-rest[parent][1]
   if side_view:
    var forward_x=sign*dx
    joints[child]=[joints[parent][0]+sign*(forward_x*cos(theta)+dy*sin(theta)),joints[parent][1]+dy*cos(theta)-forward_x*sin(theta)]
   else:joints[child]=[joints[parent][0]+dx,joints[parent][1]+dy*cos(theta)+view.projection[1]*dy*sin(theta)]
 return {'joints':joints,'bob':bob,'world':world,'phase':phase}
func rotate_point(p:Array,pivot:Array,degrees:float)->Array:
 var a=deg_to_rad(degrees);var x=p[0]-pivot[0];var y=p[1]-pivot[1]
 return [pivot[0]+cos(a)*x-sin(a)*y,pivot[1]+sin(a)*x+cos(a)*y]
func idle_key(direction:String,key:int)->Dictionary:
 var j=data.views[direction].bind.duplicate(true);var b=data.idle.breath[key]
 for id in ['head','neck','shoulderA','shoulderB','elbowA','elbowB','wristA','wristB']:j[id][1]+=b
 for side in ['A','B']:
  for id in ['elbow','wrist']:j[id+side]=rotate_point(j[id+side],j['shoulder'+side],data.idle['shoulder'+side][key])
  j['wrist'+side]=rotate_point(j['wrist'+side],j['elbow'+side],data.idle['elbow'+side][key])
 return j
func idle_pose(direction:String,phase:float)->Dictionary:
 var wrapped=fposmod(phase,8.0);var index=int(floor(wrapped));var blend=wrapped-index;var a=idle_key(direction,index)
 if blend<1e-10:return {'joints':a,'phase':phase}
 var b=idle_key(direction,(index+1)%8);var j=a.duplicate(true)
 for id in ['root','head','neck','pelvis','shoulderA','shoulderB','hipA','hipB']:
  for axis in 2:j[id][axis]=lerpf(a[id][axis],b[id][axis],blend)
 for side in ['A','B']:
  for chain in [['shoulder','elbow','wrist'],['hip','knee','ankle']]:
   var p=chain[0]+side;var m=chain[1]+side;var tip=chain[2]+side
   var upper=mix_angle(screen_angle(a,p,m),screen_angle(b,p,m),blend)
   var lower=upper+mix_angle(wrap_angle(screen_angle(a,m,tip)-screen_angle(a,p,m)),wrap_angle(screen_angle(b,m,tip)-screen_angle(b,p,m)),blend)
   for segment in [[p,m,upper],[m,tip,lower]]:
    var u=segment[0];var v=segment[1];var theta=segment[2];var l=length(a[u],a[v]);j[v]=[j[u][0]+cos(theta)*l,j[u][1]+sin(theta)*l]
  for axis in 2:j['toe'+side][axis]=j['ankle'+side][axis]+lerpf(a['toe'+side][axis]-a['ankle'+side][axis],b['toe'+side][axis]-b['ankle'+side][axis],blend)
 return {'joints':j,'phase':phase}
func make_pose(direction:String,action:String,phase:float)->Dictionary:
 assert(data.views.has(direction) and action in ['neutral','idle','walk'])
 if action=='neutral':return {'joints':data.views[direction].bind.duplicate(true),'phase':0.0}
 return walk_pose(direction,phase) if action=='walk' else idle_pose(direction,phase)
func round_even(value:float)->float:
 var lower=floor(value);var fraction=value-lower
 if absf(fraction-.5)<1e-9:return lower if fposmod(lower,2.0)==0 else lower+1.0
 return floor(value+.5)
func bone_frames(direction:String,pose:Dictionary)->Dictionary:
 var globals={};var locals={};var j=pose.joints;var view=data.views[direction];var rest=view.bind
 for spec in view.defs:
  var transform:Transform2D
  if spec.get('head',false):transform=Transform2D(0.0,Vector2(rest.head[0]+round_even(j.head[0]-rest.head[0]),rest.head[1]+round_even(j.head[1]-rest.head[1])))
  elif spec.get('rigidAngle',false):transform=Transform2D(deg_to_rad(pose.get('torsoAngle',0.0)),Vector2(j[spec.joint][0],j[spec.joint][1]))
  elif spec.has('pair'):
   var a=j[spec.pair[0]];var b=j[spec.pair[1]];var dx=b[0]-a[0];var dy=b[1]-a[1];var l=sqrt(dx*dx+dy*dy)
   transform=Transform2D(Vector2(dx/spec.restLength,dy/spec.restLength),Vector2(-dy/l,dx/l),Vector2(a[0],a[1]))
  else:transform=Transform2D(0.0,Vector2(j[spec.joint][0],j[spec.joint][1]))
  globals[spec.id]=transform;locals[spec.id]=globals[spec.parent].affine_inverse()*transform if spec.parent!=null else transform
 return {'globals':globals,'locals':locals}
