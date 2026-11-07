# 共用骨架、衣装与体型：官方资料核对

核对日期：2026-11-06。这里只记录官方工具的公开机制，不推断某款未公开源码游戏的内部实现。没有购买、下载或打包第三方美术。

## 已核实的外部做法

1. **Spine Skins**：换装使用slot下的skin placeholder，由不同skin提供attachment；动画引用占位而非绑死某件衣服。Skin可包含自己的骨骼和约束。因此“动作共用”和“衣服有专用骨骼”可以并存。来源：[官方Skins指南](https://esotericsoftware.com/spine-skins)。
2. **Spine Mix-and-match**：官方示例把发型、裤子、包等作为单独skin组合；长裙上部绑定躯干，下部使用跟随腿部的专用骨骼/约束；披风和背包有各自分片、挂点和权重。该示例是非像素画，用来学习结构，不能直接证明44px下变形的视觉质量。来源：[官方示例](https://esotericsoftware.com/spine-examples-mix-and-match)。
3. **体型不是整张贴图横向拉伸**：Spine官方比例示例调整臀部位置、四肢约束并处理约束顺序，每个比例变体有自己的skin/constraints，再与衣装skin组合。来源：[官方比例教程](https://esotericsoftware.com/blog/Skin-constraints-for-different-proportions)。
4. **Godot允许混合动画**：cutout部件运动可以与AnimatedSprite2D局部换图结合，官方举例为手、脚、表情等复杂部分；无需把所有内容都做成一张整人序列。来源：[Cutout animation](https://docs.godotengine.org/en/stable/tutorials/animation/cutout_animation.html)。
5. **网格形变仍需绑定与修形**：Godot 2D skeleton教程要求配置权重，并说明三角形布局可能导致不符合预期的弯折，需要内部顶点与重新权重。来源：[2D skeletons](https://docs.godotengine.org/en/stable/tutorials/animation/2d_skeletons.html)。官方stable页当前提示部分内容尚未更新至4.7；本轮仅引用其工作原理，未升级项目引擎或验证新API。

## 对南乡的建议（设计判断，不是外部事实）

保留真实共用骨架、动作时钟和装备挂点；眼睛/脸部尽量保持原生像素簇；手脚、侧向头部、衣领以及裙摆允许方向或姿势专用片。所谓遮罩要分清：染色mask负责哪些像素能改色；遮挡mask负责隐藏底层身体；骨骼权重决定如何运动；方向/姿势专用片负责二维图片中本来不存在的侧面及弯折形状。一张遮罩无法同时提供这些信息。

V82已经具备附件、染色mask、源绑定和体型offset，缺的是统一设计的五官/发际线适配、每方向外观变体以及衣服弯折与遮挡规则。八个独特姿势或108种可组合结果只能证明组合逻辑，不能证明这些结果自然耐看。

建议先保留1个体型、2个发型、2个眼型、1件短上衣与1件裙装，做正/侧/背同尺度的造型验收，再做4方向各8关键帧与装备动作。技术粒度可细，玩家选项应是经过搭配验证的整体眼型/发型；无需把每个眼白或瞳孔都独立暴露。
