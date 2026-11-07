extends SceneTree
var checks=[]
func check(name,ok):checks.append({'name':name,'ok':ok})
func _initialize():call_deferred('run')
func run():
 var demo=load('res://main.tscn').instantiate();root.add_child(demo);await process_frame
 var c=demo.control;c.set_process(false)
 demo.action_choice.item_selected.emit(2);check('choose-hoe-auto-hand',c.action=='hoe' and c.equipment.hand=='wood-hoe')
 demo.key_buttons[4].pressed.emit();check('key-five-pauses',c.phase==4 and not c.playing)
 demo.outfit_choice.item_selected.emit(2);check('outfit-keeps-key',c.outfit=='moon-celadon-hanfu' and c.phase==4)
 demo.head_choice.item_selected.emit(2);demo.basket.toggled.emit(true);check('head-and-back-slots',c.equipment.head=='straw-hat' and c.equipment.back=='back-basket')
 demo.play.pressed.emit();check('play-button',c.playing)
 c._advance_action_clock(75);demo.play.pressed.emit();var phase=c.phase;check('pause-button-fractional',not c.playing and phase>4)
 demo.hand_choice.item_selected.emit(1);check('tool-incompatibility-ui-reset',c.action=='idle' and c.phase==0 and demo.action_choice.get_item_metadata(demo.action_choice.selected)=='idle')
 demo.action_choice.item_selected.emit(1);demo.slider.value=3.37;check('slider-inspects-same-clock',not c.playing and abs(c.phase-3.37)<.0001)
 # Visible proof state: same scene users launch, no synthetic UI.
 demo.action_choice.item_selected.emit(2);demo.key_buttons[4].pressed.emit();demo.lines.button_pressed=true;demo.sync()
 if not '--logic-only' in OS.get_cmdline_user_args():
  await process_frame;await RenderingServer.frame_post_draw
  root.get_texture().get_image().save_png('res://presentation/native-ui.png')
 var bad=checks.filter(func(x):return not x.ok).size();FileAccess.open('res://qa/ui-checks.json',FileAccess.WRITE).store_string(JSON.stringify({'checks':checks,'failures':bad,'mode':'real-control-signals; screenshot GPU; not human CUA'},'  '));print('UI checks ',checks.size(),', failures ',bad);quit(1 if bad else 0)
