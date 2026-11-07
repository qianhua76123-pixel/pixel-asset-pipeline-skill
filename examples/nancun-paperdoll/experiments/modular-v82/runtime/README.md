# V82 发型、眼型、体型独立组合

入口 `index.html` 可离线双击。3种发型、3对眼型、2档体型与6套衣装分别选择，共108种基础组合；不再把原村民的整头作为唯一选择。眼睛按完整一对切换，不独立随机左右眼。固定使用本批平眉；“查看分层”可看到脸底、颈肤、成对眼睛、眉、前后发和身体衣片各自真实PNG。

服装原色/靛蓝/苔绿与发肤色板沿已有显式语义索引。五官和保护区RGBA不随染色改变。发型、眼型、体型、衣装、染色切换均保留当前相位与播放时钟。独立搭配键为 `nancun-modular-character-v82-look`，不会覆盖V81保存。

场景为原896×512村院；64原生人物画布、脚点中心32/58，静止44像素参考。场景整数1/2/3倍，近看整数2/4/6倍，禁止平滑采样。正面8关键姿势/连续播放由同一个骨架求解，未使用整身预渲染帧动画。

## 模块与遮挡

- 完整脸底来自本批独立真实源。脸与颈无损拆开，颈层25在衣领后，脸层80在衣领前；成对眼82、眉83、前发85，后发按素材声明层序。
- 所有头件复制脸底唯一的整数平移矩阵，没有眼睛单独浮动、旋转或缩放。每对眼的不透明图案左右相同，同向高光；透明角露出的是脸底原肤色，不把肤色当眼素材。
- 标准体型保留原绑定。宽实体型仅用已审的横向关节位置与逐片宽度参数，不缩放整个头或人物，不改sourceBone/原PNG。手鞋沿新关节移动，尺寸不变。
- 正常骨片的widthFactor只应用一次。三件刚性裙/围裙按显式rigidWidthFactor围绕原pelvis pivot横向适配，pivot映射保持不变。
- 独立衣装排除共享头、发、手、鞋和bodyOnly肤片；其余按显式garmentMask保留全部布料（包括墨线），不凭颜色猜露肤。

这仍是正面刚性裁片验证；裙子不是权重网格布料，没有增加新方向或武器。旧完整V81自含副本位于 `stable-v81/index.html`，其原有四向入口仍可从子页进入。V81原目录未改。

## 数据与出图

浏览器仅需本目录，无外部素材路径或联网依赖。`bundle-data.js`含真实PNG，`assets`保留原文件，`source/packages`及`qa/import-receipts.json`记录包来源SHA。

```sh
node tools/import-package.cjs --head /绝对路径/head-modules.json --check-only
node tools/import-package.cjs --bodies /绝对路径/body-profiles.json --check-only
# 正式导入去掉 --check-only；更新已有包显式加 --replace
```

Node读取接口：

```js
const {load} = require('./tools/render.cjs');
const {renderer,manifest} = await load();
const r = renderer.render({
  hairstyle:'short', eyes:'clear', body:'solid', outfit:'cream-indigo',
  action:'walk', phase:3.375, canvasSize:96,
  garmentOnly:false, appearance:{hair:'original',skin:'original'}
}); // RGBA pixels、commands、pose、selection、clippedPixels
const layers = renderer.layers(manifest.defaults); // 原锚点模块贴图与真实矩阵
```

`--hairstyle/--eyes/--body/--outfit`可选具体ID或all；`--walk40`输出40相，否则静止。Node出图工具使用本机Pixel Studio现有sharp；离线浏览器无需Node。

## 验证范围

`qa/module-validation.json`记录12主图来源SHA、3对眼源像素一致、192材质保护检查、48头件共矩阵、领口层序、裙pivot保持、标准体型6独立衣装与冻结V81逐RGBA一致。`qa/ui-state-validation.json`记录32项真实app回调检查；测试使用真实PNG和渲染器、最小DOM，不冒称浏览器实测。108组合与实机视觉验收由上级任务根目录的QA/展示记录。

基础 `rig-engine.js` 和 `walk-stance.js` 与冻结V81/V69保持字节不变；本次改动集中在模块适配器、数据入口与UI。
