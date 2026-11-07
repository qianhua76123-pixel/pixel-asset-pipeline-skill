extends Node2D
# Source part local matrices are immutable. Only real Bone2D transforms,
# visibility and absolute z-order consume the final V46 plan.
var data:Dictionary
var bones:Dictionary={}
var parts:Dictionary={}
var fixed_locals:Dictionary={}
var equipment:Dictionary={}
var last_plan={}
func matrix(a)->Transform2D:return Transform2D(Vector2(a[0],a[1]),Vector2(a[2],a[3]),Vector2(a[4],a[5]))
func vec(a)->Vector2:return Vector2(a[0],a[1])
func _ready():
 data=JSON.parse_string(FileAccess.get_file_as_string('res://data/body-bindings.json'))
 var runtime=JSON.parse_string(FileAccess.get_file_as_string('res://assets/runtime-data.json'))
 for item in runtime.equipment:equipment[item.id]=item
 for bone in find_children('*','Bone2D',true,false):bones[bone.name]=bone
 for sprite in find_children('*','Sprite2D',true,false):parts[sprite.get_meta('file')]=sprite;fixed_locals[sprite.get_meta('file')]=sprite.transform
func apply_plan(plan:Dictionary):
 var j=plan.pose.joints;var globals={};var head_command={}
 for command in plan.commands:
  if command.part=='head':head_command=command;break
 for definition in data.defs:
  var frame:Transform2D
  if definition.get('head',false):
   # The exact final source quantization is authoritative, not a new rounding pass.
   var source=Vector2(32,25.5);frame=head_command.transform*Transform2D(0,source)
  elif definition.has('pair'):
   var a=vec(j[definition.pair[0]]);var b=vec(j[definition.pair[1]]);var d=b-a
   frame=Transform2D(d/definition.restLength,Vector2(-d.y,d.x).normalized(),a)
  else:frame=Transform2D(0,vec(j[definition.joint]))
  globals[definition.id]=frame
 globals.RigidPelvis=Transform2D(deg_to_rad(plan.pose.get('torsoAngle',0)),vec(j.pelvis))
 globals.GripSlot=Transform2D(0,vec(j.wristB));globals.HeadSlot=globals.HeadUpright;globals.BackSlot=Transform2D(0,vec(j.neck))
 for command in plan.commands:
  if command.category!='equipment':continue
  var item=equipment[command.part];var slot={'hand':'GripSlot','head':'HeadSlot','back':'BackSlot'}[item.slot]
  globals[slot]=command.transform*Transform2D(0,vec(item.pivot))
 for definition in data.defs:
  bones[definition.id].transform=globals[definition.parent].affine_inverse()*globals[definition.id] if definition.parent!=null else globals[definition.id]
 for id in ['RigidPelvis','GripSlot','HeadSlot','BackSlot']:
  var parent=bones[id].get_parent().name;bones[id].transform=globals[parent].affine_inverse()*globals[id]
 for sprite in parts.values():sprite.visible=false
 for i in plan.commands.size():
  var command=plan.commands[i];assert(parts.has(command.file),'Unsupported final-plan part '+command.file)
  var sprite=parts[command.file];sprite.visible=true;sprite.z_index=i
 last_plan=plan
func local_matrices_unchanged()->bool:
 for file in parts:
  if parts[file].transform!=fixed_locals[file]:return false
 return true
