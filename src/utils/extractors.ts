// ============================================================
// 内容提取器 —— 针对不同平台
// ============================================================
import type { ArticleData, Platform } from '../types';

interface Env {
  IMAGE_BUCKET: R2Bucket;
}

// ── 通用提取（Readability + linkedom）──
async function extractGeneric(url: string): Promise<Omit<ArticleData, 'platform'>> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });
  const html = await resp.text();

  const { parseHTML } = await import('linkedom');
  const { Readability } = await import('@mozilla/readability');
  const { document: doc } = parseHTML(html);
  const reader = new Readability(doc);
  const parsed = reader.parse();

  if (!parsed) throw new Error('无法提取页面内容');

  return {
    url,
    title: parsed.title || '无标题',
    author: parsed.byline || '未知作者',
    publishedAt: new Date().toISOString(),
    content: parsed.content || '',
    plainText: parsed.textContent?.slice(0, 500) || '',
  };
}


// ── 哔哩哔哩（加 Referer 走通用提取，412 则 OG 兜底）──
async function extractBilibili(url: string): Promise<Omit<ArticleData, 'platform'>> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://www.bilibili.com/',
      'Origin': 'https://www.bilibili.com',
    },
  });
  const html = await resp.text();

  let title = '';
  let author = 'B站作者';
  let content = '';
  let plainText = '';
  let coverImage = '';
  let isBlocked = false;

  // 尝试 Readability
  try {
    const { parseHTML } = await import('linkedom');
    const { Readability } = await import('@mozilla/readability');
    const { document: doc } = parseHTML(html);
    const reader = new Readability(doc);
    const parsed = reader.parse();
    if (parsed) {
      title = parsed.title || '';
      author = parsed.byline || 'B站作者';
      content = parsed.content || '';
      plainText = parsed.textContent?.slice(0, 500) || '';
    }
  } catch { /* 解析失败继续 */ }

  // 判断是否命中反爬
  isBlocked = (!title || title.includes('出错啦') || title.includes('412') || content.length < 100);

  // 反爬则用 OG 标签兜底
  if (isBlocked) {
    title = extractMeta(html, 'og:title') || 'B站文章';
    const desc = extractMeta(html, 'og:description') || '';
    coverImage = extractMeta(html, 'og:image') || '';
    content = desc ? `<p>${desc}</p>` : '<p>B站反爬限制，仅展示摘要。升级 Workers Paid 启用 Browser Rendering 可获取全文。</p>';
    plainText = desc.slice(0, 500);
  }

  return {
    url, title, author,
    publishedAt: new Date().toISOString(),
    content, plainText, coverImage,
  };
}

// ── Twitter（OG 标签提取）──
async function extractTwitter(url: string): Promise<Omit<ArticleData, 'platform'>> {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSS-Collector/1.0)' },
  });
  const html = await resp.text();
  const title = extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title') || 'Twitter 帖子';
  const author = extractMeta(html, 'twitter:creator') || 'Twitter 用户';
  const description = extractMeta(html, 'og:description') || extractMeta(html, 'twitter:description') || '';
  return {
    url, title, author,
    publishedAt: new Date().toISOString(),
    content: description ? `<p>${description}</p>` : '<p>需通过 Twitter API 获取完整正文</p>',
    plainText: description.slice(0, 500),
    coverImage: extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image') || '',
  };
}

function extractMeta(html: string, property: string): string | null {
  for (const p of [
    new RegExp(`<meta[^>]+property="${property}"[^>]+content="([^"]*)"`, 'i'),
    new RegExp(`<meta[^>]+name="${property}"[^>]+content="([^"]*)"`, 'i'),
    new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${property}"`, 'i'),
  ]) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}


// ── 知乎（Referer + Readability，JS 页面用 OG 兜底）──
async function extractZhihu(url: string): Promise<Omit<ArticleData, 'platform'>> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://www.zhihu.com/',
      'Origin': 'https://www.zhihu.com',
    },
  });
  const html = await resp.text();
  let title = ''; let author = '知乎作者'; let content = ''; let plainText = ''; let coverImage = '';
  try {
    const { parseHTML } = await import('linkedom');
    const { Readability } = await import('@mozilla/readability');
    const { document: doc } = parseHTML(html);
    const parsed = (new Readability(doc)).parse();
    if (parsed) {
      title = parsed.title || ''; author = parsed.byline || '知乎作者';
      content = parsed.content || ''; plainText = parsed.textContent?.slice(0, 500) || '';
    }
  } catch { /* ignore */ }
  const isBlocked = (!title || title === '无标题' || content.length < 200);
  if (isBlocked) {
    title = extractMeta(html, 'og:title') || '知乎文章';
    const desc = extractMeta(html, 'og:description') || '';
    coverImage = extractMeta(html, 'og:image') || '';
    content = desc ? '<p>' + desc + '</p>' : '<p>知乎由 JS 渲染，仅展示摘要。升级 Workers Paid 用 Browser Rendering 可获取全文。</p>';
    plainText = desc.slice(0, 500);
  }
  return { url, title, author, publishedAt: new Date().toISOString(), content, plainText, coverImage };
}

// ── 平台判断 ──
export function detectPlatform(url: string): Platform {
  const u = url.toLowerCase();
  if (u.includes('bilibili.com')) return 'bilibili';
  if (u.includes('zhihu.com')) return 'zhihu';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  return 'generic';
}

// ── 统一提取入口 ──
export async function extractContent(env: Env, url: string): Promise<ArticleData> {
  const platform = detectPlatform(url);
  let data: Omit<ArticleData, 'platform'>;
  switch (platform) {
    case 'twitter':  data = await extractTwitter(url); break;
    case 'bilibili': data = await extractBilibili(url); break;
    case 'zhihu':    data = await extractZhihu(url); break;
    
    default:         data = await extractGeneric(url); break;
  }
  return { ...data, platform };
}
