extends RefCounted
# Normalizes an already computed final V36 draw plan. Never invokes rig.plan().
static func matrix(t:Transform2D)->Array:return [float(t.x.x),float(t.x.y),float(t.y.x),float(t.y.y),float(t.origin.x),float(t.origin.y)]
static func normalize(rig:RefCounted,raw:Dictionary,context:Dictionary)->Dictionary:
 var bindings=[];var commands=[]
 for b in raw.bindings:
  var item=rig.equipment[b.id]
  bindings.append({'id':b.id,'slot':item.slot,'pivot':[float(b.pivot.x),float(b.pivot.y)],'matrix':matrix(b.transform)})
 for c in raw.commands:
  if c.category!='equipment':continue
  var item=rig.equipment[c.part]
  commands.append({'id':c.part,'slot':item.slot,'category':'equipment','file':c.file,'matrix':matrix(c.transform)})
 return {'character':{'id':context.character},'effectiveOptions':{'character':context.character,'direction':context.direction,'action':context.action,'phase':context.renderPhase,'equipment':context.equipment.duplicate(true),'outfit':raw.effectiveOutfit},'resolution':{'requestedAction':raw.requestedAction,'action':raw.effectiveAction,'cancelled':raw.requestedAction!=raw.effectiveAction},'equipmentBindings':bindings,'commands':commands}
