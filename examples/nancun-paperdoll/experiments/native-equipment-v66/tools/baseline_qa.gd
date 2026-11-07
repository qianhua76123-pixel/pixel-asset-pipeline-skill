extends SceneTree
const Rig=preload('res://scripts/rig_math.gd')
const Track=preload('res://scripts/occlusion_track.gd')
var records=[]
var rig=Rig.new()
var track=JSON.parse_string(FileAccess.get_file_as_string('res://data/occlusion-tracks.json'))
var policy=JSON.parse_string(FileAccess.get_file_as_string('res://data/occlusion-policy.json'))
func _initialize():call_deferred('run')
func viewport()->SubViewport:
 var v=SubViewport.new();v.size=Vector2i(96,96);v.transparent_bg=true;v.disable_3d=true;v.render_target_update_mode=SubViewport.UPDATE_ALWAYS;v.canvas_item_default_texture_filter=Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST;root.add_child(v);return v
func delta(a:Transform2D,b:Transform2D)->float:
 return maxf(maxf(a.x.distance_to(b.x),a.y.distance_to(b.y)),a.origin.distance_to(b.origin))
func run():
 var gpu=not '--logic-only' in OS.get_cmdline_user_args()
 DirAccess.make_dir_recursive_absolute('res://qa/gpu')
 var vp=viewport();var refvp=viewport();var actor=load('res://native_bone_actor.tscn').instantiate();vp.add_child(actor);actor.position=Vector2(16,16)
 var flat=Node2D.new();refvp.add_child(flat);flat.position=Vector2(16,16)
 var cases=[]
 for outfit in ['original','stone-blue-daily','moon-celadon-hanfu']:
  for action in ['sword','hoe']:
   var phases=[0.0,1.0,2.0,3.0,4.0,5.0,6.0,7.0,1.375,3.375,5.375,6.375]
   var bounds=[2.75,5.75] if action=='sword' else [2.5,6.0]
   for bound in bounds:phases.append(bound-.001);phases.append(bound);phases.append(bound+.001)
   for phase in phases:cases.append({'outfit':outfit,'action':action,'phase':phase,'head':'straw-hat','back':'back-basket'})
  cases.append({'outfit':outfit,'action':'idle','phase':0.0,'head':'','back':''})
 # Explicit hairpin branch and pure-body neutral.
 cases.append({'outfit':'original','action':'hoe','phase':1.0,'head':'hairpin','back':''})
 var max_error=0.0;var pixel_failures=0;var failure=[]
 for index in cases.size():
  var c=cases[index];var equip={'head':c.head,'back':c.back,'hand':'' if c.action=='idle' else ('iron-sword' if c.action=='sword' else 'wood-hoe')}
  var raw=rig.plan('heqing','down',c.action,c.phase,c.outfit,equip,0,'open',{},'original')
  var p=Track.apply_track(raw,{'character':'heqing','direction':'down','action':c.action,'phase':c.phase,'outfit':c.outfit,'headStyle':'original','equipment':equip},track,policy)
  actor.apply_plan(p)
  for child in flat.get_children():flat.remove_child(child);child.free()
  var err=0.0
  for i in p.commands.size():
   var command=p.commands[i];var sprite=Sprite2D.new();sprite.texture=load('res://assets/'+command.file);sprite.centered=false;sprite.transform=command.transform;sprite.z_as_relative=false;sprite.z_index=i;sprite.texture_filter=CanvasItem.TEXTURE_FILTER_NEAREST;flat.add_child(sprite)
   var actual=actor.global_transform.affine_inverse()*actor.parts[command.file].global_transform
   err=maxf(err,delta(actual,command.transform))
   if actor.parts[command.file].z_index!=i:failure.append('z-order')
  max_error=maxf(max_error,err)
  if not actor.local_matrices_unchanged():failure.append('sprite-local-mutated')
  var record=c.duplicate();record.matrixMaxError=err;record.commands=p.commands.size();record.occlusion=p.occlusion;record.id='%03d'%index
  if gpu:
   await process_frame;await RenderingServer.frame_post_draw
   var a=vp.get_texture().get_image();var b=refvp.get_texture().get_image();a.convert(Image.FORMAT_RGBA8);b.convert(Image.FORMAT_RGBA8)
   a.save_png('res://qa/gpu/'+record.id+'-bone.png');b.save_png('res://qa/gpu/'+record.id+'-flat.png')
   var aa=a.get_data();var bb=b.get_data();var diff=0;var adiff=0
   for k in range(0,aa.size(),4):
    if aa.slice(k,k+4)!=bb.slice(k,k+4):diff+=1
    if aa[k+3]!=bb[k+3]:adiff+=1
   record.rgbaChangedPixels=diff;record.alphaChangedPixels=adiff
   if diff:pixel_failures+=1
  records.append(record)
 # A real parent edit must propagate only through its descendants.
 var original=actor.bones.UpperArmA.transform;var hand_before=actor.bones.ForearmA.global_transform;var other_before=actor.bones.ForearmB.global_transform
 actor.bones.UpperArmA.rotate(.1)
 var edit_ok=actor.bones.ForearmA.global_transform!=hand_before and actor.bones.ForearmB.global_transform==other_before
 actor.bones.UpperArmA.transform=original
 var owned=true
 for node in actor.find_children('*','',true,false):
  if node is Bone2D or node is Sprite2D:
   if node.owner!=actor:owned=false
 var report={'godot':Engine.get_version_info().string,'gpu':gpu,'sampleCount':cases.size(),'bones':actor.bones.size(),'sprites':actor.parts.size(),'allOwnedByPackedActor':owned,'spriteLocalsUnchanged':actor.local_matrices_unchanged(),'parentEditPropagatesOnlyToOwnChain':edit_ok,'maxMatrixError':max_error,'gpuCasesWithDifferences':pixel_failures,'failures':failure,'samples':records}
 FileAccess.open('res://qa/'+('gpu-baseline.json' if gpu else 'logic-baseline.json'),FileAccess.WRITE).store_string(JSON.stringify(report,'  '))
 print('V66 baseline: ',cases.size(),' samples, max matrix error ',max_error,', GPU difference cases ',pixel_failures,', owner=',owned,', edit=',edit_ok)
 quit(1 if failure.size() or not owned or not edit_ok or max_error>.0001 else 0)
