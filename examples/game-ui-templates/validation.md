# 验证记录与当前效果

[返回总览](README.md)。记录日期：2026-11-08。验证范围是研究资料、模板规范、软件交互和便携简报，不是12套新UI美术验收。

## 已有证据

| 层次 | 检查内容 | 已确认结果 | 证据边界 |
|---|---|---|---|
| 图源 | 官方远程截图与原始来源逐项核对 | 15项用途记录，10款游戏，14张独立图 | 不等于实机操作这些游戏 |
| 研究 | 事实、布局、交互证据、迁移与局限 | 每项独立记录；Moonlighter加工服务重复用途已说明 | 静图推断仍标为未验证 |
| 模板 | 四类各三套，唯一ID、不同布局、尺寸比例 | 共12套；原有64项内容保留，总76项 | 不等于生成质量已达标 |
| 编译 | 用户主体保留、uiPreset持久、通用规则合并 | 软件真实编译函数导出两种背景结果 | 模型不保证遵守全部规则 |
| 边界 | 未知ID、冲突布局、过小画布、比例不符 | 在生成请求前拒绝 | 无法替代真实PNG检查 |
| 背景 | 中性/透明规则一致 | 已修正预设强制透明的冲突并加回归 | 未对12套图做自动去底效果验收 |
| 浏览 | 参考列表、图片状态、对比、来源、焦点返回 | 浏览不导入素材、不请求生图；嵌套弹窗可返回 | 外部图源仍可能失效 |
| 渲染 | 浅色、深色、620×900窄窗口 | 参考图与布局可浏览，深色与窄窗口已检查 | 不是游戏手柄/触摸测试 |
| 流程 | UI模板自动图创建 | generation→pixel→cutout→export四节点 | 本轮未执行新的付费生图 |
| 工程 | 相关Vitest、类型检查、生产构建 | 对应实现已通过；提交a4bc94d | 工程通过不等于美术通过 |
| 便携简报 | 全12项×透明/中性，主体覆盖与错误输入 | 本地Node测试覆盖24种编译结果、研究图不注入、输入拒绝 | 脚本只准备文本，不生成图片 |
| 资料闭包 | 本地Markdown路径、JSON索引、来源ID、SVG、补丁哈希 | 可用下述校验器复核 | 校验器不判断美感与交互可用性 |

## 便携复核命令

在本资料目录执行：

```sh
node scripts/validate-study.mjs
node --test tests/ui-brief.test.mjs
node scripts/ui-brief.mjs list
node scripts/ui-brief.mjs build --id game-ui-crafting-wood-paper --background neutral --format json
```

上述命令不读取密钥、连接生图API或修改用户画布。`build --out`仅写入指定的新文件；不指定`--out`时输出到终端。

## 软件实现的复核命令

需要具备对应Pixel Studio源码与依赖，以下测试文件属于软件集成补丁：

```sh
npx vitest run \
  src/lib/pixel-studio/__tests__/game-ui-prompt-presets.test.ts \
  src/lib/pixel-studio/__tests__/game-ui-template-integration.test.ts \
  src/components/pixel-studio/__tests__/GameUiReferenceBrowser.test.tsx \
  src/components/pixel-studio/__tests__/StudioTemplateGallery.test.tsx \
  src/components/pixel-studio/__tests__/PixelGenerationStandardEditor.test.tsx
npm run typecheck
npm run build:studio
```

这不是让安装了独立Skill的AI直接执行软件源码测试；软件与可安装Skill是不同环境。

## 还需要实际成图验证什么

1. 在最终显示尺寸，物品、文字留白、代价和主要动作是否具有合理主次。
2. 模型是否遵守请求区域；是否乱加栏目、假字、假数字或重复图标。
3. 采样是否让细边、角饰、器物身份与材质层次混乱。
4. 128色普通处理或后续色板调整是否误改项目原色；不能拿独立Skill的24色默认冒充本流程参数。
5. 自动去底是否误删内部米白纸面、布面、细线或真实透明孔。
6. 导出的逻辑尺寸、硬alpha、边距和滤波是否正确，是否还有青紫污染。
7. 组件实际拆件、动态中文、焦点与状态绑定后，是否仍保持同一视觉语言。

这些项目前保留为待验证，不用提示词、机器数值或程序测试代替结论。

## 来源与许可

软件集成来源与哈希见[PROVENANCE.json](studio-integration/PROVENANCE.json)，上游MIT见[LICENSE.upstream](studio-integration/LICENSE.upstream)。商业游戏图像权利属于各自权利人；本资料仅保存外部官方引用，不能把截图中的素材直接加入游戏发行包。

布局SVG是带明确文字标记的研究示意；没有外部图片、脚本或可运行游戏UI。它不是生成成品或交互实现证据。
