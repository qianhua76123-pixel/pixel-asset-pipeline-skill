extends SceneTree
var checks=[]
func check(name,ok):checks.append({'name':name,'ok':ok})
func _initialize():call_deferred('run')
func run():
 var actor=load('res://four_view_actor.tscn').instantiate();root.add_child(actor);actor.set_process(false)
 check('packed_scene_loaded',actor.bones.size()==15 and actor.sprites.size()==195)
 actor.set_action('walk');actor.seek_phase(3.4375);actor.toggle_play();var ids=actor.bones.values().map(func(b):return b.get_instance_id())
 for direction in actor.data.directions:actor.set_direction(direction)
 actor.select_outfit('moon-celadon-four-view')
 check('four_direction_family_keeps_clock_and_tree',actor.phase==3.4375 and actor.playing and actor.bones.values().map(func(b):return b.get_instance_id())==ids)
 check('sprite_locals_constant',actor.local_matrices_unchanged())
 actor.set_action('idle');actor._process(.4);check('authored_idle_timing',absf(actor.phase-1)<1e-8)
 actor.rest_pose();actor.set_direction('up');check('neutral_stopped',actor.is_resting and not actor.playing)
 var demo=load('res://main.tscn').instantiate();root.add_child(demo);await process_frame
 check('ui_can_load',demo.preview_picture.size==Vector2(480,480) and demo.actor.bones.size()==15)
 var failed=checks.filter(func(c):return not c.ok)
 print('V70_SMOKE '+JSON.stringify({'checks':checks,'failures':failed.size(),'godot':Engine.get_version_info().string}))
 quit(1 if failed.size() else 0)
