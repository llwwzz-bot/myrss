// ============================================================
// 共享类型定义
// ============================================================

/** 文章来源平台 */
export type Platform = 'wechat' | 'twitter' | 'bilibili' | 'zhihu' | 'generic';

/** Queue 消息体 */
export interface CollectTask {
  url: string;
  userId: string;
  chatId: number;
  messageId: number;
  source: 'telegram' | 'feishu';
  submittedAt: string;
}

/** 提取后的文章数据 */
export interface ArticleData {
  url: string;
  title: string;
  author: string;
  publishedAt: string;
  content: string;           // HTML 正文
  plainText: string;         // 纯文本摘要
  platform: Platform;
  coverImage?: string;       // 封面图 URL（已上传到 R2）
}

/** 图片上传结果 */
export interface ImageUploadResult {
  originalUrl: string;
  r2Url: string;
}

/** Supabase articles 表行 */
export interface ArticleRecord {
  id: string;
  url: string;
  title: string;
  author: string;
  published_at: string;
  content: string;
  plain_text: string;
  summary: string | null;
  outline: string | null;
  viewpoints: string | null;
  platform: Platform;
  cover_image: string | null;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/** Telegram 消息体 */
export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  text?: string;
  from?: { id: number; first_name: string };
  entities?: Array<{ type: string; offset: number; length: number }>;
}
