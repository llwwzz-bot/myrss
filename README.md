# RSS 个人采集系统 —— MVP 实现指南

## 系统架构

```
手机 Telegram Bot ──发送链接──▶ Cloudflare Worker (Webhook)
                                      │
                                      ▼
                              Cloudflare Queue (任务队列)
                                      │
                                      ▼
                              Cloudflare Worker (Processor)
                                   │          │
                              ┌────┘          └────┐
                              ▼                    ▼
                       Cloudflare R2          Supabase
                       (图片存储)           (文章数据库)
                                                      │
                                                      ▼
                                            Cloudflare Worker (RSS)
                                                      │
                                                      ▼
                                              RSS 阅读器 (Read You / Fluent Reader)
```

三步式流程：**采集 → 清洗 → 呈现**

---

## 前置准备

### 你需要注册以下服务（均提供免费额度）

| 服务 | 用途 | 免费额度 |
|------|------|---------|
| [Cloudflare](https://dash.cloudflare.com) | Worker + Queue + R2 + Browser Rendering | Workers 10万次/天, R2 10GB |
| [Supabase](https://supabase.com) | 文章数据库 | 500MB 数据库, 无限 API 请求 |
| Telegram [@BotFather](https://t.me/BotFather) | 创建 Bot | 免费 |

### 本地环境

```bash
# 安装 Node.js 18+
node -v

# 安装 Wrangler CLI
npm install -g wrangler
wrangler login
```

---

## 第一步：创建 Telegram Bot

1. 在 Telegram 中搜索 `@BotFather`
2. 发送 `/newbot`，按提示设置 Bot 名称和用户名
3. 获得 **Bot Token**（格式：`123456:ABC-DEF1234ghijk`）
4. 获取你的 Telegram User ID：
   - 搜索 `@userinfobot`，发送任意消息即可获得你的数字 ID
5. **将 Bot Token 和 User ID 记下来**

---

## 第二步：配置 Supabase

### 2.1 创建项目

1. 登录 [supabase.com](https://supabase.com)，点击 **New Project**
2. 设置项目名（如 `rss-collector`），设置数据库密码并记下
3. 选择区域（建议选 `ap-southeast-1` 新加坡，国内访问较快）
4. 等待项目创建完成（约 2 分钟）

### 2.2 创建数据表

1. 进入项目 → **SQL Editor** → **New Query**
2. 将 `sql/schema.sql` 的内容粘贴进去，点击 **Run**
3. 确认左侧出现 `articles` 表

### 2.3 获取 API 密钥

1. 进入 **Project Settings** → **API**
2. 复制以下两个值：
   - **Project URL**（如 `https://xxxxx.supabase.co`）
   - **service_role key**（以 `eyJ...` 开头）⚠️ 这个 key 权限最高，不要公开

---

## 第三步：配置 Cloudflare

### 3.1 创建 R2 存储桶

```bash
wrangler r2 bucket create rss-images
```

### 3.2 创建 Queue

```bash
wrangler queues create collect-queue
```

### 3.3 配置 wrangler.toml

打开项目根目录的 `wrangler.toml`，填入你的实际值：

```toml
[vars]
TELEGRAM_BOT_TOKEN = "你的Bot Token"
ALLOWED_USERS = "你的Telegram User ID"
```

部署后 Cloudflare 自动分配 `workers.dev` 子域名，无需手动配置路由。

### 3.4 设置 Secret 环境变量

```bash
# Supabase 配置
wrangler secret put SUPABASE_URL
# 输入: https://xxxxx.supabase.co

wrangler secret put SUPABASE_SERVICE_KEY
# 输入: eyJ...你的 service_role key
```
# 输入: eyJ...你的 service_role key
```

---

## 第四步：部署

### 4.1 安装依赖

```bash
cd rss
npm install
```

### 4.2 部署到 Cloudflare

```bash
# 部署主 Worker（Webhook + Queue Consumer）
npx wrangler deploy

# 部署 RSS Worker
npx wrangler deploy --env rss
```

部署成功后你会获得类似 `rss-collector.你的用户名.workers.dev` 的域名。

---

## 第五步：设置 Telegram Webhook

将 Bot 的消息转发到你的 Worker：

```bash
curl -X POST "https://api.telegram.org/bot<你的Bot Token>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://rss-collector.你的域名.workers.dev/webhook"}'
```

验证是否设置成功：
```bash
curl "https://api.telegram.org/bot<你的Bot Token>/getWebhookInfo"
```

---

## 第六步：导入 RSS 阅读器

### 电脑端：Fluent Reader
1. 下载 [Fluent Reader](https://github.com/yang991178/fluent-reader)
2. 添加订阅源，地址为：`https://rss-collector.你的域名.workers.dev/rss`

### 安卓端：Read You
1. 下载 [Read You](https://github.com/Ashinch/ReadYou)（支持自定义字体）
2. 添加订阅源，同上地址

---

## 使用流程

1. **手机上刷到好文章** → 点分享 → 选 Telegram → 发送给你的 Bot
2. **Bot 回复**「✅ 已收到链接，正在后台处理…」
3. **后台自动**：提取正文 → 存到 Supabase → 图片搬上 R2
4. **空闲时打开阅读器** → 同步 RSS → 阅读规整排版的文章

---

## 项目文件说明

```
rss/
├── wrangler.toml              # Cloudflare 配置（需修改填入实际值）
├── package.json               # 依赖
├── tsconfig.json              # TypeScript 配置
├── sql/
│   └── schema.sql             # Supabase 建表 SQL
└── src/
    ├── types.ts               # 共享类型定义
    ├── webhook.ts             # Telegram Webhook 入口
    ├── processor.ts           # Queue 消费者（内容提取入库）
    ├── rss.ts                 # RSS 生成 Worker
    └── utils/
        ├── supabase.ts        # Supabase 客户端 & 操作
        ├── extractors.ts      # 内容提取器（通用/公众号/Twitter）
        └── r2.ts              # R2 图片存储
```

---

## 扩展方向

- **飞书机器人**：修改 webhook 支持飞书 Webhook 格式
- **AI 摘要**：在 processor 中加入 OpenAI API 调用，自动生成文章摘要
- **分类标签**：用 AI 自动打标签，在阅读器中按分类筛选
- **全文搜索**：利用 Supabase 全文索引 + 自定义搜索界面
- **定时抓取**：用 Cloudflare Cron Trigger 定时抓取关注的博主/RSS 源

---

## 常见问题

**Q: 为什么用 Cloudflare Browser Rendering 提取公众号？**
A: 微信公众号文章需要微信 UA 才能看到完整内容，且内容由 JS 动态渲染，普通 HTTP 请求拿不到。Browser Rendering 是 Cloudflare 提供的无头浏览器服务。

**Q: Queue 消费失败了怎么办？**
A: Cloudflare Queue 默认会重试。如果一直失败，可以配置 Dead Letter Queue（DLQ）来捕获失败消息。

**Q: 免费额度够用吗？**
A: 个人使用完全够。Cloudflare Workers 每天 10 万次请求，Supabase 500MB 数据库存储数千篇文章绰绰有余。
