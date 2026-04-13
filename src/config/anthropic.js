import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Model constants matching the agent spec
 */
export const MODELS = {
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-4-6',
  OPUS: 'claude-opus-4-6',
};

/**
 * Call Claude with a system prompt and user message.
 * Returns the text content of the response.
 */
export async function callClaude(model, systemPrompt, userMessage, options = {}) {
  const { maxTokens = 4096, temperature = 0 } = options;

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  return response.content[0].text;
}

/**
 * Call Claude expecting a JSON response. Parses and returns the object.
 */
export async function callClaudeJSON(model, systemPrompt, userMessage, options = {}) {
  const text = await callClaude(model, systemPrompt, userMessage, options);

  // Extract JSON from response (handles markdown code blocks)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  try {
    return JSON.parse(jsonMatch[1].trim());
  } catch (e) {
    console.error('Failed to parse Claude JSON response:', text.substring(0, 200));
    throw new Error(`Claude returned invalid JSON: ${e.message}`);
  }
}

export default anthropic;
