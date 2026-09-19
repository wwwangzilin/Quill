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
 * 流式续写。每收到一段增量就回调一次（带上累积结果），
 * 返回的 Promise 在流结束时给出完整文本。
 */
export async function aiStream(
  req: AiRequest,
  onText: (full: string, delta: string) => void,
): Promise<string> {
  if (!isTauri()) throw new Error('AI 续写只在桌面版里可用')
  const channel = new Channel<AiEvent>()
  let full = ''
  channel.onmessage = (msg) => {
    if (msg.done) return
    if (msg.delta) {
      full += msg.delta
      onText(full, msg.delta)
    }
  }
  await invoke('ai_stream', { req, channel })
  return full
}
