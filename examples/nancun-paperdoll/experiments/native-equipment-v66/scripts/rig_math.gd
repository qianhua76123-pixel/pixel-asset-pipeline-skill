class_name CutoutRigMath
extends RefCounted
# Custom FK / palm IK port. This is not Godot Skeleton2D or weighted mesh skinning.
var data: Dictionary
var characters: Dictionary = {}
var equipment: Dictionary = {}
var _rest_vectors: Dictionary = {}
var _outfit_ids: Dictionary = {}
var _outfit_parts: Dictionary = {}
var _head_styles: Dictionary = {}
# Structural rig edits require this explicit rebuild. Appearance/dye/equipment
# selections are per-call data; no phase or evaluated pose is cached.
func rebuild_rig_cache():
 _rest_vectors.clear();_outfit_ids.clear();_outfit_parts.clear();_head_styles.clear()
 for id in characters:
  var c=characters[id];var heads={};var outfit_ids={};var rests={};var parts={}
  for style in c.get('headStyles',[]):heads[style.id]=style
  for outfit in c.outfits:outfit_ids[outfit.id]=true
  for direction in c.directions:
   rests[direction]=joints(c.bindPoses[direction]);rests[direction].make_read_only();parts[direction]={}
   for outfit in c.outfits:
    var allowed={};var selected=[]
    for part_id in outfit.get('parts',[]):allowed[part_id]=true
    for b in c.attachments:
     if b.direction==direction and (b.category=='shared' or (allowed.has(b.id) if c.kind=='cutout' else b.category==outfit.id)):selected.append(b)
    parts[direction][outfit.id]=selected
  _head_styles[id]=heads;_outfit_ids[id]=outfit_ids;_rest_vectors[id]=rests;_outfit_parts[id]=parts
func _init():
 data = JSON.parse_string(FileAccess.get_file_as_string('res://assets/runtime-data.json'))
 for c in data.characters: characters[c.id] = c
 for e in data.equipment: equipment[e.id] = e
 rebuild_rig_cache()
func vec(a) -> Vector2: return a if a is Vector2 else Vector2(a[0],a[1])
func arr(v: Vector2) -> Array: return [v.x,v.y]
func rounded(v: Vector2) -> Vector2: return Vector2(round_even(v.x),round_even(v.y))
func round_even(x: float) -> float:
 var f = floor(x)
 if abs(x-f-.5)<0.0000001: return f if int(f)%2==0 else f+1
 return round(x)
func rot(p: Vector2, center: Vector2, degrees: float) -> Vector2: return center+(p-center).rotated(deg_to_rad(degrees))
func joints(p: Dictionary) -> Dictionary:
 var result = {}
 for name in p.joints: result[name] = vec(p.joints[name])
 return result
func rest(character: String,direction: String) -> Dictionary: return characters[character].bindPoses[direction].duplicate(true)
func timing(action: String, milliseconds: float) -> Dictionary:
 var a = data.actions[action];var total = 0.0
 for duration in a.durations: total+=duration
 var t = maxf(0,milliseconds)
 if a.loop: t=fmod(t,total)
 elif t>=total: return {'phase':7.0,'finished':true,'total':total}
 for k in 8:
  if t<a.durations[k]: return {'phase':float(k)+(0.0 if k==7 and not a.loop else t/a.durations[k]),'finished':false,'total':total}
  t-=a.durations[k]
 return {'phase':7.0,'finished':not a.loop,'total':total}
func key_time(action: String,index: int) -> float:
 var t=0.0
 for i in index: t+=data.actions[action].durations[i]
 return t
func lerp_array(a,b,t: float) -> Array:
 var r=[]
 for i in a.size(): r.append(lerpf(a[i],b[i],t))
 return r
func project(direction: String,point: Array) -> Vector2:
 var projection=data.rig.projection[direction]
 return vec(data.rig.root)+vec(projection.forward)*point[0]+vec(projection.anatomicalLeft)*point[1]-Vector2(0,point[2])
func world_walk(direction: String,phase: float) -> Dictionary:
 var phase_wrapped=fposmod(phase,8);var index=int(floor(phase_wrapped));var t=phase_wrapped-index
 var a=data.keyPoses['old-b'][direction].walk[index];var b=data.keyPoses['old-b'][direction].walk[(index+1)%8]
 if t<0.00000001:return a.duplicate(true)
 var p=a.duplicate(true);var aw=a.worldJoints;var bw=b.worldJoints;var world={}
 for name in ['root','pelvis','neck','head','hipA','hipB','shoulderA','shoulderB']:world[name]=lerp_array(aw[name],bw[name],t)
 for side in ['A','B']:
  for chain in [['shoulder','elbow','wrist'],['hip','knee','ankle']]:
   var n0=chain[0]+side;var n1=chain[1]+side;var n2=chain[2]+side
   var a0=atan2(aw[n1][0]-aw[n0][0],-(aw[n1][2]-aw[n0][2]));var a1=atan2(aw[n2][0]-aw[n1][0],-(aw[n2][2]-aw[n1][2]))
   var b0=atan2(bw[n1][0]-bw[n0][0],-(bw[n1][2]-bw[n0][2]));var b1=atan2(bw[n2][0]-bw[n1][0],-(bw[n2][2]-bw[n1][2]))
   var upper=lerp_angle(a0,b0,t);var lower=upper+lerp_angle(wrapf(a1-a0,-PI,PI),wrapf(b1-b0,-PI,PI),t)
   for segment in [[n0,n1,upper],[n1,n2,lower]]:
    var u=segment[0];var v=segment[1];var angle=segment[2];var length=Vector2(aw[v][0]-aw[u][0],aw[v][2]-aw[u][2]).length()
    world[v]=[world[u][0]+length*sin(angle),world[u][1]+lerpf(aw[v][1]-aw[u][1],bw[v][1]-bw[u][1],t),world[u][2]-length*cos(angle)]
  var ankle='ankle'+side;var toe='toe'+side;var offset=[];var sole=[]
  for k in 3:
   offset.append(world[ankle][k]+lerpf(aw[toe][k]-aw[ankle][k],bw[toe][k]-bw[ankle][k],t))
   sole.append(world[ankle][k]+lerpf(a.feet[side].soleWorld[k]-aw[ankle][k],b.feet[side].soleWorld[k]-bw[ankle][k],t))
  world[toe]=offset;p.feet[side].soleWorld=sole;p.feet[side].sole=arr(project(direction,sole));p.feet[side].heelRaise=lerpf(a.feet[side].heelRaise,b.feet[side].heelRaise,t)
 p.worldJoints=world
 for name in world:
  var bias=(vec(a.joints[name])-project(direction,aw[name])).lerp(vec(b.joints[name])-project(direction,bw[name]),t)
  p.joints[name]=arr(project(direction,world[name])+bias)
 p.bodyBobY=lerpf(a.bodyBobY,b.bodyBobY,t)
 return p
func pose(character: String,direction: String,action: String,phase: float) -> Dictionary:
 if action=='walk':
  var p=world_walk(direction,phase)
  if character=='old-b':return p
  var result=rest(character,direction);var r=joints(result);var j=r.duplicate();var w=p.worldJoints;var bob=p.bodyBobY
  for n in ['head','neck','pelvis','shoulderA','shoulderB','hipA','hipB']:j[n].y+=bob
  for side in ['A','B']:
   for chain in [['shoulder','elbow','wrist'],['hip','knee','ankle']]:
    for segment in [[chain[0]+side,chain[1]+side],[chain[1]+side,chain[2]+side]]:
     var u=segment[0];var v=segment[1];var theta=atan2(w[v][0]-w[u][0],-(w[v][2]-w[u][2]));var length=absf(r[v].y-r[u].y)
     j[v]=j[u]+Vector2(r[v].x-r[u].x,length*cos(theta)+.5*length*sin(theta))
   j['toe'+side]=j['ankle'+side]+r['toe'+side]-r['ankle'+side]+Vector2(0,p.feet[side].heelRaise)
   result.feet[side].sole=arr(j['toe'+side])
  for n in j:result.joints[n]=arr(j[n])
  result.bodyBobY=bob;result.drawOrder=p.drawOrder
  return result
 var conf=data.actions[action];var ph=fposmod(phase,8) if conf.loop else clampf(phase,0,7);var index=int(floor(ph));var t=ph-index
 var a=data.keyPoses[character][direction][action][index];var b=data.keyPoses[character][direction][action][(index+1)%8 if conf.loop else mini(7,index+1)]
 if t<0.00000001:return a.duplicate(true)
 var p=a.duplicate(true);var aj=joints(a);var bj=joints(b);var j={}
 for n in ['root','head','neck','pelvis','shoulderA','shoulderB','hipA','hipB']:j[n]=aj[n].lerp(bj[n],t)
 for side in ['A','B']:
  for chain in [['shoulder','elbow','wrist'],['hip','knee','ankle']]:
   var n0=chain[0]+side;var n1=chain[1]+side;var n2=chain[2]+side
   var aa=(aj[n1]-aj[n0]).angle();var ba=(bj[n1]-bj[n0]).angle();var upper=lerp_angle(aa,ba,t)
   var lower=upper+lerp_angle(wrapf((aj[n2]-aj[n1]).angle()-aa,-PI,PI),wrapf((bj[n2]-bj[n1]).angle()-ba,-PI,PI),t)
   j[n1]=j[n0]+Vector2.from_angle(upper)*aj[n0].distance_to(aj[n1]);j[n2]=j[n1]+Vector2.from_angle(lower)*aj[n1].distance_to(aj[n2])
  j['toe'+side]=j['ankle'+side]+(aj['toe'+side]-aj['ankle'+side]).lerp(bj['toe'+side]-bj['ankle'+side],t)
  p.wristTwist[side]=lerpf(a.wristTwist.get(side,0),b.wristTwist.get(side,0),t)
 for n in j:p.joints[n]=arr(j[n])
 p.bodyBobY=lerpf(a.bodyBobY,b.bodyBobY,t);p.torsoAngle=lerpf(a.torsoAngle,b.torsoAngle,t)
 if a.has('twoHand'):p.twoHand={'enabled':true,'offset':lerp_array(a.twoHand.offset,b.twoHand.offset,t),'angle':lerpf(a.twoHand.angle,b.twoHand.angle,t)}
 return p
func bone(source: Array,target: Array,width: float=1.0) -> Transform2D:
 var p0=vec(source[0]);var p1=vec(source[1]);var q0=vec(target[0]);var q1=vec(target[1]);var u=(p1-p0).normalized();var v=(q1-q0)/(p1-p0).length();var n=Vector2(-u.y,u.x);var m=(q1-q0).normalized().orthogonal()*-width
 var x=v*u.x+m*n.x;var y=v*u.y+m*n.y
 return Transform2D(x,y,q0-x*p0.x-y*p0.y)
func rigid(pivot: Vector2,target: Vector2,degrees: float) -> Transform2D:
 var t=Transform2D(deg_to_rad(degrees),Vector2.ZERO);t.origin=target-t.basis_xform(pivot);return t
func palm_offset(character: String,side: String) -> Vector2:return (Vector2(-.5,1) if side=='B' else Vector2(0,1.5)) if character=='heqing' else Vector2(0,.5)
func forearm_delta(j: Dictionary,r: Dictionary,side: String) -> float:return (j['wrist'+side]-j['elbow'+side]).angle()-(r['wrist'+side]-r['elbow'+side]).angle()
func palm(character: String,j: Dictionary,r: Dictionary,side: String) -> Vector2:return j['wrist'+side]+palm_offset(character,side).rotated(forearm_delta(j,r,side))
func solve_palm(character: String,j: Dictionary,r: Dictionary,side: String,target: Vector2) -> float:
 var shoulder=j['shoulder'+side];var re=r['elbow'+side];var rw=r['wrist'+side];var rs=r['shoulder'+side];var off=palm_offset(character,side)
 var l1=rs.distance_to(re);var l2=re.distance_to(rw+off);var delta=target-shoulder;var raw=delta.length();var d=clampf(raw,absf(l1-l2)+.00001,l1+l2-.00001);var u=delta/raw if raw>.0000001 else Vector2.DOWN
 var along=(l1*l1-l2*l2+d*d)/(2*d);var height=sqrt(maxf(0,l1*l1-along*along));var center=shoulder+u*along;var e1=center+Vector2(-u.y,u.x)*height;var e2=center-Vector2(-u.y,u.x)*height
 var elbow=e2 if side=='A' else e1 # Stable signed bend branch; never choose by screen x.
 var endpoint=shoulder+u*d;var angle=(endpoint-elbow).angle()-(rw+off-re).angle();j['elbow'+side]=elbow;j['wrist'+side]=elbow+(rw-re).rotated(angle)
 return palm(character,j,r,side).distance_to(target)
func gear(character: String,p: Dictionary,j: Dictionary,r: Dictionary,item: Dictionary,adjust:Dictionary={}) -> Dictionary:
 var angle=float(p.get('torsoAngle',0));var point:Vector2
 if item.slot=='hand':
  point=palm(character,j,r,'B');angle=float(p.twoHand.angle) if p.has('twoHand') else rad_to_deg(forearm_delta(j,r,'B'))+p.get('wristTwist',{}).get('B',0)
 else:
  var joint='head' if item.slot=='head' else 'neck';var reference=characters.heqing.bindPoses.down.joints;var offset=vec(item.heqingRestPlacement)-vec(reference[joint])
  if item.slot=='head':angle=0
  point=j[joint]+offset.rotated(deg_to_rad(angle))
  if item.slot=='head':point=rounded(point)
 point+=Vector2(float(adjust.get('x',0)),float(adjust.get('y',0))).rotated(deg_to_rad(angle))
 return {'transform':rigid(vec(item.pivot),point,angle+item.get('bindAngleDeg',0)+float(adjust.get('angle',0))),'point':point}
func plan(character: String,direction: String,action: String,phase: float,outfit: String,equipped: Dictionary,blink_time_ms: float=0.0,face_mode: String='open',adjustments:Dictionary={},head_style:String='original') -> Dictionary:
 var requested_action=action;var warnings=[];var clean_equipment={}
 if not is_finite(phase):phase=0.0;warnings.append('Non-finite phase reset to zero')
 var c=characters[character]
 var selected_head=_head_styles[character].get(head_style,{})
 if selected_head.is_empty() and head_style!='original':
  warnings.append('Unknown head style; using original');head_style='original'
  selected_head=_head_styles[character].get('original',{})
 if not _outfit_ids[character].has(outfit):
  warnings.append('Unknown outfit; using character default');outfit=c.outfits[0].id
 for slot in ['head','back','hand']:
  var id=equipped.get(slot,'')
  if id=='':continue
  if not equipment.has(id):warnings.append('Unknown equipment ignored: '+str(id));continue
  if equipment[id].slot!=slot:warnings.append('Wrong-slot equipment ignored: '+str(id));continue
  clean_equipment[slot]=id
 equipped=clean_equipment
 if data.actions[action].has('equipment'):
  var required=data.actions[action].equipment
  if equipped.get('hand','')!=required or not direction in equipment[required].directions:
   action='idle';phase=0.0;warnings.append('Required hand equipment or direction unavailable; effective action is idle')
 var face=face_at_time(blink_time_ms,action,face_mode)
 if face=='closed' and (not c.has('faceVariants') or not c.faceVariants.has('closed') or c.faceVariants.closed.direction!=direction):face='open'
 var p=pose(character,direction,action,phase);var j=joints(p);var r=_rest_vectors[character][direction];var active=[];var ik={'enabled':false};var grip={'enabled':false};var placements={}
 for id in equipped.values():
  if equipment.has(id) and direction in equipment[id].directions:active.append(equipment[id])
 for item in active:
  if action=='hoe' and item.has('secondaryGrip'):
   var adjust=adjustments.get(item.id,{})
   var target=rot(Vector2(r.pelvis.x+p.twoHand.offset[0],(r.shoulderA.y+r.shoulderB.y)*.5+p.twoHand.offset[1]),r.pelvis,p.torsoAngle)
   target+=Vector2(float(adjust.get('x',0)),float(adjust.get('y',0))).rotated(deg_to_rad(p.twoHand.angle))
   ik.enabled=true;ik.primaryTarget=target;ik.primaryTargetError=solve_palm(character,j,r,'B',target)
   var effective_adjust=adjust.duplicate();effective_adjust.x=0;effective_adjust.y=0
   var placement=gear(character,p,j,r,item,effective_adjust);placements[item.id]=placement
   ik.secondaryTarget=placement.transform*vec(item.secondaryGrip);ik.secondaryTargetError=solve_palm(character,j,r,'A',ik.secondaryTarget)
 for n in j:p.joints[n]=arr(j[n])
 var commands=[]
 for b in _outfit_parts[character][direction][outfit]:
  var t:Transform2D
  if b.part in ['head','hairFront']:
   var pivot=r.head if character=='heqing' else vec(b.get('pivot',r.head));t=Transform2D(0,rounded(j.head-pivot))
   if character=='old-b' and p.get('torsoAngle',0)!=0:t=rigid(pivot,j.head,p.torsoAngle)
  elif c.kind=='legacy' and String(b.part).begins_with('shoe'):
   t=Transform2D(0,rounded(vec(p.feet[String(b.part).right(1)].sole)-vec(b.pivot)))
  elif b.has('sourceBone'):
   t=bone(b.sourceBone,[j[b.targetBone[0]],j[b.targetBone[1]]],b.get('widthFactor',1))
  else:
   var joint=b.get('bindJoint','pelvis')
   t=rigid(vec(b.pivot),j[joint],p.get('torsoAngle',0)) if c.kind=='cutout' else Transform2D(0,rounded(j[joint]-vec(b.pivot)))
  var rank=part_rank(b,p)
  if c.kind=='legacy':rank=c.drawOrders[direction][outfit][int(floor(fposmod(phase,8)))].find(b.file)
  var file=c.faceVariants.closed.file if b.part=='head' and face=='closed' else b.file
  if b.part=='head' and not selected_head.is_empty():file=selected_head.states[face].file
  commands.append({'file':file,'part':b.part,'category':b.category,'mask':b.get('dyeMask',''),'dyeGroup':b.get('dyeGroup') if b.get('dyeGroup')!=null else default_dye_group(b.part),'dyeChannels':b.get('dyeChannels',{}),'dyeProfile':b.get('dyeProfile',{}),'transform':t,'rank':rank,'underlap':b.get('underlap',false)})
 commands.sort_custom(func(a,b):return a.rank<b.rank)
 var bindings=[]
 for item in active:
  var placement=placements[item.id] if placements.has(item.id) else gear(character,p,j,r,item,adjustments.get(item.id,{}));bindings.append({'id':item.id,'point':placement.point,'transform':placement.transform,'pivot':vec(item.pivot)})
  var command={'file':item.file,'part':item.id,'category':'equipment','mask':'','transform':placement.transform,'rank':0,'underlap':false}
  if item.slot=='back':commands.push_front(command)
  elif item.slot=='head':commands.append(command)
  else:
   var hands=[]
   for k in range(commands.size()-1,-1,-1):
    if not commands[k].underlap and (commands[k].part=='handB' or (ik.enabled and commands[k].part=='handA')):hands.push_front(commands.pop_at(k))
   commands.append(command);commands.append_array(hands)
 for item in active:
  if item.slot!='hand':continue
  var binding={}
  for candidate in bindings:
   if candidate.id==item.id:binding=candidate;break
  grip.enabled=true;grip.primaryPoint=binding.transform*vec(item.pivot)
  grip.primaryError=grip.primaryPoint.distance_to(palm(character,j,r,'B'))
  if ik.enabled:
   grip.secondaryPoint=binding.transform*vec(item.secondaryGrip);grip.secondaryError=grip.secondaryPoint.distance_to(palm(character,j,r,'A'))
   ik.primaryError=grip.primaryError;ik.secondaryError=grip.secondaryError
   if maxf(ik.primaryTargetError,ik.secondaryError)>.35:warnings.append('Two-hand target is outside reach; bones were not stretched')
  elif grip.primaryError>.35:warnings.append('Single-hand local offset creates a measured grip gap; restore XY or check attachment pivot')
 return {'pose':p,'commands':commands,'bindings':bindings,'ik':ik,'grip':grip,'requestedAction':requested_action,'effectiveAction':action,'warnings':warnings,'effectiveOutfit':outfit,'headStyle':head_style,'faceState':face}
func default_dye_group(part:String)->String:
 if part.begins_with('thigh') or part.begins_with('shin') or part in ['pelvis','skirt']:return 'bottom'
 return 'trim' if part in ['trim','belt','waistband'] else 'top'
func part_rank(b:Dictionary,p:Dictionary)->float:
 if b.get('layerOrder')!=null:return b.layerOrder+b.get('drawOrder',0)*.000001
 if b.get('underlap',false):return -1000+b.get('drawOrder',0)*.001
 var name=String(b.part)
 if name=='head':return 80
 if name=='hairFront':return 90
 if name.begins_with('shoe'):return 12
 if name.begins_with('thigh') or name.begins_with('shin'):return 15
 if name=='pelvis':return 20
 if name=='torso':return 30
 if name=='skirt':return 35
 if name.begins_with('hand'):return 50
 return 45

func validate_texture_contract(sizes: Dictionary) -> Array:
 var errors=[]
 for c in characters.values():
  for part in c.attachments:
   if not sizes.has(part.file):errors.append('Missing required texture: '+str(part.file));continue
   var mask=part.get('dyeMask','')
   if mask!='':
    if not sizes.has(mask):errors.append('Missing required dye mask: '+str(mask))
    elif sizes[mask]!=sizes[part.file]:errors.append('Dye mask dimensions differ: '+str(mask))
   for channel in part.get('dyeChannels',{}).values():
    if not sizes.has(channel):errors.append('Missing dye channel: '+str(channel))
    elif sizes[channel]!=sizes[part.file]:errors.append('Dye channel dimensions differ: '+str(channel))
 for c in characters.values():
  for style in c.get('headStyles',[]):
   for state in ['open','closed']:
    if not style.get('states',{}).has(state):errors.append('Missing head style state: '+style.id+'/'+state);continue
    var file=style.states[state].file
    if not sizes.has(file):errors.append('Missing head style file: '+file)
    elif sizes[file]!=Vector2(64,64):errors.append('Head style dimensions differ: '+file)
  for variant in c.get('faceVariants',{}).values():
   if not sizes.has(variant.file):errors.append('Missing face variant: '+str(variant.file))
   elif sizes[variant.file]!=Vector2(64,64):errors.append('Face variant dimensions differ: '+str(variant.file))
 for item in equipment.values():
  if not sizes.has(item.file):errors.append('Missing equipment: '+str(item.file))
 return errors

func face_at_time(milliseconds: float,action: String='idle',mode: String='auto') -> String:
 if mode=='closed':return 'closed'
 if mode=='open' or not action in ['idle','walk']:return 'open'
 var time=fposmod(maxf(0,milliseconds),4800.0)
 return 'closed' if time>=4100 and time<4190 else 'open'
