extends Node2D
var actor:Node2D
func _process(_delta):queue_redraw()
func _draw():
 if not is_instance_valid(actor):return
 for bone in actor.bones.values():
  var start=to_local(bone.global_position)
  var end=to_local(bone.to_global(Vector2(bone.get_length(),0)))
  draw_line(start,end,Color(.2,.75,.8,.85),.65)
  draw_circle(start,.7,Color(1,.55,.2))
