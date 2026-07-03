# RSS 个人采集系统

Telegram 发链接 → AI 分析 → Supabase + Obsidian 知识库 + RSS 阅读器

## 架构

```
Telegram Bot ──▶ CF Worker (webhook) ──▶ Queue ──▶ 内容提取
                                                      │
                          ┌───────────────────────────┤
                          ▼                           ▼
                   Puppeteer 代理                Readability
                   (B站/知乎/公众号)             (通用网站)
                          │                           │
                          └───────────┬───────────────┘
                                      ▼
                              DeepSeek AI
                          (摘要·目录·观点·技术要点)
                                      │
                          ┌───────────┼───────────┐
                          ▼           ▼           ▼
                      Supabase     GitHub      RSS 阅读器
                     (文章存档)  (Obsidian)  (Fluent Reader)
```

## 功能

| 功能 | 说明 |
|------|------|
| 🤖 Telegram Bot | 发链接即采集，自动去重 |
| 📄 通用网站 | Readability 正文提取 |
| 🎬 B站/知乎/公众号 | Puppeteer 渲染代理（国内服务器 + Cloudflare Tunnel） |
| 🖼️ 图片处理 | 自动搬 R2，防盗链图片转 base64 再上传 |
| 🧠 AI 分析 | DeepSeek：摘要、目录、观点、技术要点、标签 |
| 📚 Supabase | 结构化存储，全文检索 |
| 📡 RSS | Fluent Reader / Read You 随时阅读 |
| 🗂️ Obsidian | 自动生成 .md → GitHub → Obsidian Git 同步 |

## 前置准备

| 服务 | 用途 | 免费额度 |
|------|------|---------|
| [Cloudflare](https://dash.cloudflare.com) | Worker + Queue + R2 | 10万次/天, 10GB R2 |
| [Supabase](https://supabase.com) | 数据库 | 500MB, 无限 API |
| Telegram [@BotFather](https://t.me/BotFather) | Bot | 免费 |
| [DeepSeek](https://platform.deepseek.com) | AI 分析 | 送 500万 tokens |
| GitHub | Obsidian 同步 | 免费 |
| 国内云服务器 | 渲染代理（B站/知乎） | 阿里云约 ¥60/月 |

## 部署

### 1. 本地环境

```bash
node -v          # Node 18+
npm install -g wrangler
wrangler login
```

### 2. Telegram Bot

`@BotFather` → `/newbot` → 获取 Token。`@userinfobot` → 获取你的 User ID。

### 3. Supabase

创建项目 → SQL Editor 执行 `sql/schema.sql` → Project Settings → API 复制 `Project URL` 和 `service_role key`。

### 4. DeepSeek API

[platform.deepseek.com](https://platform.deepseek.com) → API Keys → 创建 Key。

### 5. Cloudflare 资源

```bash
wrangler r2 bucket create rss-images
wrangler queues create collect-queue
```

### 6. 配置环境变量

编辑 `wrangler.toml`：

```toml
[vars]
TELEGRAM_BOT_TOKEN = "你的 Bot Token"
ALLOWED_USERS = "你的 Telegram User ID"
```

设置 Secrets：

```bash
wrangler secret put SUPABASE_URL           # https://xxx.supabase.co
wrangler secret put SUPABASE_SERVICE_KEY   # eyJ...
wrangler secret put DEEPSEEK_API_KEY       # sk-...
wrangler secret put RENDER_PROXY_URL       # https://rss-render.你的域名
wrangler secret put RENDER_PROXY_KEY       # 代理 API Key
wrangler secret put GITHUB_TOKEN           # ghp_...（contents write 权限）
wrangler secret put GITHUB_REPO            # 用户名/仓库名
```

### 7. 渲染代理服务器

在阿里云等国内服务器上部署 `render-proxy/`：

```bash
cd render-proxy
npm install
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

首次需配置 Cloudflare Named Tunnel：

```bash
cloudflared tunnel login
cloudflared tunnel create rss-render
cloudflared tunnel route dns rss-render rss-render.你的域名
cat > ~/.cloudflared/config.yml << EOF
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<uuid>.json
ingress:
  - hostname: rss-render.你的域名
    service: http://localhost:3456
  - service: http_status:404
EOF
pm2 start ecosystem.config.js
```

### 8. 部署 Worker

```bash
npx wrangler deploy            # 主 Worker
npx wrangler deploy --env rss  # RSS Worker
```

### 9. 设置 Webhook

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://rss-collector.你的域名.workers.dev/webhook"}'
```

### 10. Obsidian 配置

1. GitHub 上创建仓库
2. Clone 到本地作为 Obsidian Vault
3. 装 [Obsidian Git](https://github.com/Vinzent03/obsidian-git) 插件
4. 插件设置中开启 **Auto pull interval**（如 5 分钟）
5. 如在国内，配置代理或使用 Gitee 镜像

## 使用

1. 手机上分享链接 → Telegram → 发给你的 Bot
2. Bot 回复确认，后台自动处理
3. RSS 阅读器（Fluent Reader / Read You）订阅 `https://rss-collector.你的域名.workers.dev/rss`
4. Obsidian 自动同步 Markdown 笔记

## 项目结构

```
rss/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── sql/schema.sql
├── render-proxy/               # 国内服务器 Puppeteer 渲染代理
│   ├── index.js
│   ├── ecosystem.config.js
│   └── package.json
└── src/
    ├── types.ts
    ├── webhook.ts              # Worker 主入口（Webhook + Queue + Debug）
    ├── rss.ts                  # RSS 生成
    └── utils/
        ├── extractors.ts       # 内容提取（通用 + 渲染代理）
        ├── ai.ts               # DeepSeek AI 分析
        ├── supabase.ts         # Supabase 操作
        ├── r2.ts               # R2 图片存储（含 base64 支持）
        └── obsidian.ts         # Obsidian MD 生成 + GitHub 推送
```

## 常见问题

**Q: B站/知乎图片不显示？**
A: 渲染代理已内置 base64 转 R2。检查 Worker 的 `/debug?url=...` 端点输出。

**Q: Worker 返回 502？**
A: 通常是 AI 调用超时或 Render 代理不可达。检查 `npx wrangler tail` 日志。

**Q: 代理连通性 FAIL？**
A: 检查服务器 `npx pm2 list` 确保 `rss-render-proxy` 和 `cloudflared-tunnel` 都在线。