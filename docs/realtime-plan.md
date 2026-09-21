# 实时互动层设计（FlowDeck Realtime）

目标：在现有「流程图式演示引擎」之上，长出一套**主持人权威、学员跟随、可统计、可控制流程**的实时互动系统。

---

## 0. 结论先行

1. **现有同步层必须换血，不能只加 WebSocket。** 现在是「对等广播」：每个客户端各自持有 `S` 状态、互相发事件。50 人场景下这必然出现状态漂移、无法锁页、无法点名、无法统计。要改成 **服务器权威（server-authoritative）**：客户端只发**意图**，服务器裁决后广播**事实**。
2. **主持人的四种模式只是 UI 状态，房间里有另一套全局 `phase`。** 这两者必须分开存，否则会做出「主持人切到 Review，学员端也跟着变」这种 bug。
3. **50 人根本不是性能问题。** 一节课 20 题 × 50 人 ≈ 1000 条消息，Node 单进程绰绰有余。真正的风险是**现场网络**，所以局域网模式不是可选项，是一等公民。

---

## 1. 现状盘点：现有引擎哪里撑不住

| 现有实现 | 问题 | 影响 |
|---|---|---|
| `Trace` 用 BroadcastChannel 广播 | 只能同浏览器多窗口 | 手机连不进来 |
| 每个客户端各自算 `S.polls` | 无单一真相源 | 投票数对不上，刷新后重复计 |
| 投票按 `Trace.cid` 记（sessionStorage） | 匿名且不稳定 | 「看到是谁」做不到；换设备算两个人 |
| `goto()` 人人可调 | 无导航权限 | 「学员页面固定死」做不到 |
| 幂等靠 `seen[_n]`，超过 600 条清空 | 长会话旧消息会被重复应用 | 一节课下来数据会错乱 |
| `n.poll` 一页只有一个，无开关态 | 无法开题/收题/计时 | 无法控制作答窗口 |
| 规格无 gate / branch | 无法做顺序限制与分支 | 需求 3b、3c 落不了地 |

### 改造落点（映射到具体函数）

| 现有 | 改成 |
|---|---|
| `Trace`（承载 + 协议混在一起） | 拆成 `Transport`（承载，可换 WS/LAN/Broadcast）与 `Room`（客户端侧状态机） |
| `onRemote(m)` | `onFact(fact)`：只接受 `seq > lastSeq` 的服务器事实 |
| `seen[_n]` 去重 | `lastSeq` 单调序号 + `welcome` 全量快照 |
| `S.polls[cid]` | `Room.responses[pid]`，按 `pid + nodeId + widgetId` 唯一 |
| `goto()` | 学员端禁用；只有收到 `nav` 事实才跳 |
| `renderPoll(id)` | `renderWidget(nodeId, widgetId)`，支持多组件 / 开关态 / 正确率 |
| `normalize(spec)` | 增加 `widgets` / `gate` / `branch` / `flow` 归一化 |
| `setMode(m)` | 主持端 UI 模式；房间 `phase` 另行广播 |

---

## 2. 角色与权限

| 能力 | host | cohost | guest | observer |
|---|:--:|:--:|:--:|:--:|
| 跳页 / 开题 / 收题 / 放行 | ✅ | ✅ | ❌ | ❌ |
| 看逐人明细 `attrib` | ✅ | ✅ | ❌ | ❌ |
| 看实时分布 `tally` | ✅ | ✅ | 仅聚合 | ✅ |
| 分支裁决 | ✅ | ❌ | ❌ | ❌ |
| 名册管理（改名/移出/分组/静音） | ✅ | ✅ | ❌ | ❌ |
| 改流程顺序 / 强制放行 | ✅ | ❌ | ❌ | ❌ |
| 提交作答 | ❌ | ❌ | ✅ | ❌ |
| 发标注 / 表情 | ✅ | ✅ | 需开关 | ❌ |

- **host**：凭 `hostKey` 认领，写在主持人链接里，**绝不能出现在学员链接中**。
- **cohost**：主持人现场授予，可代管名册。
- **guest**：凭房间口令 + 昵称加入。
- **observer**：只读，适合旁听的领导/客户。

---

## 3. 房间状态模型（服务器权威）

```
Room {
  roomId, deckId, deckRev
  hostKey            // 主持人凭证，不广播
  joinCode           // 学员口令，可轮换
  seq                // 单调递增，客户端乱序/丢包校验用
  phase              // idle | asking | closed | reviewing | locked
  cursor             // 全员游标（self 分支时为 null，改看每人 cursor）
  nodes: {
    [nodeId]: { state, openedAt, closedAt, gate, chosen }
  }
  participants: {
    [pid]: { name, role, group, online, lastSeen, cursor, joinedAt }
  }
  responses: [
    { pid, nodeId, widgetId, value, ts, ms, rev }
  ]
  annotations: [ ... ]
  events: [ ... ]    // append-only，用于回放 / 审计 / 报表重建
}
```

**游标语义（关键）**：
- 默认 `policy != self`：全员共用 `room.cursor`，一人一份页面。
- 分支 `policy == self`：每人有独立 `participants[pid].cursor`，服务器**分别**钉死，学员依然不能自选。

---

## 4. 消息协议

### 客户端 → 服务器（意图，需鉴权）

| 消息 | 谁可发 | 说明 |
|---|---|---|
| `hello` | 所有 | 携带 `resumeToken` + `lastSeq`，用于重连认领身份与补发 |
| `join` | guest | `{ code, name, deviceId }` |
| `resp` | guest | `{ nodeId, widgetId, value, rev }`；去重键 `pid+node+widget` |
| `react` / `raise` | guest | 表情雨、举手 |
| `note:add` | 需开关 | 学员标注 |
| `host:nav` | host | 请求跳页 |
| `host:open` / `host:close` | host | 开题 / 收题，可带 `seconds` 倒计时 |
| `host:reveal` | host | 公布答案 |
| `host:lock` | host | `{ follow, allowBrowse, allowAnnotate, anonymous }` |
| `host:branch` | host | 分支裁决 |
| `host:roster` | host/cohost | 改名 / 移出 / 分组 / 静音 |
| `host:rehearse` | host | 生成 N 个虚拟学员（彩排） |

### 服务器 → 客户端（事实，幂等）

| 事实 | 发给谁 | 说明 |
|---|---|---|
| `welcome` | 本人 | `{ pid, resumeToken, snapshot, seq }`，重连也走这条 |
| `presence` | 全员 | 名册增量 |
| `nav` | 全员 | **学员端唯一的跳转依据** |
| `phase` | 全员 | 节点阶段变化 |
| `widget` | 全员 | 组件开关与截止时间 |
| `tally` | 全员 | 聚合分布（含 `mine`） |
| `attrib` | **仅 host** | 逐人明细：谁选了什么、用时多久 |
| `roster` | **仅 host** | `{ answered: [pid], pending: [pid] }` |
| `gate` | **仅 host** | 门槛是否满足、还差什么 |
| `branch` | 全员 | 分支结果与走向分布 |
| `error` | 本人 | 被拒绝的意图 |

`attrib` 与 `roster` **只发给主持人**——这是「立马看到是谁」的实现，也是不能让学员拿到的东西。

---

## 5. 学员端

- **跟随锁**：顶部常驻「跟随主持人」标识 + 当前页码。导航控件隐藏或禁用。
- **回看**（可选开关 `allowBrowse`）：只能回看**已走过**的节点，不能前进到未解锁页。
- **互动卡**：只在 `phase == asking` 时可交互；提交后显示「已提交」；若 `allowChange` 为 true 可改，但改答次数记入事件日志。
- **内联选项**：引擎扫描节点 HTML 里的 `[data-fd-choice]` 元素，自动挂接到 widget。这样「页面上的互动选项链接」可以直接写进可编辑内容里，不必另开容器。
- **掉线重连**：指数退避 0.5/1/2/4/8…上限 15s；重连后凭 `resumeToken` 认领同一身份，按 `lastSeq` 补 delta 或收全量快照。

---

## 6. 主持人端四种模式

模式是**本机 UI 状态**，切换不影响房间 `phase`，学员端毫无感知。

| 模式 | 画面 | 关键元素 |
|---|---|---|
| **Demo 讲解** | 内容全屏 + 右侧反馈流 | 谁刚答了什么滚动播放、未答人数徽标、底部开题/收题、上一页/下一页 |
| **Dashboard 投屏** | 数据大屏 | 参与率大环、选项分布条、倒计时、**未答名单**（默认只显示人数，点开才显名）、表情雨、分支走向 |
| **Review 评审** | 逐节点回看 | 每节点一卡：题目 + 分布 + 逐人明细 + 用时分布 + 标注；底部「确认本页并解锁下一页」 |
| **Control 操控** | 管理台 | 名册（改名/移出/分组/静音）、权限开关、强制跳转、分支裁决、导出、彩排模式 |

**未答名单要不要投屏**：默认只显示「还有 7 人未答」，点开才看名字。公开点名有压力，留个开关给主持人自己决定。

---

## 7. 互动组件类型

`single` / `multi` / `rating` / `scale`（NPS）/ `quiz`（带 `correct`）/ `text` / `rank` / `react`

每个组件可配：`reveal`（host|all|never）、`allowChange`、`timeLimit`、`anonymous`、`once`。

**数值型组件（rating / scale）必须同时输出平均数与中位数**，两者并列显示，不允许只给平均。
原因：平均会被极端值拽跑。示例 `[1,2,4,5,5,5]` → 平均 3.7、中位数 4.5——
只看平均会以为"反响一般"，实际是多数人打高分、被两个极端低分拉低。
**平均与中位数的差值本身就是两极分化信号**，差值超过 1 时在主持端标出来。

---

## 8. 流程控制：门槛与顺序

```jsonc
"gate": {
  "all": ["w1"],              // 必须完成的组件
  "minRate": 0.8,             // 参与率门槛
  "minCorrect": 0.6,          // 正确率门槛
  "requireHostConfirm": true, // 必须主持人确认
  "onFail": "wait"            // wait | force | hint
}
```

- 门槛在**服务器**裁决。主持人 UI 上「下一页」是灰的，旁边写明原因：`还差 7 人未答 · 参与率 78% < 80%`。
- `force` 强制放行可用，但会写进事件日志，报表里标出来。
- `flow.strict = true` 时禁止跳页；`flow.allowBack` 控制能否回看。

---

## 9. 分支与汇聚

```jsonc
"branch": {
  "policy": "host",            // host | vote | self
  "source": "w1",
  "arms": [
    { "id": "a", "label": "重做引导", "when": { "w1": 0 }, "to": "n5a" },
    { "id": "b", "label": "先做性能", "when": { "w1": [2,3] }, "to": "n5b" }
  ],
  "default": "a",
  "merge": { "at": "n8", "waitFor": "all" }  // all | first | hostSignal
}
```

- `host`：主持人点选，同时显示投票分布作参考。
- `vote`：服务器按众数自动走，全员一致。
- `self`：**学员级分支**，每人按自己答案走不同路径，各人游标独立，到 `merge` 汇合。

---

## 10. 数据分析与导出

**实时**：每收到一条 `resp` 增量更新，150ms 节流广播。

**Review 模式自动产出**：

- 参与率（已答 / 在线）
- 选项分布与众数
- **平均 + 中位数并列**（评分类），差值 > 1 判为两极分化并高亮
- **分歧度**（归一化熵 0–1）——识别"这题吵起来了"
- 正确率与逐题正确率热力
- 反应时长：首答中位数 / p90；标记「秒答 <3s」（可能瞎选）与超时
- **未答名单**
- 改答率
- 分支走向人数分布
- 交叉分析：题 A 选 X 的人，在题 B 上的分布
- 文本/标注关键词与词云

**导出**：CSV 长表（`pid, name, node, widget, value, correct, ms, ts`）、JSON 全量、Markdown 摘要。

---

## 11. 传输与部署

一套协议，三种承载，自动降级：

1. **WebSocket 公网** —— 常规场景
2. **局域网模式** —— 现场笔记本起 Node 服务 + 二维码扫码，同网段 <10ms
3. **BroadcastChannel** —— 仅开发调试

**选型建议（诚实版）**：50 人单房间，**不要上 Cloudflare Durable Objects**。DO 的价值在于百万房间的弹性调度，你这个量级用不上，徒增绑定与调试成本。推荐 **一台内地 2C4G 轻量云 + Node ws 单进程**，可同时撑数百房间。只有当「同时开很多场 + 海外学员」时才值得换 DO。

**现场网络是头号风险**：培训场地 WiFi 经常崩。局域网模式必须是 P1 而不是 nice-to-have。

---

## 12. 可靠性参数

| 项 | 值 |
|---|---|
| 心跳 | 15s；35s 无心跳判离线，但名册保留 30 分钟（防地铁掉线被踢） |
| tally 广播节流 | 150ms |
| 重连退避 | 0.5 / 1 / 2 / 4 / 8s，上限 15s |
| 限速 | 每人每组件每秒 1 条 resp，超出丢弃并回 error |
| 快照 | 超过 200KB 只发 delta |
| 端到端目标 | 公网 p95 < 250ms；局域网 < 50ms |

---

## 13. 规格扩展示例

```jsonc
{
  "id": "onboarding-review",
  "flow": { "start": "n1", "strict": true, "allowBack": "reviewed" },
  "nodes": [
    {
      "id": "n3",
      "kind": "step",
      "html": "<h2>引导流失在哪一步</h2><p>看这张漏斗图</p>",
      "widgets": [
        {
          "id": "w1",
          "type": "single",
          "q": "你认为流失最严重的是哪一步",
          "options": ["手机号验证", "兴趣选择", "头像上传", "推荐关注"],
          "correct": 0,
          "reveal": "host",
          "allowChange": true,
          "timeLimit": 45
        }
      ],
      "gate": { "all": ["w1"], "minRate": 0.8, "requireHostConfirm": true },
      "branch": {
        "policy": "vote",
        "source": "w1",
        "arms": [
          { "id": "a", "label": "重做验证", "when": { "w1": 0 }, "to": "n5a" },
          { "id": "b", "label": "砍掉步骤", "when": { "w1": [1,2,3] }, "to": "n5b" }
        ],
        "default": "a",
        "merge": { "at": "n8", "waitFor": "all" }
      }
    }
  ]
}
```

---

## 14. 分期实施

每期独立可验收，不阻塞下一期。

| 期 | 内容 | 验收标准 |
|---|---|---|
| **P0 权威化地基** | `Transport` 接口抽出；seq 快照取代 `seen[_n]`；身份与名册；学员导航锁定；虚拟学员压测脚本 | 50 个虚拟客户端连入，主持人跳页全员 <300ms 跟随；断线 30s 后重连仍回到同一身份、同一页 |
| **P1 互动与实时统计** | widget 全类型；开题/收题/倒计时；tally / attrib / roster | 主持人能看到「谁选了什么」与「谁还没答」；改答正确归因 |
| **P2 主持人四模式** | Demo / Dashboard / Review / Control 四套 UI | 切模式不影响学员端；Dashboard 可投屏 |
| **P3 门槛与顺序** | gate 裁决、strict 顺序、强制放行 | 未达门槛时下一页灰掉且写明原因；强制放行进日志 |
| **P4 分支与汇聚** | 三种 policy、per-participant cursor、merge waitFor | self 分支下每人被钉在不同页；汇聚点正确合流 |
| **P5 报表与彩排** | 全部指标、CSV/JSON/Markdown 导出、彩排模式 | 一节课结束 5 秒内出报表；彩排模式可 1 人压出 50 人效果 |

---

## 15. 待你拍板的 7 件事

1. **部署形态**：内地轻量云 / 现场局域网 / 两者都要 / 海外（影响是否上 DO）
2. **身份强度**：昵称即可 / 实名（工号或手机后四位）/ 对接企微微信登录
3. **`self` 分支下的「固定死」**：全员看同一页，还是分组走不同路径后再汇总
4. **匿名模式**：某些投票是否需要匿名（匿名就拿不到逐人明细，二者互斥）
5. **数据留存**：当场即毁 / 存历史场次可回看 / 长期归档
6. **终端形态**：手机浏览器 / 微信小程序 / 企微内嵌 H5
7. **并发规模上限**：50 人是常态还是上限？要不要按 500 人设计
