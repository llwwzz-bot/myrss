// ============================================================
// Obsidian 知识库 —— Markdown 生成 + GitHub 推送
// ============================================================
import type { AIResult } from './ai';
import type { ArticleData } from '../types';

interface GitHubEnv {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
}

interface PushResult { ok: boolean; error?: string }

function toBase64(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function generateObsidianMd(
  article: ArticleData,
  ai: AIResult,
  imageUploads: Array<{ originalUrl: string; r2Url: string }>
): string {
  const platformLabel: Record<string, string> = {
    wechat: '公众号', bilibili: 'B站', zhihu: '知乎',
    twitter: 'Twitter', generic: 'Web',
  };
  const platform = platformLabel[article.platform] || article.platform;
  const date = article.publishedAt.slice(0, 10);

  const imgMd = imageUploads.length > 0
    ? '\n## 🖼️ 图片\n\n' + imageUploads.map((u, i) => `![图片${i + 1}](${u.r2Url})`).join('\n\n')
    : '';

  const techSection = ai.techPoints ? `\n## 🔑 技术要点\n\n${ai.techPoints}\n` : '';
  const implSection = ai.implementation ? `\n## 🏗️ 实现方案\n\n${ai.implementation}\n` : '';

  return `---
url: "${article.url}"
platform: ${platform}
date: ${date}
tags: [${ai.tags.join(', ')}]
source_title: "${article.title.replace(/"/g, '\\"')}"
author: "${article.author.replace(/"/g, '\\"')}"
---

# ${article.title}

## 📋 摘要

${ai.summary || '（无摘要）'}

## 📑 目录

${ai.outline || '（无目录）'}

## 💡 观点

${ai.viewpoints || '（无观点）'}
${techSection}${implSection}${imgMd}
## 📎 原文

[${article.title}](${article.url})
`;
}

export async function pushToGithub(
  env: GitHubEnv,
  filePath: string,
  content: string
): Promise<PushResult> {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return { ok: false, error: 'Missing GITHUB_TOKEN or GITHUB_REPO' };
  }

  const base64Content = toBase64(content);
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const apiUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${encodedPath}`;

  try {
    let sha = '';
    try {
      const existing = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'rss-collector',
        },
      });
      if (existing.ok) {
        const data: any = await existing.json();
        sha = data.sha || '';
      }
    } catch { /* 文件不存在 */ }

    const body: any = { message: `Add: ${filePath}`, content: base64Content };
    if (sha) body.sha = sha;

    const resp = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'rss-collector',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      return { ok: false, error: `HTTP ${resp.status}: ${errBody.slice(0, 200)}` };
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'unknown' };
  }
}

export function obsidianFilePath(article: ArticleData, ai: AIResult): string {
  const platform = article.platform;
  const date = article.publishedAt.slice(0, 10);
  const shortTitle = article.title
    .replace(/[^\w\u4e00-\u9fff]/g, ' ')
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/g, '')
    || 'untitled';
  return `articles/${platform}/${date}-${shortTitle}.md`;
}