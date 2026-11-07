extends Node2D
var actor
func _draw():
 if not is_instance_valid(actor):return
 for name in actor.bones:
  var bone=actor.bones[name]
  var a=actor.global_transform.affine_inverse()*bone.global_position
  var b=a+Vector2(2,0)
  for spec in actor.data.defs:
   if spec.id==name and spec.has('pair'):
    b=a+bone.global_transform.x*float(spec.restLength);break
  var color=Color('#d25048') if name.ends_with('Slot') else Color('#178d93')
  draw_line(a,b,color,.6,false);draw_circle(a,.85,color,false,.5,false)
