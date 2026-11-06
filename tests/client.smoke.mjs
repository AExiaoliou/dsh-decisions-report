/**
 * Runtime smoke test for the built `client.js` bundle.
 *
 * The bundle is a classic script, so this test supplies the two browser
 * globals it touches — `globalThis.__ModuleLoader__` and the loader's
 * `require('react')` seed word — then drives the registered module against
 * fake Cordis services. It covers the parts that a type check cannot: the
 * registration shape, the `actionCards` → `@` candidate projection, the
 * stable mention a pick inserts, the userText rule that re-reads it, and the
 * `conversation.view` / `user.text.node` renderers.
 *
 * Run: node tests/client.smoke.mjs
 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

// ---------------------------------------------------------------------------
// Browser globals: loader facade + React seed word
// ---------------------------------------------------------------------------

const registrations = []
globalThis.__ModuleLoader__ = {
  load(registration) {
    registrations.push(registration)
  },
}

/** Minimal `createElement`: keeps the tree inspectable, never touches a DOM. */
function createElement(type, props, ...children) {
  const merged = { ...(props ?? {}) }
  if (children.length === 1) merged.children = children[0]
  else if (children.length > 1) merged.children = children
  return { type, props: merged }
}
const react = { createElement }

await import(pathToFileURL(new URL('../client.js', import.meta.url).pathname).href)

assert.equal(registrations.length, 1, 'bundle registers exactly one module')
const registration = registrations[0]
assert.equal(registration.id, '@local/dsh-decisions-report', 'module id is the package name')

const loaded = registration.factory(specifier => {
  assert.equal(specifier, 'react', 'the bundle requires only the react seed word')
  return react
})
assert.ok(loaded !== null && typeof loaded === 'object', 'factory returns the module face')
assert.deepEqual(
  [...loaded.inject].sort(),
  ['locale', 'sessions', 'slots', 'uiConversation'],
  'module declares exactly the services it uses at activation',
)
assert.equal(typeof loaded.apply, 'function', 'module exports apply')

// ---------------------------------------------------------------------------
// Fake Cordis client context
// ---------------------------------------------------------------------------

const ACTION = 'record_critical_decision'

const projection = {
  proposals: {
    call_aaa: {
      callId: 'call_aaa',
      turn: 2,
      action: ACTION,
      title: '采用 TypeScript 迁移',
      brief: '把 client.js 的实现迁到 src/client.ts。',
      details: {
        decision: '采用 TypeScript 源码',
        rationale: '类型检查与重构更安全',
        impact: '只影响客户端',
        alternatives: ['继续维护手写 JS'],
      },
    },
    call_bbb: {
      callId: 'call_bbb',
      turn: 9,
      action: ACTION,
      title: 'Keep the client.js artifact runnable',
      brief: 'commit the compiled bundle',
      details: {},
    },
    call_other: {
      callId: 'call_other',
      turn: 4,
      action: 'some_other_action',
      title: 'Not a critical decision',
      brief: 'must never appear',
      details: {},
    },
  },
  decisions: {
    call_aaa: {
      callId: 'call_aaa',
      action: ACTION,
      phase: 'acknowledged',
      data: { decision: '采用 TypeScript 源码' },
    },
  },
}

const unavailable = { getSnapshot: () => undefined, subscribe: () => () => {} }
const bindings = new Map([
  ['open-session', {
    session: {
      projections: {
        faceOf: key => key === 'actionCards'
          ? { getSnapshot: () => projection, subscribe: () => () => {} }
          : unavailable,
      },
    },
  }],
])

const dictionaries = new Map()
function translate(namespace) {
  const table = dictionaries.get(namespace)?.zh ?? {}
  return (key, params = {}) => (table[key] ?? key).replace(/\{(\w+)\}/gu, (_, name) => String(params[name] ?? ''))
}

const slots = []
const rules = []
const sources = []
const disposers = []
const injectedDeps = []

/** The `ctx.get('inputTriggers')` face the `@` contribution registers into. */
const servicesTable = {
  inputTriggers: {
    registerSource(source) {
      sources.push(source)
      return () => {}
    },
  },
}

/** One effect boundary: run the registration and keep its disposer. */
function effect(register) {
  const dispose = register()
  if (typeof dispose === 'function') disposers.push(dispose)
}

const ctx = {
  slots: {
    inject(name, factory) {
      assert.equal(typeof factory, 'function', `slots.inject(${name}) takes a factory`)
      effect(factory)
    },
    register(options, component) {
      slots.push({ options, component })
      return () => {}
    },
  },
  locale: {
    register(namespace, tables) {
      dictionaries.set(namespace, tables)
      return () => {}
    },
    bind: namespace => translate(namespace),
  },
  uiConversation: {
    userText: {
      register(rule) {
        rules.push(rule)
        return () => {}
      },
    },
  },
  sessions: { binding: id => bindings.get(id) },
  get(service) {
    return servicesTable[service]
  },
  inject(services, callback) {
    injectedDeps.push([...services])
    // Stand-in for the scoped child context: the same service table with its
    // own effect boundary.
    callback({ get: name => services.includes(name) ? servicesTable[name] : undefined, effect })
  },
  effect,
}

loaded.apply(ctx)

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const viewSlot = slots.find(entry => entry.options.name === 'conversation.view')
assert.ok(viewSlot !== undefined, 'conversation.view is registered')
assert.equal(viewSlot.options.id, 'critical-decisions')
assert.equal(viewSlot.options.order, 20)
assert.equal(typeof viewSlot.options.label, 'function', 'tab label follows the active locale')
assert.equal(viewSlot.options.label(), '关键决策')

const mentionSlot = slots.find(entry => entry.options.name === 'conversation.user.text.node')
assert.ok(mentionSlot !== undefined, 'the user-text node occupant is registered')
assert.equal(mentionSlot.options.key, 'decision')
assert.equal(mentionSlot.options.priority, 100)

const tables = dictionaries.get('dsh-critical-decisions')
assert.ok(tables !== undefined, 'the plugin registers its locale dictionaries')
assert.deepEqual(
  Object.keys(tables.en).sort(),
  Object.keys(tables.zh).sort(),
  'en and zh carry the same keys',
)

assert.equal(rules.length, 1, 'one userText rule')
assert.equal(rules[0].id, 'decision')
assert.equal(sources.length, 1, 'one @ trigger source')
assert.deepEqual(injectedDeps, [['inputTriggers']], 'the @ source waits on its own service only')

// A composition without the trigger pipeline must still show the View.
const standaloneSlots = []
loaded.apply({
  slots: {
    inject: (_name, factory) => { factory() },
    register: (options, component) => { standaloneSlots.push({ options, component }); return () => {} },
  },
  locale: { register: () => () => {}, bind: () => key => key },
  uiConversation: { userText: { register: () => () => {} } },
  sessions: { binding: () => undefined },
  get: () => undefined,
  inject: () => {},
  effect: () => {},
})
assert.ok(
  standaloneSlots.some(entry => entry.options.name === 'conversation.view'),
  'the View registers even when inputTriggers never arrives',
)

// ---------------------------------------------------------------------------
// `@` source
// ---------------------------------------------------------------------------

const source = sources[0]
assert.equal(source.trigger, '@')
assert.equal(source.name, 'decision')
assert.equal(source.order, 10)
assert.equal(source.showGroupTitle, false, 'rows carry a localized section instead')
assert.equal(typeof source.codec?.serialize, 'function', 'a reference codec is declared')

const open = { sessionId: 'open-session' }
const request = query => ({ query, position: 'leading', drilled: false, signal: new AbortController().signal })

const all = await source.candidates(open, request(''))
assert.deepEqual(
  all.map(candidate => candidate.name),
  ['call_bbb', 'call_aaa'],
  'only this action kind is offered, newest first',
)
assert.deepEqual(
  all.map(candidate => candidate.label),
  ['Keep the client.js artifact runnable', '采用 TypeScript 迁移'],
)
assert.equal(all[0].section, '关键决策', 'rows carry the localized section title')
assert.ok(all[0].description !== undefined && all[0].description.length > 0, 'rows carry a description')

const filtered = await source.candidates(open, request('迁移'))
assert.deepEqual(filtered.map(candidate => candidate.name), ['call_aaa'], 'query filters on the title')

assert.deepEqual(
  await source.candidates(open, request('nothing-matches-this')),
  [],
  'a miss returns no rows',
)
assert.deepEqual(
  await source.candidates({ sessionId: 'not-retained' }, request('')),
  [],
  'a session without a retained binding yields no rows instead of throwing',
)

const pick = source.onPick({ candidate: all[1], action: 'pick' })
assert.ok(pick !== undefined && 'insert' in pick, 'a pick inserts a structured reference')
assert.equal(pick.insert.source, 'decision', 'the insert routes back to this source')
assert.equal(pick.insert.ref, '@[采用 TypeScript 迁移](dsh-decision:call_aaa)', 'stable mention ref')
assert.equal(pick.insert.clipboardText, pick.insert.ref, 'clipboard projection is the mention')
assert.equal(pick.insert.label, '采用 TypeScript 迁移', 'the draft chip shows the title')

const bracketed = source.onPick({
  candidate: { name: 'call_ccc', value: JSON.stringify({ callId: 'call_ccc', title: '[weird] (title)' }) },
  action: 'pick',
})
assert.equal(
  bracketed.insert.ref,
  '@[weird title](dsh-decision:call_ccc)',
  'grammar characters are flattened out of the mention title',
)

const titled = source.onPick({
  candidate: { name: 'call_ddd', value: JSON.stringify({ callId: 'call_ddd', title: '' }) },
  action: 'pick',
})
assert.equal(titled.insert.ref, '@[call_ddd](dsh-decision:call_ddd)', 'an untitled card falls back to the id')

assert.equal(source.onPick({ candidate: { name: 'x' }, action: 'pick' }), undefined, 'a candidate without a payload is ignored')

// ---------------------------------------------------------------------------
// userText rule (same start offset as the file-reference rule, lower order)
// ---------------------------------------------------------------------------

const rule = rules[0]
assert.ok(rule.order < 30, 'must win the leading @ against the file-reference rule (order 30)')

const text = '请看 @[采用 TypeScript 迁移](dsh-decision:call_aaa) 这条。'
const node = rule.match(text, 0)
assert.ok(node !== undefined, 'the mention is found inside message text')
assert.equal(node.id, 'decision')
assert.equal(text.slice(node.start, node.end), '@[采用 TypeScript 迁移](dsh-decision:call_aaa)')
assert.deepEqual(node.data, { callId: 'call_aaa', title: '采用 TypeScript 迁移' })

assert.equal(rule.match('@[a](dsh-decision:b)', 0).data.callId, 'b', 'minimal mention')
assert.equal(rule.match('no mention here', 0), undefined, 'plain text stays plain')
assert.equal(rule.match('@[broken](dsh-decision:)', 0), undefined, 'an empty target is not a mention')
assert.equal(rule.match('@[x](other:call_1)', 0), undefined, 'another scheme is not a decision mention')
assert.equal(
  rule.match(`${text} ${text}`, node.end).start,
  text.length + 1 + text.indexOf('@['),
  'a later query skips the first occurrence',
)

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/** Resolve function components into plain `{type, props}` nodes, then flatten all text. */
function resolve(node) {
  if (Array.isArray(node)) return node.flatMap(resolve)
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (typeof node.type === 'function') return resolve(node.type(node.props))
  return { type: node.type, props: { ...node.props, children: resolve(node.props.children) } }
}

function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object') return ''
  return textOf(node.props.children)
}

const view = resolve(viewSlot.component({
  sessionId: 'open-session',
  useProjection: key => (key === 'actionCards' ? projection : undefined),
  t: translate('dsh-critical-decisions'),
}))
const viewText = textOf(view)
assert.match(viewText, /关键决策/u)
assert.match(viewText, /本会话已记录 2 条/u, 'the count covers this action kind only')
assert.match(viewText, /采用 TypeScript 迁移/u)
assert.match(viewText, /Keep the client\.js artifact runnable/u)
assert.match(viewText, /已确认/u, 'the recorded decision phase is shown')
assert.match(viewText, /继续维护手写 JS/u, 'alternatives are listed')
assert.doesNotMatch(viewText, /Not a critical decision/u, 'other action kinds are ignored')

const emptyView = resolve(viewSlot.component({
  sessionId: 'empty',
  useProjection: () => ({ proposals: {}, decisions: {} }),
  t: translate('dsh-critical-decisions'),
}))
assert.match(textOf(emptyView), /尚未记录关键决策/u, 'a ready empty projection explains itself')

const pendingView = resolve(viewSlot.component({
  sessionId: 'pending',
  useProjection: () => undefined,
  t: translate('dsh-critical-decisions'),
}))
assert.doesNotMatch(textOf(pendingView), /尚未记录关键决策/u, 'no empty claim before the projection arrives')

const chip = resolve(mentionSlot.component({
  node: { id: 'decision', start: 0, end: 1, data: node.data },
  raw: '@[采用 TypeScript 迁移](dsh-decision:call_aaa)',
  interactive: true,
  t: translate('dsh-critical-decisions'),
}))
assert.equal(chip.props['data-dsh-decision-mention'], 'call_aaa', 'the chip keeps the stable id')
assert.equal(chip.props.title, '@[采用 TypeScript 迁移](dsh-decision:call_aaa)', 'the raw mention stays reachable')
assert.equal(textOf(chip), '决策：采用 TypeScript 迁移')

assert.ok(disposers.length >= 3, 'registrations are effect-owned (disposable)')
for (const dispose of disposers) dispose()

console.log('client.js smoke test: OK')
