# V83：小尺寸像素纸娃娃的实际分层机制

实际访问：2026-11-06，America/Los_Angeles。范围：Universal LPC、FashionSense、RPG Maker MZ 的原作者仓库、作者文档和官方规格。没有购买或下载商业素材，没有修改运行时或 Git。本文将可核实事实、由资料作出的判断、对本项目的建议分开。

## 先回答架构问题

**逐帧分层仍是真正的换装机制。** 可以让身体、头发、上衣、裤子各自拥有对齐的方向／动作帧，运行时选择同一帧并叠合；换上衣只替换上衣帧图，不必为每一种头发×衣裤组合重新画完整人物。也可以在导出时合成为整人图集。这两个时点不同，不能把“工具导出整人 PNG”误认为“素材必须按每套完整人物制作”。ULPC 明确保留独立选项、分层绘制和按物件拆分导出；FashionSense 则直接给穿戴件定义运行时的方向、帧和同步规则。[ULPC 生成器](https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/)、[ULPC 渲染架构](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/master/ARCHITECTURE.md)、[FashionSense 动画属性](https://github.com/Floogen/FashionSense/wiki/Animation-Properties)

这些证据不支持“画完一副骨架，再画遮罩，就能自动得到所有衣服和体型”。骨架解决运动关系，染色遮罩解决颜色归属，身体隐藏规则解决遮挡；领口形状、袖长、裤裆与裙摆轮廓仍须有对应的美术内容。当前 V82 的问题不能仅由“更多独立选项”解决。

## 三个可核实的实现

### 1. Universal LPC：身体类型筛选＋逐帧图层合成

**事实。** 官方架构说明：遍历每个选项的 `layer_1` 至 `layer_9`，排除 `meta.required` 不支持当前身体类型的选项，按 `zPos` 排序，再载入图片、调色和合成。它是对已有像素图层进行组合；这条已公开渲染路径不是用骨骼把一件衣服自动变形成任意身体。[架构正文](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/master/ARCHITECTURE.md)

**事实。** 当前工具把 Body、Head、Hair、Headwear、Arms、Torso、Legs、Feet 等分开；身体类型包含 Male、Female、Teen、Child、Muscular、Pregnant。可导出选择 JSON，以及按动画、物件、动画＋物件拆开的 ZIP。身体类型作为可选项，并不保证每件衣服覆盖全部身体与动作。[官方生成器](https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/)

**事实。** 作者工具说明提供头部参考点图，供头、脸部附件、帽与头发分配到各帧，并使用偏移和遮罩；新增动作也需要支持该行的身体等源图。脸部表情的帧映射属于资产制作工作，不是任意贴上两颗眼睛就自动完成。[制作工具说明](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/master/tools/README.md)、[贡献规范](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/master/CONTRIBUTING.md)

**对南乡的判断。** 最值得借用的是“身体模板＋明确兼容表＋统一帧注册”，不是照搬 LPC 比例或古典装备画风。LPC 标准画布为 64×64，不代表其可见身高与我们的 44px 相同；其不同衍生基底也有尚未补齐的资产。[项目 README](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/master/README.md)

### 2. FashionSense：穿戴件各自帧图＋方向定位＋同步

**事实。** 这是 Stardew Valley 的模组框架，不能当作星露谷本体内部实现的官方披露。它的穿戴类别含身体、发型、帽、上衣、袖、裤、鞋及饰物。上衣包使用独立 `shirt.png`／`shirt.json`；`FrontShirt`、`BackShirt`、`LeftShirt`、`RightShirt` 分别描述方向，至少一个方向即可有效，每个已提供方向都有位置和尺寸。这明确允许“只有正面”的内容，而不是默认假设四向齐全。[作者 Wiki](https://github.com/Floogen/FashionSense/wiki)、[制作上衣包](https://github.com/Floogen/FashionSense/wiki/Creating-a-Shirt-Content-Pack)

**事实。** 动画 `Frame` 选取横向图块，位置计算为起点加尺寸乘帧号；可用毫秒时长，也可在母体 farmer 帧变化时推进。`AppearanceSyncing` 能让鞋与裤等部件同步。这里公开的是帧选择与偏移合同，不是骨骼蒙皮自动适配。[动画属性](https://github.com/Floogen/FashionSense/wiki/Animation-Properties)、[部件同步](https://github.com/Floogen/FashionSense/wiki/Appearance-Syncing)

**事实。** 身体模型独立定义头／衣／臂／腿／鞋的偏移，眼睛和眨眼底图的位置；上衣有隐藏母体、隐藏袖子及袖色规则。露肤使用 `SkinToneMasks` 的亮／中／暗色映射，和衣物 `ColorMasks` 分开。尺寸与偏移可配置，不等于任意身体宽度会自动重画全部衣服。[身体模型](https://github.com/Floogen/FashionSense/wiki/Body-Model-Properties)、[上衣模型](https://github.com/Floogen/FashionSense/wiki/Shirt-Model-Properties)、[肤色遮罩](https://github.com/Floogen/FashionSense/wiki/Skin-Tone-Masks-Property)

**对南乡的判断。** V82 的共时钟、独立肤色／衣料遮罩方向正确；下一步要增加的是每种外形的适配证明。同步能避免裤脚和鞋的时序错位，不能修复领口挤头、宽肩后像素团块或不合适的眼线。

### 3. RPG Maker MZ：可证明部件目录与输出规范，内部算法仍有限

**事实。** Gotcha Gotcha Games 的官方生成器部件包明确分别列出前发、后发、眼睛、眉毛、服装、披风和饰物，并按 Male／Female／Child 列不同数量。它证明生成内容按类别和人物家族组织；不能由商品目录推断每个选项都在所有输出类型中拥有独立层。[官方生成器部件包](https://store.rpgmakerofficial.com/products/character-generator-pack-mz)

**事实。** MZ 地图人物规格为四方向、每方向三个图案，常规每格 48×48，但尺寸可变；菜单／对话头像是独立的 144×144 图像。地图小人和大头像并非同一套像素预算。官方输出规格能证明使用离散图帧，不能单凭它断言生成器内部有／没有骨骼，也不能推出地图眼睛具有任意表情动画。[官方 Asset Standards](https://rpgmakerofficial.com/product/MZ_help-en/01_11_01.html)

**对南乡的判断。** 可借用前后发分层与人物家族分类。不要把大头像的眼眉细节直接压成 44px 人物的可替换小块；小人眼睛必须以同一脸框、眼线和遮挡条件制作。

## V82 当前能证明什么，不能证明什么

本轮重新读取了 [V82 体型说明](../../experiments/modular-v82/body/README.md)。以下是本地实现记录，不是外部行业事实，也不是重新进行的视觉验收：

| V82 当前实现 | 实际边界 |
|---|---|
| 肩距 9.5→11.5px、胯距 6→8px；左右肢链外移 1px | 是真实骨点变化，但不自动产生新的肩颈、胸腰或裤裆画法 |
| 躯干宽 1.20、袖／裤腿 1.10、刚性裙 1.18 | 使用现有源片最近邻放宽，会改变像素团块和线条厚度；不是为宽体型绘制的表面 |
| 原头眼不缩放、静态仍 44px、共用动作时钟 | 尺寸和同步成立，不代表头身关系与五官风格已经好看 |
| 492 次渲染零裁切、标准档源图精确、没有新增接缝断开 | 是结构验证；不能代替轮廓、肩领、眼神和步态的美术验收 |
| 半裙部分相位仍继承裙边与 B 小腿不四邻接；裙片刚性 | 尚非自然布料，也没有证明所有裙腿遮挡已完成 |

用户最新认为 V82 仍怪，因此不能继续把此前局部体型差异确认写成整套外观已被接受。现有验证保留为技术证据，美术状态应按最新反馈标为待改。

## 建议：保留可用结构，先修制作标准

以下是面向本项目的建议，不是声称上述案例采用同一种内部架构。

1. **先批准一个母体的整体轮廓。** 保持 44px、同脚底；用一件简单日常上衣验证脸框、头发外轮廓、颈口、肩线、腰胯和裤缝。标准／宽实仅保留两个明确档位。宽实需要对应局部轮廓修正时应有真实画稿，不能把“继续放宽源片”当默认解决办法。
2. **把兼容条件写成内容规则。** 每件资产声明支持的身体、方向、动作、表情／眨眼状态与遮挡关系。没有侧脸眼睛或某体型袖片时明确不支持或回退，不自动镜像、缩宽并宣称完成。前后发、脸底、眼睛可独立，但眼线、脸框和发际线要共享注册点。
3. **允许骨骼与像素帧修正并存。** 保留真实骨架和动作时钟；肩帽、领口、短裤裆、裙腿遮挡等易坏区域，可制作少量姿态替代附件或分层修正帧。主片、补片、肤色／衣料遮罩及 sourceBone 必须成组替换。无新局部图时明确是待制作，不能拿旧片继续变形冒充新的美术适配。
4. **维持四类语义分离。** 衣服全轮廓 alpha 决定衣物形状；衣料染色 mask 只改衣色；肤色 mask 只改露肤；身体隐藏／遮挡规则控制底层可见性。单一“衣服遮罩”不能承担四件事。既有纯衣输出与肤色保护可继续复用。
5. **做一个有判别力的小对照，再扩组合。** 同一母体、同一件衣、同一方向和八个动作时点，对照纯裁片旋转与少量像素修正后的分层结果，检查原生 1×／4×。只统计修正成本、明显接缝、线宽跳动与关键轮廓；不以组合数量、帧数或零裁切替代“好看”。批准后再扩到六衣和四向。

这条路线不要求推翻已有真实骨架，也不要求为每种发型与衣裤组合重做完整人物。要补的是**可复用部件自身的美术适配内容**。

## 使用边界

ULPC 的程序 LICENSE 为 GPLv3，图像许可按具体文件和 credits 分别核对；不能把程序开源视作每张图都无条件可用。[软件 LICENSE](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/master/LICENSE)、[素材说明](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/blob/master/README.md)

FashionSense 框架 LICENSE 为 GPLv3，第三方内容包的素材权利不能由框架许可代替。[框架 LICENSE](https://github.com/Floogen/FashionSense/blob/development/LICENSE)

本文引用的特定 RPG Maker 官方部件包允许商用和编辑，但限定 RPG Maker MZ；这不是可以移入 Godot 的素材许可，也不代表其他商品具有相同条款。[该包条款](https://store.rpgmakerofficial.com/products/character-generator-pack-mz)

本次仅研究公开机制，没有将上述外部人物或衣服作为南乡的生产素材。
