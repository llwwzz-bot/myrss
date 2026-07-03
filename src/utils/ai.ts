// ============================================================
// AI 分析 —— DeepSeek API
//   链路 1: generateAIInsights()   → Supabase / RSS
//   链路 2: generateObsidianDoc()  → GitHub / Obsidian（生产型文档）
// ============================================================

// ── 链路 1 类型（保持兼容）──
export interface AIResult {
  summary: string;
  outline: string;
  viewpoints: string;
  techPoints: string;
  implementation: string;
  tags: string[];
}

const emptyAI: AIResult = {
  summary: '', outline: '', viewpoints: '',
  techPoints: '', implementation: '', tags: [],
};

// ── 链路 2 类型 ──
export interface GuideStep {
  title: string;
  content: string;
  commands: string[];
}

export interface Troubleshooting {
  problem: string;
  cause: string;
  fix: string;
}

export interface ObsidianGuide {
  type: 'guide';
  prerequisites: string[];
  steps: GuideStep[];
  verification: string;
  troubleshooting: Troubleshooting[];
  architecture: string;
  nextSteps: string[];
  notes: string[];
  tags: string[];
}

export interface Comparison {
  aspect: string;
  optionA: string;
  optionB: string;
  winner: string;
}

export interface ObsidianKnowledge {
  type: 'knowledge';
  coreConcept: string;
  analogy: string;
  prerequisiteConcepts: string[];
  keyPoints: string[];
  comparisons: Comparison[];
  learningPath: string[];
  decisionTree: string;
  applications: string[];
  tradeoffs: string;
  tags: string[];
}

export interface ObsidianOpinion {
  type: 'opinion';
  coreOpinion: string;
  arguments: string[];
  counterView: string;
  actionItems: string[];
  shortTermImplications: string;
  longTermTrends: string;
  tags: string[];
}

export interface ObsidianGeneral {
  type: 'general';
  tags: string[];
}

export type ObsidianDoc = ObsidianGuide | ObsidianKnowledge | ObsidianOpinion | ObsidianGeneral;

const emptyDoc: ObsidianGeneral = { type: 'general', tags: [] };

// ── 链路 1：摘要 + 目录 + 观点 + 技术要点（Supabase / RSS）──
export async function generateAIInsights(
  apiKey: string,
  title: string,
  text: string
): Promise<AIResult> {
  if (!apiKey || text.length < 200) return emptyAI;

  const truncated = text.slice(0, 3500);

  try {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `你是一个技术文章分析助手。根据提供的文章，输出一个 JSON 对象：

{
  "summary": "2-3 句中文摘要，不超过 150 字",
  "outline": "文章段落目录，每行以 '- ' 开头，3-8 条，每条 8-20 字",
  "viewpoints": "核心观点：xxx\n关键论据：xxx\n结论：xxx，每条不超过 30 字",
  "tech_points": "提炼 3-5 个关键技术知识点，每条格式为 '**知识点**：一句话说明'，以换行分隔。如无则空字符串",
  "implementation": "实现方案 / 架构思路要点，2-4 条，换行分隔。如无则空字符串",
  "tags": ["3-6个中英文标签"]
}

只输出 JSON，不要 markdown 代码块。`,
          },
          {
            role: 'user',
            content: `标题：${title}\n\n正文：${truncated}`,
          },
        ],
        max_tokens: 800,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    const json: any = await resp.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) return emptyAI;

    const parsed = JSON.parse(content);
    const toStr = (v: any): string =>
      Array.isArray(v) ? v.map(String).join('\n') : (typeof v === 'string' ? v : '');
    const toArr = (v: any): string[] =>
      Array.isArray(v) ? v.map(String).slice(0, 6) : [];

    return {
      summary: toStr(parsed.summary),
      outline: toStr(parsed.outline),
      viewpoints: toStr(parsed.viewpoints),
      techPoints: toStr(parsed.tech_points),
      implementation: toStr(parsed.implementation),
      tags: toArr(parsed.tags),
    };
  } catch {
    return emptyAI;
  }
}

// ── 链路 2：分类 + 生产型文档（GitHub / Obsidian）──
export async function generateObsidianDoc(
  apiKey: string,
  title: string,
  text: string
): Promise<ObsidianDoc> {
  if (!apiKey || text.length < 200) return emptyDoc;

  const truncated = text.slice(0, 6000);

  try {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `你是一个技术文档工程师。你的目标不是「复述文章」，而是「基于文章生产一份可独立使用的技术文档」。如果文章内容不足以支撑某个字段，请基于技术常识合理推断补全，不要留空。代码示例必须完整可运行，禁止出现 "...省略"。

## 类型判断
- guide：技术教程、工具搭建、部署流程、环境配置、DevOps
- knowledge：架构设计、技术原理、概念讲解、方案对比、编程范式
- opinion：技术观点、行业分析、经验总结、趋势判断、技术选型
- general：其他

## guide 输出格式
{
  "type": "guide",
  "prerequisites": ["每条前置条件含具体版本号/环境要求，包括隐式依赖"],
  "steps": [
    {
      "title": "步骤名",
      "content": "详细操作说明 + 为什么这一步必要",
      "commands": ["完整可运行的 bash/powershell 命令，多行用多条"]
    }
  ],
  "verification": "具体验证命令 + 预期输出截图描述，逐步骤对应",
  "troubleshooting": [
    { "problem": "读者可能遇到的错误", "cause": "根因", "fix": "具体解决步骤" }
  ],
  "architecture": "mermaid flowchart 或 architecture ASCII 图，描述系统架构/数据流。如不适用填空字符串",
  "nextSteps": ["下一步可以做的进阶方向或相关工具", "..."],
  "notes": ["踩坑提醒", "安全注意事项", "生产环境建议"],
  "tags": ["5-8个中英文标签"]
}

## knowledge 输出格式
{
  "type": "knowledge",
  "coreConcept": "核心概念 + 通俗类比（用非技术语言解释）",
  "analogy": "比喻一句，让非技术人员也能懂",
  "prerequisiteConcepts": ["读懂此文需要的 2-3 个前置概念"],
  "keyPoints": ["每个知识点 1-2 句深度说明", "..."],
  "comparisons": [
    { "aspect": "对比维度", "optionA": "方案A简述", "optionB": "方案B简述", "winner": "谁在什么场景下更优" }
  ],
  "learningPath": ["推荐阅读/学习顺序，串起来形成知识链"],
  "decisionTree": "什么情况选什么方案的决策逻辑，文字描述或简化决策树",
  "applications": ["实际落地场景"],
  "tradeoffs": "深度权衡分析，不只是优缺点列表，要说清取舍逻辑",
  "tags": ["5-8个标签"]
}

## opinion 输出格式
{
  "type": "opinion",
  "coreOpinion": "核心观点",
  "arguments": ["支撑论据 1", "论据 2（每个论据要有说服力）"],
  "counterView": "反方视角：这个观点的局限/批评声音/不适用场景",
  "actionItems": ["基于此我能立刻做什么", "团队层面建议"],
  "shortTermImplications": "短期（6个月内）启示",
  "longTermTrends": "长期趋势预判",
  "tags": ["3-6个标签"]
}

## general 输出格式
{
  "type": "general",
  "tags": ["3-6个标签"]
}

只输出 JSON，不要 markdown 代码块。`,
          },
          {
            role: 'user',
            content: `标题：${title}\n\n正文：${truncated}`,
          },
        ],
        max_tokens: 10000,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    const json: any = await resp.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) return emptyDoc;

    const parsed = JSON.parse(content);
    const toStr = (v: any): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.map(String).join('\n') : '');
    const toArr = (v: any): string[] => Array.isArray(v) ? v.map(String).slice(0, 12) : [];

    switch (parsed.type) {
      case 'guide':
        return {
          type: 'guide',
          prerequisites: toArr(parsed.prerequisites),
          steps: Array.isArray(parsed.steps)
            ? parsed.steps.slice(0, 15).map((s: any) => ({
                title: String(s.title || ''),
                content: String(s.content || ''),
                commands: Array.isArray(s.commands) ? s.commands.map(String) : [],
              }))
            : [],
          verification: toStr(parsed.verification),
          troubleshooting: Array.isArray(parsed.troubleshooting)
            ? parsed.troubleshooting.slice(0, 8).map((t: any) => ({
                problem: String(t.problem || ''), cause: String(t.cause || ''), fix: String(t.fix || ''),
              }))
            : [],
          architecture: toStr(parsed.architecture),
          nextSteps: toArr(parsed.nextSteps),
          notes: toArr(parsed.notes),
          tags: toArr(parsed.tags),
        };
      case 'knowledge':
        return {
          type: 'knowledge',
          coreConcept: toStr(parsed.coreConcept),
          analogy: toStr(parsed.analogy),
          prerequisiteConcepts: toArr(parsed.prerequisiteConcepts),
          keyPoints: toArr(parsed.keyPoints),
          comparisons: Array.isArray(parsed.comparisons)
            ? parsed.comparisons.slice(0, 8).map((c: any) => ({
                aspect: String(c.aspect || ''), optionA: String(c.optionA || ''), optionB: String(c.optionB || ''), winner: String(c.winner || ''),
              }))
            : [],
          learningPath: toArr(parsed.learningPath),
          decisionTree: toStr(parsed.decisionTree),
          applications: toArr(parsed.applications),
          tradeoffs: toStr(parsed.tradeoffs),
          tags: toArr(parsed.tags),
        };
      case 'opinion':
        return {
          type: 'opinion',
          coreOpinion: toStr(parsed.coreOpinion),
          arguments: toArr(parsed.arguments),
          counterView: toStr(parsed.counterView),
          actionItems: toArr(parsed.actionItems),
          shortTermImplications: toStr(parsed.shortTermImplications),
          longTermTrends: toStr(parsed.longTermTrends),
          tags: toArr(parsed.tags),
        };
      default:
        return { type: 'general', tags: toArr(parsed.tags) };
    }
  } catch {
    return emptyDoc;
  }
}