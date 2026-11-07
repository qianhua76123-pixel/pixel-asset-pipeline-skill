extends SceneTree
const Rig=preload('res://scripts/rig_math.gd')
const Track=preload('res://scripts/occlusion_track.gd')
func _initialize():call_deferred('run')
func run():
 var rig=Rig.new();var track=JSON.parse_string(FileAccess.get_file_as_string('res://data/occlusion-tracks.json'));var policy=JSON.parse_string(FileAccess.get_file_as_string('res://data/occlusion-policy.json'))
 var vp=SubViewport.new();vp.size=Vector2i(288,96);vp.transparent_bg=true;vp.disable_3d=true;vp.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(vp)
 var actors=[];var overlays=[];var outfits=['original','stone-blue-daily','moon-celadon-hanfu']
 for i in 3:
  var actor=load('res://native_bone_actor.tscn').instantiate();vp.add_child(actor);actor.position=Vector2(16+i*96,16);actors.append(actor)
  var overlay=load('res://scripts/bone_overlay.gd').new();overlay.actor=actor;overlay.z_index=1000;actor.add_child(overlay);overlays.append(overlay)
 var report={'renderer':'actual Godot 4.6.2 Bone2D tree; no wholebody frame inputs','frames':[]}
 for action in ['sword','hoe']:
  var total=0.0
  for duration in rig.data.actions[action].durations:total+=duration
  var times=[];var t=0.0
  while t<total:times.append(t);t+=40.0
  if total-times[-1]<20:times.pop_back()
  times.append(total)
  for structure in [false,true]:
   var folder='res://qa/demo-frames/'+action+('-bones' if structure else '-clean');DirAccess.make_dir_recursive_absolute(folder)
   for index in times.size():
    var phase=rig.timing(action,times[index]).phase
    for i in 3:
     var equip={'head':'straw-hat','back':'back-basket','hand':'iron-sword' if action=='sword' else 'wood-hoe'}
     var raw=rig.plan('heqing','down',action,phase,outfits[i],equip,0,'open',{},'original')
     var plan=Track.apply_track(raw,{'character':'heqing','direction':'down','action':action,'phase':phase,'outfit':outfits[i],'equipment':equip,'headStyle':'original'},track,policy)
     actors[i].apply_plan(plan);overlays[i].visible=structure;overlays[i].queue_redraw()
    await process_frame;await RenderingServer.frame_post_draw
    var path=folder+'/%03d.png'%index;vp.get_texture().get_image().save_png(path)
    report.frames.append({'action':action,'structure':structure,'index':index,'timeMs':times[index],'phase':phase,'file':path.trim_prefix('res://'),'durationMs':times[index+1]-times[index] if index<times.size()-1 else 400})
 FileAccess.open('res://qa/demo-render.json',FileAccess.WRITE).store_string(JSON.stringify(report,'  '));print('Actual bone GPU demo frames: ',report.frames.size());quit()
