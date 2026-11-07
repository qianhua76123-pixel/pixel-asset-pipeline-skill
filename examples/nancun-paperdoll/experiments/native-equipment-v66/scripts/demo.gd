extends Control
const Controller=preload('res://scripts/controller.gd')
var control
var actor
var overlay
var view
var status:Label
var notice:Label
var log_label:Label
var play:Button
var slider:HSlider
var outfit_choice:OptionButton
var action_choice:OptionButton
var head_choice:OptionButton
var hand_choice:OptionButton
var basket:CheckButton
var key_buttons=[]
var lines:CheckButton
var events=[]
var starts=0
var ends=0
var cancels=0
var syncing=false
func label(text:String,size=16)->Label:
 var l=Label.new();l.text=text;l.add_theme_font_size_override('font_size',size);l.add_theme_color_override('font_color',Color('#3f443b'));return l
func button(text:String,callback:Callable)->Button:
 var b=Button.new();b.text=text;b.custom_minimum_size.y=38;b.pressed.connect(callback);return b
func option(parent:VBoxContainer,title:String,items:Array,callback:Callable)->OptionButton:
 parent.add_child(label(title,16));var o=OptionButton.new();o.custom_minimum_size.y=38
 for item in items:o.add_item(item[1]);o.set_item_metadata(o.item_count-1,item[0])
 o.item_selected.connect(func(i):
  if not syncing:callback.call(o.get_item_metadata(i)))
 parent.add_child(o);return o
func _ready():
 var theme=Theme.new();var font=SystemFont.new();font.font_names=['PingFang SC','Heiti SC'];theme.default_font=font;theme.default_font_size=16;theme.set_color('font_color','CheckButton',Color('#3f443b'));theme.set_color('font_pressed_color','CheckButton',Color('#245c55'));set_theme(theme)
 var bg=ColorRect.new();bg.color=Color('#ece7d7');bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT);add_child(bg)
 var margin=MarginContainer.new();margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
 for side in ['left','right','top','bottom']:margin.add_theme_constant_override('margin_'+side,24)
 add_child(margin);var page=VBoxContainer.new();page.add_theme_constant_override('separation',12);margin.add_child(page)
 page.add_child(label('禾青 · 原生骨节点持械试验',26));page.add_child(label('18 个真实 Bone2D · 三衣共骨架 · 仅正面 / 原色。标记为动作请求，不是碰撞或伤害。',16))
 var row=HBoxContainer.new();row.add_theme_constant_override('separation',26);page.add_child(row)
 var left=VBoxContainer.new();row.add_child(left)
 var frame=Control.new();frame.custom_minimum_size=Vector2(480,480);left.add_child(frame)
 var paper=ColorRect.new();paper.color=Color('#f5f0e2');paper.size=Vector2(480,480);frame.add_child(paper)
 view=SubViewport.new();view.size=Vector2i(96,96);view.transparent_bg=true;view.disable_3d=true;view.render_target_update_mode=SubViewport.UPDATE_ALWAYS;view.canvas_item_default_texture_filter=Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST;add_child(view)
 actor=load('res://native_bone_actor.tscn').instantiate();view.add_child(actor);actor.position=Vector2(16,16)
 overlay=load('res://scripts/bone_overlay.gd').new();overlay.actor=actor;overlay.z_index=1000;overlay.visible=false;actor.add_child(overlay)
 var screen=TextureRect.new();screen.texture=view.get_texture();screen.texture_filter=CanvasItem.TEXTURE_FILTER_NEAREST;screen.size=Vector2(480,480);frame.add_child(screen)
 left.add_child(label('96×96 动作画布 · 整数 5 倍显示\n人物站高 44 像素；脚点 (48,74)，padding 只加一次。',15))
 var right=VBoxContainer.new();right.add_theme_constant_override('separation',6);right.custom_minimum_size.x=500;row.add_child(right)
 outfit_choice=option(right,'衣装（切换保持动作时钟）',[['original','原衣装'],['stone-blue-daily','石青日常'],['moon-celadon-hanfu','月白豆青汉服']],func(value):control.set_outfit(value))
 action_choice=option(right,'动作',[['idle','待机'],['sword','挥剑 · 单次'],['hoe','挥锄 · 单次']],func(value):control.set_action(value))
 var equipment_row=HBoxContainer.new();equipment_row.add_theme_constant_override('separation',12);right.add_child(equipment_row)
 var hcol=VBoxContainer.new();hcol.size_flags_horizontal=Control.SIZE_EXPAND_FILL;equipment_row.add_child(hcol)
 var wcol=VBoxContainer.new();wcol.size_flags_horizontal=Control.SIZE_EXPAND_FILL;equipment_row.add_child(wcol)
 head_choice=option(hcol,'头饰',[['','无头饰'],['hairpin','木簪'],['straw-hat','斗笠']],func(value):control.set_equipment('head',value))
 hand_choice=option(wcol,'手持',[['','空手'],['iron-sword','铁剑'],['wood-hoe','木锄']],func(value):control.set_equipment('hand',value))
 basket=CheckButton.new();basket.text='背篓';basket.toggled.connect(func(v):
  if not syncing:control.set_equipment('back','back-basket' if v else ''))
 right.add_child(basket)
 var playback=HBoxContainer.new();right.add_child(playback);play=button('播放',func():control.toggle_play());play.size_flags_horizontal=Control.SIZE_EXPAND_FILL;playback.add_child(play)
 var continuous=CheckButton.new();continuous.text='连续骨角';continuous.button_pressed=true;continuous.toggled.connect(func(v):control.set_continuous(v));playback.add_child(continuous)
 slider=HSlider.new();slider.min_value=0;slider.max_value=7;slider.step=.01;slider.custom_minimum_size.y=28;slider.value_changed.connect(func(v):
  if not syncing:control.inspect_phase(v))
 right.add_child(slider)
 var keyrow=HBoxContainer.new();right.add_child(keyrow)
 for i in 8:
  var b=button(str(i+1),func():control._inspect_key(i));b.size_flags_horizontal=Control.SIZE_EXPAND_FILL;keyrow.add_child(b);key_buttons.append(b)
 var checks=HBoxContainer.new();right.add_child(checks)
 lines=CheckButton.new();lines.text='查看骨节点';lines.toggled.connect(func(v):overlay.visible=v;overlay.queue_redraw());checks.add_child(lines)
 var order=CheckButton.new();order.text='遮挡候选';order.button_pressed=true;order.toggled.connect(func(v):control.set_occlusion(v));checks.add_child(order)
 status=label('',15);right.add_child(status);notice=label('',14);notice.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART;notice.custom_minimum_size.y=40;right.add_child(notice)
 log_label=label('',14);page.add_child(log_label)
 control=Controller.new();add_child(control);control.updated.connect(sync)
 control.action_started.connect(func(a):starts+=1;record('开始 '+a))
 control.action_cancelled.connect(func(a):cancels+=1;record('取消 '+a))
 control.action_finished.connect(func(a):ends+=1;record('完成 '+a))
 control.action_marker.connect(func(e):record('%s @ %.0fms / render %.3f'%[e.markerId,e.elapsedMs,e.visualContext.renderPhase]))
 var result=control.initialize(actor)
 if not result.ok:notice.text='初始化失败：'+str(result);set_process(false)
 sync()
func record(text:String):
 events.append(text)
 if events.size()>4:events.pop_front()
 sync()
func select_value(choice:OptionButton,value:String):
 for i in choice.item_count:
  if choice.get_item_metadata(i)==value:choice.select(i);return
func sync():
 if not is_instance_valid(control) or control.current_plan.is_empty():return
 syncing=true
 select_value(outfit_choice,control.outfit);select_value(action_choice,control.action);select_value(head_choice,control.equipment.head);select_value(hand_choice,control.equipment.hand)
 basket.button_pressed=control.equipment.back!='';slider.value=control.phase;play.text='暂停' if control.playing else ('重新播放' if control.completion_emitted else '播放')
 status.text='关键姿势 %.2f / 8　时钟 %.0f ms　%s\n开始 %d · 完成 %d · 取消 %d'%[control.phase+1,control.time_ms,'播放中' if control.playing else '暂停 / 检查',starts,ends,cancels]
 notice.text='改手持会取消不相容的单次动作。裙摆为刚性裁片；动作与遮挡仍是试验，不代表战斗完成。'
 log_label.text='事件（同一播放时钟，不判定命中）：\n'+'  ｜  '.join(events)
 overlay.queue_redraw();syncing=false
