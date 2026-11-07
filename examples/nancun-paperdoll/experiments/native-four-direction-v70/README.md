# 禾青 · 四向共骨与三款衣装 V70

把 V69 已冻结人物接到真正 Godot 骨节点：一棵 Skeleton2D、14 个身体 Bone2D 加 1 个独立 RigidPelvis、195 个独立 Sprite2D 裁片。四方向各用自身源绑定；换向、换上衣保留相位、时间和播放状态。默认原衣；石青只换上衣并保留原裤鞋；月白汉服按源激活整裙衣片并隐藏被替代的裤腿。三者共享身体动作。

## 启动与编辑

双击“启动四向共骨三衣.command”。使用已安装 Godot 4.6.2，先离线导入资源，再运行。也可在该版本编辑器打开 project.godot，运行 main.tscn。独立用户目录为 nancun-native-hanfu-four-directions-v70，不读取原游戏存档。

界面包含四方向、三衣、行走／呼吸待机、播放暂停、八关键相位、连续滑杆、中立站姿和骨线。拖动或点关键相位会暂停；切动作从零相开始并保留播放开关；失焦暂停。

four_view_actor.tscn 已保存真实骨树，15 骨和 195 Sprite 的 owner 都是 actor。所有 Sprite 直接挂在所属骨上，local 矩阵恒定；不是运行时临时造树或整身帧贴骨。编辑器可查看静态绑定和层级。运行中的 solver 会覆盖动态骨姿势，本版没有可持久化手动动作编辑器或 AnimationPlayer 动作轨。

## 动作合同

- 每向独立 bind、骨长、头原点和静态 local；不镜像冒充左右素材。
- scripts/continuous_pose.gd 移植冻结 V51/V69 的 S12 公式，只读 bind、参数及每向八个原始手臂世界关节 key；运行时不读 qa 采样表或整身图。
- 头与前辫相对各向 head bind 整像素平移；其它裁片按 sourceBone → targetBone 分解。宽度系数仅施加一次。鞋沿禾青实际分支，不误套旧 B sole 取整。
- 一个时间变量驱动动作。行走 800ms；待机沿原非均匀时长 [400,300,260,300,300,260,300,280]，总 2400ms。
- 源 64×64 原生坐标，加 (16,16) padding 到 96×96 视口，屏幕整数 5× 最近邻显示；静止人物保留原 44px 规格，不拉伸等高。

## 验证与证据

qa/export-audit.json：195 张 PNG 与 V69 源 SHA 精确一致，矩阵分解最大误差 2.84217e-14。qa/source-preservation.json 核对 V69 冻结文件无修改。

qa/logic-validation.json：33 项 headless 检查通过。四向各 128 walk + 5 idle，共 532 个参考；最大骨点误差 2.13163e-14，真实骨全局矩阵误差 1.57284e-5（Godot 浮点）。195 Sprite local 不变；换向／衣装保同一骨实例和时钟；非均匀 idle、回环、暂停、非法输入及实际 UI 信号通过。

qa/gpu-validation.json：35 项检查通过，180 个真实 GPU 样本覆盖四向三衣中立、八 key、选定连续半相和 idle。与独立 V69 最终指令平铺 Sprite 比较，全部 RGBA 逐字节一致，无画布边缘裁切。

V70 本次未另做独立代理复审；V68 基础合同的既有独立审查不能代称本次新增汉服已被独立审过。新增刚性裙骨有专门数值检查：人为 torsoAngle=25° 时仅 RigidPelvis 改变，14 身体骨及腿链保持。

presentation/four-directions-three-outfits-800ms.gif 是真实 12 视口 GPU 比较，40 个均匀相位、每帧 20ms，总 800ms；246 色全局调色板，解码 RGB 全部精确。qa/presentation.json 有哈希与时长；不用 10ms GIF。
另有 neutral-four-directions-three-outfits.png、三张四向八 key 图、native-four-directions-ui.png。UI 截图为自动捕获，不冒称手动 CUA 验收。

## 局限

仅原头、原色、三衣装、idle/S12 原地 walk；没有装备、染色、捏脸、世界移动、起停／转向过渡、碰撞或玩法。数学／GPU 与源一致不等于自然感改善：原侧向短腿团块、左右步形差及衣领扣袢候选状态仍保留。本次未绘画或生成新素材；三衣装由原版、日常上衣族和既有汉服候选组成。

## 复核

在项目目录使用已安装 Godot 4.6.2：

    /Users/qian/Applications/Godot-4.6.2.app/Contents/MacOS/Godot --headless --path . --editor --import --quit
    /Users/qian/Applications/Godot-4.6.2.app/Contents/MacOS/Godot --headless --path . --script tools/build_scene.gd
    /Users/qian/Applications/Godot-4.6.2.app/Contents/MacOS/Godot --headless --path . --script tools/validate.gd
    /Users/qian/Applications/Godot-4.6.2.app/Contents/MacOS/Godot --path . --script tools/validate.gd -- --gpu

build_scene 可仅用包内 data/rig.json 与 PNG 重建骨树。export-bones.cjs 是来源导出工具，重跑它需要相邻冻结 V69；正常启动、骨树重建与已有 QA 验证无需 V69 或网络。reference/v69-freeze.json 记录源；未修改 V68/V69 等冻结源。

美术来自项目既有自有流水线，没有引入第三方商业角色图包；本说明不另行授予美术资产公开再分发许可。Godot 应用未附在压缩包中。

## 汉服刚性裙骨

RigidPelvis 是 Pelvis 的独立子骨；动态 frame 为 R(torsoAngle) + pelvis，静态 local 只减一次各自原 pivot。正面沿 V29 原值 (32,48.5)，另外三向沿 V67 (32,48)。裙子不是腿链父节点，不拉长腿骨、不改变腿部姿势。当前 idle/S12 的 torsoAngle 为零，新增子骨保留正确独立变换合同。此为刚性裁片，不是 cloth、权重网格或自然裙摆模拟。

实际活动组来自 V69 customCommands/outfitParts，含自动加入的 shared 部件；没有把 outfit.parts 的 72 个 ID 当作全部渲染命令。195 张纹理中 149 张与 V68 原样一致，新增 46 张：V67 三向 30 张、V29 正面既有汉服 16 张。原头原色，没有并入脸型、染色或武器系统。
