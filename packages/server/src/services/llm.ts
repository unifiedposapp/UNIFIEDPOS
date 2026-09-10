// ─── Optional LLM copilot bridge (env-gated) ─────────────────────────────────
// The rule-based copilot (routes/copilot.ts) always works offline. When an
// OpenAI-compatible endpoint is configured, this bridge can augment answers with
// a natural-language summary. It is fully optional: with no API key configured
// `isLlmConfigured()` is false and `completeChat()` returns null, so callers
// silently fall back to the deterministic engine. No SDK dependency — a single
// fetch keeps the supply chain small and works with OpenAI, Groq, Together,
// Ollama, or any /chat/completions-compatible server via LLM_BASE_URL.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY);
}

function apiKey(): string | undefined {
  return process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
}

/** Base URL of an OpenAI-compatible API (no trailing slash). */
function baseUrl(): string {
  return (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function model(): string {
  return process.env.LLM_MODEL || 'gpt-4o-mini';
}

export interface LlmResult {
  text: string;
  model: string;
  provider: 'llm';
}

/**
 * Send a chat-completion request. Returns null when unconfigured or on any
 * error/timeout — callers MUST handle the null and fall back gracefully.
 */
export async function completeChat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {}): Promise<LlmResult | null> {
  if (!isLlmConfigured()) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({
        model: model(),
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 500,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[llm] provider error ${res.status}`);
      return null;
    }
    const json: any = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.trim() === '') return null;
    return { text: text.trim(), model: json?.model || model(), provider: 'llm' };
  } catch (error) {
    console.error('[llm] request failed:', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
