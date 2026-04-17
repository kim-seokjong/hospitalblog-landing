import Anthropic from '@anthropic-ai/sdk';

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.');
  }
  return new Anthropic({ apiKey });
}

export const MODEL = 'claude-sonnet-4-6';
