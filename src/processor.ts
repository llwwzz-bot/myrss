// ============================================================
// Queue Consumer —— 消费采集任务，提取内容并存库
// ============================================================
import type { CollectTask } from './types';
import { detectPlatform, extractContent } from './utils/extractors';
import { insertArticle, urlExists } from './utils/supabase';
import { replaceImageUrls } from './utils/r2';
// 注意：此文件作为 Queue consumer 与 webhook 共用 Worker
// wrangler.toml 中配置为 queue consumer

interface Env {
  COLLECT_QUEUE: Queue<CollectTask>;
  BROWSER: any;
  IMAGE_BUCKET: R2Bucket;
}

export default {
  async queue(batch: MessageBatch<CollectTask>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const task = msg.body;
      console.log(`Processing: ${task.url}`);

      try {
        // 去重检查
        const exists = await urlExists(task.url);
        if (exists) {
          console.log(`Skipped (duplicate): ${task.url}`);
          msg.ack();
          continue;
        }

        // 提取内容
        const article = await extractContent(env, task.url);

        // 保存到 Supabase
        await insertArticle({
          url: article.url,
          title: article.title,
          author: article.author,
          publishedAt: article.publishedAt,
          content: article.content,
          plainText: article.plainText,
          platform: article.platform,
          coverImage: article.coverImage,
        });

        console.log(`Saved: ${article.title}`);
        msg.ack();
      } catch (err) {
        console.error(`Failed to process ${task.url}:`, err);
        // 失败后不 ack，Queue 会自动重试
        // 如需限次重试，可配合 DLQ（死信队列）
        msg.retry();
      }
    }
  },
};

/** 提取正文中所有图片 URL */
function extractImageUrls(html: string): string[] {
  const imgRegex = /<img[^>]+src="([^"]+)"/g;
  const urls: string[] = [];
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}
