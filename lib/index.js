/**
 * Node half of `dsh-ask-panel`: the `ask_user` tool.
 *
 * The tool is a thin, opinionated client of the existing `userQuestions`
 * service — it never registers a provider, so the Web UI keeps owning the
 * wire. What it adds on top of the shipped `ask_user_question`:
 *
 * - a `impact` object per option, encoded into the option's `description` so
 *   the Client half can render the hover preview (plain text fallback: the
 *   shipped card shows the summary and the encoded tail);
 * - one synthetic option, {@link PROCEED_LABEL}, that represents "decide this
 *   yourself" — the supported way to hand the decision back mid-flight;
 * - cancellation meaning HALT: the tool concludes the turn, so the agent loop
 *   stops issuing model requests instead of continuing on its own;
 * - a payload budget and a per-session call budget, both enforced as errors
 *   the model can act on rather than as silent truncation.
 *
 * @module dsh-ask-panel
 */

/** Synthetic option appended to every question: the "you decide" door. */
export const PROCEED_LABEL = '〔按你的判断继续〕'

/**
 * Label of the free-text option appended to every question. The card renders it
 * as a text field, so the answer arrives as `custom` text instead of a label.
 */
export const OTHER_LABEL = '〔其他〕'

/**
 * Marker carried in the free-text option's description, so the card can tell
 * that option apart from a model-provided one without matching the label.
 */
export const OTHER_MARKER = '[[other]]'

/** Separator between an option's summary and its encoded impact payload. */
export const IMPACT_MARKER = '\n[[impact]]'

/** Separator inside `custom` between the chosen option label and the user's note. */
export const NOTE_SEPARATOR = '\n[[note]]'

/** Largest question batch this tool accepts (each question costs the model output tokens). */
const MAX_QUESTIONS = 3

/** Largest encoded request payload, in bytes; beyond this the model must trim. */
const MAX_PAYLOAD_BYTES = 2048

/** Largest number of `ask_user` calls allowed in one session. */
const MAX_ASKS_PER_SESSION = 3

/** Largest number of options accepted per question. */
const MAX_OPTIONS = 6

/** Per-session call counter, keyed by session id. */
const asksBySession = new Map()

/**
 * Encode an option into the wire shape the question service accepts.
 * @param option - model-provided option with optional consequence data.
 * @returns Wire option: `label` plus a `description` carrying summary and payload.
 */
export function encodeOption(option) {
  const summary = typeof option?.description === 'string' ? option.description.trim() : ''
  const impact = option?.impact
  const tail = impact === undefined || impact === null
    ? ''
    : IMPACT_MARKER + JSON.stringify(compactImpact(impact))
  const description = summary + tail
  return {
    label: option.label,
    ...(description === '' ? {} : { description }),
  }
}

/**
 * Drop empty impact fields so a sparse preview costs nothing on the wire.
 * @param impact - model-provided impact object.
 * @returns The same object without undefined/empty members.
 */
function compactImpact(impact) {
  const out = {}
  for (const key of ['summary', 'changes', 'files', 'effects', 'risk', 'cost', 'reversible']) {
    const value = impact[key]
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      const items = value.filter(item => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
      if (items.length > 0) out[key] = items
      continue
    }
    if (typeof value === 'string' && value.trim() === '') continue
    out[key] = value
  }
  return out
}

/**
 * Encode one question for the question service, appending the synthetic door.
 * @param question - model-provided question.
 * @returns Wire question object.
 */
function encodeQuestion(question) {
  const options = (Array.isArray(question.options) ? question.options : []).map(encodeOption)
  return {
    id: String(question.id),
    question: String(question.question),
    ...(question.header === undefined ? {} : { header: String(question.header) }),
    ...(question.detail === undefined ? {} : { detail: String(question.detail) }),
    ...(question.multi_select === true ? { multiSelect: true } : {}),
    options: [...options, { label: OTHER_LABEL, description: OTHER_MARKER }, { label: PROCEED_LABEL }],
  }
}

/**
 * Decode one wire answer into the compact result the model reads.
 * @param answer - one entry of `AskUserQuestionAnswer['answers']`.
 * @param question - the question it answers, for label validation.
 * @returns Compact answer: chosen label, optional note, or free-form text.
 */
export function decodeAnswer(answer, question) {
  const picked = (Array.isArray(answer.selected) ? answer.selected : [])
    .filter(label => label !== OTHER_LABEL)
  const custom = typeof answer.custom === 'string' ? answer.custom : ''
  if (picked.includes(PROCEED_LABEL)) return { kind: 'proceed' }
  const split = custom.indexOf(NOTE_SEPARATOR)
  const head = (split >= 0 ? custom.slice(0, split) : custom).trim()
  const note = split >= 0 ? custom.slice(split + NOTE_SEPARATOR.length).trim() : ''
  const labels = optionLabels(question)
  const out = { questionId: question.id }
  if (head !== '' && (labels.length === 0 ? picked.includes(head) : labels.includes(head))) {
    out.label = head
  } else if (head !== '') {
    out.custom = head
    if (picked.length > 0) out.labels = picked
  } else if (picked.length === 1) {
    out.label = picked[0]
  } else if (picked.length > 1) {
    out.labels = picked
  } else {
    out.label = ''
  }
  if (note !== '') out.note = note
  return out
}

/**
 * Labels of the model-provided options of one question.
 * @param question - model-provided question, or a bare `{ id }` stub.
 * @returns Its option labels, or an empty array when it carries none.
 */
function optionLabels(question) {
  const options = Array.isArray(question?.options) ? question.options : []
  return options.map(option => option?.label).filter(label => typeof label === 'string')
}

/**
 * Validate the request before it reaches the service.
 * @param questions - model-provided questions.
 * @returns A message describing the first violation, or undefined when valid.
 */
function validationError(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return 'questions must be a non-empty array'
  if (questions.length > MAX_QUESTIONS) {
    return `at most ${String(MAX_QUESTIONS)} questions per call; merge or drop the extras`
  }
  for (const question of questions) {
    if (typeof question?.id !== 'string' || typeof question.question !== 'string') {
      return 'every question needs a string id and a string question'
    }
    const options = question.options
    if (options !== undefined && (!Array.isArray(options) || options.length === 0)) {
      return `question "${question.id}" has an empty options array; omit options for a free-form question`
    }
    if (Array.isArray(options) && options.length > MAX_OPTIONS) {
      return `question "${question.id}" has ${String(options.length)} options (max ${String(MAX_OPTIONS)})`
    }
    for (const option of options ?? []) {
      if (typeof option?.label !== 'string' || option.label.trim() === '') {
        return `question "${question.id}" has an option without a label`
      }
      if (option.label === PROCEED_LABEL) {
        return `the label ${PROCEED_LABEL} is added automatically; do not include it`
      }
      if (option.label === OTHER_LABEL) {
        return `the label ${OTHER_LABEL} is added automatically; do not include it`
      }
    }
  }
  return undefined
}

/**
 * Render the model-facing content for one ask result.
 * @param _args - the tool arguments (unused by this projection).
 * @param value - the tool's value (compact answer or deferral).
 * @returns One text block with the JSON value.
 */
function renderResult(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** @returns The output contract shared by every success path. */
function outputContract() {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'askId'],
      properties: {
        kind: { type: 'string' },
        askId: { type: 'string' },
        answers: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              questionId: { type: 'string' },
              label: { type: 'string' },
              note: { type: 'string' },
              custom: { type: 'string' },
            },
          },
        },
        choice: { type: 'string' },
        note: { type: 'string' },
        unanswered: { type: 'array', items: { type: 'string' } },
      },
    },
    render: renderResult,
  }
}

/** Plugin identity. */
export const name = 'ask-panel'

/** Services this plugin's tool needs. */
export const inject = ['tools', 'userQuestions']

/**
 * Register the `ask_user` tool.
 * @param ctx - host context.
 */
export function apply(ctx) {
  let counter = 0

  ctx.tools.register({
    name: 'ask_user',
    description:
      'Ask the user to settle a fork you cannot settle from context. '
      + 'Use it when two or more implementations are defensible and the choice changes what gets built — '
      + 'not for confirmation, not for anything you can infer from the todo list, the files, or the last answer. '
      + 'Each option may carry an `impact` object (summary / changes / files / effects / risk / cost / reversible) '
      + 'that the UI shows as a hover preview, so the user can see the consequence before choosing. '
      + 'Write only the impact fields you are sure about; a one-line summary is enough. '
      + `The UI adds a "${OTHER_LABEL}" free-text option and a "${PROCEED_LABEL}" option `
      + 'that hands the decision back to you. '
      + 'Closing or cancelling the card also hands it back, with the turn ending: '
      + 'you will not be asked again and no further model request is issued until the user speaks. '
      + `At most ${String(MAX_QUESTIONS)} questions per call and ${String(MAX_ASKS_PER_SESSION)} calls per task.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['id', 'question'],
            properties: {
              id: { type: 'string' },
              question: { type: 'string' },
              header: { type: 'string' },
              detail: { type: 'string' },
              multi_select: { type: 'boolean' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: true,
                  required: ['label'],
                  properties: {
                    label: { type: 'string' },
                    description: { type: 'string' },
                    impact: {
                      type: 'object',
                      additionalProperties: true,
                      properties: {
                        summary: { type: 'string' },
                        changes: { type: 'array', items: { type: 'string' } },
                        files: { type: 'array', items: { type: 'string' } },
                        effects: { type: 'array', items: { type: 'string' } },
                        risk: { type: 'string' },
                        cost: { type: 'string' },
                        reversible: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    output: outputContract(),
    /**
     * Ask the user, then translate the wire answer into a compact result.
     * @param args - validated tool arguments.
     * @param exec - this execution's run context.
     * @returns Compact answer batch, or a deferral when the user cancelled.
     */
    async execute(args, exec) {
      const questions = args.questions
      const invalid = validationError(questions)
      if (invalid !== undefined) throw new Error(invalid)

      const sessionId = exec.agent?.session?.id
      const askId = `ask-${String(++counter)}`
      const calls = (asksBySession.get(sessionId) ?? 0) + 1
      if (calls > MAX_ASKS_PER_SESSION) {
        return {
          kind: 'refused',
          askId,
          note: `${String(MAX_ASKS_PER_SESSION)} asks already used in this task: decide it yourself, state the assumption, and mark it 待确认.`,
        }
      }

      const wire = questions.map(encodeQuestion)
      const bytes = Buffer.byteLength(JSON.stringify(wire), 'utf8')
      if (bytes > MAX_PAYLOAD_BYTES) {
        return {
          kind: 'refused',
          askId,
          note: `request is ${String(bytes)} bytes (max ${String(MAX_PAYLOAD_BYTES)}): write only the impact fields you are sure about, or drop an option.`,
        }
      }
      asksBySession.set(sessionId, calls)

      let result
      try {
        result = await ctx.userQuestions.ask({
          questions: wire,
          ...(exec.agent === undefined ? {} : { agent: exec.agent }),
          ...(exec.signal === undefined ? {} : { signal: exec.signal }),
        })
      } catch (error) {
        if (error?.code === 'ASK_CANCELLED') {
          // Cancellation is the user taking the decision back, not a failure:
          // the turn ends here so no further model request is issued.
          exec.concludeTurn()
          return { kind: 'deferred', askId, choice: 'halt' }
        }
        throw error
      }

      const decoded = result.answers.map((answer, index) => decodeAnswer(answer, questions[index]))
      if (decoded.some(item => item.kind === 'proceed')) {
        return { kind: 'deferred', askId, choice: 'proceed' }
      }
      const unanswered = decoded
        .filter(item => item.label === '' && item.custom === undefined)
        .map(item => item.questionId)
      return {
        kind: 'answered',
        askId,
        answers: decoded,
        ...(unanswered.length === 0 ? {} : { unanswered }),
      }
    },
  })
}
