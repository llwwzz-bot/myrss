// ============================================================
// 内容提取器 —— 通用 + 渲染代理（B站/知乎/公众号）
// ============================================================
import type { ArticleData, Platform } from '../types';

interface Env {
  IMAGE_BUCKET: R2Bucket;
  RENDER_PROXY_URL?: string;
  RENDER_PROXY_KEY?: string;
}

// ── 调用渲染代理 ──
async function renderViaProxy(env: Env, url: string, platform: string): Promise<{ html: string; title: string; author: string } | null> {
  if (!env.RENDER_PROXY_URL || !env.RENDER_PROXY_KEY) return null;
  try {
    const resp = await fetch(`${env.RENDER_PROXY_URL}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.RENDER_PROXY_KEY,
      },
      body: JSON.stringify({ url, platform }),
    });
    const json: any = await resp.json();
    if (!json.ok) return null;
    return { html: json.html || '', title: json.title || '', author: json.author || '' };
  } catch {
    return null;
  }
}

// ── 通用提取（Readability）──
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

// ── 渲染代理提取（B站/知乎/公众号）—— 代理已返回干净内容+base64图片，跳过 Readability
async function extractViaProxy(env: Env, url: string, platform: string): Promise<Omit<ArticleData, 'platform'>> {
  const result = await renderViaProxy(env, url, platform);
  if (!result || !result.html) {
    try { return await extractGeneric(url); } catch {
      return { url, title: '提取失败', author: '', publishedAt: new Date().toISOString(), content: '<p>渲染代理不可用</p>', plainText: '' };
    }
  }

  const title = result.title || '无标题';
  const author = result.author || '';
  const content = result.html.startsWith('<') ? result.html : `<div>${result.html}</div>`;
  const plainText = result.html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 500);

  return { url, title, author, publishedAt: new Date().toISOString(), content, plainText };
}

// ── 公众号 ──
async function extractWechat(env: Env, url: string): Promise<Omit<ArticleData, 'platform'>> {
  return extractViaProxy(env, url, 'wechat');
}

// ── 哔哩哔哩 ──
async function extractBilibili(env: Env, url: string): Promise<Omit<ArticleData, 'platform'>> {
  if (url.includes('b23.tv') || url.includes('m.bilibili.com')) {
    try {
      const resp = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/125.0.0.0 Safari/537.36' },
      });
      const location = resp.headers.get('location');
      if (location) {
        url = location.startsWith('http') ? location : 'https://www.bilibili.com' + location;
        url = url.replace('m.bilibili.com', 'www.bilibili.com');
      }
    } catch { /* keep original */ }
  }
  return extractViaProxy(env, url, 'bilibili');
}

// ── 知乎 ──
async function extractZhihu(env: Env, url: string): Promise<Omit<ArticleData, 'platform'>> {
  return extractViaProxy(env, url, 'zhihu');
}

// ── Twitter ──
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
    content: description ? `<p>${description}</p>` : '<p>需通过 Twitter API 获取</p>',
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

// ── 平台判断 ──
export function detectPlatform(url: string): Platform {
  const u = url.toLowerCase();
  if (u.includes('mp.weixin.qq.com')) return 'wechat';
  if (u.includes('bilibili.com') || u.includes('b23.tv')) return 'bilibili';
  if (u.includes('zhihu.com')) return 'zhihu';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  return 'generic';
}

// ── 统一提取入口 ──
export async function extractContent(env: Env, url: string): Promise<ArticleData> {
  const platform = detectPlatform(url);
  let data: Omit<ArticleData, 'platform'>;
  switch (platform) {
    case 'wechat':   data = await extractWechat(env, url); break;
    case 'bilibili': data = await extractBilibili(env, url); break;
    case 'zhihu':    data = await extractZhihu(env, url); break;
    case 'twitter':  data = await extractTwitter(url); break;
    default:         data = await extractGeneric(url); break;
  }
  return { ...data, platform };
}