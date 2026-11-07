# 禾青：Godot 原生骨节点持械试验 V66

本版把已验证的正面最终姿势，接到真正的 `Skeleton2D / Bone2D` 子树。衣片和装备都是原始独立 PNG，Sprite 的局部绑定为常量，动作每次只更新骨节点变换、可见性与最终绝对绘制顺序。不是把整身帧放到骨架上，也不是权重网格变形。

这是机制迁移验证：正面禾青、原衣装／石青日常／月白豆青汉服，共用待机、挥剑、挥锄。没有合入 S12 行走、四方向、换脸、染色、碰撞或伤害系统。挥锄的原动作仍为旧候选，事件里的 `impact-proposal` 不代表工具已经接触地面。

## 运行与编辑

双击 `启动骨节点持械演示.command`。它使用本机已有 Godot 4.6.2，先执行离线资源导入再启动。也可在 Godot 4.6.2 编辑器导入本目录 `project.godot`，运行 `main.tscn`。独立用户目录为 `nancun-native-bone-equipment-v66`，不读取原游戏存档。

在编辑器打开 `native_bone_actor.tscn` 可展开真实树：14 个身体骨＋刚性裙骨＋Grip／Head／Back 三个槽骨，共 18 个 Bone2D、71 个 Sprite2D。所有 Bone/Sprite 的 owner 都是根 actor。66 个身体／衣料 Sprite 挂所属骨；5 个装备 Sprite 的固定局部矩阵为 `Translate(-nativePivot)`。三衣共享同一套骨。

`tools/build_bone_actor.gd` 可从只含结构字段的 `data/body-bindings.json` 重建这个 PackedScene。运行端直接加载保存的场景；不是在 `_ready` 临时创建后宣称可编辑。运行中 solver 会覆盖动态骨变换，所以编辑器检查静态绑定与层级是可行的，手改动作骨后永久保留则还需要后续制作工具。本版不宣称已有可持久化的手动骨动画编辑器或 AnimationPlayer 动作资源。

界面可切三衣、头饰／背篓／剑锄、8 个关键姿势、连续／采样、骨线与遮挡候选。初始暂停。相容换衣／头饰保持时钟；单次动作换成不相容工具会显式取消，不发送完成。检查姿势不触发跳过的事件；应用失焦会暂停。画布 96×96，显示固定整数 5 倍；人物原生尺寸不缩放，padding `(16,16)` 只加一次，静止脚点 `(48,74)`。

## 已验证的范围

- 71 张 PNG 与源文件逐字节一致，未重绘、重编码或改变轮廓。
- 112 个实际 Godot GPU 对照：三衣×剑锄 8 关键姿势、分数相位、遮挡边界前／中／后，另含中立及木簪。真实骨树与独立 flat-final-plan 参考逐 RGBA **0 差异**；最大矩阵误差约 `1.9452e-5`，源于浮点层级计算。图像均非空、硬 alpha、96 格边缘透明。
- 保存／重新加载 PackedScene 后，18 骨、71 Sprite、owner、固定局部矩阵检查通过。上臂小角度编辑会带动同侧前臂，另一侧不动。
- 19 个实际 GDScript 控制器检查：同一时钟、换衣保相位、最终矩阵挂点、marker 查询不重复求姿势、旧事件拒绝、检查／暂停、开始／marker／取消／完成回调重入、完成恰一次等。
- 8 个真实 UI 信号检查。`presentation/native-ui.png` 是自动 GPU 截图，**不是人工 CUA 验收**。

完整数值在 `qa/gpu-baseline.json`、`qa/controller-checks.json`、`qa/ui-checks.json`。`presentation/flat-vs-bones.png` 是相同姿势并排；`sword-clean.gif`／`hoe-clean.gif` 是净画面，`*-bones.gif` 叠实际骨节点。GIF 来自实际骨树 GPU 输出，单帧最短不少于 20ms，GIF 时间按格式量化至 10ms；原采样时刻保存在 `qa/demo-render.json`。

## 数据与时钟

身体常量绑定采用源骨坐标逆变换；每帧 target frame 沿轴伸缩、法向保宽，再由父全局逆矩阵得到骨局部变换。汉服整裙显式绑定刚性 Pelvis 旋转骨。头／长辫沿用最终计划的整数平移，保持脸部像素；装备有独立槽骨来表达真实握点与工具角度，不能仅把装备刚性绑在前臂旋转上。

只使用一条 V46 ActionTimeline。marker 回调前先求并应用事件当刻的实际 renderPhase，再发布带 instance/time/phase 的最终挂点查询。换衣重绘可以复用同一时间；查询不重复 plan。预览不提供游戏 world 坐标，`world` 查询显式返回不支持，`rig-canvas / preview-canvas / actor-local` 使用原合同。

最终绘制顺序来自 V46 已审查的头／头饰保序组遮挡候选，写入所有可见 Sprite 的绝对 `z_index`。旧顺序可在 UI 切回。手柄深度仍是 2D 排序近似；刚性短肘与裙片没有布料模拟，遮挡改善不等于所有动作美术最终通过。

## 复现

```sh
godot-4.6.2 --headless --path . --editor --import
godot-4.6.2 --headless --path . --script res://tools/build_bone_actor.gd
godot-4.6.2 --headless --path . --script res://tools/controller_qa.gd
godot-4.6.2 --path . --script res://tools/baseline_qa.gd
godot-4.6.2 --path . --script res://tools/ui_qa.gd
godot-4.6.2 --path . --script res://tools/render_demo.gd
python3 tools/present.py
```

Python 展示工具需要 Pillow。`tools/source_audit.py` 用原冻结目录只读复核来源，不是运行依赖。软件和素材许可说明见 `LICENSES.md`。所有旧版本保持只读，本目录是独立候选，未替换游戏主角。
