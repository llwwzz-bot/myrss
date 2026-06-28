// ============================================================
// RSS Collector Worker —— Webhook + Queue Consumer + 图片服务
// ============================================================
import type { TelegramMessage, CollectTask } from './types';
import { extractContent } from './utils/extractors';
import { insertArticle, urlExists } from './utils/supabase';
import { generateAIInsights } from './utils/ai';
import { uploadImageToR2, extractImageUrls, replaceImageUrls } from './utils/r2';

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  ALLOWED_USERS: string;
  COLLECT_QUEUE: Queue<CollectTask>;
  IMAGE_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  DEEPSEEK_API_KEY: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // R2 图片服务
    if (url.pathname.startsWith('/img/')) {
      return serveImage(url, env);
    }

    if (url.pathname === '/webhook' && req.method === 'POST') {
      return handleTelegramWebhook(req, env);
    }

    if (url.pathname === '/debug') {
      return handleDebug(req, env);
    }

    return new Response('RSS Collector is running', { status: 200 });
  },

  async queue(batch: MessageBatch<CollectTask>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const task = msg.body;
      try {
        const exists = await urlExists(env, task.url);
        if (exists) { msg.ack(); continue; }

        await processAndSave(env, task.url, reqHost(env));
        msg.ack();
      } catch (err: any) {
        if (msg.attempts < 2) {
          msg.retry({ delaySeconds: 10 });
        } else {
          msg.ack();
        }
      }
    }
  },
};

// ── R2 图片服务 ──
async function serveImage(url: URL, env: Env): Promise<Response> {
  const key = url.pathname.replace('/img/', 'articles/').replace(/\/$/, '');
  // 尝试常见扩展名
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
    const obj = await env.IMAGE_BUCKET.get(`${key}.${ext}`);
    if (obj) {
      return new Response(obj.body, {
        headers: {
          'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }
  }
  return new Response('Not Found', { status: 404 });
}

// ── 核心处理：提取 → 下载图片 → 存库 ──
async function processAndSave(env: Env, targetUrl: string, workerHost: string): Promise<string> {
  const articleId = crypto.randomUUID();
  const article = await extractContent(env, targetUrl);

  // 提取并上传图片
  const imgUrls = extractImageUrls(article.content);
  const uploads: Array<{ originalUrl: string; r2Url: string }> = [];
  for (let i = 0; i < imgUrls.length; i++) {
    const result = await uploadImageToR2(env.IMAGE_BUCKET, workerHost, imgUrls[i], articleId, i);
    if (result) uploads.push(result);
  }

  // 替换图片链接
  const finalContent = uploads.length > 0 ? replaceImageUrls(article.content, uploads) : article.content;

    // AI 摘要
  const ai = await generateAIInsights(env.DEEPSEEK_API_KEY, article.title, article.plainText);

  return insertArticle(env, {
    url: article.url,
    title: article.title,
    author: article.author,
    publishedAt: article.publishedAt,
    content: finalContent,
    plainText: article.plainText,
    platform: article.platform,
    coverImage: article.coverImage, summary: ai.summary, outline: ai.outline, viewpoints: ai.viewpoints,
  }, articleId);
}

// ── 调试端点 ──
async function handleDebug(req: Request, env: Env): Promise<Response> {
  const testUrl = new URL(req.url).searchParams.get('url');
  if (!testUrl) return new Response('缺少 ?url=', { status: 400 });

  const lines: string[] = [];
  try {
    lines.push('1. 检查去重...');
    const exists = await urlExists(env, testUrl);
    if (exists) return new Response(lines.join('\n') + '\n   已存在');

    lines.push('2. 提取内容...');
    const host = new URL(req.url).host;
    const article = await extractContent(env, testUrl);
    lines.push(`   标题: ${article.title}`);
    lines.push(`   平台: ${article.platform}`);

    // 图片处理
    const imgUrls = extractImageUrls(article.content);
    lines.push(`3. 处理图片 (${imgUrls.length} 张)...`);
    const uploads: Array<{ originalUrl: string; r2Url: string }> = [];
    for (let i = 0; i < imgUrls.length; i++) {
      const r = await uploadImageToR2(env.IMAGE_BUCKET, host, imgUrls[i], 'debug', i);
      if (r) uploads.push(r);
      lines.push(`   [${i + 1}/${imgUrls.length}] ${r ? 'OK' : 'FAIL'}: ${imgUrls[i].slice(0, 60)}...`);
    }

    const finalContent = uploads.length > 0 ? replaceImageUrls(article.content, uploads) : article.content;

        // AI 摘要
    lines.push('4. AI 分析...');
    const ai = await generateAIInsights(env.DEEPSEEK_API_KEY, article.title, article.plainText);
    if (ai.summary) lines.push('   摘要: ' + ai.summary);
    if (ai.outline) lines.push('   目录: ' + ai.outline.replace(/\\n/g, '\\n         '));
    if (ai.viewpoints) lines.push('   观点: ' + ai.viewpoints.replace(/\\n/g, '\\n         '));
    lines.push('5. 写入 Supabase...');
    const id = await insertArticle(env, {
      url: article.url, title: article.title, author: article.author,
      publishedAt: article.publishedAt, content: finalContent,
      plainText: article.plainText, platform: article.platform, coverImage: article.coverImage, summary: ai.summary, outline: ai.outline, viewpoints: ai.viewpoints,
    });
    lines.push(`   成功! ID: ${id}`);
    return new Response(lines.join('\n'));
  } catch (err: any) {
    lines.push(`X 失败: ${err?.message || err}`);
    return new Response(lines.join('\n'), { status: 500 });
  }
}

// ── Telegram Webhook ──
async function handleTelegramWebhook(req: Request, env: Env): Promise<Response> {
  try {
    const body: { message?: TelegramMessage } = await req.json();
    if (!body.message?.text) return new Response('OK');

    const msg = body.message;
    const text = msg.text.trim();
    const userId = String(msg.from?.id || '');

    const allowed = env.ALLOWED_USERS.split(',').map(s => s.trim());
    if (allowed.length > 0 && !allowed.includes(userId)) {
      await sendTelegram(env, msg.chat.id, '你没有权限');
      return new Response('OK');
    }

    const match = text.match(/https?:\/\/[^\s]+/);
    if (!match) {
      await sendTelegram(env, msg.chat.id, '请发送一个链接');
      return new Response('OK');
    }

    await env.COLLECT_QUEUE.send({
      url: match[0], userId, chatId: msg.chat.id,
      messageId: msg.message_id, source: 'telegram',
      submittedAt: new Date().toISOString(),
    });

    await sendTelegram(env, msg.chat.id, `已收到链接，正在后台处理…\n${match[0]}`);
    return new Response('OK');
  } catch (err: any) {
    return new Response(`Error: ${err?.message || err}`, { status: 500 });
  }
}

async function sendTelegram(env: Env, chatId: number, text: string): Promise<boolean> {
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const result: any = await resp.json();
  return result.ok === true;
}

// 从环境推断 Worker 域名（queue 上下文没有请求 URL）
function reqHost(env: Env): string {
  return 'rss-collector.liwenzhestudy.workers.dev';
}
