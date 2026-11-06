/** Session projection for decisions recorded by this plugin's own tool. */
import { z } from 'zod'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'

const fields = z.record(z.string(), z.any())
const proposal = z.object({
  callId: z.string().min(1), turn: z.number().int().nonnegative(), action: z.string().min(1),
  title: z.string().min(1), brief: z.string().min(1), details: fields,
}).strict()
const decision = z.object({
  callId: z.string().min(1), action: z.string().min(1), phase: z.string().min(1), data: fields.optional(),
}).strict()
const viewSchema = z.object({ proposals: z.record(z.string(), proposal), decisions: z.record(z.string(), decision) })
const stateSchema = z.object({
  view: viewSchema,
  calls: z.record(z.string(), proposal.omit({ callId: true })),
})

export type CriticalDecisionState = {
  view: { proposals: Record<string, any>; decisions: Record<string, any> }
  calls: Record<string, any>
}

export const criticalDecisionsProjection = {
  key: 'criticalDecisions',
  stateVersion: 1,
  stateSchema,
  init: () => ({ view: { proposals: {}, decisions: {} }, calls: {} }),
  apply: (state: CriticalDecisionState, event: any) => {
    if (event.type === 'tool/call' && event.data.name === 'record_critical_decision') {
      let args: any
      try { args = JSON.parse(event.data.arguments) } catch { return state }
      const parsed = proposal.omit({ callId: true }).safeParse({
        turn: event.data.turn,
        action: 'record_critical_decision',
        title: args.title ?? args.decision,
        brief: args.brief ?? args.rationale,
        details: args.details ?? args,
        ...args,
      })
      if (!parsed.success) return state
      return { ...state, calls: { ...state.calls, [event.data.callId]: parsed.data } }
    }
    if (event.type === 'tool/result') {
      const callId = event.data.message.toolCallId
      const call = state.calls[callId]
      if (call === undefined) return state
      const calls = { ...state.calls }; delete calls[callId]
      if (event.data.message.isError === true) return { ...state, calls }
      const record = { callId, ...call }
      return { ...state, calls, view: { ...state.view, proposals: { ...state.view.proposals, [callId]: record } } }
    }
    const record = pluginRecordOf(event)
    if (record?.type !== 'plugin:dsh-decisions/decision') return state
    const parsed = decision.safeParse(record.data)
    if (!parsed.success) return state
    return { ...state, view: { ...state.view, decisions: { ...state.view.decisions, [parsed.data.callId]: parsed.data } } }
  },
  wire: { viewSchema, view: (state: CriticalDecisionState) => state.view },
}
