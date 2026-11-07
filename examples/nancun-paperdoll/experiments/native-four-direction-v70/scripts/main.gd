extends Control
var actor
var overlay
var caption:Label
var phase_slider:HSlider
var direction_control:OptionButton
var outfit_control:OptionButton
var action_control:OptionButton
var overlay_control:CheckButton
var play_button:Button
var rest_button:Button
var key_buttons=[]
var preview_picture:TextureRect
func text(parent,value,size=18):
 var label=Label.new();label.text=value;label.add_theme_font_size_override('font_size',size);label.add_theme_color_override('font_color',Color('#453d33'));parent.add_child(label);return label
func button(parent,value,fn):
 var b=Button.new();b.text=value;b.pressed.connect(fn);parent.add_child(b);return b
func _ready():
 var margin=MarginContainer.new();margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
 for side in ['left','top','right','bottom']:margin.add_theme_constant_override('margin_'+side,20)
 add_child(margin)
 var col=VBoxContainer.new();col.add_theme_constant_override('separation',12);margin.add_child(col)
 text(col,'禾青 · 四向共骨，三款衣装',26)
 text(col,'同一套 14 身体骨 + 1 裙骨。转身与换衣接续当前动作；所有衣片使用原始像素。',16)
 var row=HBoxContainer.new();row.add_theme_constant_override('separation',28);col.add_child(row)
 var viewport=SubViewport.new();viewport.size=Vector2i(96,96);viewport.transparent_bg=true;viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS;viewport.canvas_item_default_texture_filter=Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST;add_child(viewport)
 actor=load('res://four_view_actor.tscn').instantiate();actor.position=Vector2(16,16);viewport.add_child(actor)
 preview_picture=TextureRect.new();preview_picture.size_flags_vertical=Control.SIZE_SHRINK_CENTER;preview_picture.size_flags_horizontal=Control.SIZE_SHRINK_BEGIN;preview_picture.texture=viewport.get_texture();preview_picture.texture_filter=CanvasItem.TEXTURE_FILTER_NEAREST;preview_picture.custom_minimum_size=Vector2(480,480);preview_picture.expand_mode=TextureRect.EXPAND_IGNORE_SIZE;row.add_child(preview_picture)
 overlay=load('res://scripts/bone_overlay.gd').new();overlay.actor=actor;overlay.z_index=1000;overlay.visible=false;viewport.add_child(overlay)
 var controls=VBoxContainer.new();controls.add_theme_constant_override('separation',6);row.add_child(controls)
 text(controls,'朝向',18);direction_control=OptionButton.new()
 for label in ['正面','向右','背面','向左']:direction_control.add_item(label)
 direction_control.item_selected.connect(func(i):actor.set_direction(actor.data.directions[i]));controls.add_child(direction_control)
 text(controls,'衣装（四向共用衣装族）',18);outfit_control=OptionButton.new()
 for item in actor.data.outfits:outfit_control.add_item(item.name)
 outfit_control.item_selected.connect(func(i):actor.select_outfit(actor.data.outfits[i].id));controls.add_child(outfit_control)
 text(controls,'动作',18);action_control=OptionButton.new();action_control.add_item('行走 · S12 连续');action_control.add_item('待机 · 呼吸')
 action_control.item_selected.connect(func(i):actor.set_action('walk' if i==0 else 'idle'));controls.add_child(action_control)
 var playrow=HBoxContainer.new();controls.add_child(playrow)
 play_button=button(playrow,'播放 / 暂停',func():actor.toggle_play())
 rest_button=button(playrow,'原图中立站姿',func():actor.rest_pose())
 text(controls,'动作相位（拖动即暂停）',16)
 phase_slider=HSlider.new();phase_slider.min_value=0;phase_slider.max_value=7.9375;phase_slider.step=.0625;phase_slider.custom_minimum_size.x=440;phase_slider.value_changed.connect(func(v):actor.seek_phase(v));controls.add_child(phase_slider)
 var keys=HBoxContainer.new();controls.add_child(keys)
 for k in 8:key_buttons.append(button(keys,str(k+1),func():actor.seek_key(k)))
 overlay_control=CheckButton.new();overlay_control.text='显示真实骨节点'
 for property in ['font_color','font_pressed_color','font_hover_color','font_hover_pressed_color']:overlay_control.add_theme_color_override(property,Color('#453d33'))
 overlay_control.toggled.connect(func(on):overlay.visible=on);controls.add_child(overlay_control)
 caption=text(controls,'',16)
 text(controls,'原色、原头。石青为上衣；汉服使用整裙。\n连续骨点由参数实时求解，未播放整身帧图。\n整裙刚性跟骨盆，不是布料模拟。',15)
 text(controls,'原地演示，未接世界起停、装备、染色、捏脸。\n运行时 solver 会覆盖手改骨姿势。',15)
 actor.seek_phase(0)
func _process(_delta):
 if is_instance_valid(actor) and caption:
  phase_slider.set_value_no_signal(actor.phase)
  caption.text='%s · 相位 %.4f / 8\n%s · %.3f s / %.1f s' % ['中立站姿' if actor.is_resting else ('行走' if actor.action=='walk' else '待机'),actor.phase,'播放中' if actor.playing else '暂停',actor.time_seconds,actor.period_seconds()]
