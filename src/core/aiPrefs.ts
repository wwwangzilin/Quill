/**
 * AI 生成参数的微调配置。
 *
 * 接口地址 / 模型 / 密钥走 Rust 侧的 ai.json，这里只管「每次请求怎么发」：
 * 长度上限、采样温度、附加写作要求。都不保密，所以留在前端 ——
 * 请求前现读，改完立刻生效，不必重启也不必多绕一圈 IPC。
 */
import { useCallback, useEffect, useState } from 'react'

export interface AiTuning {
  /** 行内续写的 token 上限。太小会写半句就被砍断 */
  continueTokens: number
  /** 选中文本改写的 token 上限 */
  rewriteTokens: number
  /** 文档问答的 token 上限 */
  answerTokens: number
  /** 采样温度：越低越稳，越高越活 */
  temperature: number
  /** 追加给所有提示词的额外要求，留空表示不加 */
  style: string
}

/**
 * 默认值按「中文一个字差不多一个 token」估。
 *
 * 续写只要一两句，而改写和问答的输入动辄上千字，上限得留够倍数 ——
 * 否则模型正说到一半就被长度砍断，半截话比慢一点讨厌得多。
 */
export const AI_TUNING_DEFAULT: AiTuning = {
  continueTokens: 160,
  rewriteTokens: 2400,
  answerTokens: 2000,
  temperature: 0.7,
  style: '',
}

/** 滑动条取值范围，同时也是读盘时的夹取边界 */
export const AI_TUNING_RANGE = {
  continue: { min: 64, max: 512, step: 32 },
  rewrite: { min: 256, max: 8192, step: 128 },
  answer: { min: 256, max: 8192, step: 128 },
  temperature: { min: 0, max: 1.5, step: 0.05 },
}

const KEY = 'quill-ai-tuning'
const EVENT = 'quill-ai-tuning'

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

/** 把任意输入收拢成一份合法参数：越界夹回范围，缺失回退默认 */
export function normalizeAiTuning(raw: Partial<AiTuning> | null | undefined): AiTuning {
  const d = AI_TUNING_DEFAULT
  const R = AI_TUNING_RANGE
  const o = raw ?? {}
  return {
    continueTokens: num(o.continueTokens, R.continue.min, R.continue.max, d.continueTokens),
    rewriteTokens: num(o.rewriteTokens, R.rewrite.min, R.rewrite.max, d.rewriteTokens),
    answerTokens: num(o.answerTokens, R.answer.min, R.answer.max, d.answerTokens),
    temperature: num(o.temperature, R.temperature.min, R.temperature.max, d.temperature),
    style: typeof o.style === 'string' ? o.style.slice(0, 800) : d.style,
  }
}

/** 读参数。没存过或者存坏了都退回默认，绝不抛错打断写作 */
export function readAiTuning(): AiTuning {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...AI_TUNING_DEFAULT }
    return normalizeAiTuning(JSON.parse(raw) as Partial<AiTuning>)
  } catch {
    return { ...AI_TUNING_DEFAULT }
  }
}

/** 写参数；返回夹取后的结果，调用方拿它刷界面，免得显示越界值 */
export function saveAiTuning(next: Partial<AiTuning>): AiTuning {
  const clean = normalizeAiTuning({ ...readAiTuning(), ...next })
  try {
    localStorage.setItem(KEY, JSON.stringify(clean))
  } catch {
    /* 存不进去只是这次不生效，不打扰用户 */
  }
  window.dispatchEvent(new Event(EVENT))
  return clean
}

/** 恢复出厂参数 */
export function resetAiTuning(): AiTuning {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 同上 */
  }
  window.dispatchEvent(new Event(EVENT))
  return { ...AI_TUNING_DEFAULT }
}

/** 设置界面用。同窗口内改完立即同步，不必重挂载 */
export function useAiTuning(): [AiTuning, (patch: Partial<AiTuning>) => void] {
  const [cur, setCur] = useState<AiTuning>(() => readAiTuning())
  useEffect(() => {
    const sync = () => setCur(readAiTuning())
    window.addEventListener(EVENT, sync)
    return () => window.removeEventListener(EVENT, sync)
  }, [])
  const update = useCallback((patch: Partial<AiTuning>) => {
    setCur(saveAiTuning(patch))
  }, [])
  return [cur, update]
}

/** 把「额外要求」拼到系统提示词后面；没填就原样返回 */
export function withStyle(system: string, tuning: AiTuning): string {
  const s = tuning.style.trim()
  return s ? `${system}\n\n【额外要求】\n${s}` : system
}
