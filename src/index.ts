import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { criticalDecisionsProjection } from './projection.js'

const ACTION = 'record_critical_decision'
const RECORD = 'plugin:dsh-decisions/decision'

type Details = { decision: string; rationale: string; impact: string; alternatives: string[]; followUp?: string }
type ParseFailure = { success: false; error: { issues: readonly [{ path: readonly string[]; message: string }] } }
type ParseSuccess = { success: true; data: Details }
type DetailsSchema = { safeParse(value: unknown): ParseFailure | ParseSuccess }

function invalid(message: string): ParseFailure { return { success: false, error: { issues: [{ path: [], message }] } } }
function parseDetails(value: unknown): ParseFailure | ParseSuccess {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid('details must be an object')
  const input = value as Record<string, unknown>
  const text = (name: string, max: number, required = true) => {
    if (typeof input[name] !== 'string') return required ? { error: `${name} is required` } : { value: undefined }
    const v = input[name].trim(); if (required && !v) return { error: `${name} must not be blank` }; if (v.length > max) return { error: `${name} exceeds ${max} characters` }; return { value: v }
  }
  const decision = text('decision', 1200); const rationale = text('rationale', 2400); const impact = text('impact', 1200); const followUp = text('followUp', 1200, false)
  const first = decision.error ?? rationale.error ?? impact.error ?? followUp.error; if (first) return invalid(first)
  const alternatives = input.alternatives === undefined ? [] : input.alternatives
  if (!Array.isArray(alternatives) || alternatives.length > 5 || alternatives.some(v => typeof v !== 'string' || !v.trim() || v.trim().length > 600)) return invalid('alternatives must contain at most five non-empty strings of 600 characters or fewer')
  return { success: true, data: { decision: decision.value as string, rationale: rationale.value as string, impact: impact.value as string, alternatives: alternatives.map(v => (v as string).trim()), ...(followUp.value === undefined ? {} : { followUp: followUp.value }) } }
}
const details: DetailsSchema = { safeParse: parseDetails }

function registerSkill(ctx: Context): void {
  ctx.skills.registerProvider(() => ({
    name: 'dsh-critical-decisions',
    list: () => Promise.resolve([{ name: 'critical-decisions', description: 'Use when you make a consequential choice that changes direction, scope, risk, architecture, or user-visible behavior. Load before recording the decision.', invocation: { modelInvocable: true, userInvocable: false }, provider: 'dsh-critical-decisions', source: 'bundled' as const, rank: BUNDLED_SKILL_RANK, locator: null }]),
    async get(candidate: Record<string, unknown>, { signal }: { signal?: AbortSignal }) { return { ...candidate, content: await readFile(new URL('../skills/critical-decisions.md', import.meta.url), { encoding: 'utf8', signal }) } },
  }))
}

export const inject = ['tools', 'sessionProjections', 'skills', 'systemPrompt'] as const

export function apply(ctx: Context): void {
  registerSkill(ctx)
  ctx.sessionProjections.register(criticalDecisionsProjection)
  ctx.tools.register(defineTool({
    name: ACTION,
    description: 'Record a consequential decision in the current session with its rationale, impact, alternatives, and follow-up.',
    parameters: { decision: { type: 'string', required: true }, rationale: { type: 'string', required: true }, impact: { type: 'string', required: true }, alternatives: { type: 'array', items: { type: 'string' } }, followUp: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { recorded: { type: 'boolean', required: true } } }, render: () => [{ type: 'text', text: 'Decision recorded in the session.' }] },
    execute: async (args: unknown, exec: any) => {
      const parsed = details.safeParse(args)
      if (!parsed.success) throw new Error((parsed as ParseFailure).error.issues[0].message)
      if (exec.agent === undefined) throw new Error('This tool requires an active agent session.')
      appendPluginRecord(exec.agent.session, RECORD as any, { callId: exec.callId, action: ACTION, phase: 'acknowledged', data: parsed.data })
      return { recorded: true }
    },
  }))
  ctx.systemPrompt.section({ name: 'dsh-critical-decisions/instructions', order: 720, text: 'When you make a consequential choice that changes direction, scope, risk, architecture, or user-visible behavior, load the critical-decisions skill and call the record_critical_decision tool. Include the decision, concise rationale, impact, alternatives considered, and follow-up. In user messages, a token like @[decision](dsh-decision:<callId>) refers to a recorded decision; use the Decisions view data when available. Do not record routine steps or transient observations.' })
}
