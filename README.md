# sologsb-1120 古钟表维修工序档案（gbclockrepair）

面向钟表修复师的工序档案台：为一台古董钟表建档，记录机芯型号、零件缺失与配换、拆解顺序、清洗润滑点位，以及修复后的走时测试数据；每台钟表可编制维修估价单，师傅按当前零件与待办工序填写工时费、材料费，版本经前台确认后冻结，事后再有变化自动标为待补价。纯前端单页应用，数据全部保存在浏览器本地。

## Docker 一键启动（推荐）

```bash
cp .env.example .env
docker compose up -d --build
```

访问地址：**http://localhost:21820**

停止服务：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| UI | Element Plus 2 |
| 构建 | Vite 5 |
| 状态管理 | Pinia |
| 路由 | Vue Router 4（history 模式） |
| 本地存储 | IndexedDB（Dexie 4），含结构版本号与升级迁移 |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # vue-tsc 类型检查 + vite 构建
```

> 生产环境由 nginx 托管 `dist`，`nginx.conf` 已启用 `try_files $uri $uri/ /index.html;` 与 gzip。

## 目录结构

```
sologsb-1120/
├── docker-compose.yml
├── .env.example
├── .env
└── frontend/
    ├── Dockerfile              # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── main.ts
        ├── App.vue
        ├── router/index.ts
        ├── types/{clock,part,step,test,estimate}.ts
        ├── stores/{clock,part,step,estimate}Store.ts
        ├── components/common/{StepSequence,RateChart,ClockCard,StateBadge,EstimatePanel}.vue
        ├── hooks/{useClockSearch,useRepairProgress,useRepairState,useEstimateStatus}.ts
        ├── pages/{ClockList,ClockDetail,StepForm,PartList,TestView,EstimateView}.vue
        └── utils/{db,timeCalc,id,estimate}.ts
```

## 页面与路由

| 路由 | 页面 | 消费模型 |
| --- | --- | --- |
| `/clocks` | 钟表台账：按种类/机芯/品相/年代区间筛选，按修复状态分栏（含待补价栏），卡片显示估价角标 | Clock、Estimate |
| `/clocks/:id` | 钟表详情：左侧机芯信息，右侧工序流、估价单摘要与走时测试记录，可切零件清单 | Clock、RepairStep、TimekeepingTest、MovementPart、Estimate |
| `/steps/new` | 新建维修工序：选步骤类型后动态出清洗液/油脂/力矩字段，顺序号冲突即报错 | RepairStep、MovementPart |
| `/parts` | 零件与配换清单：按磨损状态分组，标出待修配条目与来源批号 | MovementPart |
| `/tests/:clockId` | 走时测试录入与多方位均值计算，生成走时单文本 | TimekeepingTest |
| `/estimates/:clockId?` | 估价单编制：按当前零件与待办工序生成明细，版本保存、前台确认与补价流转 | Estimate、MovementPart、RepairStep |

`/` 重定向到 `/clocks`，未匹配路由同样兜底到 `/clocks`。

## 数据存储说明

- 数据库名 `gbclockrepair`，当前结构版本 **v3**（`localStorage['gbclockrepair:db-version']` 记录）。
- 五张表：`clocks`（钟表）、`parts`（机芯零件）、`steps`（维修工序）、`tests`（走时测试）、`estimates`（估价单版本）。
- v1 → v2 迁移：补齐老记录的 `state`、`partIds`、`torque`、`positions` 字段并新增索引。
- v2 → v3 迁移：新增 `estimates` 表，老档案无需改动，打开即自动建表，原有记录照常可读。
- 容器无状态、不挂载命名卷；清空站点数据即回到初始示范数据。
- 首次打开灌入 2 台示范钟表、3 项零件、3 道工序、1 次走时测试与 3 份估价单版本（一台演示「确认后改零件 → 待补价 +¥440」，一台演示正常的已确认状态）。

## 功能要点

- **顺序号不跳号**：新建工序时若顺序号大于「当前最大顺序号 + 1」直接报错并给出建议值；`<StepSequence>` 对缺口行标红。
- **工序排序**：支持「上移 / 下移」按钮与原生拖拽交换顺序，交换的是 `seq`。
- **工序完成 / 回退**：完成后写 `finishedAt`，回退后计入待办与回退计数。
- **估价单版本化**：师傅按当前零件（处理决定非「保留」）与待办工序一键生成工时费、材料费明细，保存为递增版本；每台钟表同时只有一份待确认草稿。
- **前台确认即冻结**：确认时记录确认人、时间与基线快照（零件决定、待办工序数、合计金额），已确认版本内容不再改动，旧版本转为「已被取代」留存可查。
- **变更自动标待补价**：确认后零件决定、待办工序数量或估价金额再变化，原估价保持不变并标为待补价，台账与详情页同步显示待确认差额（草稿合计 − 已确认合计；未填报补价时显示「差额待填报」）。
- **补价确认前不能完成维修**：存在待确认差额时，即使工序全部完成且已有走时测试，修复状态也停在「待补价」栏，前台确认补价版本后才可进入「已完成」。
- **双轴走时图**：`<RateChart>` 左轴日差 s/d、右轴摆幅 °，标注四方位读数与均值。
- **走时单导出**：按方位均值生成文本，可复制或下载 txt。
