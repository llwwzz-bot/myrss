// ============================================================
// Obsidian 知识库 —— 按文章类型渲染 Markdown + GitHub 推送
// ============================================================
import type { AIResult, ObsidianDoc, Comparison, Troubleshooting, GuideStep } from './ai';
import type { ArticleData } from '../types';

interface GitHubEnv { GITHUB_TOKEN: string; GITHUB_REPO: string; }
interface PushResult { ok: boolean; error?: string }

function toBase64(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function esc(s: string): string { return s.replace(/"/g, '\u201c').replace(/\n/g, ' '); }

// ── 通用元信息 ──
function frontmatter(article: ArticleData, ai: AIResult, doc: ObsidianDoc): string {
  const label: Record<string, string> = { wechat: '公众号', bilibili: 'B站', zhihu: '知乎', twitter: 'Twitter', generic: 'Web' };
  const tags = doc.tags.length > 0 ? doc.tags : ai.tags;
  return `---
url: "${article.url}"
platform: ${label[article.platform] || article.platform}
date: ${article.publishedAt.slice(0, 10)}
tags: [${tags.join(', ')}]
source_title: "${esc(article.title)}"
author: "${esc(article.author)}"
doc_type: ${doc.type}
---\n`;
}

function imgs(ups: Array<{ r2Url: string }>): string {
  return ups.length > 0 ? '\n## 🖼️ 图片\n\n' + ups.map((u,i) => `![${i+1}](${u.r2Url})`).join('\n\n') : '';
}
function src(a: ArticleData): string { return `\n## 📎 原文\n\n[${a.title}](${a.url})\n`; }

// ═══════ guide ═══════
function renderGuide(article: ArticleData, ai: AIResult, doc: import('./ai').ObsidianGuide, ups: Array<{ r2Url: string }>): string {
  const prereq = doc.prerequisites.length ? '\n## 📦 前置条件\n\n' + doc.prerequisites.map(p => `- [ ] ${p}`).join('\n') : '';

  const arch = doc.architecture ? `\n## 🏗️ 架构概览\n\n\`\`\`mermaid\n${doc.architecture}\n\`\`\`\n` : '';

  const steps = doc.steps.length ? '\n## 🛠️ 操作步骤\n\n' + doc.steps.map((s: GuideStep, i: number) => {
    const cmds = s.commands.length ? '\n```bash\n' + s.commands.join('\n') + '\n```\n' : '';
    return `### ${i + 1}. ${s.title}\n\n${s.content}${cmds}`;
  }).join('\n\n') : '';

  const verify = doc.verification ? `\n## ✅ 验证\n\n${doc.verification}\n` : '';

  const ts = doc.troubleshooting.length
    ? '\n## 🐛 踩坑排查\n\n| 问题 | 原因 | 解决 |\n|------|------|------|\n' +
      doc.troubleshooting.map((t: Troubleshooting) => `| ${t.problem} | ${t.cause} | ${t.fix} |`).join('\n')
    : '';

  const next = doc.nextSteps.length ? '\n## 🚀 下一步\n\n' + doc.nextSteps.map(n => `- ${n}`).join('\n') : '';
  const notes = doc.notes.length ? '\n## ⚠️ 注意事项\n\n' + doc.notes.map(n => `- ${n}`).join('\n') : '';

  return frontmatter(article, ai, doc)
    + `# 🧭 ${article.title}\n\n`
    + `> **操作指南**  |  ${ai.summary || ''}\n`
    + prereq + arch + steps + verify + ts + next + notes
    + imgs(ups) + src(article);
}

// ═══════ knowledge ═══════
function renderKnowledge(article: ArticleData, ai: AIResult, doc: import('./ai').ObsidianKnowledge, ups: Array<{ r2Url: string }>): string {
  const concept = doc.coreConcept ? `\n## 💡 核心概念\n\n${doc.coreConcept}\n\n> ${doc.analogy || ''}` : '';
  const pre = doc.prerequisiteConcepts.length ? '\n## 📖 前置知识\n\n' + doc.prerequisiteConcepts.map(p => `- ${p}`).join('\n') : '';

  const kp = doc.keyPoints.length ? '\n## 🔑 关键知识点\n\n' + doc.keyPoints.map(p => `- ${p}`).join('\n') : '';

  const comp = doc.comparisons.length
    ? '\n## ⚖️ 同类对比\n\n| 维度 | A | B | 结论 |\n|------|---|---|------|\n' +
      doc.comparisons.map((c: Comparison) => `| ${c.aspect} | ${c.optionA} | ${c.optionB} | ${c.winner} |`).join('\n')
    : '';

  const dt = doc.decisionTree ? `\n## 🧭 决策指南\n\n${doc.decisionTree}\n` : '';
  const apps = doc.applications.length ? '\n## 🎯 应用场景\n\n' + doc.applications.map(a => `- ${a}`).join('\n') : '';
  const to = doc.tradeoffs ? `\n## ⚖️ 权衡分析\n\n${doc.tradeoffs}\n` : '';
  const learn = doc.learningPath.length ? '\n## 🗺️ 学习路径\n\n' + doc.learningPath.map((l,i) => `${i+1}. ${l}`).join('\n') : '';

  return frontmatter(article, ai, doc)
    + `# 📚 ${article.title}\n\n`
    + `> **知识卡片**  |  ${ai.summary || ''}\n`
    + concept + pre + kp + comp + dt + apps + to + learn
    + imgs(ups) + src(article);
}

// ═══════ opinion ═══════
function renderOpinion(article: ArticleData, ai: AIResult, doc: import('./ai').ObsidianOpinion, ups: Array<{ r2Url: string }>): string {
  const args = doc.arguments.length ? '\n## 🗣️ 论据\n\n' + doc.arguments.map(a => `- ${a}`).join('\n') : '';
  const counter = doc.counterView ? `\n## 🔄 反方视角\n\n${doc.counterView}\n` : '';
  const action = doc.actionItems.length ? '\n## ✅ 可行动项\n\n' + doc.actionItems.map(a => `- [ ] ${a}`).join('\n') : '';
  const short = doc.shortTermImplications ? `\n## 🔮 短期启示\n\n${doc.shortTermImplications}\n` : '';
  const long = doc.longTermTrends ? `\n## 📈 长期趋势\n\n${doc.longTermTrends}\n` : '';

  return frontmatter(article, ai, doc)
    + `# 💡 ${article.title}\n\n`
    + `> **观点笔记**  |  ${doc.coreOpinion || ''}\n`
    + args + counter + action + short + long
    + imgs(ups) + src(article);
}

// ═══════ general ═══════
function renderGeneral(article: ArticleData, ai: AIResult, doc: ObsidianDoc, ups: Array<{ r2Url: string }>): string {
  const tech = ai.techPoints ? `\n## 🔑 技术要点\n\n${ai.techPoints}\n` : '';
  const impl = ai.implementation ? `\n## 🏗️ 实现方案\n\n${ai.implementation}\n` : '';
  return frontmatter(article, ai, doc)
    + `# ${article.title}\n\n`
    + `## 📋 摘要\n\n${ai.summary || '（无）'}\n`
    + `## 📑 目录\n\n${ai.outline || '（无）'}\n`
    + `## 💡 观点\n\n${ai.viewpoints || '（无）'}\n`
    + tech + impl + imgs(ups) + src(article);
}

// ── 分发 ──
export function generateObsidianMd(article: ArticleData, ai: AIResult, doc: ObsidianDoc, ups: Array<{ originalUrl: string; r2Url: string }>): string {
  const mapped = ups.map(u => ({ r2Url: u.r2Url }));
  switch (doc.type) {
    case 'guide': return renderGuide(article, ai, doc, mapped);
    case 'knowledge': return renderKnowledge(article, ai, doc, mapped);
    case 'opinion': return renderOpinion(article, ai, doc, mapped);
    default: return renderGeneral(article, ai, doc, mapped);
  }
}

// ── GitHub 推送 ──
export async function pushToGithub(env: GitHubEnv, filePath: string, content: string): Promise<PushResult> {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return { ok: false, error: 'Missing secrets' };
  const base64 = toBase64(content);
  const ep = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  try {
    let sha = '';
    try { const r = await fetch(ep, { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'rss-collector' } }); if (r.ok) sha = ((await r.json() as any).sha || ''); } catch {}
    const body: any = { message: `Add: ${filePath}`, content: base64 };
    if (sha) body.sha = sha;
    const resp = await fetch(ep, { method: 'PUT', headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'rss-collector', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return resp.ok ? { ok: true } : { ok: false, error: `HTTP ${resp.status}: ${(await resp.text().catch(()=>'')).slice(0,200)}` };
  } catch (e: any) { return { ok: false, error: e?.message || 'unknown' }; }
}

export function obsidianFilePath(article: ArticleData, ai: AIResult): string {
  const short = article.title.replace(/[^\w\u4e00-\u9fff]/g,' ').replace(/\s+/g,'-').slice(0,40).replace(/-+$/g,'') || 'untitled';
  return `articles/${article.platform}/${article.publishedAt.slice(0,10)}-${short}.md`;
}