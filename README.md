# Interactive Deck

更完整、可互动、带权限管控的 HTML 个人 Deck 平台。写一份 JSON 规格，构建出一个自包含的交互式 HTML 站点——从创作、发布，到实时演示与观众互动，覆盖个人演示的完整链路。

## 它是什么

- **流程画布，不是线性翻页**：每一页是画布上的一个节点，节点之间用边连接；镜头在节点间带方向感地平移缩放，观众沿着流程走。
- **零依赖，单文件产物**：构建产物是一个自包含 HTML，双击即可打开，丢到任何静态托管上就能发布。
- **AI Agent 与人共用一套工作流**：deck 的源文件就是 JSON，人和智能体读写同一份规格。

## 核心特性

### 1. 兼容各类 AI Agent，一键发布

- 兼容 **Codex、Workbody、Claude Code** 等 AI Agent：Agent 直接读写 `decks/` 下的 JSON 规格即可完成创作与修改，无需理解渲染层。
- **一键发布**：运行一次构建，`dist/` 下即生成可发布的站点；演示现场点「导出单文件」，还能把当前所有改动打包成一个自包含 HTML 随身带走。

```bash
node scripts/build.mjs        # decks/*.json → dist/<slug>/index.html
npx --yes serve dist -l 5173  # 本地预览
```

### 2. 与多维表格生态打通：实时编辑 · 演示 · 聚合分析

兼容 **飞书多维表格、明道云多维表格** 或 **Workbody 的文档表格** 后，平台解锁三件事：

1. **实时编辑与演示**：Host 自己实时编辑内容，同时向 **50 人以内**的观众进行 Present；
2. **轻度互动**：观众参与选项投票、星级评分，不需要任何人举手；
3. **实时聚合分析**：票选比例条、评分的平均分与中位数实时汇总在页面上。

权限按角色管控（Host / 协作者 / 观众），实时层与权限设计详见 [`docs/realtime-plan.md`](docs/realtime-plan.md)。

### 3. 方向性导航

- **指向性的前进 / 后退**：镜头朝下一节点带方向偏置地平移，观众始终知道"接下来去哪"；
- 键盘（`→` `空格` `PageDown` 前进，`←` `PageUp` 后退，`E` 编辑，`A` 标注）、底部圆形按钮、可点击进度点；
- 每个节点都有深链（`#节点ID`），可直接跳到流程中的任何一页；
- 分叉边（如「通过」「只要结论」）支持有方向性的跳转语义。

### 4. 右上角缩略图（流程总览）

- 全局 minimap：一个节点一个方框，连线还原流程结构，虚线框实时标出摄像机当前视口；
- 琥珀色圆点 = 该节点有投票，蓝色 = 被编辑过；**点击任意节点直达**；
- 窄屏自动隐藏，不挡内容。

### 5. 现场演示能力

- **就地编辑**：任意页直接改文字、插入表格 / 图片 / 图形，图片自动内联；
- **标注**：标注模式下在任意页钉便签，复盘时逐条回填；
- **多窗口实时互通**：同一份 deck 开多个窗口，编辑、投票、标注实时同步（BroadcastChannel）；
- **投票与评分**：单选投票带动画比例条，1–5 星评分同时给出平均分与中位数。

## 快速开始

```bash
git clone https://github.com/jqu224/interactive-deck.git
cd interactive-deck
node scripts/build.mjs
npx --yes serve dist -l 5173
# 打开 http://localhost:5173
```

开发调试：`dev/index.html` 直接加载 `src/` 源码并拉取 deck JSON，改完即刷新可见，无需重新构建。

## Deck 规格（JSON）

一份规格对应一个站点（节选自 `decks/01-internal-beta-review.json`）：

```json
{
  "id": "01-internal-beta-review",
  "title": "内测复盘",
  "start": "n1",
  "order": ["n1", "n2", "n3"],
  "nodes": [
    {
      "id": "n1",
      "label": "开场",
      "kind": "start",
      "x": 0,
      "y": 300,
      "html": "<h2>把结论钉在流程上</h2><p>…</p>"
    },
    {
      "id": "n2",
      "label": "为什么现在做",
      "kind": "step",
      "x": 1120,
      "y": 0,
      "html": "<h2>…</h2>",
      "poll": { "q": "你最该补的是哪一块？", "options": ["信息密度", "引导步骤"] }
    }
  ],
  "edges": [
    { "from": "n1", "to": "n2" },
    { "from": "n2", "to": "n3", "label": "通过" }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `id` | 站点标识，同时是 URL 目录名 |
| `nodes[].kind` | `start` / `step` / `decision` / `end`，决定节点色条与语义 |
| `nodes[].x` / `y` | 节点在画布上的位置 |
| `nodes[].poll` | `{ q, options }` 单选投票，或 `{ type: "rating", q }` 星级评分 |
| `edges[].label` | 分叉边的跳转语义（如「通过」） |

## 目录结构

```
html-slides/
├── decks/            # deck 规格（内容源）
├── dev/              # 开发调试入口
├── dist/             # 构建产物（自包含 HTML，可直接发布）
├── docs/             # 设计文档（实时层 / 权限管控）
├── scripts/build.mjs # 构建器
└── src/              # 引擎源码（flowdeck.js / flowdeck.css）
```

## 文档

- [`docs/realtime-plan.md`](docs/realtime-plan.md) —— 实时层设计：角色权限、房间状态、消息协议、Host 模式与部署方案。
