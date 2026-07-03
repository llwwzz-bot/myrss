// ============================================================
// RSS Collector Worker —— Webhook + Queue Consumer + 图片服务 + Obsidian
// ============================================================
import type { TelegramMessage, CollectTask } from './types';
import { extractContent } from './utils/extractors';
import { insertArticle, urlExists } from './utils/supabase';
import { generateAIInsights, generateObsidianDoc } from './utils/ai';
import { uploadImageToR2, uploadBase64ToR2, extractImageUrls, replaceImageUrls } from './utils/r2';
import { generateObsidianMd, pushToGithub, obsidianFilePath } from './utils/obsidian';

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  ALLOWED_USERS: string;
  COLLECT_QUEUE: Queue<CollectTask>;
  IMAGE_BUCKET: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  DEEPSEEK_API_KEY: string;
  RENDER_PROXY_URL: string;
  RENDER_PROXY_KEY: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

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

async function serveImage(url: URL, env: Env): Promise<Response> {
  const key = url.pathname.replace('/img/', 'articles/').replace(/\/$/, '');
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

async function processAndSave(env: Env, targetUrl: string, workerHost: string): Promise<string> {
  const articleId = crypto.randomUUID();
  const article = await extractContent(env, targetUrl);

  const imgUrls = extractImageUrls(article.content);
  const uploads: Array<{ originalUrl: string; r2Url: string }> = [];

  for (let i = 0; i < imgUrls.length; i++) {
    const imgUrl = imgUrls[i];
    let result = null;
    if (imgUrl.startsWith('data:image/')) {
      result = await uploadBase64ToR2(env.IMAGE_BUCKET, workerHost, imgUrl, articleId, i);
    } else {
      result = await uploadImageToR2(env.IMAGE_BUCKET, workerHost, imgUrl, articleId, i);
    }
    if (result) uploads.push(result);
  }

  const finalContent = uploads.length > 0 ? replaceImageUrls(article.content, uploads) : article.content;

  // 链路 1: 通用摘要（Supabase / RSS）
  const ai = await generateAIInsights(env.DEEPSEEK_API_KEY, article.title, article.plainText);

  // 链路 2: 分类 + 生产型文档（Obsidian）—— 并行调用
  const obsidianPromise = env.GITHUB_TOKEN && env.GITHUB_REPO
    ? generateObsidianDoc(env.DEEPSEEK_API_KEY, article.title, article.plainText)
    : Promise.resolve(null);

  const id = await insertArticle(env, {
    url: article.url,
    title: article.title,
    author: article.author,
    publishedAt: article.publishedAt,
    content: finalContent,
    plainText: article.plainText,
    platform: article.platform,
    coverImage: article.coverImage,
    summary: ai.summary,
    outline: ai.outline,
    viewpoints: ai.viewpoints,
  }, articleId);

  const obsidianDoc = await obsidianPromise;
  if (obsidianDoc) {
    try {
      const md = generateObsidianMd(article, ai, obsidianDoc, uploads);
      const filePath = obsidianFilePath(article, ai);
      const pushResult = await pushToGithub(env, filePath, md);
      if (!pushResult.ok) console.warn(`GitHub push failed: ${filePath} - ${pushResult.error}`);
    } catch (e: any) {
      console.warn(`Obsidian flow failed: ${e.message}`);
    }
  }

  return id;
}

async function handleDebug(req: Request, env: Env): Promise<Response> {
  const testUrl = new URL(req.url).searchParams.get('url');
  if (!testUrl) return new Response('缺少 ?url=', { status: 400 });

  const lines: string[] = [];
  try {
    lines.push('1. 检查去重...');
    const exists = await urlExists(env, testUrl);
    if (exists) return new Response(lines.join('\n') + '\n   已存在');

    const proxyOn = !!env.RENDER_PROXY_URL;
    lines.push('2. 提取内容 (代理: ' + (proxyOn ? 'ON' : 'OFF') + ')...');
    if (proxyOn) {
      lines.push('   代理地址: ' + env.RENDER_PROXY_URL);
      try {
        const testResp = await fetch(env.RENDER_PROXY_URL + '/health');
        const testJson: any = await testResp.json();
        lines.push('   代理连通: ' + (testJson.ok ? 'OK' : 'FAIL'));
      } catch (e: any) {
        lines.push('   代理连通: FAIL - ' + (e?.message || 'unknown'));
      }
    }
    const host = new URL(req.url).host;
    const article = await extractContent(env, testUrl);
    lines.push(`   标题: ${article.title}`);
    lines.push(`   平台: ${article.platform}`);

    const imgUrls = extractImageUrls(article.content);
    lines.push(`3. 处理图片 (${imgUrls.length} 张)...`);
    const uploads: Array<{ originalUrl: string; r2Url: string }> = [];
    for (let i = 0; i < imgUrls.length; i++) {
      const imgUrl = imgUrls[i];
      let r = null;
      if (imgUrl.startsWith('data:image/')) {
        r = await uploadBase64ToR2(env.IMAGE_BUCKET, host, imgUrl, 'debug', i);
      } else {
        r = await uploadImageToR2(env.IMAGE_BUCKET, host, imgUrl, 'debug', i);
      }
      if (r) uploads.push(r);
      const prefix = imgUrl.startsWith('data:') ? 'base64' : 'http';
      lines.push(`   [${i + 1}/${imgUrls.length}] ${r ? 'OK' : 'FAIL'} (${prefix}): ${imgUrl.slice(0, 60)}...`);
    }

    const finalContent = uploads.length > 0 ? replaceImageUrls(article.content, uploads) : article.content;

    // 链路 1: 通用摘要
    lines.push('4. AI 分析 (链路 1: Supabase)...');
    const ai = await generateAIInsights(env.DEEPSEEK_API_KEY, article.title, article.plainText);
    lines.push(`   摘要: ${(ai.summary || '').slice(0, 80)}...`);
    lines.push(`   技术要点: ${(ai.techPoints || '').slice(0, 80)}...`);
    lines.push(`   标签: [${ai.tags.join(', ')}]`);

    // 链路 2: Obsidian 分类文档
    if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
      lines.push('4b. AI 分类 (链路 2: Obsidian)...');
    }
    const aiStart = Date.now();
    const obsidianDocPromise = env.GITHUB_TOKEN && env.GITHUB_REPO
      ? generateObsidianDoc(env.DEEPSEEK_API_KEY, article.title, article.plainText)
      : Promise.resolve(null);

    lines.push('5. 写入 Supabase...');
    const id = await insertArticle(env, {
      url: article.url, title: article.title, author: article.author,
      publishedAt: article.publishedAt, content: finalContent,
      plainText: article.plainText, platform: article.platform, coverImage: article.coverImage,
      summary: ai.summary, outline: ai.outline, viewpoints: ai.viewpoints,
    });
    lines.push(`   成功! ID: ${id}`);

    const obsidianDoc = await obsidianDocPromise;
    if (obsidianDoc) {
      lines.push(`   文档类型: ${obsidianDoc.type} (${Date.now() - aiStart}ms)`);
      lines.push('6. 推送 Obsidian...');
      try {
        const md = generateObsidianMd(article, ai, obsidianDoc, uploads);
        const filePath = obsidianFilePath(article, ai);
        const pushResult = await pushToGithub(env, filePath, md);
        lines.push(`   ${pushResult.ok ? 'OK' : 'FAIL'}: ${filePath}`);
        if (!pushResult.ok && pushResult.error) lines.push(`   原因: ${pushResult.error}`);
      } catch (e: any) {
        lines.push(`   FAIL: ${e.message}`);
      }
    } else {
      lines.push('6. 跳过 Obsidian (未配置)');
    }

    return new Response(lines.join('\n'));
  } catch (err: any) {
    lines.push(`X 失败: ${err?.message || err}`);
    return new Response(lines.join('\n'), { status: 500 });
  }
}

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

function reqHost(env: Env): string {
  return 'rss-collector.liwenzhestudy.workers.dev';
}