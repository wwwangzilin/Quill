/**
 * AI 续写的客户端封装。
 *
 * 走兼容 OpenAI 的 /chat/completions（Rust 侧发请求，避开 WebView 的跨域限制，
 * 而且 API Key 根本不会经过前端）。
 */
import { Channel, invoke } from '@tauri-apps/api/core'
import { isTauri } from './windows'

export interface AiStatus {
  baseUrl: string
  model: string
  hasKey: boolean
}

export interface AiEvent {
  delta: string
  done: boolean
  text?: string | null
  /** 结束原因。`length` 表示被 max_tokens 截断了 */
  finishReason?: string | null
}

/** 流结束时告诉调用方「结果完不完整」 */
export interface AiFinish {
  text: string
  /** 被 max_tokens 截断了（finish_reason === 'length'） */
  truncated: boolean
  reason?: string | null
}

export interface AiRequest {
  system: string
  prompt: string
  maxTokens?: number
  temperature?: number
}

export const AI_DEFAULTS = {
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
}

/** AI 续写只在桌面版里可用（要 Rust 侧发请求） */
export function aiAvailable(): boolean {
  return isTauri()
}

export async function aiStatus(): Promise<AiStatus | null> {
  if (!isTauri()) return null
  try {
    return await invoke<AiStatus>('ai_status')
  } catch {
    return null
  }
}

/** 保存设置；apiKey 传空字符串表示「不改动原来那个」 */
export async function aiSave(baseUrl: string, model: string, apiKey?: string): Promise<AiStatus> {
  if (!isTauri()) throw new Error('AI 续写只在桌面版里可用')
  return await invoke<AiStatus>('ai_save', { baseUrl, model, apiKey: apiKey ?? null })
}

/**
 * 拉取这个接口支持的模型列表（Rust 侧发 `GET /models`）。
 *
 * baseUrl 传界面上正在填的那个 —— 还没保存也能先看看有什么可选的。
 * 服务不支持这个端点的话会直接报错，界面上退回「常见模型」提示即可。
 */
export async function aiModels(baseUrl?: string): Promise<string[]> {
  if (!isTauri()) throw new Error('AI 续写只在桌面版里可用')
  return await invoke<string[]>('ai_models', { baseUrl: baseUrl ?? null })
}

/**
 * 按接口地址猜几个常见模型名，只在还没拉到真列表时当提示用。
 *
 * 真列表以「从接口获取」为准 —— 写在这里的名字迟早会过时，
 * 所以宁可少写几个，也不假装很全。本机地址干脆留空：
 * Ollama / LM Studio 里装了什么模型，只有它自己知道。
 */
export function guessModels(baseUrl: string): string[] {
  const u = (baseUrl || '').toLowerCase()
  if (u.includes('deepseek')) return ['deepseek-chat', 'deepseek-reasoner']
  if (u.includes('openai')) return ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1-mini']
  if (u.includes('moonshot') || u.includes('kimi')) return ['moonshot-v1-32k', 'kimi-k2-0711-preview']
  if (u.includes('dashscope') || u.includes('aliyun')) return ['qwen-max', 'qwen-plus', 'qwen-turbo']
  if (u.includes('bigmodel') || u.includes('zhipu')) return ['glm-4-plus', 'glm-4-air']
  if (u.includes('siliconflow')) return ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct']
  if (u.includes('11434') || u.includes('ollama')) return ['qwen2.5', 'llama3.2', 'gemma2']
  if (u.includes('localhost') || u.includes('127.0.0.1') || u.includes('192.168.')) return []
  return ['deepseek-chat', 'gpt-4o-mini']
}

/**
 * 流式续写。每收到一段增量就回调一次（带上累积结果），
 * 返回的 Promise 在流结束时给出完整文本。
 *
 * onFinish 可选：想知道「结果是不是被截断了」就传它。
 * 模型被 max_tokens 砍断时会给出 finish_reason = 'length'，
 * 这是唯一能据以判断的信号 —— 光看文本是看不出「写完没写完」的。
 */
export async function aiStream(
  req: AiRequest,
  onText: (full: string, delta: string) => void,
  onFinish?: (info: AiFinish) => void,
): Promise<string> {
  if (!isTauri()) throw new Error('AI 续写只在桌面版里可用')
  const channel = new Channel<AiEvent>()
  let full = ''
  channel.onmessage = (msg) => {
    if (msg.done) {
      const text = msg.text ?? full
      onFinish?.({ text, truncated: msg.finishReason === 'length', reason: msg.finishReason })
      return
    }
    if (msg.delta) {
      full += msg.delta
      onText(full, msg.delta)
    }
  }
  await invoke('ai_stream', { req, channel })
  return full
}
