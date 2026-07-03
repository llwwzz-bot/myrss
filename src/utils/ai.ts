// ============================================================
// AI 分析 —— DeepSeek API（摘要 + 目录 + 观点 + 技术分析）
// ============================================================

export interface AIResult {
  summary: string;
  outline: string;
  viewpoints: string;
  techPoints: string;
  implementation: string;
  tags: string[];
}

const empty: AIResult = {
  summary: '', outline: '', viewpoints: '',
  techPoints: '', implementation: '', tags: [],
};

/** 生成摘要、段落目录、观点提炼 + 技术分析 */
export async function generateAIInsights(
  apiKey: string,
  title: string,
  text: string
): Promise<AIResult> {
  if (!apiKey || text.length < 200) return empty;

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
  "tech_points": "提炼 3-5 个关键技术知识点，每条格式为 '**知识点**：一句话说明'，以换行分隔。如文章无技术内容则填空字符串",
  "implementation": "实现方案 / 架构思路的要点总结，2-4 条，以换行分隔。如无则填空字符串",
  "tags": ["3-6个中英文标签，如 JavaScript, 部署, RAG"]
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
    if (!content) return empty;

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
    return empty;
  }
}