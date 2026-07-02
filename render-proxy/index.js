// ============================================================
// RSS 渲染代理 —— Puppeteer 无头浏览器 HTTP 服务
// ============================================================

const express = require('express');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 3456;
const API_KEY = process.env.API_KEY || 'change-me-to-a-random-string';

const app = express();
app.use(express.json({ limit: '1mb' }));

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

function auth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key || '';
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// 下载图片转 base64（服务端国内 IP，不受防盗链影响）
async function inlineImages(html, platform, limit = 20) {
  const imgs = [...html.matchAll(/<img[^>]+src="([^"]+)"[^>]*>/gi)];
  const seen = new Set();
  const tasks = [];

  for (const m of imgs) {
    const url = m[1];
    if (!url.startsWith('http') || seen.has(url) || seen.size >= limit) continue;
    seen.add(url);
    tasks.push((async () => {
      try {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0 Safari/537.36',
            'Referer': platform === 'bilibili' ? 'https://www.bilibili.com/'
                     : platform === 'zhihu' ? 'https://www.zhihu.com/'
                     : url,
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) return null;
        const buf = Buffer.from(await resp.arrayBuffer());
        const ct = resp.headers.get('content-type') || 'image/jpeg';
        return { url, dataUri: `data:${ct};base64,${buf.toString('base64')}` };
      } catch { return null; }
    })());
  }

  const results = await Promise.all(tasks);
  let out = html;
  for (const r of results) {
    if (r) out = out.replaceAll(r.url, r.dataUri);
  }
  return out;
}

app.post('/render', auth, async (req, res) => {
  const { url, platform } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  let page = null;
  try {
    const b = await getBrowser();
    page = await b.newPage();

    const userAgents = {
      wechat: 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.0',
      zhihu:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
      bilibili:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
    };
    await page.setUserAgent(userAgents[platform] || userAgents.bilibili);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });

    if (platform === 'bilibili') {
      await page.setExtraHTTPHeaders({
        'Referer': 'https://www.bilibili.com/',
        ...(await page.extraHTTPHeaders?.() || {}),
      });
    }

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 25000,
    });

    const selectors = {
      wechat: '#js_content',
      zhihu: '.Post-RichText, .RichText, .RichContent-inner',
      bilibili: '.article-content, #read-article-holder',
    };
    const sel = selectors[platform];
    if (sel) {
      try { await page.waitForSelector(sel, { timeout: 10000 }); } catch {}
    }

    // 滚动触发懒加载
    await page.evaluate(async () => {
      const delay = (ms) => new Promise(r => setTimeout(r, ms));
      const h = document.documentElement.scrollHeight;
      for (let y = 0; y < h; y += 500) {
        window.scrollTo(0, y);
        await delay(150);
      }
      window.scrollTo(0, 0);
      await delay(500);
    });

    await page.waitForNetworkIdle({ timeout: 10000, idleTime: 1000 }).catch(() => {});

    const result = await page.evaluate((p) => {
      function absUrl(src) {
        if (!src) return '';
        if (/^(https?:|data:|\/\/)/i.test(src)) return src.startsWith('//') ? 'https:' + src : src;
        try { return new URL(src, location.href).href; } catch { return src; }
      }

      // 修复懒加载
      document.querySelectorAll('img').forEach(img => {
        const realSrc = img.getAttribute('data-src')
          || img.getAttribute('data-original')
          || img.getAttribute('data-lazy-src')
          || img.getAttribute('src');
        if (realSrc && !realSrc.startsWith('data:')) {
          img.setAttribute('src', absUrl(realSrc));
        }
      });

      let title = '', author = '', content = '';

      if (p === 'wechat') {
        title = document.querySelector('#activity-name')?.textContent?.trim() || document.title || '';
        content = document.querySelector('#js_content')?.innerHTML || '';
        author = document.querySelector('#js_name')?.textContent?.trim() || '';
      } else if (p === 'zhihu') {
        title = (document.querySelector('h1.Post-Title') || document.querySelector('h1.QuestionHeader-title') || document.querySelector('.QuestionHeader-title') || document.querySelector('.ContentItem-title'))?.textContent?.trim() || document.title || '';
        content = (document.querySelector('.Post-RichText') || document.querySelector('.RichText') || document.querySelector('.RichContent-inner'))?.innerHTML || '';
        const authorEl = document.querySelector('.AuthorInfo-name span, .AuthorInfo-name');
        author = authorEl?.textContent?.trim() || '';
      } else if (p === 'bilibili') {
        title = (document.querySelector('h1.title') || document.querySelector('.article-title') || document.querySelector('[data-title]') || document.querySelector('h1'))?.textContent?.trim() || document.title || '';
        content = (document.querySelector('.article-content') || document.querySelector('#read-article-holder'))?.innerHTML || '';
        author = (document.querySelector('.up-name') || document.querySelector('.username') || document.querySelector('.author-name'))?.textContent?.trim() || '';
      }

      return {
        title: title.replace(/\s+/g, ' ').trim(),
        content,
        author: author.replace(/\s+/g, ' ').trim(),
      };
    }, platform);

    let html = result.content || await page.evaluate(() => document.body?.innerHTML || '');

    // B站/知乎/公众号：服务端下载图片转 base64（绕过防盗链）
    if (['bilibili', 'zhihu', 'wechat'].includes(platform)) {
      html = await inlineImages(html, platform);
    }

    res.json({ ok: true, html, title: result.title, author: result.author });
  } catch (err) {
    console.error(`Render failed for ${url}:`, err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, browser: !!(browser && browser.isConnected()) });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Render proxy running on http://0.0.0.0:${PORT}`);
  console.log(`API Key required in X-API-Key header`);
});

process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit(0);
});