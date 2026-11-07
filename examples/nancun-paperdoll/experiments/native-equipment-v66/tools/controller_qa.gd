extends SceneTree
var checks=[]
var c
var actor
var observed=[]
var cancel_mode=''
var finish_mode=''
var marker_mode=''
var started_mode=''
func check(name:String,ok:bool,detail:Variant=null):
 checks.append({'name':name,'ok':ok,'detail':detail})
 if not ok:push_error(name+': '+str(detail))
func _initialize():call_deferred('run')
func on_start(_a):
 if started_mode=='replace':started_mode='';c.set_action('hoe');c._begin_action_playback()
func on_cancel(_a):
 if cancel_mode=='replace':cancel_mode='';c.set_action('idle');c._begin_action_playback()
func on_finish(_a):
 if finish_mode=='replace':finish_mode='';c.set_action('hoe');c._begin_action_playback()
func on_marker(event):
 var before=c.plan_count;var result=c.query_event_socket(event,'hand','grip.primary','preview-canvas')
 var actual:Vector2=Vector2.ZERO
 if result.ok:
  var id=c.equipment.hand;var item=c.rig.equipment[id];var sprite=actor.parts[item.file]
  actual=sprite.global_transform*Vector2(item.pivot[0],item.pivot[1])
 observed.append({'id':event.markerId,'elapsedMs':event.elapsedMs,'renderPhase':event.visualContext.renderPhase,'phaseAtCallback':c.phase,'queryOK':result.ok,'queryPlanCountDelta':c.plan_count-before,'matrixGrip': [actual.x,actual.y],'query':result})
 if marker_mode=='pause':marker_mode='';c._pause_action_clock()
 elif marker_mode=='replace':marker_mode='';c.set_action('idle');c._begin_action_playback()
func fresh(action='sword'):
 c.set_action(action);c._begin_action_playback();observed.clear()
func run():
 actor=load('res://native_bone_actor.tscn').instantiate();root.add_child(actor);actor.position=Vector2(16,16)
 c=load('res://scripts/controller.gd').new();root.add_child(c);c.set_process(false)
 check('initialize',c.initialize(actor).ok)
 c.action_started.connect(on_start);c.action_marker.connect(on_marker);c.action_cancelled.connect(on_cancel);c.action_finished.connect(on_finish)
 fresh();c._advance_action_clock(300);var state=c._clock_state();var phase=c.phase;var instance=state.instanceId;var elapsed=state.elapsedMs
 c.set_outfit('stone-blue-daily');check('outfit-keeps-clock',c._clock_state().instanceId==instance and c.time_ms==elapsed and c.phase==phase and c.playing)
 c.set_equipment('head','straw-hat');c.set_equipment('back','back-basket');check('gear-keeps-clock',c._clock_state().instanceId==instance and c.time_ms==elapsed and c.playing)
 c._advance_action_clock(190);check('large-dt-ordered-current-pose',observed.map(func(e):return e.id)==['hit-open','impact-proposal'],observed.map(func(e):return e.id))
 var sockets_ok=true
 for e in observed:
  sockets_ok=sockets_ok and e.queryOK and e.queryPlanCountDelta==0 and e.renderPhase==e.phaseAtCallback
  if e.queryOK:sockets_ok=sockets_ok and Vector2(e.matrixGrip[0],e.matrixGrip[1]).distance_to(Vector2(e.query.position[0],e.query.position[1]))<.0001
 check('markers-query-current-plan-no-extra-solve',sockets_ok,observed)
 var old=c.last_marker.duplicate(true);c._advance_action_clock(1);check('old-event-rejected-after-advance',not c.query_event_socket(old,'hand','grip.primary').ok)
 c._pause_action_clock();var paused_time=c.time_ms;c._advance_action_clock(500);check('paused-does-not-advance',c.time_ms==paused_time)
 observed.clear();c.inspect_phase(1.25);check('inspection-no-markers',observed.is_empty() and not c.playing and abs(c.phase-1.25)<.00001)
 c.set_action('sword');c.inspect_phase(1.25);c.set_continuous(false);c._begin_action_playback();observed.clear();c._advance_action_clock(300);check('sampled-event-uses-render-phase',observed.size()>0 and observed[0].renderPhase==floor(observed[0].phaseAtCallback))
 c.set_continuous(true)
 fresh();cancel_mode='replace';c.set_equipment('hand','wood-hoe');check('tool-cancel-callback-start-retained',c.action=='idle' and c.playing and c.phase==0)
 fresh();started_mode='replace';c.set_action('sword');c._begin_action_playback();check('start-reentrant-replace-retained',c.action=='hoe' and c.playing)
 fresh();finish_mode='replace';c._advance_action_clock(2000);check('finished-callback-new-action-retained',c.action=='hoe' and c.playing and c.time_ms==0)
 fresh();marker_mode='replace';c._advance_action_clock(1000);check('marker-replace-stops-old-queue',c.action=='idle' and c.playing and observed.size()==1)
 fresh();marker_mode='pause';c._advance_action_clock(1000);check('marker-pause-stops-old-queue',not c.playing and c.time_ms==440 and observed.size()==1)
 fresh('hoe');var finish_count=[0];var cancel_count=[0]
 c.action_finished.connect(func(_a):finish_count[0]+=1);c.action_cancelled.connect(func(_a):cancel_count[0]+=1)
 c._advance_action_clock(9999);c._advance_action_clock(9999);check('single-action-finish-exactly-once',finish_count[0]==1 and not c.playing and c.phase==7)
 fresh('hoe');c.set_equipment('hand','');check('remove-required-tool-cancels-not-finishes',cancel_count[0]==1 and finish_count[0]==1 and c.action=='idle' and c.time_ms==0)
 fresh('idle');c._advance_action_clock(7250);check('loop-large-dt-one-clock',c.time_ms==7250 and abs(c.phase-c.rig.timing('idle',7250).phase)<.000001 and c.playing)
 var before=c._clock_state();check('unknown-action-rejected-without-cancel',not c.set_action('walk') and c._clock_state()==before)
 check('all-sprite-local-bindings-constant',actor.local_matrices_unchanged())
 var bad=checks.filter(func(x):return not x.ok);FileAccess.open('res://qa/controller-checks.json',FileAccess.WRITE).store_string(JSON.stringify({'godot':Engine.get_version_info().string,'checks':checks,'failures':bad.size()},'  '));print('Controller: ',checks.size(),' checks, ',bad.size(),' failures');quit(1 if bad.size() else 0)
