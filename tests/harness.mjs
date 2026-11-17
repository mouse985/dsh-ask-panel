// Harness for dsh-ask-panel. Drives the real host module and the real client
// module against stubs: no browser, no DSH runtime.
//
//   node tests/harness.mjs
//
// Covers: option encoding round-trip, answer decoding (plain / note / free
// form / proceed), the halt path concluding the turn, the payload and call
// budgets, the chain selector claiming only our batches, answer construction
// (including the note separator), and the cost estimate.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const host = await import(pathToFileURL(join(root, 'lib/index.js')).href)

const failures = []
function check(name, condition, detail) {
  if (condition) return
  failures.push(detail === undefined ? name : `${name}: ${detail}`)
}

// --- host: encoding ------------------------------------------------------

const encoded = host.encodeOption({
  label: '讲解已有代码与原理',
  description: '边读代码边讲解架构设计',
  impact: { summary: '只读不改', changes: ['产出 docs/a.md'], risk: 'low', reversible: true, files: [] },
})
check('encode keeps label', encoded.label === '讲解已有代码与原理')
check('encode keeps summary', encoded.description.startsWith('边读代码边讲解架构设计'))
check('encode appends marker', encoded.description.includes(host.IMPACT_MARKER))
check('encode drops empty arrays', !encoded.description.includes('files'))
const roundTrip = JSON.parse(encoded.description.slice(encoded.description.indexOf(host.IMPACT_MARKER) + host.IMPACT_MARKER.length))
check('encode payload parses', roundTrip.summary === '只读不改' && roundTrip.risk === 'low' && roundTrip.reversible === true)

const bare = host.encodeOption({ label: 'plain' })
check('encode without impact has no marker', bare.description === undefined)

// --- host: question encoding appends the door ----------------------------

const wired = host
const wireQuestion = {
  id: 'q1',
  question: '接下来你希望我优先投入哪一类工作？',
  options: [{ label: 'A', impact: { summary: 's' } }, { label: 'B' }],
}
check('PROCEED_LABEL exported', typeof wired.PROCEED_LABEL === 'string' && wired.PROCEED_LABEL.length > 0)

// --- host: answer decoding ----------------------------------------------

const decodeCases = [
  ['plain choice', { selected: ['A'] }, { questionId: 'q1', label: 'A' }],
  ['choice with note', { selected: [], custom: 'A' + host.NOTE_SEPARATOR + '不要新增 md' }, { questionId: 'q1', label: 'A', note: '不要新增 md' }],
  ['free form', { selected: [], custom: '换一套方案' }, { questionId: 'q1', custom: '换一套方案' }],
  ['proceed door', { selected: [host.PROCEED_LABEL] }, { kind: 'proceed' }],
]
for (const [name, answer, expected] of decodeCases) {
  const actual = host.decodeAnswer(answer, { id: 'q1', options: [{ label: 'A' }, { label: 'B' }] })
  check(`decode ${name}`, JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify(actual))
}

const otherDecoded = host.decodeAnswer(
  { selected: [host.OTHER_LABEL], custom: '我自己写的答案' },
  { id: 'q1', options: [{ label: 'A' }, { label: host.OTHER_LABEL }] },
)
check(
  'decode free text typed into the other row',
  JSON.stringify(otherDecoded) === JSON.stringify({ questionId: 'q1', custom: '我自己写的答案' }),
  JSON.stringify(otherDecoded),
)

// --- host: tool registration and both terminal paths --------------------

const sections = []

function registerTool() {
  let definition
  const ctx = {
    tools: { register: (tool) => { definition = tool; return () => {} } },
    userQuestions: {},
    systemPrompt: { section: (section) => { sections.push(section); return () => {} } },
  }
  host.apply(ctx)
  return definition
}

const tool = registerTool()
check('tool name', tool.name === 'ask_user')

const guidance = sections.find(section => section.name === 'tool:ask_user')
check('registers ask_user prompt guidance', guidance !== undefined)
check('guidance order is finite', Number.isFinite(guidance?.order))
check(
  'guidance states when to ask',
  typeof guidance?.text === 'string' && guidance.text.includes('ambiguous request') && guidance.text.includes('`待确认`'),
)
check('inject declares systemPrompt', host.inject.includes('systemPrompt'))
check('tool requires questions', tool.parameters.required?.includes('questions') === true)
check('tool has output contract', typeof tool.output?.render === 'function')

function fakeExec(overrides) {
  const calls = { concluded: 0 }
  const exec = {
    agent: { session: { id: overrides.sessionId ?? 's1' } },
    signal: new AbortController().signal,
    concludeTurn: () => { calls.concluded += 1 },
  }
  return { exec, calls }
}

function ctxWith(ask) {
  const ctx = {
    tools: { register: () => () => {} },
    userQuestions: { ask },
    systemPrompt: { section: () => () => {} },
  }
  host.apply(ctx)
  // apply registers into a throwaway registry; re-register on a capturing one.
  let definition
  ctx.tools = { register: (tool) => { definition = tool; return () => {} } }
  host.apply(ctx)
  return definition
}

const questions = [{ id: 'q1', question: 'pick', mode: 'single', options: [{ label: 'A' }, { label: 'B' }] }]

const answeredTool = ctxWith(async (request) => {
  check('sent to service with agent', request.agent?.session?.id === 's1')
  check('sent marker option', request.questions[0].options.at(-1).label === host.PROCEED_LABEL)
  return { answers: [{ id: 'q1', selected: ['B'] }] }
})
const answered = await answeredTool.execute({ questions }, fakeExec({}).exec)
check('answered kind', answered.kind === 'answered')
check('answered label', answered.answers[0].label === 'B')
check('answered has askId', typeof answered.askId === 'string' && answered.askId.startsWith('ask-'))

const cancelled = fakeExec({ sessionId: 's2' })
const haltTool = ctxWith(async () => {
  const error = new Error('cancelled')
  error.code = 'ASK_CANCELLED'
  throw error
})
const halted = await haltTool.execute({ questions }, cancelled.exec)
check('halt kind', halted.kind === 'deferred' && halted.choice === 'halt')
check('halt concludes turn', cancelled.calls.concluded === 1)

const proceedTool = ctxWith(async () => ({ answers: [{ id: 'q1', selected: [host.PROCEED_LABEL] }] }))
const proceeded = await proceedTool.execute({ questions }, fakeExec({ sessionId: 's3' }).exec)
check('proceed kind', proceeded.kind === 'deferred' && proceeded.choice === 'proceed')

// --- host: the pick-mode contract ---------------------------------------

const modeTool = ctxWith(async () => ({ answers: [{ id: 'q1', selected: ['A'] }] }))

const noMode = await modeTool
  .execute({ questions: [{ id: 'q1', question: 'pick', options: [{ label: 'A' }] }] }, fakeExec({ sessionId: 's6' }).exec)
  .catch((error) => error)
check('missing mode rejected', noMode instanceof Error && noMode.message.includes('set mode to'), String(noMode))

const badMode = await modeTool
  .execute({ questions: [{ id: 'q1', question: 'pick', mode: 'weird', options: [{ label: 'A' }] }] }, fakeExec({ sessionId: 's7' }).exec)
  .catch((error) => error)
check('unknown mode rejected', badMode instanceof Error && badMode.message.includes('use "single" or "multi"'), String(badMode))

let seenMulti
const multiTool = ctxWith(async (request) => {
  seenMulti = request.questions[0].multiSelect
  return { answers: [{ id: 'q1', selected: ['A'] }] }
})
await multiTool.execute(
  { questions: [{ id: 'q1', question: 'pick', mode: 'multi', options: [{ label: 'A' }] }] },
  fakeExec({ sessionId: 's8' }).exec,
)
check('mode multi asks for multiSelect', seenMulti === true, String(seenMulti))

const legacyTool = ctxWith(async (request) => {
  seenMulti = request.questions[0].multiSelect
  return { answers: [{ id: 'q1', selected: ['A'] }] }
})
await legacyTool.execute(
  { questions: [{ id: 'q1', question: 'pick', multi_select: true, options: [{ label: 'A' }] }] },
  fakeExec({ sessionId: 's9' }).exec,
)
check('legacy multi_select still works', seenMulti === true, String(seenMulti))

// --- host: budgets -------------------------------------------------------

const tooMany = ctxWith(async () => ({ answers: [] }))
const oversized = {
  questions: [{
    id: 'q1',
    question: 'x'.repeat(600),
    mode: 'single',
    options: Array.from({ length: 5 }, (_, i) => ({ label: `opt ${String(i)}`, impact: { summary: 'y'.repeat(300) } })),
  }],
}
const refusedBig = await tooMany.execute(oversized, fakeExec({ sessionId: 's4' }).exec)
check('oversized request refused', refusedBig.kind === 'refused' && refusedBig.note.includes('bytes'), JSON.stringify(refusedBig))

let askCount = 0
const budgetTool = ctxWith(async () => { askCount += 1; return { answers: [{ id: 'q1', selected: ['A'] }] } })
const budget = fakeExec({ sessionId: 's5' })
for (let i = 0; i < 3; i += 1) await budgetTool.execute({ questions }, budget.exec)
const fourth = await budgetTool.execute({ questions }, budget.exec)
check('fourth ask refused', fourth.kind === 'refused' && askCount === 3, JSON.stringify({ fourth, askCount }))

const invalid = await budgetTool.execute({ questions: [] }, fakeExec({}).exec).catch((error) => error)
check('empty questions rejected', invalid instanceof Error)

// --- client: module under a fake loader ---------------------------------

const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useMemo: (factory) => factory(),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useRef: (value) => ({ current: value ?? null }),
  useCallback: (fn) => fn,
}

let registration
const loaded = {}
const sandboxWindow = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      const exports = factory((name) => {
        if (name === 'react') return React
        throw new Error(`unexpected require: ${name}`)
      })
      loaded[id] = exports
      return exports
    },
  },
}

const clientSource = readFileSync(join(root, 'client.js'), 'utf8')
const require = createRequire(import.meta.url)
void require
const runClient = new Function('window', 'document', clientSource)
const styleEl = { setAttribute: () => {}, textContent: '', remove: () => {} }
runClient(sandboxWindow, {
  head: { appendChild: () => {} },
  createElement: () => styleEl,
  activeElement: null,
})
const client = loaded['dsh-ask-panel']

check('client exports name', client.name === 'ask-panel')
check('client injects slots+locale', JSON.stringify(client.inject) === JSON.stringify(['slots', 'locale']))

const carrierOf = (questions) => ({
  kind: 'question',
  key: 'q:1',
  sessionId: 's1',
  payload: { questions },
  respond: () => Promise.resolve({ accepted: true }),
})

check('selector ignores foreign batches',
  client.select({ interactions: [carrierOf([{ id: 'q1', question: 'x', options: [{ label: 'A' }] }])] }) === null)
check('selector ignores non-questions',
  client.select({ interactions: [{ kind: 'approval' }] }) === null)

const ours = carrierOf([
  { id: 'q1', question: 'pick', options: [{ label: 'A', description: 'sum' + host.IMPACT_MARKER + '{"summary":"s"}' }, { label: host.PROCEED_LABEL }] },
])
check('selector claims our batch', client.select({ interactions: [ours] }) === ours)
check('selector claims the single carrier shape', client.select({ pendingInteraction: ours }) === ours)
check('selector passes when the single carrier is foreign',
  client.select({ pendingInteraction: { kind: 'approval' } }) === null)
check('selector passes on an empty owner', client.select({}) === null)

const rootCarrier = { kind: 'question', key: 'q:2', sessionId: 's1', questions: [{ id: 'q1', question: 'x', options: [{ label: host.PROCEED_LABEL }] }] }
check('selector reads questions off the carrier root', client.select({ pendingInteraction: rootCarrier }) === rootCarrier)

let answeredWith = null
let cancelCalled = false
const modern = {
  kind: 'question',
  sessionId: 's1',
  payload: { questions: [] },
  answer: (answer) => { answeredWith = answer; return Promise.resolve() },
  cancel: () => { cancelCalled = true; return Promise.resolve() },
}
await client.settle(modern, { answers: [] })
check('settle prefers answer()', answeredWith !== null && JSON.stringify(answeredWith) === JSON.stringify({ answers: [] }))
await client.settleCancel(modern)
check('settleCancel prefers cancel()', cancelCalled)

let legacyPayload = null
const legacy = { kind: 'question', sessionId: 's9', payload: { questions: [] }, respond: (payload) => { legacyPayload = payload; return Promise.resolve({ accepted: true }) } }
await client.settle(legacy, { answers: [] })
check('settle falls back to respond()', legacyPayload?.value?.sessionId === 's9' && legacyPayload?.ok === true)
await client.settleCancel(legacy)
check('settleCancel falls back to a cancelled response', legacyPayload?.error?.code === 'cancelled')

// --- client: parsing / answers / cost -----------------------------------

const parsed = client.parseOption({ label: 'A', description: '摘要' + host.IMPACT_MARKER + '{"summary":"s","risk":"low"}' })
check('parse summary', parsed.summary === '摘要')
check('parse impact', parsed.impact?.risk === 'low')
check('parse without marker', client.parseOption({ label: 'B' }).impact === null)

const built = client.buildAnswers(
  [{ id: 'q1', multiSelect: false }, { id: 'q2', multiSelect: false }, { id: 'q3', multiSelect: false }, { id: 'q4', multiSelect: true }],
  [['A'], ['B'], [], ['C', 'D']],
  ['', '不要新增 md', '', ''],
)
check('plain answer', JSON.stringify(built[0]) === JSON.stringify({ id: 'q1', selected: ['A'] }))
check('note answer splits label', built[1].selected.length === 0 && built[1].custom === 'B' + host.NOTE_SEPARATOR + '不要新增 md')
check('skipped answer', JSON.stringify(built[2]) === JSON.stringify({ id: 'q3', selected: [] }))
check('multi answer', JSON.stringify(built[3]) === JSON.stringify({ id: 'q4', selected: ['C', 'D'] }))

check('single pick replaces', JSON.stringify(client.applyPick(['A'], 'B', false)) === JSON.stringify(['B']))
check('single pick clears itself', client.applyPick(['A'], 'A', false).length === 0)
check('multi pick appends', JSON.stringify(client.applyPick(['A'], 'B', true)) === JSON.stringify(['A', 'B']))
check('multi pick toggles off', JSON.stringify(client.applyPick(['A', 'B'], 'A', true)) === JSON.stringify(['B']))
check('multi pick keeps every extra', client.applyPick([], 'C', true).length === 1)

const otherRow = client.parseOption({ label: host.OTHER_LABEL, description: host.OTHER_MARKER })
check('parse marks the other row', otherRow.other === true && otherRow.summary === '')
check('parse keeps the other marker out of the summary',
  client.parseOption({ label: 'A', description: '摘要' }).other === false)

const freeQuestions = [{ id: 'q1', multiSelect: false, options: [{ label: 'A' }, { label: host.OTHER_LABEL, other: true }] }]
const freeBuilt = client.buildAnswers(freeQuestions, [[host.OTHER_LABEL]], [''], ['我自己的答案'])
check('other answer becomes free text',
  JSON.stringify(freeBuilt[0]) === JSON.stringify({ id: 'q1', selected: [], custom: '我自己的答案' }),
  JSON.stringify(freeBuilt[0]))

const freeWithNote = client.buildAnswers(freeQuestions, [[host.OTHER_LABEL]], ['再加一句'], ['我自己的答案'])
check('other answer keeps its note',
  freeWithNote[0].custom === '我自己的答案' + host.NOTE_SEPARATOR + '再加一句'
  && JSON.stringify(freeWithNote[0].selected) === '[]')

const multiFree = client.buildAnswers(
  [{ id: 'q1', multiSelect: true, options: [{ label: 'A' }, { label: host.OTHER_LABEL, other: true }] }],
  [['A', host.OTHER_LABEL]],
  [''],
  ['补充说明'],
)
check('multi answer keeps the extra picks beside free text',
  JSON.stringify(multiFree[0].selected) === '["A"]' && multiFree[0].custom === '补充说明',
  JSON.stringify(multiFree[0]))

check('missingOther flags an empty other row', client.missingOther(freeQuestions[0], [host.OTHER_LABEL], '') === true)
check('missingOther accepts typed text', client.missingOther(freeQuestions[0], [host.OTHER_LABEL], '写了') === false)
check('missingOther ignores the other row when unpicked', client.missingOther(freeQuestions[0], ['A'], '') === false)
check('missingOther ignores questions without the other row', client.missingOther({ id: 'q9' }, ['A'], '') === false)

const cost = client.costOf([{ options: [{ impact: { summary: 'abc' } }, { impact: null }, { impact: null, other: true }] }, { options: [] }])
check('cost counts options', cost.options === 2 && cost.filled === 1 && cost.tokens > 0)
check('formatTokens small', client.formatTokens(581) === '581')
check('formatTokens thousands', client.formatTokens(1200) === '1.2K')

// --- client: apply registers into the chain -----------------------------

const registrations = []
const injections = []
const clientCtx = {
  effect: (fn) => { fn(); return () => {} },
  locale: { register: () => () => {} },
  slots: {
    inject: (name, cb) => { injections.push(name); return cb() },
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  },
}
client.apply(clientCtx)
check('inject target', injections[0] === 'conversation.composer')
check('registers one entry', registrations.length === 1)
check('entry priority wins over shipped 0', registrations[0].options.priority < 0)
check('entry carries select', registrations[0].options.select === client.select)
check('entry renders AskPanel', registrations[0].component === client.AskPanel)

// --- report -------------------------------------------------------------

if (failures.length > 0) {
  console.error('@@RESULT@@' + JSON.stringify({ ok: false, failures }, null, 2))
  process.exitCode = 1
} else {
  console.log('@@RESULT@@' + JSON.stringify({
    ok: true,
    host: { tool: tool.name, cases: decodeCases.length + 8 },
    client: { entries: registrations.length, answers: built.length },
  }))
}
