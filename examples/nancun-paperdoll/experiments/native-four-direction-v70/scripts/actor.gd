extends Node2D
var data:Dictionary
var solver
var sprites={}
var bones={}
var direction='down'
var outfit='original'
var action='walk'
var phase=0.0
var time_seconds=0.0
var playing=false
var is_resting=true
var last_pose={}
var fixed_locals={}
func matrix(a)->Transform2D:return Transform2D(Vector2(a[0],a[1]),Vector2(a[2],a[3]),Vector2(a[4],a[5]))
func _ready():
 data=JSON.parse_string(FileAccess.get_file_as_string('res://data/rig.json'))
 solver=preload('res://scripts/continuous_pose.gd').new(data)
 for sprite in find_children('*','Sprite2D',true,false):sprites[sprite.get_meta('part_id')]=sprite;fixed_locals[sprite.get_meta('part_id')]=sprite.transform
 for bone in find_children('*','Bone2D',true,false):bones[String(bone.name)]=bone
 _set_view_rest();_render()
func _set_view_rest():
 var view=data.views[direction]
 for spec in view.defs:
  bones[spec.id].rest=matrix(view.restFrames.locals[spec.id]);bones[spec.id].set_length(spec.restLength)
func _render():
 last_pose=solver.make_pose(direction,'neutral' if is_resting else action,phase)
 var frames=solver.bone_frames(direction,last_pose)
 for id in bones:bones[id].transform=frames.locals[id]
 _visibility()
func _visibility():
 for sprite in sprites.values():
  sprite.visible=sprite.get_meta('direction')==direction and outfit in sprite.get_meta('outfits')
  sprite.z_index=int(sprite.get_meta('ranks').get(outfit,0))
func set_direction(value:String)->bool:
 if not value in data.directions:return false
 if direction==value:return true
 direction=value;_set_view_rest();_render();return true
func select_outfit(value:String)->bool:
 if not data.outfits.any(func(o):return o.id==value):return false
 outfit=value;_visibility();return true
func set_action(value:String)->bool:
 if not value in ['idle','walk']:return false
 action=value;phase=0;time_seconds=0;is_resting=false;_render();return true
func seek_phase(value:float,pause:bool=true):
 if not is_finite(value):return
 phase=fposmod(value,8.0);is_resting=false
 time_seconds=time_at_phase(phase)
 if pause:playing=false
 _render()
func seek_key(key:int):seek_phase(float(clampi(key,0,7)))
func rest_pose():playing=false;phase=0;time_seconds=0;is_resting=true;_render()
func toggle_play():
 playing=not playing
 if playing:is_resting=false;_render()
func current_phase()->float:return phase
func is_playing()->bool:return playing
func period_seconds()->float:return float(data.walk.periodSeconds if action=='walk' else data.idle.periodSeconds)
func key_duration(index:int)->float:return .1 if action=='walk' else float(data.idle.durationsMs[index])/1000.0
func time_at_phase(value:float)->float:
 var index=int(floor(value));var seconds=0.0
 for i in index:seconds+=key_duration(i)
 return seconds+(value-index)*key_duration(index)
func phase_at_time(value:float)->float:
 var remaining=fposmod(value,period_seconds())
 for i in 8:
  var duration=key_duration(i)
  if remaining<duration:return i+remaining/duration
  remaining-=duration
 return 0.0
func _process(delta):
 if playing:
  time_seconds=fposmod(time_seconds+delta,period_seconds());phase=phase_at_time(time_seconds);_render()
func _notification(what):
 if what==NOTIFICATION_APPLICATION_FOCUS_OUT:playing=false
func local_matrices_unchanged()->bool:
 for id in sprites:
  if sprites[id].transform!=fixed_locals[id]:return false
 return true
