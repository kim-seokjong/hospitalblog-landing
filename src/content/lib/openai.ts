import OpenAI from 'openai';

export const OPENAI_MODEL = 'gpt-5.5';
export const OPENAI_IMAGE_MODEL = 'gpt-image-2';

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다.');
  }
  return new OpenAI({ apiKey });
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Responses API (/v1/responses) 사용
export async function chatCompletion(
  messages: ChatMessage[],
  options?: { model?: string; maxTokens?: number }
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다.');

  const systemMessage = messages.find(m => m.role === 'system');
  const conversationMessages = messages.filter(m => m.role !== 'system');

  const body: Record<string, unknown> = {
    model: options?.model ?? OPENAI_MODEL,
    input: conversationMessages.map(m => ({ role: m.role, content: m.content })),
    store: true,
  };

  if (systemMessage) {
    body.instructions = systemMessage.content;
  }

  if (options?.maxTokens) {
    body.max_output_tokens = options.maxTokens;
  }

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`OpenAI Responses API 실패: ${await res.text()}`);

  const data = await res.json();
  const text = data.output?.[0]?.content?.[0]?.text;
  if (!text) throw new Error('OpenAI 응답이 비어있습니다.');
  return text;
}
