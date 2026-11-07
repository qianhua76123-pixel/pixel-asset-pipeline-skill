class_name NancunEquipmentContract
extends RefCounted
# V25 data contract port. Queries use the final equipment draw matrix, never a guessed bone origin.
# Wire dictionaries retain JS camelCase; public methods use GDScript snake_case.
const SLOTS=['head','back','hand']
const IDENTITY=[1,0,0,1,0,0]
var _items:Dictionary={}
var _actions:Dictionary={}
var _profiles:Dictionary={}
var _origin:Array=[]
var _padding:Array=[]

static func _finite(value:Variant,n:int)->bool:
 if not value is Array or value.size()!=n:return false
 for v in value:
  if not typeof(v) in [TYPE_INT,TYPE_FLOAT] or not is_finite(float(v)):return false
 return true
static func _freeze(value:Variant)->Variant:
 if value is Array or value is Dictionary:
  for v in (value.values() if value is Dictionary else value):_freeze(v)
  value.make_read_only()
 return value
static func _fail(reason:String,extra:Dictionary={})->Dictionary:
 var r={'ok':false,'reason':reason};r.merge(extra,true);return _freeze(r)
static func _numbers_equal(a:Array,b:Array)->bool:
 if a.size()!=b.size():return false
 for i in a.size():
  if float(a[i])!=float(b[i]):return false
 return true
static func _valid_matrix(m:Variant)->bool:return _finite(m,6) and absf(float(m[0]*m[3]-m[1]*m[2]))>=1e-12
static func apply(m:Array,p:Array)->Array:return [m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]]
static func multiply(a:Array,b:Array)->Array:return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]
static func _translated(x:float,y:float)->Array:return [1,0,0,1,x,y]
static func _unique(items:Variant,label:String)->Dictionary:
 if not items is Array:return _fail('invalid-registry',{'message':'Invalid or duplicate '+label})
 var result={}
 for item in items:
  if not item is Dictionary or not item.get('id') is String or item.id.is_empty() or result.has(item.id):return _fail('invalid-registry',{'message':'Invalid or duplicate '+label})
  result[item.id]=item
 return {'ok':true,'value':result}
# Constructor cannot throw GDScript exceptions: factory returns a Result with contract only on success.
static func create(source:Variant)->Dictionary:
 if not source is Dictionary:return _fail('invalid-registry',{'message':'Invalid equipment data'})
 var data=source.duplicate(true)
 var item_map=_unique(data.get('items'),'equipment id');if not item_map.ok:return item_map
 var action_map=_unique(data.get('actions'),'action id');if not action_map.ok:return action_map
 var profile_map=_unique(data.get('profiles'),'profile id');if not profile_map.ok:return profile_map
 var coords=data.get('coordinateContract',{})
 if not coords is Dictionary or not _finite(coords.get('rigOrigin'),2) or not _finite(coords.get('previewPadding'),2):return _fail('invalid-registry',{'message':'Invalid coordinate contract'})
 for item in item_map.value.values():
  var art=item.get('art',{});var sockets=item.get('sockets')
  if not item.get('slot') in SLOTS or not item.get('capabilities') is Array or not art is Dictionary or not _finite(art.get('canvas'),2) or not art.get('directions') is Array or not _finite(item.get('pivot'),2) or not sockets is Dictionary:return _fail('invalid-registry',{'message':'Invalid equipment data'})
  for cap in item.capabilities:
   if not cap is String:return _fail('invalid-registry',{'message':'Invalid equipment data'})
  for k in 2:
   if art.canvas[k]<=0 or art.canvas[k]!=floor(art.canvas[k]) or item.pivot[k]<0 or item.pivot[k]>=art.canvas[k]:return _fail('invalid-registry',{'message':'Invalid equipment data'})
  if item.get('actionProfile') and not profile_map.value.has(item.actionProfile):return _fail('invalid-registry',{'message':'Unknown action profile'})
  for socket in sockets.values():
   if not socket is Dictionary or not _finite(socket.get('point'),2):return _fail('invalid-registry',{'message':'Socket outside native canvas'})
   for k in 2:
    if socket.point[k]<0 or socket.point[k]>=art.canvas[k]:return _fail('invalid-registry',{'message':'Socket outside native canvas'})
 for p in profile_map.value.values():
  if not p.get('capability') is String or not p.get('characters') is Array or not p.get('directions') is Array or (p.get('requiredSockets')!=null and not p.requiredSockets is Array):return _fail('invalid-registry',{'message':'Invalid profile coverage'})
  for c in p.characters:
   if not c is String:return _fail('invalid-registry',{'message':'Invalid profile coverage'})
  for d in p.directions:
   if not d in ['down','left','right','up']:return _fail('invalid-registry',{'message':'Invalid profile coverage'})
 for a in action_map.value.values():
  var req=a.get('requires')
  if req!=null and (not req is Dictionary or not req.get('slot') in SLOTS or not profile_map.value.has(req.get('profile')) or not req.get('capability') is String):return _fail('invalid-registry',{'message':'Invalid action dependency'})
 var instance=new();instance._items=item_map.value;instance._actions=action_map.value;instance._profiles=profile_map.value;instance._origin=coords.rigOrigin;instance._padding=coords.previewPadding;_freeze(data)
 return {'ok':true,'contract':instance}
func requirements(action_id:String)->Dictionary:
 if not _actions.has(action_id):return _fail('unknown-action')
 return _freeze({'ok':true,'actionId':action_id,'requires':_actions[action_id].get('requires')})
func evaluate_action(request:Dictionary)->Dictionary:
 var action_id=request.get('actionId');var a=_actions.get(action_id)
 if a==null:return _fail('unknown-action')
 var req=a.get('requires')
 if req==null:return _freeze({'ok':true,'actionId':action_id,'layer':'data-contract','runtimeVerified':false})
 var equipment=request.get('equipment',{});var item=_items.get(equipment.get(req.slot))
 if not equipment.get(req.slot):return _fail('required-slot-empty',{'slot':req.slot})
 if item==null:return _fail('unknown-equipment')
 if item.slot!=req.slot:return _fail('wrong-slot')
 var profile=_profiles[req.profile];var cap=req.capability in item.capabilities;var compatible=item.get('actionProfile')==req.profile;var art=request.get('direction') in item.art.directions;var pose=request.get('characterId') in profile.characters and request.get('direction') in profile.directions;var sockets=true
 for name in profile.get('requiredSockets',['grip.primary']):
  if not item.sockets.has(name):sockets=false
 var reason:Variant=null
 if not cap:reason='missing-capability'
 elif not compatible:reason='incompatible-profile'
 elif not art:reason='asset-direction-unavailable'
 elif not pose:reason='pose-profile-unavailable'
 elif not sockets:reason='required-socket-missing'
 return _freeze({'ok':reason==null,'reason':reason,'checks':{'capabilityOk':cap,'profileOk':compatible,'artAvailable':art,'poseAvailable':pose,'socketsAvailable':sockets},'actionId':action_id,'equipmentId':item.id,'profileId':req.profile,'layer':'data-contract','runtimeVerified':false})
func verify_playback(request:Dictionary)->Dictionary:
 var eligibility=evaluate_action(request)
 if not eligibility.ok:return eligibility
 var p=request.get('plan')
 if not p is Dictionary or not p.get('resolution') is Dictionary:return _fail('runtime-plan-missing')
 var options=p.get('effectiveOptions',{});var action_id=request.get('actionId')
 if options.get('character')!=request.get('characterId') or options.get('direction')!=request.get('direction') or p.resolution.get('requestedAction')!=action_id:return _fail('stale-plan')
 var req=_actions[action_id].get('requires')
 if req!=null and options.get('equipment',{}).get(req.slot)!=request.get('equipment',{}).get(req.slot):return _fail('stale-plan')
 if p.resolution.get('cancelled',false) or p.resolution.get('action')!=action_id:return _fail('runtime-action-rejected',{'dataEligible':true,'requestedAction':action_id,'renderedAction':p.resolution.get('action')})
 return _freeze({'ok':true,'actionId':action_id,'runtimeVerified':true,'scope':'Current sceneCommands action resolution only; no collision/effect permission'})
func _binding(request:Dictionary)->Dictionary:
 var slot=request.get('slot');var direction=request.get('direction');var equipment=request.get('equipment',{});var plan=request.get('plan')
 if not slot in SLOTS:return _fail('unknown-slot',{'slot':slot})
 var id=equipment.get(slot)
 if not id:return _fail('slot-empty',{'slot':slot})
 var item=_items.get(id);var extra={'slot':slot,'equipmentId':id}
 if item==null:return _fail('unknown-equipment',extra)
 if item.slot!=slot:return _fail('wrong-slot',extra)
 if not direction in item.art.directions:return _fail('asset-direction-unavailable',extra)
 if not plan is Dictionary or not plan.get('equipmentBindings') is Array:return _fail('runtime-binding-missing',extra)
 var options=plan.get('effectiveOptions',{})
 if options.get('direction')!=direction or options.get('equipment',{}).get(slot)!=id:return _fail('stale-plan',extra)
 if (request.has('characterId') and plan.get('character',{}).get('id')!=request.characterId) or (request.has('phase') and options.get('phase')!=request.phase):return _fail('stale-plan',extra)
 var draws=[]
 for command in plan.get('commands',[]):
  if command.get('category')=='equipment' and command.get('id')==id and command.get('slot')==slot:draws.append(command)
 if draws.size()!=1 or draws[0].get('file')!=item.art.file:return _fail('runtime-art-mismatch',extra)
 var matches=[]
 for binding in plan.equipmentBindings:
  if binding.get('id')==id and binding.get('slot')==slot:matches.append(binding)
 if matches.size()!=1:return _fail('duplicate-runtime-binding' if matches.size()>0 else 'runtime-binding-missing',extra)
 var binding=matches[0]
 if not _valid_matrix(binding.get('matrix')):return _fail('invalid-final-transform',extra)
 if not _finite(draws[0].get('matrix'),6) or not _numbers_equal(draws[0].matrix,binding.matrix):return _fail('binding-draw-matrix-mismatch',extra)
 if not _finite(binding.get('pivot'),2) or not _numbers_equal(binding.pivot,item.pivot):return _fail('binding-pivot-mismatch',extra)
 return {'ok':true,'item':item,'binding':binding,'slot':slot,'equipmentId':id}
func _space(matrix:Array,space:String,actor_to_world:Variant)->Dictionary:
 if space=='rig-canvas':return {'ok':true,'matrix':matrix.duplicate()}
 if space=='preview-canvas':return {'ok':true,'matrix':multiply(_translated(_padding[0],_padding[1]),matrix)}
 var local=multiply(_translated(-_origin[0],-_origin[1]),matrix)
 if space=='actor-local':return {'ok':true,'matrix':local}
 if space=='world':
  if not _valid_matrix(actor_to_world):return _fail('missing-or-invalid-actor-world-transform')
  return {'ok':true,'matrix':multiply(actor_to_world,local)}
 return _fail('unknown-coordinate-space')
func query_slot(request:Dictionary)->Dictionary:
 var b=_binding(request)
 if not b.ok:return b
 var space=request.get('space','rig-canvas');var s=_space(b.binding.matrix,space,request.get('actorToWorld'))
 if not s.ok:return s
 var position=apply(s.matrix,b.binding.pivot);var slot_matrix=s.matrix.slice(0,4);slot_matrix.append_array(position)
 return _freeze({'ok':true,'slot':b.slot,'equipmentId':b.equipmentId,'space':space,'position':position,'slotToSpace':slot_matrix,'source':'final-equipmentBindings-matrix','collisionTested':false})
func query_socket(request:Dictionary)->Dictionary:
 var b=_binding(request)
 if not b.ok:return b
 var socket=b.item.sockets.get(request.get('socket'))
 if socket==null:return _fail('socket-missing',{'slot':b.slot,'equipmentId':b.equipmentId,'socket':request.get('socket')})
 var space=request.get('space','rig-canvas');var s=_space(b.binding.matrix,space,request.get('actorToWorld'))
 if not s.ok:return s
 return _freeze({'ok':true,'slot':b.slot,'equipmentId':b.equipmentId,'socket':request.socket,'space':space,'localPoint':socket.point.duplicate(),'position':apply(s.matrix,socket.point),'textureToSpace':s.matrix,'reviewStatus':socket.get('status'),'source':'final-equipmentBindings-matrix','collisionTested':false})
# Deprecated compatibility only. New consumers must inspect Result instead of using identity fallback.
func legacy_slot_transform(request:Dictionary,on_diagnostic:Callable)->Dictionary:
 if not on_diagnostic.is_valid():return _fail('diagnostic-callback-required')
 var result=query_slot(request)
 var notice=_freeze({'deprecated':true,'api':'getSlotTransform','replacement':'querySlot','fallbackIdentity':not result.ok,'reason':result.get('reason')})
 on_diagnostic.call(notice)
 return {'ok':true,'deprecated':true,'transform':result.slotToSpace.duplicate() if result.ok else IDENTITY.duplicate(),'query':result}
