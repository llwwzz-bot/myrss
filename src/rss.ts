// ============================================================
// RSS 生成 Worker
// ============================================================
import { getReadyArticles } from './utils/supabase';
import type { ArticleRecord } from './types';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/rss' || url.pathname === '/rss.xml') {
      return generateRSS(req, env);
    }
    return new Response('Not Found', { status: 404 });
  },
};

async function generateRSS(req: Request, env: Env): Promise<Response> {
  try {
    const articles = await getReadyArticles(env, 100);
    const rssXml = buildRssXml(articles, req.url);
    return new Response(rssXml, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    console.error('RSS error:', err);
    return new Response('Internal Error', { status: 500 });
  }
}

function buildRssXml(articles: ArticleRecord[], reqUrl: string): string {
  const baseUrl = reqUrl.replace(/\/rss(\.xml)?.*$/, '');

  const items = articles.map(a => {
    const cards = buildCards(a);
    return `
    <item>
      <title><![CDATA[${esc(a.title)}]]></title>
      <link>${esc(a.url)}</link>
      <guid isPermaLink="true">${esc(a.url)}</guid>
      <description><![CDATA[${a.summary ? 'AI 摘要 ' + a.summary + '\n\n' : ''}${a.plain_text || ''}]]></description>
      <content:encoded><![CDATA[${cards}${a.content || ''}]]></content:encoded>
      <author>${esc(a.author)}</author>
      <pubDate>${new Date(a.published_at).toUTCString()}</pubDate>
      ${a.cover_image ? '<enclosure url="' + esc(a.cover_image) + '" type="image/jpeg"/>' : ''}
      <category>${esc(a.platform)}</category>
    </item>
  `}).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>我的 RSS 收藏</title>
    <link>${esc(baseUrl)}</link>
    <description>个人信息采集管道</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${esc(reqUrl)}" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;
}

function buildCards(a: ArticleRecord): string {
  let html = '';

  // 摘要卡片
  if (a.summary) {
    html += '<div style="background:#f0f7ff;padding:12px 16px;border-left:4px solid #4a90d9;margin:0 0 12px;border-radius:4px;font-size:15px;"><b>AI 摘要</b> ' + a.summary + '</div>';
  }

  // 目录卡片
  if (a.outline) {
    const items = a.outline.split('\n').filter(l => l.trim()).map(l => '<li>' + esc(l.replace(/^-\s*/, '')) + '</li>').join('');
    html += '<details open style="background:#fdf6e3;padding:12px 16px;margin:0 0 12px;border-radius:4px;font-size:14px;"><summary style="font-weight:bold;cursor:pointer;">📑 文章目录</summary><ul style="margin:8px 0 0;padding-left:20px;">' + items + '</ul></details>';
  }

  // 观点卡片
  if (a.viewpoints) {
    const lines = a.viewpoints.split('\n').filter(l => l.trim()).map(l => {
      const colon = l.indexOf('：');
      if (colon === -1) return '<p style="margin:4px 0;">' + esc(l) + '</p>';
      const label = l.slice(0, colon);
      const value = l.slice(colon + 1);
      return '<p style="margin:4px 0;"><b>' + esc(label) + '</b>' + esc(value) + '</p>';
    }).join('');
    html += '<div style="background:#f3e8ff;padding:12px 16px;border-left:4px solid #7c3aed;margin:0 0 12px;border-radius:4px;font-size:14px;"><b>💡 观点提炼</b><div style="margin-top:6px;">' + lines + '</div></div>';
  }

  return html;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
