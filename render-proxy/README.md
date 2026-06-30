# 渲染代理 —— 云服务器部署指南

## 部署步骤（在云服务器上执行）

### 1. 安装 Node.js 18+
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. 安装 Chromium 依赖（Puppeteer 需要）
```bash
sudo apt-get install -y \
  ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
  libatk1.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 \
  libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 \
  xdg-utils
```

### 3. 上传 render-proxy 目录到服务器
```bash
scp -r render-proxy/ user@your-server:/opt/rss-render-proxy/
```

### 4. 安装依赖
```bash
cd /opt/rss-render-proxy
npm install
```

### 5. 修改配置
编辑 `ecosystem.config.js`，把 `API_KEY` 改成随机字符串：
```js
API_KEY: '生成一个随机字符串，如 openssl rand -hex 32',
```

### 6. 启动服务
```bash
npm run pm2:start
pm2 save
pm2 startup   # 设置开机自启
```

### 7. 验证
```bash
curl http://localhost:3456/health
# → {"ok":true,"browser":true}
```

### 8. 开放端口（如用防火墙）
```bash
# 仅对 Cloudflare Workers 的 IP 开放，不建议直接暴露公网
# 更好的做法：用 Nginx 反代 + HTTPS + 仅允许你 Worker 的出口 IP
```

推荐用 Caddy 或 Nginx 反代加 HTTPS：
```
# Caddyfile 示例（最简单）
rss-render.yourdomain.com {
  reverse_proxy localhost:3456
}
```

## Worker 配置

云服务器跑起来后，设 Worker 环境变量：
```bash
wrangler secret put RENDER_PROXY_URL
# 输入: https://rss-render.yourdomain.com  （或 http://你的服务器IP:3456）

wrangler secret put RENDER_PROXY_KEY
# 输入: 和 ecosystem.config.js 里一样的 API_KEY
```

然后部署：`wrangler deploy`

## 测试

```
https://rss-collector.liwenzhestudy.workers.dev/debug?url=https://www.bilibili.com/read/cvxxxxx
```

输出里平台应该显示 `bilibili`，内容不再是 412 错误。
