extends Node
signal action_started(action)
signal action_marker(event)
signal action_finished(action)
signal action_cancelled(action)
signal updated
const Rig=preload('res://scripts/rig_math.gd')
const Timeline=preload('res://scripts/action_timeline.gd')
const Track=preload('res://scripts/occlusion_track.gd')
const EquipmentContract=preload('res://scripts/equipment_contract.gd')
const FinalPlan=preload('res://scripts/final_plan_adapter.gd')
var rig=Rig.new()
var track=JSON.parse_string(FileAccess.get_file_as_string('res://data/occlusion-tracks.json'))
var policy=JSON.parse_string(FileAccess.get_file_as_string('res://data/occlusion-policy.json'))
var actor:Node2D
var character='heqing'
var direction='down'
var outfit='original'
var action='idle'
var phase=0.0
var time_ms=0.0
var playing=false
var continuous=true
var head_style='original'
var occlusion_mode='candidate'
var equipment={'head':'','back':'','hand':''}
var equipment_notice=''
var current_plan={}
var action_clock
var clock_instances={}
var clock_duration_audit=[]
var completion_emitted=false
var marker_count=0
var last_marker={}
var equipment_contract
var socket_plan={}
var socket_context={}
var socket_stamp=[]
var socket_plan_ready=false
var socket_render_revision=0
var plan_count=0
func initialize(target:Node2D)->Dictionary:
 actor=target
 var loaded=EquipmentContract.create(JSON.parse_string(FileAccess.get_file_as_string('res://data/equipment-contract.json')))
 if not loaded.ok:return loaded
 equipment_contract=loaded.contract
 var result=_setup_action_clock()
 if not result.ok:return result
 _clock_prepare('idle');_render();return {'ok':true}
func _process(dt):
 if playing:_advance_action_clock(dt*1000.0)
func _notification(what):
 if what==NOTIFICATION_APPLICATION_FOCUS_OUT:_pause_action_clock();updated.emit()
func _render():
 if not is_instance_valid(actor):return
 var actual=phase if continuous else floor(phase)
 current_plan=rig.plan(character,direction,action,actual,outfit,equipment,0,'open',{},head_style);plan_count+=1
 if occlusion_mode=='candidate':
  current_plan=Track.apply_track(current_plan,{'character':character,'direction':direction,'action':action,'phase':actual,'outfit':outfit,'headStyle':head_style,'equipment':equipment},track,policy)
 else:current_plan=current_plan.duplicate(false);current_plan.occlusion={'applied':false,'reason':'legacy-selected'}
 actor.apply_plan(current_plan);_publish_socket_plan();updated.emit()
func set_outfit(value:String)->bool:
 if not value in ['original','stone-blue-daily','moon-celadon-hanfu']:return false
 outfit=value;_render();return true
func set_action(value:String)->bool:
 if not value in ['idle','sword','hoe']:return false
 playing=false
 if value=='sword':equipment.hand='iron-sword'
 elif value=='hoe':equipment.hand='wood-hoe'
 action=value;phase=0;time_ms=0
 _clock_prepare(value);_sync_clock_state();_render();return true
func set_equipment(slot:String,id:String)->bool:
 if not slot in ['head','back','hand']:return false
 if id and (not rig.equipment.has(id) or rig.equipment[id].slot!=slot):return false
 equipment[slot]=id
 var required={'sword':'iron-sword','hoe':'wood-hoe'}.get(action,'')
 if slot=='hand' and required and required!=id:
  set_action('idle')
 else:_render()
 return true
func set_continuous(value:bool):continuous=value;_render()
func set_occlusion(value:bool):occlusion_mode='candidate' if value else 'legacy';_render()
func inspect_phase(value:float):
 if not is_finite(value):return
 var p=clampf(value,0,7);var i=int(floor(p));var target=rig.key_time(action,i)+float(rig.data.actions[action].durations[i])*(p-i)
 playing=false
 var state=_clock_state()
 if state==null or state.status in ['finished','cancelled']:_clock_prepare(action,target,true)
 else:clock_instances[state.instanceId].chosen=true;action_clock.seek_inspection(target)
 _sync_clock_state();_render()
func toggle_play():
 if playing:_pause_action_clock();updated.emit()
 else:_begin_action_playback()
func _setup_action_clock()->Dictionary:
 var parser=JSON.new()
 if parser.parse(FileAccess.get_file_as_string('res://data/action-events.json'))!=OK or not parser.data is Dictionary or parser.data.get('schemaVersion')!=1:
  return Timeline.failure('event-data','动作事件JSON格式错误')
 if not parser.data.get('actions') is Array:return Timeline.failure('event-data','动作列表必须是数组')
 var definitions=parser.data.actions.duplicate(true);var audit=[]
 var checked=Timeline.create(definitions)
 if not checked.ok:return checked
 for definition in definitions:
  if not rig.data.actions.has(definition.id):return Timeline.failure('unknown-action','事件包含未知动作')
  var visual=rig.data.actions[definition.id];var total=0.0
  for duration in visual.durations:total+=duration
  if not definition.get('keyDurationsMs') is Array or definition.durationMs!=total or definition.keyDurationsMs!=visual.durations or definition.loop!=visual.loop:
   return Timeline.failure('duration-mismatch','动作事件与视觉关键时长不一致：'+definition.id)
  audit.append({'action':definition.id,'durationMs':total,'keyDurationsExact':true})
 for id in ['idle']:
  var visual=rig.data.actions[id];var total=0.0
  for duration in visual.durations:total+=duration
  definitions.append({'id':id,'durationMs':total,'loop':true,'markers':[]})
 var result=Timeline.create(definitions,_on_clock_event)
 if result.ok:action_clock=result.timeline;clock_duration_audit=audit
 return result
func _clock_state()->Variant:return action_clock.state if action_clock!=null else null
func _sync_clock_state():
 var state=_clock_state()
 if state==null:return
 action=state.actionId;time_ms=state.elapsedMs;phase=rig.timing(action,time_ms).phase
 completion_emitted=state.status=='finished'
func _clock_prepare(value:String,inspection_ms=0.0,chosen=false)->Dictionary:
 # Preview instances suppress lifecycle/zero cues. Actual play gets one public start.
 return action_clock.start(value,{'preview':true,'inspectionMs':inspection_ms,'chosen':chosen})
func _on_clock_event(event:Dictionary)->Variant:
 var id=event.instanceId
 if event.kind=='started':
  clock_instances[id]={'played':false,'chosen':event.context.get('chosen',false)}
  if event.context.get('preview',false):
   action_clock.seek_inspection(event.context.inspectionMs);_sync_clock_state();return null
  clock_instances[id].played=true;_sync_clock_state();_render();action_started.emit(event.actionId);return null
 if event.kind=='cancelled':
  var played=clock_instances.get(id,{}).get('played',false);clock_instances.erase(id)
  _sync_clock_state()
  if played and event.actionId in ['sword','hoe']:
   _render();action_cancelled.emit(event.actionId)
  return null
 if event.kind=='marker':
  _sync_clock_state();marker_count+=1;last_marker=event.duplicate(true);_render()
  var public_event=event.duplicate(true);public_event.visualContext=EquipmentContract._freeze(socket_context.duplicate(true))
  last_marker=public_event.duplicate(true);action_marker.emit(public_event);return null
 if event.kind=='finished':
  clock_instances.erase(id);_sync_clock_state();playing=false;_render();action_finished.emit(event.actionId)
 return null
func _pause_action_clock():
 playing=false
 if action_clock!=null:action_clock.pause()
func _begin_action_playback():
 var state=_clock_state()
 if state==null:return
 playing=true
 if state.status in ['finished','cancelled'] or (not clock_instances.get(state.instanceId,{}).get('played',false) and not clock_instances.get(state.instanceId,{}).get('chosen',false)):
  var result=action_clock.start(action,{})
  if not result.ok:playing=false;equipment_notice=result.error.message
  return
 var first_play=not clock_instances.get(state.instanceId,{}).get('played',false)
 clock_instances[state.instanceId].played=true;action_clock.resume();_sync_clock_state();_render()
 # Resume from an inspected key starts actual playback without replaying skipped cues.
 if first_play:action_started.emit(action)
func _advance_action_clock(dt_ms:float)->Dictionary:
 var result=action_clock.tick(dt_ms)
 if not result.ok:
  _pause_action_clock();equipment_notice=result.error.message
 _sync_clock_state();_render();return result
func _inspect_key(index:int):
 var target=rig.key_time(action,index);var state=_clock_state();playing=false
 if state==null or state.status in ['finished','cancelled']:_clock_prepare(action,target,true)
 else:
  clock_instances[state.instanceId].chosen=true;action_clock.seek_inspection(target)
 _sync_clock_state();_render()

# V40: same-render Result queries. No extra pose solve, renderer call, hit or effect.
func _socket_live_stamp()->Array:
 var clock=_clock_state()
 return [character,direction,action,phase,continuous,outfit,head_style,occlusion_mode,equipment.duplicate(true),clock.instanceId if clock!=null else '',clock.elapsedMs if clock!=null else 0.0]
func _publish_socket_plan():
 var clock=_clock_state();socket_render_revision+=1
 socket_context={'occlusionMode':occlusion_mode,'occlusion':current_plan.get('occlusion',{}).duplicate(true),'renderRevision':socket_render_revision,'character':character,'direction':direction,'actionId':action,'action':action,'clockInstanceId':clock.instanceId if clock!=null else '', 'elapsedMs':clock.elapsedMs if clock!=null else time_ms,'logicalPhase':phase,'renderPhase':phase if continuous else floor(phase),'continuous':continuous,'equipment':equipment.duplicate(true),'actorToWorld':null}
 socket_plan=FinalPlan.normalize(rig,current_plan,socket_context)
 socket_stamp=_socket_live_stamp();socket_plan_ready=true
func _socket_failure(reason:String)->Dictionary:return EquipmentContract._freeze({'ok':false,'reason':reason})
func equipment_capability(action_id:String)->Dictionary:
 if equipment_contract==null:return _socket_failure('equipment-contract-unavailable')
 return equipment_contract.evaluate_action({'actionId':action_id,'characterId':character,'direction':direction,'equipment':equipment})
func _socket_query_request(slot:String,space:String,event_context:Dictionary)->Dictionary:
 if equipment_contract==null or not socket_plan_ready:return _socket_failure('final-plan-unavailable')
 if socket_stamp!=_socket_live_stamp():return _socket_failure('stale-final-plan')
 if not event_context.is_empty():
  if not event_context.get('equipment',{}) is Dictionary:return _socket_failure('invalid-event-equipment-context')
  var clock=_clock_state()
  if clock==null or clock.status in ['cancelled','inspecting']:return _socket_failure('event-instance-inactive')
  for field in ['clockInstanceId','elapsedMs','actionId','character','direction','logicalPhase','renderPhase','continuous']:
   if not event_context.has(field) or event_context[field]!=socket_context[field]:return _socket_failure('stale-event-context')
  if event_context.get('equipment',{}).get(slot,'')!=equipment.get(slot,''):return _socket_failure('event-equipment-changed')
  var requirement=equipment_contract.requirements(event_context.actionId)
  if not requirement.ok:return requirement
  if requirement.requires!=null and event_context.get('equipment',{}).get(requirement.requires.slot,'')!=equipment.get(requirement.requires.slot,''):return _socket_failure('event-required-equipment-changed')
  var playback=equipment_contract.verify_playback({'actionId':event_context.actionId,'characterId':character,'direction':direction,'equipment':equipment,'plan':socket_plan})
  if not playback.ok:return playback
 var request={'slot':slot,'characterId':character,'direction':direction,'phase':socket_context.renderPhase,'equipment':equipment.duplicate(true),'plan':socket_plan,'space':space}
 if space=='world':return _socket_failure('world-space-not-implemented-in-isolated-preview')
 return {'ok':true,'request':request}
func query_socket(slot:String,socket:String,space:String='actor-local',event_context:Dictionary={})->Dictionary:
 var built=_socket_query_request(slot,space,event_context)
 if not built.ok:return built
 built.request.socket=socket
 var result=equipment_contract.query_socket(built.request)
 if not result.ok:return result
 var answer=result.duplicate(true);answer.visualContext=socket_context.duplicate(true)
 return EquipmentContract._freeze(answer)
func query_slot(slot:String,space:String='actor-local',event_context:Dictionary={})->Dictionary:
 var built=_socket_query_request(slot,space,event_context)
 if not built.ok:return built
 var result=equipment_contract.query_slot(built.request)
 if not result.ok:return result
 var answer=result.duplicate(true);answer.visualContext=socket_context.duplicate(true)
 return EquipmentContract._freeze(answer)
func query_event_socket(event:Dictionary,slot:String,socket:String,space:String='actor-local')->Dictionary:
 if event.get('kind')!='marker' or not event.get('visualContext') is Dictionary or event.visualContext.is_empty():return _socket_failure('event-context-missing')
 var context=event.visualContext
 if event.get('instanceId')!=context.get('clockInstanceId') or event.get('elapsedMs')!=context.get('elapsedMs') or event.get('actionId')!=context.get('actionId'):return _socket_failure('event-context-mismatch')
 return query_socket(slot,socket,space,context)
