// Open the single-file entry PR to awesome-dsh-plugin/awesome-dsh-plugin.
// Usage: node publish/open-pr.mjs
// Needs a GitHub token in %TEMP%/dsh-gh-token.txt (classic token with `public_repo`).
// The list rejects repositories younger than 1 day, so run this the day after the repo was created.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'
const OWNER = 'mouse985'
const REPO = 'dsh-ask-panel'
const BRANCH = `add-${REPO}`
const FILE = `data/plugins/${OWNER}__${REPO}.yml`
const TITLE = `Add ${OWNER}/${REPO}`

const here = dirname(fileURLToPath(import.meta.url))
const entry = readFileSync(join(here, `${OWNER}__${REPO}.yml`), 'utf8')
const token = readFileSync(join(process.env.TEMP, 'dsh-gh-token.txt'), 'utf8').trim()

async function gh(path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': REPO,
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : undefined
  if (!response.ok) {
    const error = new Error(`${init.method ?? 'GET'} ${path} -> ${response.status} ${text.slice(0, 500)}`)
    error.status = response.status
    throw error
  }
  return body
}

try {
  await gh(`/repos/${OWNER}/${UPSTREAM.split('/')[1]}`)
} catch (error) {
  if (error.status !== 404) throw error
  await gh(`/repos/${UPSTREAM}/forks`, { method: 'POST', body: JSON.stringify({ default_branch_only: true }) })
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    try {
      await gh(`/repos/${OWNER}/${UPSTREAM.split('/')[1]}`)
      break
    } catch (retry) {
      if (retry.status !== 404) throw retry
    }
  }
}

const upstream = await gh(`/repos/${UPSTREAM}`)
const base = upstream.default_branch
const baseRef = await gh(`/repos/${OWNER}/${UPSTREAM.split('/')[1]}/git/ref/heads/${base}`)

await gh(`/repos/${OWNER}/${UPSTREAM.split('/')[1]}/git/refs`, {
  method: 'POST',
  body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: baseRef.object.sha }),
}).catch(async error => {
  if (error.status !== 422) throw error
  await gh(`/repos/${OWNER}/${UPSTREAM.split('/')[1]}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: baseRef.object.sha, force: true }),
  })
})

await gh(`/repos/${OWNER}/${UPSTREAM.split('/')[1]}/contents/${FILE}`, {
  method: 'PUT',
  body: JSON.stringify({ message: `Add ${OWNER}/${REPO}`, content: Buffer.from(entry, 'utf8').toString('base64'), branch: BRANCH }),
})

const pull = await gh(`/repos/${UPSTREAM}/pulls`, {
  method: 'POST',
  body: JSON.stringify({
    title: TITLE,
    head: `${OWNER}:${BRANCH}`,
    base,
    body: [
      `Adds \`${FILE}\` for [${OWNER}/${REPO}](https://github.com/${OWNER}/${REPO}).`,
      '',
      'Consequence-aware question panel: each option carries what choosing it changes (files, behaviour, risk, cost), hovering previews it, a note typed there rides along with the answer, and Cancel opens a hand-off card that either returns the decision to the agent or halts the turn through `concludeTurn()`.',
      '',
      `- bundle: \`cordis.patch.yml\` (host tool \`ask_user\` + web client slot \`conversation.composer\`)`,
      `- screenshots: \`screenshots.json\` (4)`,
    ].join('\n'),
  }),
})

console.log(JSON.stringify({ pull: pull.html_url, number: pull.number, branch: BRANCH }, null, 1))
