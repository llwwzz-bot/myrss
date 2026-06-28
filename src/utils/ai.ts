// ============================================================
// AI 分析 —— DeepSeek API（摘要 + 目录 + 观点）
// ============================================================

export interface AIResult {
  summary: string;
  outline: string;
  viewpoints: string;
}

/** 生成中文摘要、段落目录、观点提炼 */
export async function generateAIInsights(
  apiKey: string,
  title: string,
  text: string
): Promise<AIResult> {
  const empty = { summary: '', outline: '', viewpoints: '' };
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
            content: `你是一个文章分析助手。根据提供的文章，输出一个 JSON 对象，包含三个字段：
1. "summary"：2-3 句中文摘要，不超过 150 字。
2. "outline"：文章段落目录，每行以 "- " 开头，3-8 条，每条 8-20 字，按文章结构顺序排列。
3. "viewpoints"：格式为 "核心观点：xxx\n关键论据：xxx\n结论：xxx"，每条不超过 30 字。如果文章无明显论证结构，可简化为 "要点：xxx"。

只输出 JSON，不要 markdown 代码块。`,
          },
          {
            role: 'user',
            content: `标题：${title}\n\n正文：${truncated}`,
          },
        ],
        max_tokens: 600,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    const json: any = await resp.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) return empty;

    const parsed = JSON.parse(content);
    return {
      summary: parsed.summary || '',
      outline: parsed.outline || '',
      viewpoints: parsed.viewpoints || '',
    };
  } catch {
    return empty;
  }
}
