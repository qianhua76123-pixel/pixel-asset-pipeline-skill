# V82 标准 / 宽实：共动作体型注册

这两个档位修改真实目标骨点和逐片衣物宽度，不横向缩放整个人。标准档保留 V81 原样；宽实档改变肩、腰和胯，头、眼、身高以及动作时间不变。仅正面，两档，配六套现有衣装；未增加 AI 生成、身高滑杆或新身体表面画稿。

`package/body-profiles.json` 是运行端合同。`src/body-profile.js` 提供独立参考实现，`package/source-attachments.json` 列出 106 个适配附件的实际源文件、SHA、sourceBone/targetBone 与 override。源 PNG、sourceBone、衣料/肤色 mask 都未改变，不复制整身帧做运行资源。

## 参数与应用

| 项目 | 标准 | 宽实 |
|---|---:|---:|
| 肩骨点间距 | 9.5px | 11.5px |
| 胯骨点间距 | 6px | 8px |
| 左右肩臂链 | 原坐标 | 各向外移 1px |
| 左右胯腿链及脚 | 原坐标 | 各向外移 1px |
| 躯干/腰片法向宽度 | 1 | 1.20 |
| 袖/裤腿法向宽度 | 1 | 1.10 |
| 刚性裙横宽 | 1 | 1.18 |
| 头眼、手鞋自身缩放 | 无 | 无 |

头、颈、骨盆中心、root 坐标保留；脚底 y58、左右中心 x32 保留。肩肘腕和胯膝踝趾整条链平移，因此臂腿段长不变。身体 y37–55 的实际像素包络由 17px 变为 19px；头的 21px 宽度未变，两档静态均为实高 44px。

运行端先克隆 character 并替换 `bindPoses.down`，再对各附件应用 `widthFactor`。原 `E.boneMatrix` 只在源骨法向施加一次宽度，不再对整图或最终全局 X 缩放。

三个刚性裙/围裙附件没有 sourceBone，原引擎不会读取 widthFactor；它们用独立 `rigidWidthFactor`。在最终 command 上计算：

```text
M' = M · Translate(sourcePivot) · Scale(f, 1) · Translate(-sourcePivot)
```

这样 source pivot 仍映射到当前 pose.pelvis，腿链不动。衣图、衣料 mask、肤色 mask 必须使用同一最终矩阵。不能把 `widthFactor` 与 `rigidWidthFactor` 同时应用到一个片。参考模块不修改输入 character、plan 或时钟。

## 实际证据

- `presentation/body-neutral-1x4x.png`：六衣标准/宽实，真实 1× 与 4×。
- `presentation/<outfit>/eight-keys-4x.png`：两体型的八关键姿势。
- `presentation/body-six-outfits-walk.gif`：同一 S12 相位的十二个实际角色，40 个均匀样本、800ms、延迟至少 20ms，124 色，逐时间样本 decoded RGB exact。
- 各体型目录保留 64px 原生站姿和 40 个真实裁片渲染 PNG，`commands.json` 给实际骨点与矩阵。

`qa/body-render-proof.json`：12 个站姿 + 480 个 S12 样本，492 次渲染，零裁切。标准六套站姿与 V81 穿着 PNG 逐 RGBA 一致。40 相位下全部关节 Y 与 head/hairFront 矩阵在两体型之间完全相同；臂腿链长度保留，刚性裙 pivot 映射保留，sourceBone 与 PNG 保留。

同一批实际栅格检查肩袖、袖腕及裤装腰胯连接：宽实档没有新增断开，肩袖/腕手/裤装胯腿始终有四邻接或重叠像素。浅藕半裙继承 V81 刚性裙与小腿结构，少数相位裙边与 B 小腿没有四邻接接触；标准也如此，不能称已解决所有裙腿遮挡或自然布料。

`qa/profile-contract.json` 的 7 个定向检查覆盖：标准精确不变、source 不被修改、未知附件、非有限骨点、双重缩放、把 rigid 注册用于手臂、重入读取不修改旧计划。

## 限制

这是局部裁片注册的两体型候选，不是新绘制的胖瘦解剖表面，也不是网格肌肉/布料变形。最近邻放宽会复制局部源像素，细节仍受 44px 预算限制。没有修改腿长、S12 的 stride12 / 800ms、移动速度、动作时钟或其它冻结版本。新发型/眼睛/脸与两体型的组合验收由 V82 运行端另外完成，本报告不冒称浏览器或 Godot 验收。

本地复现只读取冻结来源：

```sh
node tools/build-profiles.cjs
node tools/check-profile-contract.cjs
node tools/render-body-study.cjs
python3 tools/present-body-study.py
```
