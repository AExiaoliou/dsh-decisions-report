# Critical decisions

Use this skill when a choice has lasting consequences for direction, scope, architecture, risk, data handling, or user-visible behavior. Before the final answer, call `propose_action` with action `record_critical_decision`.

Provide:
- `decision`: the chosen outcome;
- `rationale`: the evidence or reasoning that led to it;
- `impact`: what changes because of it;
- `alternatives`: meaningful options considered, when any;
- `followUp`: the next verification or action, when one exists.

Do not record routine implementation steps, temporary observations, or ordinary tool results. The card appears in the session view; do not duplicate its full contents in the answer.
