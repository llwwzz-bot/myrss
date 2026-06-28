-- ============================================================
-- Supabase 数据表 —— articles
-- 在 Supabase SQL Editor 中执行此文件（可重复执行）
-- ============================================================

-- 创建文章表
CREATE TABLE IF NOT EXISTS articles (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url         TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL DEFAULT '无标题',
  author      TEXT NOT NULL DEFAULT '未知作者',
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content     TEXT NOT NULL DEFAULT '',
  plain_text  TEXT NOT NULL DEFAULT '',
  platform    TEXT NOT NULL DEFAULT 'generic'
              CHECK (platform IN ('wechat', 'twitter', 'generic')),
  cover_image TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error_message TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_platform ON articles(platform);
CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_articles_updated_at ON articles;
CREATE TRIGGER trg_articles_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 启用 Row Level Security
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

-- 允许 service_role 完全访问（先删再建，确保幂等）
DROP POLICY IF EXISTS "Service role full access" ON articles;
CREATE POLICY "Service role full access" ON articles
  FOR ALL USING (true) WITH CHECK (true);
