// ============================================================
// RSS 渲染代理 —— Puppeteer 无头浏览器 HTTP 服务
// 部署到国内云服务器，Workers Worker 调用此服务渲染页面
// ============================================================

const express = require('express');
const puppeteer = require('puppeteer');

// ====== 配置（部署时修改）======
const PORT = process.env.PORT || 3456;
const API_KEY = process.env.API_KEY || 'change-me-to-a-random-string';
// ================================

const app = express();
app.use(express.json({ limit: '1mb' }));

// 全局浏览器实例（复用，避免每次启动）
let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  const chromiumPath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
  return browser;
}

// 鉴权中间件
function auth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key || '';
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ====== POST /render —— 渲染页面并返回 HTML ======
app.post('/render', auth, async (req, res) => {
  const { url, platform } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  let page = null;
  try {
    const b = await getBrowser();
    page = await b.newPage();

    // 根据平台设置 UA（国内大厂都检查 UA）
    const userAgents = {
      wechat:
        'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.0',
      zhihu:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
      bilibili:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
    };
    const ua = userAgents[platform] || userAgents.bilibili;
    await page.setUserAgent(ua);

    // 额外请求头
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    });

    // 根据平台设置 Referer
    if (platform === 'bilibili') {
      await page.setExtraHTTPHeaders({
        'Referer': 'https://www.bilibili.com/',
        'Origin': 'https://www.bilibili.com',
        ...(await page.extraHTTPHeaders?.() || {}),
      });
    }

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 25000,
    });

    // 等待关键内容元素
    const selectors = {
      wechat: '#js_content',
      zhihu: '.Post-RichText, .RichText',
      bilibili: '.article-content, #read-article-holder',
    };
    const sel = selectors[platform];
    if (sel) {
      try {
        await page.waitForSelector(sel, { timeout: 8000 });
      } catch {
        // 没等到也不失败——有些页面可能没有目标选择器
      }
    }

    const result = await page.evaluate((p) => {
      let title = document.title || '';
      let content = '';
      let author = '';

      if (p === 'wechat') {
        title = document.querySelector('#activity-name')?.textContent?.trim() || title;
        content = document.querySelector('#js_content')?.innerHTML || '';
        author = document.querySelector('#js_name')?.textContent?.trim() || '';
      } else if (p === 'zhihu') {
        title = document.querySelector('h1.Post-Title, h1.QuestionHeader-title')?.textContent?.trim() || title;
        content = document.querySelector('.Post-RichText, .RichText')?.innerHTML || '';
        author = document.querySelector('.AuthorInfo-name span')?.textContent?.trim() || '';
      } else if (p === 'bilibili') {
        title = (document.querySelector('h1') || document.querySelector('.title'))?.textContent?.trim() || title;
        content = (document.querySelector('.article-content') || document.querySelector('#read-article-holder'))?.innerHTML || '';
        author = (document.querySelector('.username') || document.querySelector('.up-name'))?.textContent?.trim() || '';
      }

      return { title, content, author, url: location.href };
    }, platform);

    res.json({
      ok: true,
      html: result.content || document.body?.innerHTML,
      title: result.title,
      author: result.author,
    });
  } catch (err) {
    console.error(`Render failed for ${url}:`, err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

// ====== GET /health —— 健康检查 ======
app.get('/health', (req, res) => {
  res.json({ ok: true, browser: !!(browser && browser.isConnected()) });
});

// ====== 启动 ======
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Render proxy running on http://0.0.0.0:${PORT}`);
  console.log(`API Key required in X-API-Key header`);
});

// 优雅退出
process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit(0);
});
