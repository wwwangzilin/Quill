import { useEffect, useMemo, useState } from 'react'
import { PRESETS, compileRule, previewRule, splitBlocksByRule, splitByRule, type RuleChapter } from '../core/chapterRule'

/** 预览用的原文：超大文档给整篇原文；普通文档给每个顶层块的文字 */
export type RuleSource = { kind: 'raw'; text: string } | { kind: 'blocks'; texts: string[] }

/**
 * 自定义章节规则：自动识别认错了章，就自己写一条（一个正则，对每一行匹配）。
 * 边写边预览会切出几章、前几章叫什么；章数多得离谱 / 平均每章太短，多半是误伤了正文。
 */
export default function ChapterRuleDialog({
  open,
  initial,
  fallbackTitle,
  loadSource,
  onApply,
  onClose,
}: {
  open: boolean
  initial: string
  fallbackTitle: string
  loadSource: () => Promise<RuleSource>
  onApply: (rule: string) => void
  onClose: () => void
}) {
  const [src, setSrc] = useState<RuleSource | null>(null)
  const [rule, setRule] = useState(initial)
  const [debounced, setDebounced] = useState(initial)

  useEffect(() => {
    if (!open) return
    setRule(initial)
    setDebounced(initial)
    setSrc(null)
    let alive = true
    void loadSource()
      .then((s) => alive && setSrc(s))
      .catch(() => alive && setSrc({ kind: 'blocks', texts: [] }))
    return () => {
      alive = false
    }
  }, [open, initial, loadSource])

  // 超大文档每次按键都扫几百万字太费，停一下再算
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(rule), 250)
    return () => window.clearTimeout(t)
  }, [rule])

  const re = useMemo(() => compileRule(debounced), [debounced])
  const preview = useMemo(() => {
    if (!re || !src) return null
    let chs: RuleChapter[]
    if (src.kind === 'raw') chs = splitByRule(src.text, re, fallbackTitle)
    else {
      let at = 0
      chs = splitBlocksByRule(src.texts, re, fallbackTitle).map((c) => {
        const len = src.texts.slice(c.startBlock, c.endBlock).reduce((n, t) => n + t.length, 0)
        const r = { title: c.title, from: at, to: at + len }
        at += len
        return r
      })
    }
    return previewRule(chs)
  }, [re, src, fallbackTitle])

  if (!open) return null
  const bad = rule.trim() !== '' && !compileRule(rule)

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal chap-rule" role="dialog" aria-label="自定义章节规则" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="chap-rule-title">自定义章节规则</div>
        <p className="chap-rule-help">
          写一个正则，<b>每一行</b>（去掉首尾空格后）能匹配上的就是一章的开头。留空 = 用自动识别。
        </p>
        <input
          className={'chap-rule-input' + (bad ? ' bad' : '')}
          value={rule}
          placeholder="例如 ^第[0-9一二三四五六七八九十百]+章"
          onChange={(e) => setRule(e.target.value)}
          spellCheck={false}
          autoFocus
        />
        <div className="chap-rule-presets">
          {PRESETS.map((p) => (
            <button key={p.name} className="btn ghost mini" onClick={() => setRule(p.rule)}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="chap-rule-preview">
          {bad ? (
            <span className="chap-rule-warn">这条规则写得不对（正则语法错误）</span>
          ) : !rule.trim() ? (
            <span>当前用自动识别</span>
          ) : !src ? (
            <span>正在读取原文…</span>
          ) : preview ? (
            <>
              <div>
                会切成 <b>{preview.count}</b> 章，平均每章约 {preview.avgLen} 字
                {preview.count > 1 && preview.avgLen < 200 && (
                  <span className="chap-rule-warn"> · 每章太短了，多半误伤了正文里的句子</span>
                )}
              </div>
              <ol>
                {preview.samples.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
                {preview.count > preview.samples.length && <li>…</li>}
              </ol>
            </>
          ) : null}
        </div>
        <div className="chap-rule-actions">
          {initial && (
            <button
              className="btn ghost"
              onClick={() => {
                onApply('')
                onClose()
              }}
            >
              恢复自动识别
            </button>
          )}
          <span className="grow" />
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={bad || !rule.trim()}
            onClick={() => {
              onApply(rule.trim())
              onClose()
            }}
          >
            应用
          </button>
        </div>
      </div>
    </div>
  )
}
