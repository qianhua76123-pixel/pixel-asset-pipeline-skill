# V81 村民衣橱预览

这是本批 **三位新身份、六套独立衣装** 的正面可操作预览，真实素材已全部接入。

双击 `index.html` 即可离线打开。新页使用独立搭配存储键 `nancun-village-wardrobe-v81-look`。场景为896×512原生贴图，角色共用64格、脚点32/58与44像素站高标准。村院按1/2/3倍整数像素显示，近看为2/4/6倍。切换身份或衣服只变外观，不重启动作时钟。8个关键姿势与连续播放来自同一骨架求解，没有读取整身帧动画。

主页面只使用已接入的本批真实人物及衣服，支持衣装单独显示、原锚点透明衣装与逐片查看。原始PNG和骨点不被UI缩放规则改写；衣片网格可以固定截取局部后整数放大，导出仍保持64原坐标。骨线默认隐藏。衣色提供原色、靛蓝、苔绿；发色与肤色复用已有语义索引色板，五官与保护区不参与染色，换色同样保留动作进度。

`stable-four-directions/index.html` 是逐文件复制的冻结V69独立入口，包含既有四向村院和完整正面换装子页。本批新角色和新衣装只做正面，不能把这个链接理解为新身份已有四向资产。

## 导入真实包

```sh
node tools/import-package.cjs --character /绝对路径/package/character.json --check-only
node tools/import-package.cjs --outfit /绝对路径/package/outfit.json --check-only
node tools/import-package.cjs --character /绝对路径/package/character.json
node tools/import-package.cjs --outfit /绝对路径/package/outfit.json
```

修改已有包必须显式 `--replace`。工具校验来源SHA和模型结构，图片先准备、bundle最后原子写入；浏览器不引用外部绝对目录。`--check-only` 不写文件。来源记录留在 `source/packages` 与 `qa/import-receipts.json`。

角色包：`id/name/directions:['down']/attachments/replaceParts`，可含`appearance.files`或相对JSON路径、`defaultAppearance`。头与独立发片替换旧头/辫，保持整数平移；独立真实颈肤片可标 `headAnchored:true`。不凭颜色猜皮肤。

衣装包：`id/name/directions:['down']/parts/attachments`。每片保留真实`sourceBone/targetBone`或`bindJoint/pivot`，`garmentMask`包含全部布料与轮廓，`dyeMask`仅控制可染色区。纯肤片标`bodyOnly:true`或`contentRole:'skin'`。单独衣装模式排除共享头/发/手/鞋和肤片，并依显式garmentMask去掉夹带露肤。

## 给出图与QA调用

```js
const { load } = require('./tools/render.cjs');
const { renderer, manifest } = await load();
const result = renderer.render({
  character: manifest.defaults.character,
  outfit: manifest.defaults.outfit,
  action: 'walk', phase: 3.375,
  garmentOnly: false, canvasSize: 96
}); // result.pixels: RGBA, canvas/pose/commands/clippedPixels
```

CLI 可导出所有当前组合：

```sh
node tools/render.cjs --out qa/static
node tools/render.cjs --walk40 --out qa/walk
node tools/render.cjs --garment-only --size 64 --out qa/garments
```

Node工具使用本机 Pixel Studio 已有 sharp；浏览器运行无需Node或联网。`tools/test-adapter.cjs`仅使用内存中的旧参考fixture验证适配层，不导入、不显示占位村民。

## 边界

基础 `rig-engine.js`、`walk-stance.js` 复制自V69且不修改。内部仍用同一个heqing动作合同，外层把三个身份映射为头/发/颈贴片模型；新身份不是独立重画的一套动作。裙摆是跟随pelvis的刚性裁片，不是权重网格布料。当前不含未知方向、不含装备动作，也不宣称停步过渡或自然步态已经定稿。新头颈与六套领口的最终18组合和浏览器验收由任务根目录的报告记录；本运行层的机械验证不能替代美术定稿。

## 本运行层验证

- `qa/outfits/*.json`：六套新衣包原锚点穿衣/纯衣64图与源结果逐RGBA一致；衣料/染色mask不侵入声明肤区。参考旧头仅用于内存单包检查，未显示为新人物。
- `qa/appearance-validation.json`：3头各16发肤组合，features/protected逐RGBA不变、alpha不变；纯衣输出不随发肤选择变化。
- `qa/ui-state-validation.json`：19项真实app回调检查，暂停/播放时切3身份、6衣、颜色保留相位和时钟余量，失焦暂停。该测试为最小DOM中的真实渲染器测试，不是浏览器截图。
- `qa/baseline-copy.json`：冻结引擎及背景来源记录。原完整四向入口仍独立保留。

早期 `qa/first-real-*` 与 `qa/three-real-static*` 是首套衣装修正前的接入过程图，不能用于最终美术验收；最终展示位于上级 `presentation/`。
