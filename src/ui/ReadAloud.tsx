import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useSetting } from '../core/settings'
import { READ_RATES, pickVoice, splitSpeech } from '../core/tts'

/**
 * 阅读视图的朗读。
 *
 * 逐段念：每段按句子切小块喂给 speechSynthesis（见 core/tts.ts），
 * 念到哪段就把那段高亮并翻到它所在的页；本章念完自动进下一章。
 * 暂停 = 取消当前朗读并记住念到第几段，再点从那一段开头继续。
 */

export interface ReadAloudHooks {
  /** 当前章里所有顶层块（段落、标题…），按阅读顺序 */
  getBlocks: () => HTMLElement[]
  /** 当前这一页上第一个块的下标 */
  startIndex: (blocks: HTMLElement[]) => number
  /** 把这个块翻到可见 */
  reveal: (el: HTMLElement) => void
  /** 本章念完了：能进下一章就进并返回 true，没有下一章返回 false */
  nextChapter: () => boolean
  /** 章变了就换一个值，朗读据此在新章里从头接着念 */
  chapterKey: string | number
}

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window

export function useReadAloud(h: ReadAloudHooks) {
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useSetting<number>('ttsRate', 1)
  const [voiceName, setVoiceName] = useSetting<string>('ttsVoice', '')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])

  const hooks = useRef(h)
  hooks.current = h
  const rateRef = useRef(rate)
  rateRef.current = rate
  const voiceRef = useRef<SpeechSynthesisVoice | undefined>(undefined)
  const gen = useRef(0)
  const want = useRef(false)
  const last = useRef<number | null>(null)
  const pendingChapter = useRef(false)
  const marked = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!supported()) return
    const load = () => setVoices(window.speechSynthesis.getVoices())
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])
  useEffect(() => {
    voiceRef.current = pickVoice(voices, 'zh-CN', voiceName || null)
  }, [voices, voiceName])

  const unmark = () => {
    marked.current?.classList.remove('tts-now')
    marked.current = null
  }

  const stop = useCallback(() => {
    want.current = false
    pendingChapter.current = false
    gen.current += 1
    if (supported()) window.speechSynthesis.cancel()
    unmark()
    setPlaying(false)
  }, [])

  const speakFrom = useCallback(
    (from: number) => {
      if (!supported()) return
      const synth = window.speechSynthesis
      synth.cancel()
      const mine = ++gen.current
      const els = hooks.current.getBlocks()
      let bi = from
      const finish = () => {
        unmark()
        last.current = null
        if (hooks.current.nextChapter()) {
          pendingChapter.current = true // 等章节换完（chapterKey 变）再接着念
        } else {
          want.current = false
          setPlaying(false)
        }
      }
      const nextBlock = () => {
        if (gen.current !== mine) return
        if (bi >= els.length) return finish()
        const el = els[bi]
        last.current = bi
        const parts = splitSpeech(el.textContent ?? '')
        if (!parts.length) {
          bi += 1
          return nextBlock()
        }
        unmark()
        el.classList.add('tts-now')
        marked.current = el
        hooks.current.reveal(el)
        let pi = 0
        const nextPart = () => {
          if (gen.current !== mine) return
          if (pi >= parts.length) {
            bi += 1
            return nextBlock()
          }
          const u = new SpeechSynthesisUtterance(parts[pi])
          pi += 1
          u.lang = voiceRef.current?.lang ?? 'zh-CN'
          if (voiceRef.current) u.voice = voiceRef.current
          u.rate = rateRef.current
          u.onend = nextPart
          u.onerror = (e) => {
            if (gen.current !== mine) return
            // 被我们自己 cancel 掉的不算错；别的错（音色坏了）跳过这一句继续
            if (e.error === 'interrupted' || e.error === 'canceled') return
            nextPart()
          }
          synth.speak(u)
        }
        nextPart()
      }
      nextBlock()
    },
    [],
  )

  const play = useCallback(() => {
    if (!supported()) return
    want.current = true
    setPlaying(true)
    const els = hooks.current.getBlocks()
    const from = last.current !== null && last.current < els.length ? last.current : hooks.current.startIndex(els)
    speakFrom(Math.max(0, from))
  }, [speakFrom])

  const toggle = useCallback(() => (want.current ? stop() : play()), [play, stop])

  // 换章（自动进下一章，或读者自己切了章）：朗读中就在新章里从头接着念；
  // 不重开的话，还在念的是旧章那批已经卸掉的段落
  useEffect(() => {
    last.current = null
    pendingChapter.current = false
    if (!want.current) return
    gen.current += 1
    if (supported()) window.speechSynthesis.cancel()
    const t = window.setTimeout(() => {
      if (want.current) speakFrom(0)
    }, 450) // 等新章排完版（measure）再开口，不然 reveal 量到的是旧坐标
    return () => window.clearTimeout(t)
  }, [h.chapterKey, speakFrom])

  // 卸载（关阅读视图）一定要闭嘴，否则关了窗口还在念
  useEffect(() => () => {
    gen.current += 1
    if (supported()) window.speechSynthesis.cancel()
  }, [])

  return { supported: supported(), playing, toggle, stop, rate, setRate, voices, voiceName, setVoiceName, voice: voiceRef }
}

export type ReadAloudCtl = ReturnType<typeof useReadAloud>

/** 工具栏上的朗读按钮 + 音色 / 语速浮层 */
export function ReadAloudButton({ ctl }: { ctl: ReadAloudCtl }) {
  const [open, setOpen] = useState(false)
  const zh = ctl.voices.filter((v) => /^zh/i.test(v.lang))
  const list = zh.length ? zh : ctl.voices
  if (!ctl.supported) {
    return (
      <button className="btn ghost icon" disabled title="这个环境不支持朗读（系统没有语音引擎）">
        <Icon name="speaker" />
      </button>
    )
  }
  const current = pickVoice(ctl.voices, 'zh-CN', ctl.voiceName || null)
  return (
    <div className="reader-tts">
      <button
        className={'btn ghost icon' + (ctl.playing ? ' on' : '')}
        onClick={ctl.toggle}
        title={ctl.playing ? '停止朗读' : '朗读：从这一屏开始往下念'}
      >
        <Icon name={ctl.playing ? 'stop' : 'speaker'} />
      </button>
      <button className="btn ghost reader-bm-count" onClick={() => setOpen((o) => !o)} title="音色与语速">
        {ctl.rate}x
      </button>
      {open && (
        <div className="reader-bm-list reader-tts-pop" onPointerDown={(e) => e.stopPropagation()}>
          <label className="tts-row">
            <span>音色</span>
            <select value={current?.name ?? ''} onChange={(e) => ctl.setVoiceName(e.target.value)}>
              {list.map((v) => (
                <option key={v.name + v.lang} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <div className="tts-row">
            <span>语速</span>
            <div className="rstyle-cols" role="radiogroup" aria-label="语速">
              {READ_RATES.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={ctl.rate === r}
                  className={ctl.rate === r ? 'on' : ''}
                  onClick={() => ctl.setRate(r)}
                >
                  {r}x
                </button>
              ))}
            </div>
          </div>
          {!zh.length && <div className="reader-bm-empty">没找到中文音色，系统里装一个中文语音包会好很多</div>}
        </div>
      )}
    </div>
  )
}
