// ============================================================
// Supabase 客户端 & 操作
// ============================================================
import { createClient } from '@supabase/supabase-js';
import type { ArticleRecord } from '../types';

let _client: ReturnType<typeof createClient> | null = null;
let _lastKey = '';

function getClient(env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string }) {
  const key = env.SUPABASE_URL + env.SUPABASE_SERVICE_KEY;
  if (!_client || key !== _lastKey) {
    _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    _lastKey = key;
  }
  return _client;
}

/** 插入文章 */
export async function insertArticle(
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string },
  data: {
    url: string;
    title: string;
    author: string;
    publishedAt: string;
    content: string;
    plainText: string;
    platform: string;
    coverImage?: string; summary?: string; outline?: string; viewpoints?: string; }, articleId?: string
): Promise<string> {
  const supabase = getClient(env);
  const { data: record, error } = await supabase
    .from('articles')
    .insert({ id: articleId || undefined,
      url: data.url,
      title: data.title,
      author: data.author,
      published_at: data.publishedAt,   // 注意：列名是 snake_case
      content: data.content,
      plain_text: data.plainText,       // 注意：列名是 snake_case
      platform: data.platform,
      cover_image: data.coverImage || null, summary: data.summary || '', outline: data.outline || '', viewpoints: data.viewpoints || '',  // 注意：列名是 snake_case
      status: 'ready',
    })
    .select('id')
    .single();

  if (error) throw error;
  return record.id;
}

/** 更新文章状态 */
export async function updateArticleStatus(
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string },
  id: string,
  status: ArticleRecord['status'],
  errorMessage?: string
) {
  const supabase = getClient(env);
  await supabase
    .from('articles')
    .update({ status, error_message: errorMessage || null })
    .eq('id', id);
}

/** 获取 ready 状态的文章 */
export async function getReadyArticles(
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string },
  limit = 100
): Promise<ArticleRecord[]> {
  const supabase = getClient(env);
  const { data } = await supabase
    .from('articles')
    .select('*')
    .eq('status', 'ready')
    .order('published_at', { ascending: false })
    .limit(limit);
  return data || [];
}

/** 检查 URL 是否已存在 */
export async function urlExists(
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string },
  url: string
): Promise<boolean> {
  const supabase = getClient(env);
  const { count } = await supabase
    .from('articles')
    .select('id', { count: 'exact', head: true })
    .eq('url', url);
  return (count || 0) > 0;
}
