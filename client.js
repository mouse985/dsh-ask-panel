// dsh-ask-panel — Client half.
//
// Claims the conversation composer chain for question batches raised by the
// `ask_user` tool (recognised by the synthetic "decide it yourself" option it
// appends) and renders the consequence-aware card: a hover preview per option,
// a note field inside that preview, and a handoff card when the user cancels.
//
// Everything interactive rides the existing question carrier (`matched`), so
// answering and cancelling use the same wire path as the shipped card; this
// file only changes what the user sees and which answer batch goes back.
//
// Plain browser module: the module loader evaluates this file as a classic
// script, so it registers itself and pulls React from the shared table.
(() => {
  if (typeof window === 'undefined' || !window.__ModuleLoader__) return

  window.__ModuleLoader__.load({
    id: 'dsh-ask-panel',
    factory: (require) => {
      var module = { exports: {} }
      var exports = module.exports

      const React = require('react')
      const h = React.createElement

      /** Locale namespace owned by this plugin. */
      const NS = 'ask-panel'

      /** Synthetic option the host tool appends; also the batch's ownership marker. */
      const PROCEED_LABEL = '〔按你的判断继续〕'

      /** Separator the host tool uses inside `custom` between label and note. */
      const NOTE_SEPARATOR = '\n[[note]]'

      /** Separator the host tool uses inside `description` before the impact JSON. */
      const IMPACT_MARKER = '\n[[impact]]'

      /** Delay before opening the preview when nothing is open yet. */
      const OPEN_DELAY = 500

      /** Grace period between leaving the option and closing the preview. */
      const CLOSE_DELAY = 220

      /** Preview width in CSS pixels. */
      const FLY_WIDTH = 360

      /** Fallback copy; the locale dictionaries override it key by key. */
      const STRINGS = {
        zh: {
          'title': '需要你定一个方向',
          'hint': '单击选项即选定，点「下一步」继续；停 0.5 秒展开影响预览。',
          'note.placeholder': '想改一点？在这里写下改进意见（可留空）',
          'note.hint': '写下的意见会随答案一起提交；留空就是普通选择。',
          'action.cancel': '取消',
          'action.next': '下一步',
          'action.submit': '提交',
          'action.back': '返回提问',
          'action.confirm': '确认',
          'option.picked': '已选',
          'option.multi': '可多选',
          'option.multiDesc': '这一题可以选多个，选完点下一步',
          'fly.tag': '预览',
          'fly.tagPicked': '已选',
          'fly.hintInspect': '查看影响',
          'fly.empty': '（这项没有填写影响说明）',
          'fly.section.summary': '会发生什么',
          'fly.section.changes': '会改什么',
          'fly.section.files': '涉及文件',
          'fly.section.effects': '对现有功能的影响',
          'fly.chip.risk': '风险',
          'fly.chip.cost': '成本',
          'fly.chip.reversible': '可回滚',
          'risk.low': '低',
          'risk.mid': '中',
          'risk.high': '高',
          'pickedNote': '改进意见',
          'cost.line': '本次提问 {questions} 题 {options} 个选项，约 {tokens} tokens（模型输出）。',
          'handoff.title': '你取消了这次提问，接下来怎么走？',
          'handoff.sub': '取消不会静默关闭——它本身就是一个决策：这次的判断由谁来做。',
          'handoff.proceed': '按你的思路继续做完',
          'handoff.proceedDesc': '把决定权交回给我：我按自己的判断继续当前任务，并在下一轮开头说明选了什么、为什么。',
          'handoff.halt': '停在这里，等我重新决策',
          'handoff.haltDesc': '当前这一步结束后不再发起请求、不再改文件；任务原样暂停，你随时可以接着下指令。',
          'handoff.needChoice': '先选一项：是让我自己定，还是停下来等你。',
          'handoff.done.proceed': '已交给智能体 · 按我的思路继续做完',
          'handoff.done.halt': '已停下 · 等待你的新决策',
          'error.pick': '先选一个选项，或者点「取消」把决定交回给我。',
        },
        en: {
          'title': 'This needs your call',
          'hint': 'Click an option to pick it, then Next; hover 0.5s for the consequence preview.',
          'note.placeholder': 'Want it different? Add a note (optional)',
          'note.hint': 'The note ships with your answer; leave it empty for a plain choice.',
          'action.cancel': 'Cancel',
          'action.next': 'Next',
          'action.submit': 'Submit',
          'action.back': 'Back',
          'action.confirm': 'Confirm',
          'option.picked': 'Picked',
          'option.multi': 'Multi-select',
          'option.multiDesc': 'Pick as many as you need, then continue',
          'fly.tag': 'Preview',
          'fly.tagPicked': 'Picked',
          'fly.hintInspect': 'See impact',
          'fly.empty': '(no consequence notes for this option)',
          'fly.section.summary': 'What happens',
          'fly.section.changes': 'What changes',
          'fly.section.files': 'Files',
          'fly.section.effects': 'Effect on what works today',
          'fly.chip.risk': 'Risk',
          'fly.chip.cost': 'Cost',
          'fly.chip.reversible': 'Reversible',
          'risk.low': 'low',
          'risk.mid': 'medium',
          'risk.high': 'high',
          'pickedNote': 'note',
          'cost.line': '{questions} questions, {options} options, about {tokens} tokens of model output.',
          'handoff.title': 'You cancelled the question — what now?',
          'handoff.sub': 'Cancelling is a decision too: who makes this call?',
          'handoff.proceed': 'Carry on with your own judgement',
          'handoff.proceedDesc': 'Hand the decision back to me: I proceed, and explain the choice at the start of my next reply.',
          'handoff.halt': 'Stop here and wait for me',
          'handoff.haltDesc': 'The step ends, no further request or file change, and the task pauses until you speak.',
          'handoff.needChoice': 'Pick one first: my judgement, or wait for you.',
          'handoff.done.proceed': 'Handed back · continuing on my judgement',
          'handoff.done.halt': 'Stopped · waiting for your decision',
          'error.pick': 'Pick an option first, or press Cancel to hand the decision back.',
        },
      }

      const CSS = `
.dsh-askp{position:relative;width:100%;max-width:640px;margin:0 auto;font-size:13px;color:#20242c}
.dsh-askp-card{background:#fff;border:1px solid #e5e7ec;border-radius:14px;box-shadow:0 10px 30px rgba(22,28,45,.08);overflow:hidden}
.dsh-askp-head{display:flex;align-items:flex-start;gap:10px;padding:14px 16px 10px}
.dsh-askp-head-main{flex:1;min-width:0}
.dsh-askp-eyebrow{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#8b93a2;margin-bottom:4px}
.dsh-askp-title{margin:0;font-size:15px;font-weight:650;line-height:1.45;color:#161a21}
.dsh-askp-pager{display:flex;align-items:center;gap:2px;color:#8b93a2;font-size:12px;white-space:nowrap}
.dsh-askp-icon{border:0;background:transparent;color:#8b93a2;cursor:pointer;padding:4px 6px;border-radius:6px;font-size:12px;line-height:1}
.dsh-askp-icon:hover{background:#f2f4f7;color:#4b5361}
.dsh-askp-icon[disabled]{opacity:.4;cursor:default}
.dsh-askp-body{padding:0 8px 8px}
.dsh-askp-options{list-style:none;margin:0;padding:0}
.dsh-askp-opt{display:block;width:100%;text-align:left;border:1px solid transparent;background:transparent;border-radius:10px;padding:10px 10px 11px;cursor:pointer;font:inherit;color:inherit;transition:background .12s,border-color .12s}
.dsh-askp-opt:hover,.dsh-askp-opt:focus-visible{background:#f7f8fa;border-color:#e7e9ef;outline:none}
.dsh-askp-opt[data-picked="true"]{background:#f4f7ff;border-color:#cddbff}
.dsh-askp-opt-line{display:flex;align-items:center;gap:8px}
.dsh-askp-opt-label{font-weight:600;color:#1c222c}
.dsh-askp-opt[data-picked="true"] .dsh-askp-opt-label{color:#2563eb}
.dsh-askp-badge{font-size:10.5px;line-height:1.5;padding:0 6px;border-radius:999px;background:#e8f0ff;color:#2563eb}
.dsh-askp-badge-note{background:#eef7ee;color:#2f7a3f}
.dsh-askp-mark{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:999px;border:1.5px solid #c2c9d6;background:#fff;font-size:9px;line-height:1;color:#fff}
.dsh-askp-opt[data-multi="true"] .dsh-askp-mark{border-radius:4px}
.dsh-askp-opt[data-picked="true"] .dsh-askp-mark{background:#2563eb;border-color:#2563eb}
.dsh-askp-tag{margin-left:6px;font-size:10.5px;font-weight:500;line-height:1.6;padding:0 6px;border-radius:999px;background:#eef1f6;color:#5b6472;vertical-align:1px}
.dsh-askp-opt-hint{margin-left:auto;font-size:11px;color:#9aa2b1;opacity:0;transition:opacity .12s}
.dsh-askp-opt:hover .dsh-askp-opt-hint,.dsh-askp-opt:focus-visible .dsh-askp-opt-hint{opacity:1}
.dsh-askp-opt-desc{margin-top:3px;font-size:12px;line-height:1.6;color:#7b8494}
.dsh-askp-cost{margin:8px 10px 2px;font-size:11.5px;line-height:1.6;color:#9aa2b1}
.dsh-askp-cost b{font-weight:600;color:#69717f}
.dsh-askp-foot{display:flex;align-items:center;gap:8px;padding:10px 14px 12px;border-top:1px solid #f0f2f5}
.dsh-askp-status{flex:1;font-size:11.5px;color:#c2410c;min-height:16px}
.dsh-askp-btn{border:1px solid #e3e6ec;background:#fff;color:#3d4450;border-radius:9px;padding:7px 14px;font:inherit;cursor:pointer}
.dsh-askp-btn:hover{background:#f7f8fa}
.dsh-askp-btn-primary{background:#1f2937;border-color:#1f2937;color:#fff;font-weight:600}
.dsh-askp-btn-primary:hover{background:#111827}
.dsh-askp-btn[disabled]{opacity:.5;cursor:default}
.dsh-askp-fly{position:absolute;bottom:calc(100% + 10px);width:360px;max-height:min(56vh,460px);display:flex;flex-direction:column;background:#fff;border:1px solid #e5e7ec;border-radius:13px;box-shadow:0 18px 44px rgba(22,28,45,.16);z-index:40}
.dsh-askp-fly::after{content:"";position:absolute;bottom:-5px;left:var(--arrow,28px);width:9px;height:9px;background:#fff;border-right:1px solid #e5e7ec;border-bottom:1px solid #e5e7ec;transform:rotate(45deg)}
.dsh-askp-fly-head{padding:11px 14px 9px;border-bottom:1px solid #f2f4f8;display:flex;align-items:center;gap:7px}
.dsh-askp-fly-tag{font-size:10.5px;line-height:1.6;padding:0 6px;border-radius:5px;background:#eef2f8;color:#5b6472}
.dsh-askp-fly-tag[data-picked="true"]{background:#e9f7ec;color:#2f7a3f}
.dsh-askp-fly-title{font-size:12.5px;font-weight:600;color:#242a34;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-askp-fly-body{flex:1;min-height:0;overflow:auto;padding:10px 14px 4px}
.dsh-askp-fly-sec{margin-bottom:10px}
.dsh-askp-fly-sec:last-child{margin-bottom:2px}
.dsh-askp-fly-h{margin:0 0 4px;font-size:11px;color:#9aa2b1;letter-spacing:.02em}
.dsh-askp-fly-p{margin:0;font-size:12px;line-height:1.65;color:#3f4653}
.dsh-askp-fly-ul{margin:0;padding-left:16px}
.dsh-askp-fly-ul li{font-size:12px;line-height:1.7;color:#49505d}
.dsh-askp-chips{display:flex;flex-wrap:wrap;gap:6px}
.dsh-askp-chip{font-size:11px;line-height:1.7;padding:0 7px;border-radius:6px;background:#f3f5f8;color:#5b6472}
.dsh-askp-chip[data-risk="low"]{background:#eaf6ec;color:#2f7a3f}
.dsh-askp-chip[data-risk="mid"]{background:#fdf5e3;color:#96631a}
.dsh-askp-chip[data-risk="high"]{background:#fdeceb;color:#b42318}
.dsh-askp-fly-empty{margin:0;padding:16px 0;text-align:center;font-size:12px;color:#9aa2b1}
.dsh-askp-note{padding:8px 12px 2px;border-top:1px dashed #eef0f4}
.dsh-askp-note input{width:100%;box-sizing:border-box;border:1px solid #e3e6ec;border-radius:8px;padding:7px 9px;font:inherit;font-size:12px;color:#242a34;background:#fbfcfe}
.dsh-askp-note input:focus{outline:none;border-color:#b9c8f2;background:#fff}
.dsh-askp-note-hint{font-size:10.5px;line-height:1.7;color:#a6adba;padding:4px 2px 6px}
.dsh-askp-fly-foot{padding:6px 12px 9px;font-size:11px;color:#a6adba}
.dsh-askp-handoff{padding:0}
.dsh-askp-handoff-head{display:flex;gap:9px;padding:14px 16px 8px}
.dsh-askp-handoff-mark{flex:none;width:18px;height:18px;border-radius:50%;background:#fdf1e7;color:#b45309;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:1px}
.dsh-askp-handoff-sub{margin:4px 0 0;font-size:11.5px;line-height:1.65;color:#8b93a2}
.dsh-askp-done{padding:16px;text-align:center;color:#5b6472;font-size:12.5px}
@media (prefers-reduced-motion: reduce){.dsh-askp-opt,.dsh-askp-fly{transition:none}}
`

      /**
       * Split a wire option back into its human summary and impact payload.
       * @param option - wire option (`label` plus encoded `description`).
       * @returns Label, summary text, and the parsed impact object or null.
       */
      function parseOption(option) {
        const raw = typeof option.description === 'string' ? option.description : ''
        const at = raw.indexOf(IMPACT_MARKER)
        if (at < 0) return { label: option.label, summary: raw, impact: null }
        let impact = null
        try {
          impact = JSON.parse(raw.slice(at + IMPACT_MARKER.length))
        } catch {
          impact = null
        }
        return { label: option.label, summary: raw.slice(0, at), impact }
      }

      /**
       * Whether a question batch was raised by this plugin's tool.
       * @param carrier - pending question carrier.
       * @returns True when the synthetic "decide it yourself" option is present.
       */
      function claimsAsk(carrier) {
        const questions = questionsOf(carrier)
        if (!Array.isArray(questions)) return false
        return questions.some(question => (question.options ?? []).some(option => option.label === PROCEED_LABEL))
      }

      /**
       * The question list of a pending carrier, across carrier shapes.
       * @param carrier - pending question carrier.
       * @returns Questions array, or undefined when the carrier carries none.
       */
      function questionsOf(carrier) {
        if (!carrier) return undefined
        if (Array.isArray(carrier.questions)) return carrier.questions
        return carrier.payload?.questions
      }

      /**
       * Pick the pending question carrier out of a composer owner, across owner shapes.
       * Installed builds hand a single `pendingInteraction`; older ones hand an `interactions` list.
       * @param owner - composer chain owner props.
       * @returns The question carrier this plugin claims, or null.
       */
      function toCarrier(owner) {
        const single = owner?.pendingInteraction
        if (single && single.kind === 'question') return single
        const list = Array.isArray(owner?.interactions) ? owner.interactions : []
        return list.find(entry => entry?.kind === 'question') ?? null
      }

      /**
       * Deliver an answer through whichever settlement API the carrier exposes.
       * @param carrier - pending question carrier.
       * @param answer - wire answer payload.
       * @returns Settlement promise.
       */
      function settle(carrier, answer) {
        if (typeof carrier.answer === 'function') return carrier.answer(answer)
        return carrier.respond({ ok: true, value: { sessionId: carrier.sessionId, answer } })
      }

      /**
       * Abandon the ask through whichever cancellation API the carrier exposes.
       * @param carrier - pending question carrier.
       * @returns Settlement promise.
       */
      function settleCancel(carrier) {
        if (typeof carrier.cancel === 'function') return Promise.resolve(carrier.cancel())
        return carrier.respond({
          ok: false,
          error: { code: 'cancelled', message: 'the user cancelled the ask card', details: {} },
        })
      }

      /**
       * Renderable model of one question: options split, marker removed.
       * @param question - wire question.
       * @returns Display question.
       */
      function displayQuestion(question) {
        const options = (question.options ?? [])
          .filter(option => option.label !== PROCEED_LABEL)
          .map(parseOption)
        return {
          id: question.id,
          title: question.question,
          header: question.header,
          detail: question.detail,
          multiSelect: question.multiSelect === true,
          options,
        }
      }

      /**
       * Rough output cost of the impact payloads, in tokens.
       * @param questions - display questions.
       * @returns Options total, options with impact, and estimated tokens.
       */
      function costOf(questions) {
        let options = 0
        let filled = 0
        let chars = 0
        for (const question of questions) {
          for (const option of question.options) {
            options += 1
            const impact = option.impact
            if (impact === null || Object.keys(impact).length === 0) continue
            filled += 1
            chars += JSON.stringify(impact).length
          }
        }
        return { options, filled, tokens: Math.max(0, Math.round(chars / 2.4)) }
      }

      /**
       * Fold a click into one question's picked labels.
       * @param entry - labels already picked for the question.
       * @param label - label the user clicked.
       * @param multi - whether the question allows more than one pick.
       * @returns The next picked labels.
       */
      function applyPick(entry, label, multi) {
        if (multi === true) return entry.includes(label) ? entry.filter((item) => item !== label) : [...entry, label]
        return entry.includes(label) ? [] : [label]
      }

      /**
       * Format a token estimate for the cost line.
       * @param tokens - token count.
       * @returns `581` or `1.2K`.
       */
      function formatTokens(tokens) {
        if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}K`
        return String(tokens)
      }

      /**
       * Build the answer batch for one submission.
       * @param questions - display questions.
       * @param picks - chosen labels per question.
       * @param notes - notes per question.
       * @returns Answer payload entries.
       */
      function buildAnswers(questions, picks, notes) {
        return questions.map((question, index) => {
          const picked = picks[index] ?? []
          const note = (notes[index] ?? '').trim()
          const proceed = picked.includes(PROCEED_LABEL)
          if (proceed || picked.length === 0) {
            return { id: question.id, selected: proceed ? [PROCEED_LABEL] : [] }
          }
          if (note !== '') {
            if (question.multiSelect) return { id: question.id, selected: picked, custom: note }
            return { id: question.id, selected: [], custom: picked[0] + NOTE_SEPARATOR + note }
          }
          return { id: question.id, selected: picked }
        })
      }

      /**
       * A card-local translator with dictionary fallback.
       * @param t - the locale seat, when the host provided one.
       * @returns Translate function.
       */
      function translator(t) {
        return (key, vars) => {
          let text
          try {
            text = t?.(key)
          } catch {
            text = undefined
          }
          if (typeof text !== 'string' || text === key) text = STRINGS.zh[key] ?? key
          if (vars === undefined) return text
          return text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all))
        }
      }

      /**
       * The composer takeover: question card plus preview.
       * @param props - chain props: `matched` carrier, standard kit, locale seat.
       * @returns The card.
       */
      function AskPanel(props) {
        const carrier = props.matched
        const t = translator(props.t)
        const questions = React.useMemo(
          () => (questionsOf(carrier) ?? []).map(displayQuestion),
          [carrier],
        )
        const [index, setIndex] = React.useState(0)
        const [picks, setPicks] = React.useState(() => questions.map(() => []))
        const [notes, setNotes] = React.useState(() => questions.map(() => ''))
        const [fly, setFly] = React.useState(null)
        const [mode, setMode] = React.useState('ask')
        const [handPick, setHandPick] = React.useState(null)
        const [busy, setBusy] = React.useState(null)
        const [status, setStatus] = React.useState('')
        const [done, setDone] = React.useState(null)
        const rootRef = React.useRef(null)
        const flyRef = React.useRef(null)
        const openTimer = React.useRef(null)
        const closeTimer = React.useRef(null)

        const current = questions[Math.min(index, questions.length - 1)]
        const noteFocused = React.useCallback(() => {
          const input = flyRef.current?.querySelector('input')
          return input !== undefined && input !== null && document.activeElement === input
        }, [])

        const clearTimers = () => {
          if (openTimer.current !== null) window.clearTimeout(openTimer.current)
          if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
          openTimer.current = null
          closeTimer.current = null
        }

        const openFor = React.useCallback((questionIndex, option) => {
          clearTimers()
          const root = rootRef.current
          const node = root?.querySelector(`[data-askp-opt="${String(questionIndex)}"]`)
          let arrow = 28
          if (root !== null && root !== undefined && node !== null && node !== undefined) {
            const rootRect = root.getBoundingClientRect()
            const nodeRect = node.getBoundingClientRect()
            arrow = Math.max(16, Math.min(FLY_WIDTH - 24, nodeRect.left - rootRect.left + 18))
          }
          setFly({ questionIndex, option, arrow })
        }, [])

        const scheduleClose = React.useCallback(() => {
          clearTimers()
          closeTimer.current = window.setTimeout(() => {
            if (noteFocused()) return
            setFly(null)
          }, CLOSE_DELAY)
        }, [noteFocused])

        const hoverOption = (questionIndex, option) => {
          if (fly !== null) {
            openFor(questionIndex, option)
            return
          }
          clearTimers()
          openTimer.current = window.setTimeout(() => openFor(questionIndex, option), OPEN_DELAY)
        }

        const togglePick = (label, multi) => {
          setStatus('')
          setPicks((entries) => entries.map((entry, entryIndex) => (
            entryIndex === index ? applyPick(entry, label, multi) : entry
          )))
        }

        const respond = (answer) => settle(carrier, answer)

        const say = (error) => {
          setBusy(null)
          setStatus(error instanceof Error ? error.message : String(error))
        }

        const submit = () => {
          const missing = picks.findIndex((entry) => entry.length === 0)
          if (missing >= 0) {
            setIndex(missing)
            setStatus(t('error.pick'))
            return
          }
          setBusy('answer')
          setStatus('')
          void respond({ answers: buildAnswers(questions, picks, notes) })
            .then((receipt) => {
              if (receipt?.accepted === false) throw new Error(`answer rejected: ${String(receipt.reason)}`)
              setDone(t('action.submit'))
            })
            .catch(say)
        }

        const cancelAsk = () => {
          clearTimers()
          setFly(null)
          setMode('handoff')
          setHandPick(null)
          setStatus('')
        }

        const backToAsk = () => {
          setMode('ask')
          setHandPick(null)
          setStatus('')
        }

        const commitHandoff = () => {
          if (handPick === null) {
            setStatus(t('handoff.needChoice'))
            return
          }
          setBusy('handoff')
          setStatus('')
          if (handPick === 'proceed') {
            const answers = { answers: questions.map((question) => ({ id: question.id, selected: [PROCEED_LABEL] })) }
            void respond(answers)
              .then((receipt) => {
                if (receipt?.accepted === false) throw new Error(`handoff rejected: ${String(receipt.reason)}`)
                setDone(t('handoff.done.proceed'))
              })
              .catch(say)
            return
          }
          void settleCancel(carrier)
            .then((receipt) => {
              if (receipt?.accepted === false) throw new Error(`handoff rejected: ${String(receipt.reason)}`)
              setDone(t('handoff.done.halt'))
            })
            .catch(say)
        }

        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          if (mode === 'handoff') backToAsk()
          else cancelAsk()
        }

        if (done !== null) {
          return h('div', { className: 'dsh-askp' },
            h('section', { className: 'dsh-askp-card' },
              h('div', { className: 'dsh-askp-done' }, done)))
        }

        if (mode === 'handoff') {
          return h('div', { className: 'dsh-askp', onKeyDown, ref: rootRef },
            h('section', { className: 'dsh-askp-card' },
              h('div', { className: 'dsh-askp-handoff' },
                h('div', { className: 'dsh-askp-handoff-head' },
                  h('span', { className: 'dsh-askp-handoff-mark', 'aria-hidden': 'true' }, '!'),
                  h('div', { style: { flex: '1', minWidth: '0' } },
                    h('h2', { className: 'dsh-askp-title' }, t('handoff.title')),
                    h('p', { className: 'dsh-askp-handoff-sub' }, t('handoff.sub')))),
                h('div', { className: 'dsh-askp-body' },
                  h('ul', { className: 'dsh-askp-options' },
                    handoffOption('proceed', t('handoff.proceed'), t('handoff.proceedDesc'), handPick, setHandPick),
                    handoffOption('halt', t('handoff.halt'), t('handoff.haltDesc'), handPick, setHandPick)))),
              h('div', { className: 'dsh-askp-foot' },
                h('span', { className: 'dsh-askp-status' }, status),
                h('button', { className: 'dsh-askp-btn', type: 'button', onClick: backToAsk, disabled: busy !== null }, t('action.back')),
                h('button', {
                  className: 'dsh-askp-btn dsh-askp-btn-primary',
                  type: 'button',
                  onClick: commitHandoff,
                  disabled: busy !== null,
                }, t('action.confirm')))))
        }

        const cost = costOf(questions)
        return h('div', { className: 'dsh-askp', onKeyDown, ref: rootRef },
          h('section', { className: 'dsh-askp-card' },
            h('div', { className: 'dsh-askp-head' },
              h('div', { className: 'dsh-askp-head-main' },
                current.header === undefined ? null : h('div', { className: 'dsh-askp-eyebrow' }, current.header),
                h('h2', { className: 'dsh-askp-title' },
                  current.title,
                  current.multiSelect === true
                    ? h('span', { className: 'dsh-askp-tag', title: t('option.multiDesc') }, t('option.multi'))
                    : null)),
              h('div', { className: 'dsh-askp-pager' },
                h('button', {
                  className: 'dsh-askp-icon', type: 'button', 'aria-label': 'prev',
                  disabled: index === 0,
                  onClick: () => { setIndex(index - 1); setFly(null) },
                }, '‹'),
                h('span', null, `${String(index + 1)} / ${String(questions.length)}`),
                h('button', {
                  className: 'dsh-askp-icon', type: 'button', 'aria-label': 'next',
                  disabled: index === questions.length - 1,
                  onClick: () => { setIndex(index + 1); setFly(null) },
                }, '›'),
                h('button', {
                  className: 'dsh-askp-icon', type: 'button', 'aria-label': t('action.cancel'),
                  onClick: cancelAsk, disabled: busy !== null,
                }, '×'))),
            h('div', { className: 'dsh-askp-body' },
              h('ul', { className: 'dsh-askp-options', 'data-multi': current.multiSelect === true ? 'true' : 'false' },
                current.options.map((option, optionIndex) => optionRow({
                  option,
                  questionIndex: index,
                  picked: (picks[index] ?? []).includes(option.label),
                  note: (notes[index] ?? '').trim() !== '',
                  multi: current.multiSelect === true,
                  t,
                  onPick: () => togglePick(option.label, current.multiSelect === true),
                  onHover: () => hoverOption(index, option),
                  onLeave: scheduleClose,
                }))),
              h('p', { className: 'dsh-askp-cost' },
                t('cost.line', {
                  questions: questions.length,
                  options: cost.options,
                  tokens: formatTokens(cost.tokens),
                }))),
            h('div', { className: 'dsh-askp-foot' },
              h('span', { className: 'dsh-askp-status' }, status),
              h('button', { className: 'dsh-askp-btn', type: 'button', onClick: cancelAsk, disabled: busy !== null }, t('action.cancel')),
              h('button', {
                className: 'dsh-askp-btn dsh-askp-btn-primary',
                type: 'button',
                disabled: busy !== null,
                onClick: () => {
                  if (index < questions.length - 1) {
                    if ((picks[index] ?? []).length === 0) {
                      setStatus(t('error.pick'))
                      return
                    }
                    setIndex(index + 1)
                    setFly(null)
                    setStatus('')
                    return
                  }
                  submit()
                },
              }, index === questions.length - 1 ? t('action.submit') : t('action.next')))),
          fly === null ? null : preview({
            fly, questions, picks, notes, t,
            setNotes,
            onEnter: () => { clearTimers() },
            onLeave: scheduleClose,
            picked: (picks[fly.questionIndex] ?? []).includes(fly.option.label),
            flyRef,
          }))
      }

      /**
       * One option row of the question card.
       * @param row - row state and handlers.
       * @returns The row element.
       */
      function optionRow(row) {
        const { option, questionIndex, picked, note, multi, t, onPick, onHover, onLeave } = row
        return h('li', { key: option.label },
          h('button', {
            type: 'button',
            className: 'dsh-askp-opt',
            'data-askp-opt': String(questionIndex),
            'data-picked': picked ? 'true' : 'false',
            'data-multi': multi ? 'true' : 'false',
            role: multi ? 'checkbox' : 'button',
            'aria-checked': multi ? picked : undefined,
            'aria-pressed': multi ? undefined : picked,
            onClick: onPick,
            onMouseEnter: onHover,
            onFocus: onHover,
            onMouseLeave: onLeave,
            onBlur: onLeave,
          },
          h('span', { className: 'dsh-askp-opt-line' },
            h('span', { className: 'dsh-askp-mark', 'aria-hidden': 'true' }, picked ? '✓' : ''),
            h('span', { className: 'dsh-askp-opt-label' }, option.label),
            picked ? h('span', { className: 'dsh-askp-badge' }, t('option.picked')) : null,
            note ? h('span', { className: 'dsh-askp-badge dsh-askp-badge-note' }, t('pickedNote')) : null,
            h('span', { className: 'dsh-askp-opt-hint' }, t('fly.hintInspect'))),
          option.summary === '' ? null : h('span', { className: 'dsh-askp-opt-desc' }, option.summary)))
      }

      /**
       * One row of the handoff card.
       * @param id - `proceed` or `halt`.
       * @param title - row title.
       * @param desc - row description.
       * @param picked - current handoff choice.
       * @param onPick - choice setter.
       * @returns The row element.
       */
      function handoffOption(id, title, desc, picked, onPick) {
        return h('li', { key: id },
          h('button', {
            type: 'button',
            className: 'dsh-askp-opt',
            'data-picked': picked === id ? 'true' : 'false',
            onClick: () => { onPick(id) },
          },
          h('span', { className: 'dsh-askp-opt-line' }, h('span', { className: 'dsh-askp-opt-label' }, title)),
          h('span', { className: 'dsh-askp-opt-desc' }, desc)))
      }

      /**
       * The hover preview: consequence sections plus the note field.
       * @param view - preview state and handlers.
       * @returns The preview element.
       */
      function preview(view) {
        const { fly, questions, notes, t, setNotes, onEnter, onLeave, picked, flyRef } = view
        const question = questions[fly.questionIndex]
        const option = fly.option
        const impact = option.impact ?? {}
        const sections = []
        if (typeof impact.summary === 'string' && impact.summary !== '') {
          sections.push(section(t('fly.section.summary'), h('p', { className: 'dsh-askp-fly-p' }, impact.summary)))
        }
        for (const [key, title] of [['changes', 'fly.section.changes'], ['files', 'fly.section.files'], ['effects', 'fly.section.effects']]) {
          const items = Array.isArray(impact[key]) ? impact[key] : []
          if (items.length === 0) continue
          sections.push(section(t(title), h('ul', { className: 'dsh-askp-fly-ul' }, items.map((item) => h('li', { key: item }, item)))))
        }
        const chips = []
        if (typeof impact.risk === 'string') {
          chips.push(h('span', { key: 'risk', className: 'dsh-askp-chip', 'data-risk': impact.risk },
            `${t('fly.chip.risk')} · ${t(`risk.${impact.risk}`)}`))
        }
        if (typeof impact.cost === 'string') {
          chips.push(h('span', { key: 'cost', className: 'dsh-askp-chip' }, `${t('fly.chip.cost')} · ${impact.cost}`))
        }
        if (impact.reversible === true) {
          chips.push(h('span', { key: 'rev', className: 'dsh-askp-chip' }, t('fly.chip.reversible')))
        }
        if (chips.length > 0) sections.push(h('div', { key: 'chips', className: 'dsh-askp-fly-sec dsh-askp-chips' }, chips))
        if (sections.length === 0) sections.push(h('p', { key: 'empty', className: 'dsh-askp-fly-empty' }, t('fly.empty')))

        return h('div', {
          className: 'dsh-askp-fly',
          ref: flyRef,
          style: { '--arrow': `${String(fly.arrow)}px` },
          onMouseEnter: onEnter,
          onMouseLeave: onLeave,
        },
        h('div', { className: 'dsh-askp-fly-head' },
          h('span', { className: 'dsh-askp-fly-tag', 'data-picked': picked ? 'true' : 'false' }, picked ? t('fly.tagPicked') : t('fly.tag')),
          h('span', { className: 'dsh-askp-fly-title' }, option.label)),
        h('div', { className: 'dsh-askp-fly-body' }, sections),
        h('div', { className: 'dsh-askp-note' },
          h('input', {
            type: 'text',
            value: notes[fly.questionIndex] ?? '',
            placeholder: t('note.placeholder'),
            onChange: (event) => {
              const value = event.target.value
              setNotes((current) => current.map((entry, entryIndex) => entryIndex === fly.questionIndex ? value : entry))
            },
            onKeyDown: (event) => { if (event.key === 'Escape') event.currentTarget.blur() },
          }),
          h('div', { className: 'dsh-askp-note-hint' }, t('note.hint'))),
        h('div', { className: 'dsh-askp-fly-foot' }, question?.title ?? ''))
      }

      /**
       * One titled preview section.
       * @param title - section heading.
       * @param body - section content.
       * @returns Section element.
       */
      function section(title, body) {
        return h('div', { key: title, className: 'dsh-askp-fly-sec' },
          h('p', { className: 'dsh-askp-fly-h' }, title), body)
      }

      /** Required services: the slot registry and the locale dictionaries. */
      exports.inject = ['slots', 'locale']

      /**
       * Chain routing: claim the composer only for this plugin's batches, so
       * the shipped question card keeps every other request.
       * @param owner - composer chain owner props.
       * @returns The question carrier to render, or null to pass.
       */
      exports.select = (owner) => {
        const carrier = toCarrier(owner)
        return carrier !== null && claimsAsk(carrier) ? carrier : null
      }

      exports.toCarrier = toCarrier
      exports.settle = settle
      exports.settleCancel = settleCancel

      /**
       * Client plugin body: dictionaries, stylesheet, and the chain entry.
       * @param ctx - client root context.
       */
      exports.apply = (ctx) => {
        ctx.effect(() => ctx.locale.register(NS, STRINGS), 'ask-panel: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-ask-panel', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'ask-panel: stylesheet')
        ctx.slots.inject('conversation.composer', () => ctx.slots.register(
          { name: 'conversation.composer', select: exports.select, priority: -2, locale: NS },
          AskPanel,
        ))
      }

      exports.name = 'ask-panel'
      exports.AskPanel = AskPanel
      exports.parseOption = parseOption
      exports.claimsAsk = claimsAsk
      exports.buildAnswers = buildAnswers
      exports.applyPick = applyPick
      exports.costOf = costOf
      exports.formatTokens = formatTokens
      exports.PROCEED_LABEL = PROCEED_LABEL
      exports.NOTE_SEPARATOR = NOTE_SEPARATOR
      exports.IMPACT_MARKER = IMPACT_MARKER

      return module.exports
    },
  })
})()
