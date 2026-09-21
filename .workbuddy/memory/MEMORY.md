# html-slides · 项目长期约定

## 这是什么
「流程图式可交互演示站点」的批量生产器。一份 JSON 规格 → 一个自包含单文件 HTML 站点。

## 目录约定
- `decks/<name>.json` — 唯一的内容源（节点 html、坐标、连线、投票定义）。
- `src/flowdeck.js` / `src/flowdeck.css` — 共享引擎，所有站点共用同一份。
- `scripts/build.mjs` — 把规格与引擎内联成 `dist/<slug>/index.html`，另生成 `dist/index.html` 入口页。
  **不要手改 `dist/`**，它是构建产物（每次构建会 `rm -rf` 重建）。
- `dev/index.html` — 开发用模板，通过 `body[data-deck]` 指向规格文件，需起静态服务才能读 JSON。

## 引擎必须遵守的约束
- 节点画布尺寸常量 `NW=900 / NH=600` 同时写在 JS 与 CSS 变量 `--fd-node-w/h`，改一处必须同步另一处。
- 导出单文件依赖构建时注入的 `style[data-flowdeck]` / `script[data-flowdeck]`，
  引擎在改写 body 之前必须先把它们的文本存进 `ASSETS`。
- 同步消息协议：`{t:'hello'|'here'|'vote'|'note:add'|'note:del'|'poll:reset', _n, cid, ...}`，
  所有操作必须**幂等**（重复收到同一条消息不能产生副作用），这样多承载通道（Broadcast/Socket/Storage 事件）才不会互相打架。
- 房间键 = `deck.id`；本地可写状态存 `localStorage['flowdeck:v1:<deckId>']`。

## 待改造（实时互动层，方案见 docs/realtime-plan.md）
- 「对等广播」→「服务器权威」：`Trace` 拆成 `Transport`（承载）+ `Room`（客户端状态机）；
  客户端只发意图，服务器裁决后广播事实；幂等从 `seen[_n]` 换成 `seq` + `welcome` 快照。
  （`seen[_n]` 超 600 条会清空，长会话必然错乱，务必换掉。）
- 主持人四模式（Demo/Dashboard/Review/Control）是 **host-local UI 状态**；
  房间另有全局 `phase`。两者分开存，禁止混用。
- 身份：投票从 `Trace.cid` 改成 `pid` + `resumeToken`，否则做不到「看到是谁」。
- 数值型组件（rating / scale）必须**并列给出平均数与中位数**，不允许只给平均；
  两者差值 > 1 判为两极分化。理由见 2026-09-20 日志。

## 本地浏览器验证的坑
- 静态服务必须用 Bash 的 `run_in_background: true` 起；写成 `(cmd &)` 会在该轮命令结束被回收，
  表现为后续 curl 502、浏览器空白。
- 传给 `agent-browser eval` 的脚本里禁用 `!!`（zsh 历史展开会让它报错）。
- 点击委托里凡是要定位节点，一律从 `e.target.closest('.fd-node')` 反推，
  不要用 `cur().id`——多节点同屏可见时会记错节点。
- 规格需扩 `widgets[]` / `gate` / `branch` / `flow`；互动元素支持内联 `[data-fd-choice]`。
- 部署：**不上 Cloudflare DO**（量级不匹配），选内地轻量云 + Node ws；
  另必须做 **LAN 局域网模式**，现场 WiFi 是头号风险。

## 尚未实现
- WebSocket 服务端同步（当前仅 BroadcastChannel 多窗口同步）。
- 权限与身份（现在只有侧栏里的自填昵称）。
- 门槛裁决、分支与汇聚、分析报表导出。
