# 外部纸娃娃做法与南乡下一轮方向

调研日：2026-11-06。结论：应继续保留真实部件和共用动作，但停止把“拆得更多、组合更多”当成造型质量提升。V82已解决左右眼源像素不一致，最新整个人物外观仍未获认可。

## 外部实际怎么做

| 可核实案例 | 公开机制 | 南乡值得借用的部分 |
| --- | --- | --- |
| [Universal LPC](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/master/ARCHITECTURE.md) | 按body type筛选适用选项，以层级合成同方向/帧的部件 | 衣物兼容表、统一注册点；部件有自己的帧图，不必为所有搭配重做整人 |
| [FashionSense](https://github.com/Floogen/FashionSense/wiki/Creating-a-Shirt-Content-Pack) | 衣装按正背左右独立描述，配帧同步与肤色/衣料mask | 明确缺失方向；袖口、露肤和底层身体遮挡独立处理。这是模组框架，不是星露谷本体内部实现证明 |
| [RPG Maker MZ](https://store.rpgmakerofficial.com/products/character-generator-pack-mz) | 作者生成器部件按前后发、眼眉、服装及人物家族组织 | 脸部小件先适配同一母版；官方地图三图案规范不作为我们八帧目标上限 |
| [Spine Mix-and-match](https://esotericsoftware.com/spine-examples-mix-and-match) | 共用骨架/skin槽位，长裙和披风可有专用骨骼、约束及网格 | 主体动作复用，衣服形状与次级运动仍要制作。示例为非像素美术，不能直接保证44px效果 |
| [Godot Cutout](https://docs.godotengine.org/en/stable/tutorials/animation/cutout_animation.html) | 部件变换与手脚/表情局部帧动画可以混用 | 保留真骨架，同时允许局部姿势图修正像素轮廓 |

详细证据、许可和推断边界见[技术研究](research-technical.md)与[官方骨架机制研究](research-rigging.md)。人物现状的具体可见问题和作者美术案例见[美术审查](research-art.md)。没有引入外部角色图片作为生产素材。

## 当前“怪”的原因：本项目判断

眼睛配对相同只是局部修复。V82将旧发型、共用新脸底、三个眼型和固定眉毛拼在一起，眼眉/刘海/嘴的视觉权重没有统一设计；宽实体型扩大肩胯与衣片，却没有相应精修肩颈和衣褶。静止及动作中肩袖、裤脚、裙腿的形状仍可能显拼贴。以上是候选诊断，不能以技术测试代替最终观感判断。

## 下一轮的最小验证

1. 固定44px与中国乡村场景，用**1发型×1眼型×标准体×2领口**检查整张人物。先处理眼眉间距、嘴部明度、发际线与颈肩，不继续批量扩款。
2. 这张母版观感成立后，加到2发型×2眼型，验证刘海遮眉、肤色与不同领口的兼容；体型变化有对应轮廓，避免把放宽旧片当成画好宽体型。
3. 同一角色做正/侧/背，然后完成四方向各8关键姿势。共用骨架保留，但手脚、领口、侧脸与裙摆允许独立替代片；修正片与染色mask、源绑定一起发布。
4. 最后扩衣装、饰品与工具。进入生产前需要兼容字段：body、direction、action、expression、occludes、anchor以及版本。不支持的组合明确禁用或回退。

这里是研究方案，尚未生成新的美术、修改V82运行时或完成三套原型整合。
