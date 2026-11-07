extends SceneTree
func matrix(a)->Transform2D:return Transform2D(Vector2(a[0],a[1]),Vector2(a[2],a[3]),Vector2(a[4],a[5]))
func _initialize():
 var data=JSON.parse_string(FileAccess.get_file_as_string('res://data/rig.json'));var view=data.views.down
 var actor=Node2D.new();actor.name='FourViewActor'
 var skeleton=Skeleton2D.new();skeleton.name='Skeleton2D';actor.add_child(skeleton);skeleton.owner=actor
 var bones={}
 for spec in view.defs:
  var bone=Bone2D.new();bone.name=spec.id
  var parent=bones[spec.parent] if spec.parent!=null else skeleton
  parent.add_child(bone);bone.owner=actor;bone.transform=matrix(view.restFrames.locals[spec.id]);bone.rest=bone.transform
  bone.set_autocalculate_length_and_angle(false);bone.set_length(spec.restLength);bone.set_bone_angle(0);bone.set_meta('rig_id',spec.id);bones[spec.id]=bone
 for spec in data.parts:
  var sprite=Sprite2D.new();sprite.name=String(spec.id).replace('-','_');bones[spec.bone].add_child(sprite);sprite.owner=actor
  sprite.texture=load('res://assets/'+spec.file);sprite.centered=false;sprite.texture_filter=CanvasItem.TEXTURE_FILTER_NEAREST;sprite.transform=matrix(spec.local);sprite.z_as_relative=false
  sprite.visible=spec.direction=='down' and 'original' in spec.outfits;sprite.z_index=int(spec.ranks.get('original',0))
  sprite.set_meta('part_id',spec.id);sprite.set_meta('direction',spec.direction);sprite.set_meta('outfits',spec.outfits);sprite.set_meta('ranks',spec.ranks)
 actor.set_script(load('res://scripts/actor.gd'))
 var packed=PackedScene.new();assert(packed.pack(actor)==OK);assert(ResourceSaver.save(packed,'res://four_view_actor.tscn')==OK)
 FileAccess.open('res://qa/scene-build.json',FileAccess.WRITE).store_string(JSON.stringify({'bones':bones.size(),'sprites':data.parts.size(),'savedScene':'res://four_view_actor.tscn','ownerAssigned':true,'runtimeConstructsSprites':false},'  '))
 actor.free();print('Saved 15-bone four-view scene');quit()
