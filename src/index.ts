import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'

const ACTION = 'record_critical_decision'

type Details = {
  decision: string
  rationale: string
  impact: string
  alternatives: string[]
  followUp?: string
}

type ParseFailure = { success: false; error: { issues: readonly [{ path: readonly string[]; message: string }] } }
type ParseSuccess = { success: true; data: Details }
type DetailsSchema = { safeParse(value: unknown): ParseFailure | ParseSuccess }

function invalid(message: string, path: readonly string[] = []): ParseFailure {
  return { success: false, error: { issues: [{ path, message }] } }
}

function parseDetails(value: unknown): ParseFailure | ParseSuccess {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid('details must be an object')
  const input = value as Record<string, unknown>
  const text = (name: string, max: number, required = true): { value?: string; error?: string } => {
    if (typeof input[name] !== 'string') return required ? { error: `${name} is required` } : { value: undefined }
    const textValue = input[name].trim()
    if (required && textValue.length === 0) return { error: `${name} must not be blank` }
    if (textValue.length > max) return { error: `${name} exceeds ${max} characters` }
    return { value: textValue }
  }
  const decision = text('decision', 1200)
  const rationale = text('rationale', 2400)
  const impact = text('impact', 1200)
  const followUp = text('followUp', 1200, false)
  const firstError = decision.error ?? rationale.error ?? impact.error ?? followUp.error
  if (firstError !== undefined) return invalid(firstError)
  const alternatives = input.alternatives === undefined ? [] : input.alternatives
  if (!Array.isArray(alternatives) || alternatives.length > 5 || alternatives.some(item => typeof item !== 'string' || item.trim() === '' || item.trim().length > 600)) {
    return invalid('alternatives must contain at most five non-empty strings of 600 characters or fewer')
  }
  return {
    success: true,
    data: {
      decision: decision.value as string,
      rationale: rationale.value as string,
      impact: impact.value as string,
      alternatives: alternatives.map(item => (item as string).trim()),
      ...(followUp.value === undefined ? {} : { followUp: followUp.value }),
    },
  }
}

const details: DetailsSchema = { safeParse: parseDetails }

function settled(decision: Record<string, unknown>) {
  return { status: 'settled' as const, decision }
}

function registerSkill(ctx: Context): void {
  ctx.skills.registerProvider(() => ({
    name: 'dsh-critical-decisions',
    list: () => Promise.resolve([{
      name: 'critical-decisions',
      description: 'Use when you make a consequential choice that changes direction, scope, risk, architecture, or user-visible behavior. Load before recording the decision.',
      invocation: { modelInvocable: true, userInvocable: false },
      provider: 'dsh-critical-decisions', source: 'bundled' as const, rank: BUNDLED_SKILL_RANK, locator: null,
    }]),
    async get(candidate: Record<string, unknown>, { signal }: { signal?: AbortSignal }) {
      const content = await readFile(new URL('./skills/critical-decisions.md', import.meta.url), { encoding: 'utf8', signal })
      return { ...candidate, content }
    },
  }))
}

export const inject = ['actionCards', 'skills', 'systemPrompt'] as const

export function apply(ctx: Context): void {
  registerSkill(ctx)
  ctx.actionCards.register({
    action: ACTION,
    skill: 'critical-decisions',
    invitation: 'A critical decision has been recorded in the session view. Invite the user to review it when useful, without repeating the full record.',
    details,
    verbs: { acknowledge: {} },
    openPhases: ['recorded'],
    statusGuidance: 'Critical decisions are durable session records. Treat them as prior decisions, cite their rationale when relevant, and do not silently reverse them.',
    statusFields: ['decision', 'rationale', 'impact', 'alternatives', 'followUp'],
    act: async (agent, proposal) => {
      const decision = { callId: proposal.callId, action: ACTION, phase: 'acknowledged', data: proposal.details }
      ctx.actionCards.record(agent, decision)
      return settled(decision)
    },
  })
  ctx.systemPrompt.section({
    name: 'dsh-critical-decisions/instructions',
    order: 720,
    text: 'When you make a consequential choice that changes direction, scope, risk, architecture, or user-visible behavior, load the critical-decisions skill and call propose_action with action "record_critical_decision". Include the decision, concise rationale, impact, alternatives considered, and follow-up. In user messages, a token like @[decision](dsh-decision:<callId>) refers to a recorded decision; use the Decisions view data when available. Do not record routine steps or transient observations. After the card is shown, do not repeat its full contents; refer to the session view when relevant.',
  })
}
