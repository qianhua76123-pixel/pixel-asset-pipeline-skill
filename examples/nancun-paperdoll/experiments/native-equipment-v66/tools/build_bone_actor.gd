extends SceneTree
func matrix(a)->Transform2D:return Transform2D(Vector2(a[0],a[1]),Vector2(a[2],a[3]),Vector2(a[4],a[5]))
func _initialize():
 var data=JSON.parse_string(FileAccess.get_file_as_string('res://data/body-bindings.json'));var runtime=JSON.parse_string(FileAccess.get_file_as_string('res://assets/runtime-data.json'))
 var actor=Node2D.new();actor.name='NativeBoneActor';actor.set_script(load('res://scripts/bone_actor.gd'));root.add_child(actor)
 var skeleton=Skeleton2D.new();skeleton.name='Skeleton2D';actor.add_child(skeleton);skeleton.owner=actor;var bones={}
 for spec in data.defs:
  var bone=Bone2D.new();bone.name=spec.id;var parent=bones[spec.parent] if spec.parent!=null else skeleton;parent.add_child(bone);bone.owner=actor;bone.transform=matrix(data.restFrames.locals[spec.id]);bone.rest=bone.transform;bone.set_autocalculate_length_and_angle(false);bone.set_length(spec.restLength);bone.set_bone_angle(0);bones[spec.id]=bone
 for definition in [['RigidPelvis','Pelvis'],['GripSlot','ForearmB'],['HeadSlot','HeadUpright'],['BackSlot','Torso']]:
  var bone=Bone2D.new();bone.name=definition[0];bones[definition[1]].add_child(bone);bone.owner=actor;bone.set_autocalculate_length_and_angle(false);bone.set_length(3);bone.set_bone_angle(0);bone.rest=bone.transform;bones[definition[0]]=bone
 for spec in data.parts:
  var sprite=Sprite2D.new();sprite.name=String(spec.id).replace('-','_');var bone='RigidPelvis' if spec.bone=='Pelvis' and not spec.has('sourceBone') else spec.bone
  bones[bone].add_child(sprite);sprite.owner=actor;sprite.texture=load('res://assets/'+spec.file);sprite.centered=false;sprite.texture_filter=CanvasItem.TEXTURE_FILTER_NEAREST;sprite.transform=matrix(spec.local);sprite.z_as_relative=false;sprite.visible=false;sprite.set_meta('file',spec.file);sprite.set_meta('part_id',spec.id)
 for item in runtime.equipment:
  var sprite=Sprite2D.new();sprite.name=String(item.id).replace('-','_');var slot={'hand':'GripSlot','head':'HeadSlot','back':'BackSlot'}[item.slot];bones[slot].add_child(sprite);sprite.owner=actor;sprite.texture=load('res://assets/'+item.file);sprite.centered=false;sprite.texture_filter=CanvasItem.TEXTURE_FILTER_NEAREST;sprite.transform=Transform2D(0,-Vector2(item.pivot[0],item.pivot[1]));sprite.z_as_relative=false;sprite.visible=false;sprite.set_meta('file',item.file);sprite.set_meta('part_id',item.id)
 var packed=PackedScene.new();assert(packed.pack(actor)==OK);assert(ResourceSaver.save(packed,'res://native_bone_actor.tscn')==OK)
 print('Saved true bone tree: ',bones.size(),' bones, ',data.parts.size()+runtime.equipment.size(),' immutable-local sprites');quit()
