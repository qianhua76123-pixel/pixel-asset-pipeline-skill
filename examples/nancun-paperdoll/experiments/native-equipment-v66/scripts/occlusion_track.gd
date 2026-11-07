extends RefCounted
# V41 explicit 2D art-direction phase track; V46 head-gear group is separately guarded.
# Returns a shallow plan with reused commands. Does not solve pose or alter transforms.
static func _nonzero(value:Variant)->bool:
 if value is Dictionary:
  for v in value.values():
   if _nonzero(v):return true
 elif value is Array:
  for v in value:
   if _nonzero(v):return true
 elif typeof(value) in [TYPE_INT,TYPE_FLOAT]:return value!=0
 return false
static func _unchanged(plan:Dictionary,reason:String)->Dictionary:
 var result=plan.duplicate(false);result.occlusion={'applied':false,'reason':reason};return result
static func _valid(track:Dictionary)->bool:
 if track.get('version')!=1 or not track.get('outfits') is Array or not track.get('profiles') is Dictionary:return false
 for profile in track.profiles.values():
  if not profile is Dictionary or not profile.get('equipment') is String or not profile.get('headOccludesWeapon') is Array:return false
  for bounds in profile.headOccludesWeapon:
   if not bounds is Array or bounds.size()!=2:return false
   for n in bounds:
    if not typeof(n) in [TYPE_INT,TYPE_FLOAT] or not is_finite(float(n)):return false
   if bounds[0]<0 or bounds[1]>8 or bounds[0]>=bounds[1]:return false
 return true
static func apply_track(plan:Dictionary,options:Dictionary,track:Dictionary,policy:Dictionary={})->Dictionary:
 if not _valid(track):return _unchanged(plan,'invalid-track')
 var profile=track.profiles.get(options.get('action'))
 if options.get('character')!=track.get('character') or options.get('direction')!=track.get('direction') or not options.get('outfit') in track.outfits or profile==null:return _unchanged(plan,'outside-reviewed-pose-family')
 if options.get('headStyle','original')!=track.get('headStyle') or _nonzero(options.get('angles')) or _nonzero(options.get('adjustments')):return _unchanged(plan,'unreviewed-head-or-adjustment')
 if options.get('equipment',{}).get('hand')!=profile.equipment:return _unchanged(plan,'unreviewed-equipment')
 if plan.get('effectiveAction')!=options.get('action'):return _unchanged(plan,'runtime-action-mismatch')
 var phase=options.get('phase')
 if not typeof(phase) in [TYPE_INT,TYPE_FLOAT] or not is_finite(float(phase)) or phase<0 or phase>=8:return _unchanged(plan,'unreviewed-phase')
 var head_id=options.get('equipment',{}).get('head','')
 if head_id and not head_id in policy.get('reviewedHeadEquipment',[]):return _unchanged(plan,'unreviewed-head-equipment')
 var behind=false
 for interval in profile.headOccludesWeapon:
  if phase>=interval[0] and phase<interval[1]:behind=true
 if not behind:return _unchanged(plan,'foreground-stroke')
 var group=[];var heads=[];var gear=[];var weapons=[];var commands=plan.commands.duplicate(false)
 for command in commands:
  if command.part=='head':heads.append(command);group.append(command)
  elif head_id and command.category=='equipment' and command.part==head_id:gear.append(command);group.append(command)
  if command.category=='equipment' and command.part==profile.equipment:weapons.append(command)
 if heads.size()!=1 or weapons.size()!=1 or (head_id and gear.size()!=1):return _unchanged(plan,'missing-or-ambiguous-declared-commands')
 if head_id and commands.find(heads[0])>commands.find(gear[0]):return _unchanged(plan,'unexpected-head-group-order')
 for command in group:commands.erase(command)
 var at=commands.find(weapons[0])+1
 for command in group:commands.insert(at,command);at+=1
 for command in commands:
  if command.get('underlap',false):continue
  if command.part=='handB' or (options.action=='hoe' and command.part=='handA'):
   if commands.find(command)<at:return _unchanged(plan,'unexpected-grip-palm-order')
 var result=plan.duplicate(false);result.commands=commands;result.occlusion={'applied':true,'profile':options.action,'phase':phase,'rule':'head-group-after-weapon-before-grip-palms' if head_id else 'head-after-weapon-before-grip-palms','headEquipment':head_id,'handMask':'unchanged-existing-palms'};return result
