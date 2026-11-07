class_name NancunActionTimeline
extends RefCounted
# Pure synchronous logical clock. No node, renderer, collision or game-state dependency.
# Public methods return Result dictionaries, not JS exceptions.
const MAX_SAFE_TIME=9007199254740991
const MAX_JSON_DEPTH=128
static var _next_timeline_id=0
var _actions={}
var _current:Variant=null
var _listener=Callable()
var _prefix=''
var _serial=0
var _advancing=false
var state:Variant:
 get:return _snapshot(_current) if _current!=null else null
static func success(value:Variant=null)->Dictionary:return {'ok':true,'value':value}
static func failure(code:String,message:String)->Dictionary:return {'ok':false,'error':{'code':code,'message':message}}
static func _active(status:String)->bool:return status in ['running','paused','inspecting']
static func _valid_time(value:Variant)->bool:
 return typeof(value) in [TYPE_INT,TYPE_FLOAT] and is_finite(float(value)) and value>=0 and value<=MAX_SAFE_TIME
static func _valid_id(value:Variant)->bool:return value is String and not value.strip_edges().is_empty()
static func _json_copy(value:Variant,path='payload',seen:Array=[],depth=0)->Dictionary:
 if depth>MAX_JSON_DEPTH:return failure('json-depth',path+' exceeds JSON nesting limit')
 if value==null or typeof(value) in [TYPE_STRING,TYPE_BOOL]:return success(value)
 if typeof(value) in [TYPE_INT,TYPE_FLOAT]:
  if not is_finite(float(value)):return failure('json-data',path+' contains non-finite number')
  return success(value)
 if not typeof(value) in [TYPE_ARRAY,TYPE_DICTIONARY]:return failure('json-data',path+' must contain only JSON data')
 for previous in seen:
  if is_same(value,previous):return failure('json-cycle',path+' must be acyclic')
 var parents=seen.duplicate();parents.append(value)
 if value is Array:
  var copied=[]
  for i in value.size():
   var r=_json_copy(value[i],path+'['+str(i)+']',parents,depth+1)
   if not r.ok:return r
   copied.append(r.value)
  return success(copied)
 var copied={}
 for key in value:
  if not key is String:return failure('json-key',path+' keys must be strings')
  var r=_json_copy(value[key],path+'.'+key,parents,depth+1)
  if not r.ok:return r
  copied[key]=r.value
 return success(copied)
static func _definition(source:Variant)->Dictionary:
 if not source is Dictionary:return failure('definition','action must be an object')
 if not _valid_id(source.get('id')):return failure('action-id','action id must be nonempty')
 if not _valid_time(source.get('durationMs')) or source.durationMs==0:return failure('duration','durationMs must be finite and positive')
 if not source.get('loop') is bool:return failure('loop','loop must be boolean')
 if not source.get('markers') is Array:return failure('markers','markers must be an array')
 var ids={};var markers=[];var warnings=[]
 for field in source:
  if not field in ['id','durationMs','loop','markers','name','keyDurationsMs','keyLabels','reviewStatus']:warnings.append('Ignored action metadata: '+str(field))
 for index in source.markers.size():
  var m=source.markers[index]
  if not m is Dictionary:return failure('marker','marker must be an object')
  if not _valid_id(m.get('id')):return failure('marker-id','marker id must be nonempty')
  if ids.has(m.id):return failure('duplicate-marker','Duplicate marker id: '+m.id)
  ids[m.id]=true
  if not _valid_time(m.get('timeMs')) or m.timeMs>source.durationMs:return failure('marker-time','marker time must be finite, nonnegative and within duration')
  var repeat=m.get('repeat');repeat=('start-only' if m.timeMs==0 else 'each-cycle') if repeat==null else repeat
  if not repeat in ['start-only','each-cycle'] or (repeat=='start-only' and m.timeMs!=0):return failure('repeat','start-only is valid only at zero')
  var marker_type=m.get('type');marker_type=m.id if marker_type==null else marker_type
  if not _valid_id(marker_type):return failure('marker-type','marker type must be nonempty')
  var payload=m.get('payload');payload={} if payload==null else payload
  var copied=_json_copy(payload)
  if not copied.ok:return copied
  for field in m:
   if not field in ['id','timeMs','type','payload','repeat']:warnings.append('Ignored marker metadata: '+str(field))
  markers.append({'id':m.id,'timeMs':float(m.timeMs),'type':marker_type,'payload':copied.value,'repeat':repeat,'index':index})
 markers.sort_custom(func(a,b):return a.timeMs<b.timeMs or (a.timeMs==b.timeMs and a.index<b.index))
 return {'ok':true,'value':{'id':source.id,'durationMs':float(source.durationMs),'loop':source.loop,'markers':markers},'warnings':warnings}
static func create(actions:Variant,on_event:Variant=null)->Dictionary:
 if not actions is Array:return failure('actions','actions must be an array')
 if on_event!=null and (not on_event is Callable or not on_event.is_valid()):return failure('listener','on_event must be a valid Callable')
 var definitions={};var warnings=[]
 for source in actions:
  var r=_definition(source)
  if not r.ok:return r
  if definitions.has(r.value.id):return failure('duplicate-action','Duplicate action id: '+r.value.id)
  definitions[r.value.id]=r.value;warnings.append_array(r.warnings)
 var timeline=new()
 timeline._actions=definitions;timeline._listener=on_event if on_event!=null else Callable()
 _next_timeline_id+=1;timeline._prefix='timeline-'+str(_next_timeline_id)
 return {'ok':true,'timeline':timeline,'warnings':warnings}
func _is_current(i:Dictionary)->bool:return _current!=null and _current.instanceId==i.instanceId
func _same(i:Dictionary,epoch:int)->bool:return _is_current(i) and i.status=='running' and i.epoch==epoch
func _snapshot(i:Dictionary)->Dictionary:
 return {'instanceId':i.instanceId,'actionId':i.action.id,'status':i.status,'elapsedMs':i.elapsedMs,'cycle':int(floor(i.elapsedMs/i.action.durationMs)) if i.action.loop else 0,'localTimeMs':fmod(i.elapsedMs,i.action.durationMs) if i.action.loop else i.elapsedMs,'durationMs':i.action.durationMs,'loop':i.action.loop,'context':i.context.duplicate(true) if i.context is Dictionary or i.context is Array else i.context,'reason':i.get('reason')}
func _event(i:Dictionary,kind:String,extra:Dictionary={})->Dictionary:
 var event={'kind':kind,'instanceId':i.instanceId,'actionId':i.action.id,'elapsedMs':i.elapsedMs,'timeMs':fmod(i.elapsedMs,i.action.durationMs) if i.action.loop else i.elapsedMs,'cycle':int(floor(i.elapsedMs/i.action.durationMs)) if i.action.loop else 0,'context':i.context}
 event.merge(extra,true);return event.duplicate(true)
func _emit(i:Dictionary,event:Dictionary)->Dictionary:
 if not _listener.is_valid():return success()
 var response=_listener.call(event)
 # Deliberate adaptation: a returned failure propagates; GDScript runtime faults cannot be caught here.
 if response is Dictionary and response.get('ok')==false:
  if _is_current(i) and _active(i.status):_terminate(i,'cancelled','listener-error')
  return failure('listener-error',str(response.get('error','listener returned failure')))
 return success()
func _terminate(i:Dictionary,kind:String,reason:Variant=null)->Dictionary:
 if not _active(i.status):return success(false)
 i.status=kind;i.reason=reason;i.epoch+=1
 var emitted=_emit(i,_event(i,kind,{'reason':reason}))
 return success(true) if emitted.ok else emitted
func _mark(i:Dictionary,m:Dictionary,cycle:int,absolute_time:float)->Dictionary:
 i.highWater[m.id]=cycle;i.elapsedMs=absolute_time
 return _emit(i,_event(i,'marker',{'markerId':m.id,'markerType':m.type,'payload':m.payload,'timeMs':m.timeMs,'cycle':cycle,'occurrenceId':JSON.stringify([i.instanceId,cycle,m.id])}))
func start(action_id:Variant,context:Variant={})->Dictionary:
 if not action_id is String or not _actions.has(action_id):return failure('unknown-action','Unknown action: '+str(action_id))
 var copied=_json_copy(context,'context')
 if not copied.ok:return copied
 _serial+=1
 var old=_current
 var i={'instanceId':_prefix+':'+str(_serial),'action':_actions[action_id],'context':copied.value,'status':'running','elapsedMs':0.0,'epoch':0,'highWater':{}}
 _current=i
 if old!=null and _active(old.status):
  var cancelled=_terminate(old,'cancelled','replaced')
  if not cancelled.ok:
   if _is_current(i) and _active(i.status):_terminate(i,'cancelled','replacement-listener-error')
   return cancelled
 if not _is_current(i) or not _active(i.status):return success(_snapshot(i))
 var emitted=_emit(i,_event(i,'started'))
 if not emitted.ok:return emitted
 if not _same(i,0):return success(_snapshot(i))
 for m in i.action.markers:
  if m.timeMs!=0:break
  emitted=_mark(i,m,0,0)
  if not emitted.ok:return emitted
  if not _same(i,0):break
 return success(_snapshot(i))
func cancel(reason:Variant='cancelled')->Dictionary:
 if not _valid_id(reason):return failure('cancel-reason','cancel reason must be nonempty')
 return _terminate(_current,'cancelled',reason) if _current!=null else success(false)
func pause()->Dictionary:
 if _current==null or _current.status!='running':return success(false)
 _current.status='paused';_current.epoch+=1;return success(true)
func resume()->Dictionary:
 if _current==null or not _current.status in ['paused','inspecting']:return success(false)
 _current.status='running';_current.epoch+=1;return success(true)
func seek_inspection(time_ms:Variant)->Dictionary:
 if not _valid_time(time_ms):return failure('inspection-time','inspection time must be finite and nonnegative')
 var i=_current
 if i==null or not _active(i.status):return failure('inactive','Inspection seek requires an active instance')
 var target=float(time_ms) if i.action.loop else minf(time_ms,i.action.durationMs)
 if i.action.loop and floor(target/i.action.durationMs)>MAX_SAFE_TIME:return failure('unsafe-cycle','Inspection cycle exceeds safe integer range')
 i.elapsedMs=target;i.status='inspecting';i.epoch+=1
 for m in i.action.markers:
  var cycle=floor((target-m.timeMs)/i.action.durationMs)
  if not i.action.loop or m.repeat=='start-only':cycle=minf(cycle,0)
  if cycle>=0:i.highWater[m.id]=maxi(i.highWater.get(m.id,-1),int(cycle))
 return success(_snapshot(i))
func _end_tick(result:Dictionary)->Dictionary:
 _advancing=false;return result
func tick(dt_ms:Variant)->Dictionary:
 if not _valid_time(dt_ms):return failure('delta-time','dtMs must be finite and nonnegative')
 if _advancing:return failure('reentrant-tick','Reentrant tick is unsupported; use start/cancel/pause/seek in callbacks')
 var i=_current
 if i==null or i.status!='running' or dt_ms==0:return success(state)
 var previous=i.elapsedMs;var target=previous+float(dt_ms) if i.action.loop else minf(previous+float(dt_ms),i.action.durationMs)
 if not _valid_time(target):return failure('elapsed-time','resulting elapsed time exceeds safe range')
 var epoch=i.epoch;var duration=i.action.durationMs
 if i.action.loop and floor(target/duration)>MAX_SAFE_TIME:return failure('unsafe-cycle','Resulting cycle exceeds safe integer range')
 _advancing=true
 var next=[]
 for m in i.action.markers:
  var repeats=i.action.loop and m.repeat=='each-cycle'
  var cycle=maxf(0,maxf(ceil((previous-m.timeMs)/duration),i.highWater.get(m.id,-1)+1)) if repeats else 0.0
  var when=cycle*duration+m.timeMs
  next.append({'m':m,'cycle':int(cycle),'when':when,'repeats':repeats,'eligible':when>=previous and i.highWater.get(m.id,-1)<cycle})
 while true:
  var best:Variant=null
  for candidate in next:
   if not candidate.eligible or candidate.when>target:continue
   if best==null or candidate.when<best.when or (candidate.when==best.when and (candidate.cycle<best.cycle or (candidate.cycle==best.cycle and candidate.m.index<best.m.index))):best=candidate
  if best==null:break
  var emitted=_mark(i,best.m,best.cycle,best.when)
  if not emitted.ok:return _end_tick(emitted)
  if not _same(i,epoch):return _end_tick(success(state))
  if best.repeats:
   best.cycle+=1;best.when=best.cycle*duration+best.m.timeMs
   if best.cycle>MAX_SAFE_TIME:best.eligible=false
  else:best.eligible=false
 if not _same(i,epoch):return _end_tick(success(state))
 i.elapsedMs=target
 if not i.action.loop and target==duration:
  var finished=_terminate(i,'finished')
  if not finished.ok:return _end_tick(finished)
 return _end_tick(success(state))
