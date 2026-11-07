extends SceneTree
var checks=[]
var failures=[]
var gpu=false
func matrix(a)->Transform2D:return Transform2D(Vector2(a[0],a[1]),Vector2(a[2],a[3]),Vector2(a[4],a[5]))
func error(a:Transform2D,b:Transform2D)->float:return maxf(maxf(a.x.distance_to(b.x),a.y.distance_to(b.y)),a.origin.distance_to(b.origin))
func check(name:String,ok:bool,detail:Variant=null):
 checks.append({'name':name,'ok':ok,'detail':detail})
 if not ok:failures.append(name);push_error(name+': '+str(detail))
func viewport()->SubViewport:
 var v=SubViewport.new();v.size=Vector2i(96,96);v.transparent_bg=true;v.render_target_update_mode=SubViewport.UPDATE_ALWAYS;v.canvas_item_default_texture_filter=Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST;root.add_child(v);return v
func _initialize():gpu='--gpu' in OS.get_cmdline_user_args();call_deferred('run')
func run():
 DirAccess.make_dir_recursive_absolute('res://qa/gpu')
 var refs=JSON.parse_string(FileAccess.get_file_as_string('res://qa/reference-poses.json'))
 var cases=JSON.parse_string(FileAccess.get_file_as_string('res://qa/reference-gpu.json'))
 var vp=viewport();var actor=load('res://four_view_actor.tscn').instantiate();actor.position=Vector2(16,16);vp.add_child(actor);actor.set_process(false)
 var flatvp=viewport();var flat=Node2D.new();flat.position=Vector2(16,16);flatvp.add_child(flat)
 await process_frame
 var owned=true
 for node in actor.bones.values()+actor.sprites.values():owned=owned and node.owner==actor
 check('Saved one Skeleton2D with 15 bones and 195 owned static Sprites',actor.find_children('*','Skeleton2D',true,false).size()==1 and actor.bones.size()==15 and actor.sprites.size()==195 and owned and actor.sprites.values().all(func(s):return s.get_parent() is Bone2D))
 var max_joint=0.0;var max_bone=0.0;var max_leg=0.0;var heads_integer=true;var by_direction={}
 for ref in refs:
  actor.set_direction(ref.direction);actor.set_action(ref.action);actor.seek_phase(ref.phase)
  var pose=actor.last_pose;var joint_error=0.0;var bone_error=0.0
  for joint in ref.joints:
   for axis in 2:joint_error=maxf(joint_error,absf(pose.joints[joint][axis]-ref.joints[joint][axis]))
  for id in actor.bones:
   var actual=actor.global_transform.affine_inverse()*actor.bones[id].global_transform
   bone_error=maxf(bone_error,error(actual,matrix(ref.frames[id])))
  if ref.action=='walk':
   for side in ['A','B']:
    var w=pose.world[side];var k=Vector2(w.knee[0],w.knee[1]);var a=Vector2(w.ankle[0],w.ankle[1])
    max_leg=maxf(max_leg,maxf(absf(k.length()-w.l1),absf(k.distance_to(a)-w.l2)))
  var head=actor.global_transform.affine_inverse()*actor.bones.HeadUpright.global_transform
  var rest=actor.data.views[ref.direction].bind.head
  heads_integer=heads_integer and absf(head.origin.x-rest[0]-round(head.origin.x-rest[0]))<.0001 and absf(head.origin.y-rest[1]-round(head.origin.y-rest[1]))<.0001
  max_joint=maxf(max_joint,joint_error);max_bone=maxf(max_bone,bone_error)
  var d=by_direction.get(ref.direction,{'cases':0,'maxJointError':0.0,'maxBoneError':0.0});d.cases+=1;d.maxJointError=maxf(d.maxJointError,joint_error);d.maxBoneError=maxf(d.maxBoneError,bone_error);by_direction[ref.direction]=d
 check('Four directions x 128 walk and 5 idle joint references',refs.size()==532 and max_joint<1e-9,{'maxJointError':max_joint,'directions':by_direction})
 check('Actual bone hierarchy globals match source engine',max_bone<.0001,max_bone)
 check('True sagittal leg segment lengths preserved',max_leg<1e-5,max_leg)
 check('Head translates by integer source-relative offset',heads_integer)
 check('All 195 Sprite local matrices stay constant across direction/action',actor.local_matrices_unchanged())
 var neutral_pose=actor.solver.make_pose('left','neutral',0);var standard=actor.solver.bone_frames('left',neutral_pose)
 neutral_pose.torsoAngle=25.0;var tilted=actor.solver.bone_frames('left',neutral_pose);var body_unchanged=true
 for id in standard.globals:
  if id!='RigidPelvis':body_unchanged=body_unchanged and standard.globals[id]==tilted.globals[id]
 check('Rigid skirt bone handles torso angle without changing body or leg chain',body_unchanged and absf(rad_to_deg(tilted.globals.RigidPelvis.get_rotation())-25.0)<.00001)
 var max_command=0.0;var rank_exact=true;var gpu_records=[];var different=0;var max_changed=0
 for ref in cases:
  actor.set_direction(ref.direction);actor.select_outfit(ref.outfit)
  if ref.action=='neutral':actor.rest_pose()
  else:actor.set_action(ref.action);actor.seek_phase(ref.phase)
  for child in flat.get_children():flat.remove_child(child);child.free()
  var rank=0;var expected_ids=[]
  for command in ref.commands:
   expected_ids.append(command.id)
   var sprite=Sprite2D.new();sprite.texture=load('res://assets/'+command.file);sprite.centered=false;sprite.texture_filter=CanvasItem.TEXTURE_FILTER_NEAREST;sprite.transform=matrix(command.matrix);sprite.z_index=rank;flat.add_child(sprite)
   var current=actor.sprites[command.id];var actual=actor.global_transform.affine_inverse()*current.global_transform
   max_command=maxf(max_command,error(actual,matrix(command.matrix)));rank_exact=rank_exact and current.visible and current.z_index==rank;rank+=1
  rank_exact=rank_exact and actor.sprites.values().filter(func(s):return s.visible).size()==expected_ids.size()
  if gpu:
   await process_frame;await RenderingServer.frame_post_draw
   var image=vp.get_texture().get_image();var reference=flatvp.get_texture().get_image();image.convert(Image.FORMAT_RGBA8);reference.convert(Image.FORMAT_RGBA8)
   var raw=image.get_data();var expected=reference.get_data();var changed=0;var alpha=0;var opaque=0;var edge=0
   for i in range(0,raw.size(),4):
    if raw[i]!=expected[i] or raw[i+1]!=expected[i+1] or raw[i+2]!=expected[i+2] or raw[i+3]!=expected[i+3]:changed+=1
    if raw[i+3]!=expected[i+3]:alpha+=1
    if raw[i+3]>0:
     opaque+=1;var p=int(i/4);var x=p%96;var y=int(p/96)
     if x==0 or x==95 or y==0 or y==95:edge+=1
   if changed:different+=1
   max_changed=maxi(max_changed,changed)
   var stem=ref.direction+'-'+ref.outfit+'-'+ref.action+'-'+str(ref.phase)
   image.save_png('res://qa/gpu/'+stem+'-bones.png')
   if changed:reference.save_png('res://qa/gpu/'+stem+'-flat.png')
   gpu_records.append({'direction':ref.direction,'outfit':ref.outfit,'action':ref.action,'phase':ref.phase,'rgbaChangedPixels':changed,'alphaChangedPixels':alpha,'opaquePixels':opaque,'frameEdgePixels':edge})
 check('All source commands factor through bones with exact visibility/ranks',max_command<.0001 and rank_exact,{'maxMatrixError':max_command,'rankAndVisibilityExact':rank_exact,'cases':cases.size()})
 if gpu:
  check('180 GPU cases include all neutral, 8 keys and selected fractional phases',gpu_records.size()==180 and gpu_records.all(func(r):return r.opaquePixels>0 and r.frameEdgePixels==0))
  check('180 GPU flat versus actual Bone2D renders exact',different==0,{'differentCases':different,'maxChangedPixels':max_changed})
 actor.set_action('walk');actor.seek_phase(2.375);actor.toggle_play();var p=actor.phase;var t=actor.time_seconds;var bone_ids=actor.bones.values().map(func(b):return b.get_instance_id())
 for dir in actor.data.directions:actor.set_direction(dir);check('Playing turn keeps same phase/time/skeleton '+dir,actor.phase==p and actor.time_seconds==t and actor.playing and actor.bones.values().map(func(b):return b.get_instance_id())==bone_ids)
 var globals={}
 for id in actor.bones:globals[id]=actor.bones[id].global_transform
 for garment in actor.data.outfits:actor.select_outfit(garment.id)
 check('Playing outfit change retains all bones and clock',actor.phase==p and actor.time_seconds==t and actor.playing and actor.bones.keys().all(func(id):return globals[id]==actor.bones[id].global_transform))
 actor.toggle_play();actor._process(.5);actor.set_direction('up')
 check('Paused turn and dt keep phase/time paused',actor.phase==p and actor.time_seconds==t and not actor.playing)
 actor.seek_phase(7.9375);actor.toggle_play();actor._process(.0125)
 check('Walk wraps one clock at 800 ms',absf(actor.phase-.0625)<1e-8 and actor.playing,actor.phase)
 actor.set_action('idle');actor._process(.4)
 check('Idle first authored 400 ms segment retained',absf(actor.phase-1)<1e-8 and absf(actor.time_seconds-.4)<1e-8,actor.phase)
 actor._process(2.0);check('Idle wraps at 2400 ms',absf(actor.phase)<1e-8,actor.phase)
 actor.seek_phase(2.5);check('Idle inspection uses nonuniform inverse timing',absf(actor.time_seconds-.83)<1e-8 and not actor.playing,actor.time_seconds)
 actor.rest_pose();actor.set_direction('right');actor.select_outfit('original')
 check('Neutral direction/outfit preserve true rest and stopped clock',actor.is_resting and not actor.playing and actor.phase==0)
 var state=[actor.direction,actor.outfit,actor.action,actor.phase,actor.time_seconds]
 check('Unknown enums and nonfinite phase rejected',not actor.set_direction('diagonal') and not actor.select_outfit('missing') and not actor.set_action('sword'))
 actor.seek_phase(NAN);check('Invalid input leaves state unchanged',[actor.direction,actor.outfit,actor.action,actor.phase,actor.time_seconds]==state)
 var demo=load('res://main.tscn').instantiate();root.add_child(demo);await process_frame;demo.actor.set_process(false)
 check('Actual preview layout remains integer 5x square',demo.preview_picture.size==Vector2(480,480),str(demo.preview_picture.size))
 demo.phase_slider.value=3.4375;demo.play_button.pressed.emit();var ui_time=demo.actor.time_seconds
 for i in 4:demo.direction_control.select(i);demo.direction_control.item_selected.emit(i)
 demo.outfit_control.select(2);demo.outfit_control.item_selected.emit(2)
 check('Actual UI turn and outfit signals preserve playing phase',demo.actor.direction=='left' and demo.actor.outfit=='moon-celadon-four-view' and demo.actor.phase==3.4375 and demo.actor.time_seconds==ui_time and demo.actor.playing)
 for k in 8:
  demo.key_buttons[k].pressed.emit();check('UI key '+str(k+1)+' pauses exact phase',demo.actor.phase==k and not demo.actor.playing)
 demo.overlay_control.button_pressed=true;check('Actual bones toggle shows overlay',demo.overlay.visible)
 demo.rest_button.pressed.emit();demo.direction_control.select(2);demo.direction_control.item_selected.emit(2)
 check('Actual neutral then turn stays neutral',demo.actor.is_resting and demo.actor.direction=='up' and not demo.actor.playing)
 if gpu:
  demo.direction_control.select(1);demo.direction_control.item_selected.emit(1);demo.phase_slider.value=2.4375
  await process_frame;await RenderingServer.frame_post_draw
  root.get_texture().get_image().save_png('res://presentation/native-four-directions-ui.png')
 var report={'godot':Engine.get_version_info().string,'renderer':RenderingServer.get_current_rendering_method(),'mode':'GPU' if gpu else 'headless','checks':checks,'failures':failures,'jointReferences':532,'maxJointError':max_joint,'maxBoneGlobalError':max_bone,'maxLegLengthError':max_leg,'maxCommandMatrixError':max_command,'directions':by_direction,'gpuCases':gpu_records,'gpuDifferenceCases':different,'gpuMaxChangedPixels':max_changed,'scope':'Same native source PNGs and independent V69 final-command GPU baseline. Runtime has no QA-reference loading. Source agreement does not prove natural motion or world foot locking.'}
 FileAccess.open('res://qa/'+('gpu-validation.json' if gpu else 'logic-validation.json'),FileAccess.WRITE).store_string(JSON.stringify(report,'  '))
 print(JSON.stringify({'mode':report.mode,'checks':checks.size(),'failures':failures,'jointError':max_joint,'boneError':max_bone,'commandError':max_command,'gpuCases':gpu_records.size(),'differentCases':different,'maxChangedPixels':max_changed}))
 quit(0 if failures.is_empty() else 1)
