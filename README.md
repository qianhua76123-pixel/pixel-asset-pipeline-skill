# Pixel Asset Pipeline Skill

用 `nano-banana-2` 或自定义生图 API 生成新素材，再通过固定算法整理成原生 PNG；也可直接处理已保存图片。供具备本地文件和命令执行能力的 AI 使用，包含可运行的代码。

## 从生图到导出

```sh
node "<skill-dir>/scripts/pixel_generate.mjs" providers --mode studio
node "<skill-dir>/scripts/pixel_workflow.mjs" run \
  --mode studio --provider-id <saved-connection-id> --model nano-banana-2 \
  --prompt-file brief.txt --processor local --size 256x256 \
  --material bamboo --output-dir runs/new-basket
```

复用 Studio 设置中的连接和密钥，不修改连接默认模型。独立运行可用 `--mode api --protocol openai|gemini --base-url <url>`；密钥从 `PIXEL_IMAGE_API_KEY` 环境变量读取。支持 Images 兼容接口与 Gemini 原生接口，不包含账号或密钥。

输出保存原始生成图、任务ID、各阶段报告和透明PNG。超时使用 `pixel_workflow.mjs resume --output-dir <existing-run>`，不会自动重新生图。[接口配置、完整命令及恢复](skills/pixel-asset-pipeline/references/generation.md)。

## 两种执行方式

| 方式 | 能力 | 依赖 |
|---|---|---|
| 独立本地引擎 | 透明图/可靠彩底、严格网格、有原图证据的补色、材质精修、碎色整理、竹木单遍外轮廓、PNG导出 | Node.js 22+、Sharp |
| Pixel Studio适配器 | 软件现有固定流程，包括已配置的本地主体识别和保存的源图记录 | Python 3.9+、兼容Pixel Studio服务 |

固定顺序：**背景 → 网格 → 有证据的去污染与补色 → 明确材质 → 色块整理 → 明确竹木轮廓 → 导出**。阶段可以有依据地跳过。默认96色预算；已完成输出有匹配记录时只导出，避免反复压色和移动边缘。

本仓库包含生图客户端，不托管模型，也不包含 API key、Pixel Studio UI、模型权重或用户素材。独立流程默认请求纯彩底；遇到不可靠/中性背景会拒绝自动去底。语义抠图可选 `--processor studio`，使用已经配置好的Studio服务。像素技术检查通过不等于手绘质量，残色和造型仍需目视验收。

## 安装为Skill

克隆后，将整个 `skills/pixel-asset-pipeline` 文件夹放到目标AI的技能目录。文件夹包含自己的依赖清单、运行时代码和参考文档。

- Codex / 支持Agent Skills的工具：项目 `.agents/skills/`；当前旧式 `~/.codex/skills/` 配置按宿主设置使用。
- Claude Code：项目 `.claude/skills/`。
- Cursor：项目 `.cursor/skills/` 或 `.agents/skills/`。
- 其他有终端能力的AI：读取 `SKILL.md` 后调用脚本。普通网页聊天不会因此自动获得本地执行能力。

```sh
cd "<skill-dir>"
npm ci --omit=dev
node "<skill-dir>/scripts/pixel_local.mjs" doctor
```

`<skill-dir>`替换为含 `SKILL.md` 的实际目录。Codex 可用 `$pixel-asset-pipeline`，Claude Code / Cursor 可用 `/pixel-asset-pipeline`；发现与调用规则由宿主决定。

## 独立处理PNG

```sh
node "<skill-dir>/scripts/pixel_local.mjs" inspect --input original.png

# 已经是原生像素尺寸的透明图，保留完整画布。
node "<skill-dir>/scripts/pixel_local.mjs" run \
  --input original.png --output-dir runs/chair --native --material bamboo

# 建立128x128完整逻辑画布。
node "<skill-dir>/scripts/pixel_local.mjs" run \
  --input original.png --output-dir runs/leaf --size 128x128 --material foliage
```

输出 `sprite.png`、匹配的 `sprite.png.pixel.json` 和 `manifest.json`。保留sidecar用于重复处理保护。每次使用新输出目录，改变配置时回原始源图重跑。

`--native`代表一个文件像素对应一个逻辑像素，不代表自动识别AI网格。默认最长边256、不放大。材质为 `generic/foliage/bamboo/glass`；`--palette 64`明确选择较少色块预算，预算不是硬上限。

## 调用现有Pixel Studio

```sh
python3 "<skill-dir>/scripts/pixel_studio.py" doctor
python3 "<skill-dir>/scripts/pixel_studio.py" plan --asset-id <saved-asset-id> --profile bamboo
python3 "<skill-dir>/scripts/pixel_studio.py" run \
  --input original.png --output-dir runs/studio --profile bamboo
```

默认服务地址 `http://127.0.0.1:3410`。适配器不安装软件或下载模型。先检查与预览，再提交一次；超时保留任务ID，用 `status/resume` 恢复。[命令与恢复说明](skills/pixel-asset-pipeline/references/execution.md)。

## 地块与瓦片集

本版只附[瓦片制作规范](skills/pixel-asset-pipeline/references/terrain.md)，尚未实现接缝校验、地形规则生成或Godot `.tres` 导出。地面不应直接套物件抠图、裁紧和逐瓦片独立轮廓修补。

## Development and provenance

This skill supports agents with local filesystem and command access. The generation client supports a saved Studio connection or a custom Images-compatible/Gemini API. It makes one image request, saves recovery state and freezes the result before processing. The independent engine includes extracted fixed algorithms; optional semantic cutout requires an already-running compatible Studio application.

Run `npm ci`, `npm test`, `npm run build`, and `python3 -m unittest discover -s tests -p 'test_*.py'`. See [third-party notices](THIRD_PARTY_NOTICES.md) and [runtime provenance](skills/pixel-asset-pipeline/scripts/runtime/PROVENANCE.json) for source paths, revisions and licenses. The upstream MIT notice is preserved; native dependency licenses apply separately.

Cross-agent installation references: [Claude Code](https://code.claude.com/docs/en/skills), [Cursor](https://cursor.com/docs/skills), and [Codex skills](https://learn.chatgpt.com/docs/build-skills). These are compatibility instructions, not a claim that every host version was integration-tested.
