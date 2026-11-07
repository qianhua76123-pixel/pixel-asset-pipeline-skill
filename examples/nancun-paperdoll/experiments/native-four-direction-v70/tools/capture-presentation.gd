extends SceneTree
func _initialize():call_deferred('run')
func viewport()->SubViewport:
 var v=SubViewport.new();v.size=Vector2i(96,96);v.transparent_bg=true;v.render_target_update_mode=SubViewport.UPDATE_ALWAYS;v.canvas_item_default_texture_filter=Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST;root.add_child(v);return v
func run():
 DirAccess.make_dir_recursive_absolute('res://qa/presentation-frames')
 var views=[];var dirs=['down','right','up','left'];var outfits=['original','stone-blue-top-four-view','moon-celadon-four-view'];var records=[]
 for outfit in outfits:
  for dir in dirs:
   var vp=viewport();var actor=load('res://four_view_actor.tscn').instantiate();actor.position=Vector2(16,16);vp.add_child(actor);actor.set_process(false);actor.set_direction(dir);actor.select_outfit(outfit);actor.set_action('walk');views.append({'vp':vp,'actor':actor,'dir':dir,'outfit':outfit})
 for k in 40:
  for v in views:v.actor.seek_phase(k/5.0)
  await process_frame;await RenderingServer.frame_post_draw
  for v in views:
   var image=v.vp.get_texture().get_image();image.convert(Image.FORMAT_RGBA8)
   var file='qa/presentation-frames/'+v.outfit+'-'+v.dir+'-'+str(k).pad_zeros(2)+'.png'
   image.save_png('res://'+file);records.append({'file':file,'outfit':v.outfit,'direction':v.dir,'phase':k/5.0,'frame':k})
 var demo=load('res://main.tscn').instantiate();root.add_child(demo);await process_frame;demo.actor.set_process(false)
 demo.outfit_control.select(2);demo.outfit_control.item_selected.emit(2);demo.direction_control.select(3);demo.direction_control.item_selected.emit(3);demo.phase_slider.value=3.4375;demo.overlay_control.button_pressed=true
 await process_frame;await RenderingServer.frame_post_draw
 root.get_texture().get_image().save_png('res://presentation/native-four-directions-ui.png')
 FileAccess.open('res://qa/presentation-capture.json',FileAccess.WRITE).store_string(JSON.stringify({'godot':Engine.get_version_info().string,'renderer':RenderingServer.get_current_rendering_method(),'framesPerCycle':40,'durationMsPerFrame':20,'cycleMs':800,'mode':'Actual Bone2D GPU, 12 viewports','records':records},'  '))
 print('Captured 480 real GPU images; 40 uniform walk phases x 4 directions x 3 clothes');quit()
