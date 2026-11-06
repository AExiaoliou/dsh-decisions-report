"use strict";
/**
 * Critical-decisions browser half, authored in TypeScript and compiled to the
 * sibling `client.js` bundle by this repository's client build
 * (`tsc -p tsconfig.client.json`).
 *
 * Three contributions, all session-scoped:
 *
 * 1. `conversation.view` — the "Critical decisions" tab, a read-only projection
 *    of the `actionCards` key (proposals of `record_critical_decision` plus
 *    their recorded decisions). Each card carries a "引用" button that inserts
 *    the stable decision reference as a structured composer chip through the
 *    public session-scope input face: `sessions.scope(sessionId)` borrows the
 *    retained Agent scope, `conversation.input.for(scope)` resolves that
 *    Session's input shell, and `SessionInput.insertReference(ref, span)`
 *    replaces the caret span. The span snapshot comes from the standard
 *    `inputActions` prop; without it (host-less render) the button is inert.
 * 2. An `@` InputTrigger source — candidates are the decision cards of the
 *    *current* Session, read synchronously from its `actionCards` projection
 *    (no RPC: the projection already reaches the client). A pick answers the
 *    structured `{ insert: ReferenceInsert }` outcome (`source: 'decision'`,
 *    `ref`/`clipboardText` = `@[<title>](dsh-decision:<callId>)`,
 *    `label` = the title), so the pipeline replaces the `@` token with the
 *    same chip. The source codec serializes each occurrence back to that
 *    mention, so the prompt keeps the stable literal.
 * 3. A userText rule + inline node — the sent mention is re-parsed from the
 *    user's message text and rendered as a chip, so the durable message keeps
 *    the stable id and stays readable.
 *
 * Build shape: the file is a classic script (no ESM syntax at top level) whose
 * only top-level statement is the `__ModuleLoader__.load({...})` registration.
 * Everything with runtime identity lives inside `factory`, so the bundle adds
 * no global bindings — the same shape the official client bundles use
 * (`packages/client/... /lib/client.js`). Types above the registration are
 * compile-time only and vanish from the emitted file.
 *
 * Contract subset below was verified against the DeepSeek Harness checkout
 * `fcc0ad4621` (root package `@deepseek-ai/dsh-root@0.2.2-rc.1`):
 * - `packages/client/ui-input-trigger/src/types.ts` (`InputTriggerSource`,
 *   `InputTriggerCandidate`, `CandidateRequest`, `InputTriggerPick`,
 *   `ReferenceCodec`, `ClientSessionContext`)
 * - `packages/client/ui-conversation/src/client/contract/input.ts`
 *   (`PickOutcome`, `InputActions`, `SessionInput`, `SessionInputResolver`,
 *   `InsertReferenceRequest`), `contract/draft-editor.ts`
 *   (`ReferenceInsert`, `TokenSpan`), `contract/user-text.ts`
 *   (`UserTextRule`, `UserTextNode`), `contract/slots.ts`
 *   (`SessionStandardProps.inputActions`, `ConvViewProps`)
 * - `packages/client/ui-conversation/src/client/input/controller.ts`
 *   (`PickOutcome.insert` → scoped `slash/input-insert-reference`),
 *   `input/facade.ts` (`Shell.insertReference`) and `input/hub.ts`
 *   (`InputHub.for` = `SessionInputResolver.for`)
 * - `packages/client/ui-conversation/src/client/apply.ts` (`uiSession.provide`
 *   publishes `props: ['inputActions']` to every session-scope slot entry)
 * - `packages/experimental/action-cards/src/types.ts` (`ActionCardView`,
 *   `SessionProjectionMap.actionCards`)
 * - `packages/api/session-controller/src/client/contract/sessions.ts`
 *   (`ISessions.binding`, `ISessions.scope`) and
 *   `sessions/service.ts` (`SessionBinding.ctx`)
 * - `packages/client/ui-session/src/client/index.ts`
 *   (`SessionStandardProps`: `sessionId`, `useProjection`)
 * - `packages/client/ui-reference/src/client/index.ts` (official `@` source:
 *   `onPick` answers `{ insert: ReferenceInsert }`) and
 *   `packages/experimental/client-ui-forge/src/client/mount.ts`
 *   (`sessions.scope(id)?.get('conversation')?.input.for(scope)` idiom for a
 *   non-slot caller that holds only a Session id);
 *   `packages/client/ui-skill/src/client/index.ts` (registration idiom for an
 *   `@` source, a reference codec, a userText rule and its node slot).
 *
 * React is typed by the local structural shim below: this plugin ships without
 * `node_modules`, so `@types/react` is not on the compile path. The runtime
 * namespace still comes from the loader's `require('react')` seed word.
 */
// ---------------------------------------------------------------------------
// Loader registration
// ---------------------------------------------------------------------------
globalThis.__ModuleLoader__.load({
    id: '@local/dsh-decisions-report',
    factory(require) {
        const React = require('react');
        const h = React.createElement;
        /** The Host action kind this plugin projects. */
        const ACTION = 'record_critical_decision';
        /** Locale namespace for this plugin's client copy. */
        const NS = 'dsh-critical-decisions';
        /** `@` menu group and reference-source identity (also `ReferenceInsert.source`). */
        const SOURCE_NAME = 'decision';
        /** Keyed `conversation.user.text.node` occupant that renders one mention. */
        const MENTION_NODE_KEY = 'decision';
        /** Stable reference scheme inside the mention target. */
        const REF_SCHEME = 'dsh-decision:';
        /** Longest title carried inside a mention (menu label and chip copy). */
        const MENTION_TITLE_MAX = 160;
        /** Longest menu description taken from the decision body. */
        const SUMMARY_MAX = 120;
        /**
         * Tool call ids are opaque. The Host stores OpenAI Responses ids verbatim
         * (`call_…|fc_…`), so the target admits every character the mention
         * grammar can carry: only the closing delimiter and line breaks are
         * reserved. A narrower allow-list silently dropped every real pick.
         */
        const CALL_ID_MAX = 400;
        const CALL_ID_SOURCE = `[^)\\r\\n]{1,${CALL_ID_MAX}}`;
        const CALL_ID_PATTERN = new RegExp(`^${CALL_ID_SOURCE}$`, 'u');
        const MENTION_SOURCE = `@\\[([^\\]\\n]{1,${MENTION_TITLE_MAX}})\\]\\(${REF_SCHEME}(${CALL_ID_SOURCE})\\)`;
        const en = {
            'view.label': 'Decisions',
            'view.title': 'Critical decisions',
            'view.count': '{count} recorded in this session',
            'view.emptyTitle': 'No critical decisions recorded yet',
            'view.emptyBody': 'When the agent makes a consequential choice, it appears here with its rationale, impact, and alternatives.',
            'phase.recorded': 'Recorded',
            'phase.acknowledged': 'Acknowledged',
            'phase.dismissed': 'Dismissed',
            'phase.replaced': 'Replaced',
            'field.decision': 'Decision',
            'field.rationale': 'Rationale',
            'field.impact': 'Impact',
            'field.alternatives': 'Alternatives considered',
            'field.followUp': 'Follow-up',
            'card.turn': 'Turn {turn}',
            'card.untitled': 'Untitled decision',
            'reference.section': 'Critical decisions',
            'reference.chip': 'Decision: {title}',
            'reference.button': 'Reference',
        };
        const zh = {
            'view.label': '关键决策',
            'view.title': '关键决策',
            'view.count': '本会话已记录 {count} 条',
            'view.emptyTitle': '尚未记录关键决策',
            'view.emptyBody': '当 Agent 做出影响方向、范围或风险的重要选择时，该决策及其理由、影响与备选方案会显示在这里。',
            'phase.recorded': '已记录',
            'phase.acknowledged': '已确认',
            'phase.dismissed': '已关闭',
            'phase.replaced': '已取代',
            'field.decision': '决策',
            'field.rationale': '理由',
            'field.impact': '影响',
            'field.alternatives': '考虑过的备选方案',
            'field.followUp': '后续',
            'card.turn': '第 {turn} 轮',
            'card.untitled': '未命名决策',
            'reference.section': '关键决策',
            'reference.chip': '决策：{title}',
            'reference.button': '引用',
        };
        // -----------------------------------------------------------------
        // Projection readers (the `actionCards` value is the only source)
        // -----------------------------------------------------------------
        function isRecord(value) {
            return typeof value === 'object' && value !== null && !Array.isArray(value);
        }
        function stringOf(value) {
            return typeof value === 'string' && value.trim() !== '' ? value : undefined;
        }
        function stringListOf(value) {
            return Array.isArray(value)
                ? value.filter((item) => typeof item === 'string' && item.trim() !== '')
                : [];
        }
        /** Cards of this action, in durable turn order. */
        function cardRecordsOf(view) {
            if (view === undefined || !isRecord(view.proposals))
                return [];
            const proposals = view.proposals;
            const records = [];
            for (const key of Object.keys(proposals)) {
                const proposal = proposals[key];
                if (proposal === undefined)
                    continue;
                if (proposal.action === ACTION && typeof proposal.callId === 'string')
                    records.push(proposal);
            }
            records.sort((left, right) => {
                const byTurn = (typeof left.turn === 'number' ? left.turn : 0) - (typeof right.turn === 'number' ? right.turn : 0);
                if (byTurn !== 0)
                    return byTurn;
                return left.callId < right.callId ? -1 : left.callId > right.callId ? 1 : 0;
            });
            return records;
        }
        /** Current decision state of one card, when the projection carries it. */
        function decisionOf(view, callId) {
            if (view === undefined || !isRecord(view.decisions))
                return undefined;
            if (!Object.prototype.hasOwnProperty.call(view.decisions, callId))
                return undefined;
            return view.decisions[callId];
        }
        /** Kind fields come from the decision record when present, else from the proposal. */
        function fieldsOf(proposal, decision) {
            const details = isRecord(proposal.details) ? proposal.details : {};
            const data = decision !== undefined && isRecord(decision.data) ? decision.data : {};
            const read = (name) => data[name] !== undefined ? data[name] : details[name];
            return {
                decision: stringOf(read('decision')),
                rationale: stringOf(read('rationale')),
                impact: stringOf(read('impact')),
                alternatives: stringListOf(read('alternatives')),
                followUp: stringOf(read('followUp')),
            };
        }
        function phaseOf(decision) {
            return decision !== undefined && typeof decision.phase === 'string' ? decision.phase : undefined;
        }
        function phaseLabel(t, phase) {
            switch (phase) {
                case undefined: return t('phase.recorded');
                case 'acknowledged': return t('phase.acknowledged');
                case 'dismissed': return t('phase.dismissed');
                case 'replaced': return t('phase.replaced');
                // A kind may add phases later; show the recorded token rather than inventing copy.
                default: return phase;
            }
        }
        function phaseColor(phase) {
            switch (phase) {
                case undefined: return 'var(--dsw-alias-brand-primary)';
                case 'acknowledged': return 'var(--dsw-alias-state-success-primary)';
                case 'dismissed': return 'var(--dsw-alias-state-idle-primary)';
                default: return 'var(--dsw-alias-label-secondary)';
            }
        }
        // -----------------------------------------------------------------
        // Decision mention grammar
        // -----------------------------------------------------------------
        /** Collapse whitespace and drop the characters the mention grammar reserves. */
        function mentionTitleOf(title) {
            const flattened = title.replace(/\s+/gu, ' ').trim();
            const safe = flattened.replace(/[[\]()]/gu, ' ').replace(/\s+/gu, ' ').trim();
            return safe.slice(0, MENTION_TITLE_MAX);
        }
        /**
         * The stable reference mention: `@[<title>](dsh-decision:<callId>)`.
         * `undefined` only for a call id the grammar cannot carry at all (empty,
         * over {@link CALL_ID_MAX}, or holding a line break / `)`); a real Host id
         * such as `call_…|fc_…` passes verbatim.
         */
        function mentionTextOf(title, callId) {
            if (callId === '' || !CALL_ID_PATTERN.test(callId))
                return undefined;
            const safeTitle = mentionTitleOf(title) || callId;
            return `@[${safeTitle}](${REF_SCHEME}${callId})`;
        }
        /**
         * The structured reference both entry points insert. `ref` and
         * `clipboardText` carry the full stable mention (this source's codec is the
         * identity codec), and `label` is the grammar-safe title the chip shows.
         */
        function referenceOf(title, callId) {
            const mention = mentionTextOf(title, callId);
            if (mention === undefined)
                return undefined;
            return {
                source: SOURCE_NAME,
                ref: mention,
                label: mentionTitleOf(title) || callId,
                clipboardText: mention,
            };
        }
        /**
         * Insert one decision chip from the View through the public session-scope
         * input face: `sessions.scope` borrows the retained Agent context,
         * `conversation.input.for(scope)` resolves that Session's input shell, and
         * `insertReference` replaces the current caret span with the chip.
         *
         * The span comes from `inputActions.captureInsertion()` because the
         * public `SessionInput` face exposes no caret capture of its own; both
         * objects come from the same per-Session shell and share its draft revision.
         * A host-less render, an ended Session generation, or a composition without
         * the conversation service leaves the click inert instead of throwing.
         */
        function insertDecisionReference(sessions, sessionId, inputActions, title, callId) {
            if (sessions === undefined || inputActions === undefined)
                return false;
            const reference = referenceOf(title, callId);
            if (reference === undefined)
                return false;
            try {
                const scope = sessions.scope(sessionId);
                const conversation = scope?.get('conversation');
                if (scope === undefined || conversation === undefined)
                    return false;
                return conversation.input.for(scope).insertReference(reference, inputActions.captureInsertion());
            }
            catch {
                // `input.for` throws when the binding is no longer the retained
                // generation; a click on a card of a Session that just ended is a no-op.
                return false;
            }
        }
        function summarize(text) {
            if (text === undefined)
                return '';
            const flattened = text.replace(/\s+/gu, ' ').trim();
            return flattened.length > SUMMARY_MAX
                ? `${flattened.slice(0, SUMMARY_MAX - 1)}…`
                : flattened;
        }
        /** Newest first: the menu is a recency list, the View keeps durable order. */
        function decisionEntriesOf(view) {
            const entries = cardRecordsOf(view).map((record) => {
                const fields = fieldsOf(record, decisionOf(view, record.callId));
                const title = stringOf(record.title) ?? '';
                return {
                    callId: record.callId,
                    title,
                    mentionTitle: mentionTitleOf(title) || record.callId,
                    summary: summarize(fields.decision ?? record.brief),
                };
            });
            entries.reverse();
            return entries;
        }
        /** Prefix beats substring beats body match; ties keep recency. */
        function rankedEntries(entries, query) {
            const needle = query.trim().toLowerCase();
            if (needle === '')
                return entries;
            const ranked = [];
            for (const [index, entry] of entries.entries()) {
                const title = entry.title.toLowerCase();
                const summary = entry.summary.toLowerCase();
                let score = 0;
                if (title.startsWith(needle))
                    score = 3;
                else if (title.includes(needle))
                    score = 2;
                else if (summary.includes(needle))
                    score = 1;
                else if (entry.callId.toLowerCase().includes(needle))
                    score = 1;
                if (score === 0)
                    continue;
                ranked.push({ entry, score, index });
            }
            ranked.sort((left, right) => right.score - left.score || left.index - right.index);
            return ranked.map(item => item.entry);
        }
        function candidateOf(entry, section) {
            return {
                // Identity: the exact-match key and the pick payload's owner.
                name: entry.callId,
                // Display title; the alias row then shows the stable call id.
                label: entry.title === '' ? entry.callId : entry.title,
                section,
                ...(entry.summary === '' ? {} : { description: entry.summary }),
                value: JSON.stringify({ callId: entry.callId, title: entry.mentionTitle }),
            };
        }
        function parseCandidateValue(value) {
            if (value === undefined)
                return undefined;
            let parsed;
            try {
                parsed = JSON.parse(value);
            }
            catch {
                return undefined;
            }
            if (!isRecord(parsed))
                return undefined;
            const callId = parsed['callId'];
            const title = parsed['title'];
            if (typeof callId !== 'string' || typeof title !== 'string')
                return undefined;
            return { callId, title };
        }
        // -----------------------------------------------------------------
        // Styles (theme tokens only; the View is a read-only projection)
        // -----------------------------------------------------------------
        const styles = {
            page: {
                boxSizing: 'border-box',
                width: '100%',
                maxWidth: 'var(--dsh-chat-content-width, 920px)',
                margin: '0 auto',
                padding: '24px calc(var(--dsh-composer-side-clearance, 16px) + 16px) 48px',
                color: 'var(--dsw-alias-label-primary)',
                fontFamily: 'var(--dsw-font-family)',
                fontSize: 'var(--dsw-font-s-14-font-size)',
                lineHeight: 'var(--dsw-font-s-14-line-height)',
            },
            section: { display: 'flex', flexDirection: 'column', gap: '16px' },
            header: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' },
            title: {
                margin: 0,
                fontSize: 'var(--dsw-font-m-18-font-size)',
                lineHeight: 'var(--dsw-font-m-18-line-height)',
                fontWeight: 600,
            },
            count: {
                margin: '4px 0 0',
                color: 'var(--dsw-alias-label-secondary)',
                fontSize: 'var(--dsw-font-xxs-12-font-size)',
                lineHeight: 'var(--dsw-font-xxs-12-line-height)',
            },
            list: { display: 'flex', flexDirection: 'column', gap: '12px' },
            card: {
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                padding: '16px',
                background: 'var(--dsw-alias-bg-layer-1)',
                border: '1px solid var(--dsw-alias-border-l1)',
                borderRadius: 'var(--dsw-radius-md)',
            },
            cardHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' },
            headerActions: { display: 'flex', alignItems: 'center', gap: '8px', flex: 'none' },
            referenceButton: {
                padding: '4px 9px',
                color: 'var(--dsw-alias-label-primary)',
                background: 'var(--dsw-alias-bg-layer-2)',
                border: '1px solid var(--dsw-alias-border-l1)',
                borderRadius: 'var(--dsw-radius-sm)',
                cursor: 'pointer',
                font: 'inherit',
            },
            cardHeading: { display: 'flex', flex: '1 1 auto', flexDirection: 'column', gap: '2px', minWidth: 0 },
            cardTitle: {
                margin: 0,
                fontSize: 'var(--dsw-font-s-strong-14-font-size)',
                lineHeight: 'var(--dsw-font-s-strong-14-line-height)',
                fontWeight: 'var(--dsw-font-s-strong-14-font-weight)',
                overflowWrap: 'anywhere',
            },
            turn: {
                color: 'var(--dsw-alias-label-secondary)',
                fontSize: 'var(--dsw-font-xxs-12-font-size)',
                lineHeight: 'var(--dsw-font-xxs-12-line-height)',
            },
            phase: {
                flex: 'none',
                padding: '2px 8px',
                background: 'var(--dsw-alias-bg-layer-2)',
                border: '1px solid var(--dsw-alias-border-l1)',
                borderRadius: '999px',
                fontSize: 'var(--dsw-font-xxs-12-font-size)',
                lineHeight: 'var(--dsw-font-xxs-12-line-height)',
                fontWeight: 500,
                whiteSpace: 'nowrap',
            },
            brief: { margin: 0, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
            fields: { display: 'grid', gap: '12px', margin: 0 },
            field: { display: 'grid', gap: '2px' },
            term: {
                color: 'var(--dsw-alias-label-secondary)',
                fontSize: 'var(--dsw-font-xxs-12-font-size)',
                lineHeight: 'var(--dsw-font-xxs-12-line-height)',
                fontWeight: 500,
            },
            value: { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
            alternatives: { margin: 0, paddingInlineStart: '20px', display: 'grid', gap: '2px' },
            alternative: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
            empty: {
                display: 'grid',
                justifyItems: 'center',
                gap: '6px',
                padding: '32px 20px',
                textAlign: 'center',
                background: 'var(--dsw-alias-bg-layer-1)',
                border: '1px solid var(--dsw-alias-border-l1)',
                borderRadius: 'var(--dsw-radius-md)',
            },
            emptyTitle: {
                margin: 0,
                fontSize: 'var(--dsw-font-s-strong-14-font-size)',
                lineHeight: 'var(--dsw-font-s-strong-14-line-height)',
                fontWeight: 500,
            },
            emptyBody: {
                margin: 0,
                maxWidth: '42ch',
                color: 'var(--dsw-alias-label-secondary)',
            },
            mention: {
                display: 'inline-flex',
                alignItems: 'center',
                maxWidth: '32ch',
                padding: '0 6px',
                margin: '0 1px',
                border: '1px solid var(--dsw-alias-border-l1)',
                borderRadius: '999px',
                background: 'var(--dsw-alias-bg-layer-2)',
                color: 'var(--dsw-alias-label-primary)',
                fontSize: 'var(--dsw-font-xxs-12-font-size)',
                lineHeight: 'var(--dsw-font-xxs-12-line-height)',
                verticalAlign: 'baseline',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
            },
        };
        // -----------------------------------------------------------------
        // View components
        // -----------------------------------------------------------------
        function Field(props) {
            return h('div', { style: styles.field }, h('dt', { style: styles.term }, props.label), h('dd', { style: styles.value }, props.children));
        }
        function DecisionCard(props) {
            const { record, decision, sessionId, sessions, inputActions, t } = props;
            const fields = fieldsOf(record, decision);
            const phase = phaseOf(decision);
            const cardTitle = stringOf(record.title) ?? '';
            const title = cardTitle || t('card.untitled');
            const brief = stringOf(record.brief);
            const rows = [];
            if (fields.decision !== undefined) {
                rows.push(h(Field, { key: 'decision', label: t('field.decision') }, fields.decision));
            }
            if (fields.rationale !== undefined) {
                rows.push(h(Field, { key: 'rationale', label: t('field.rationale') }, fields.rationale));
            }
            if (fields.impact !== undefined) {
                rows.push(h(Field, { key: 'impact', label: t('field.impact') }, fields.impact));
            }
            if (fields.alternatives.length > 0) {
                rows.push(h(Field, { key: 'alternatives', label: t('field.alternatives') }, h('ul', { style: styles.alternatives }, fields.alternatives.map((item, index) => h('li', { key: index, style: styles.alternative }, item)))));
            }
            if (fields.followUp !== undefined) {
                rows.push(h(Field, { key: 'followUp', label: t('field.followUp') }, fields.followUp));
            }
            return h('article', {
                style: styles.card,
                'data-action-card': record.callId,
                'data-action': ACTION,
            }, h('header', { style: styles.cardHeader }, h('div', { style: styles.cardHeading }, h('h3', { style: styles.cardTitle }, title), typeof record.turn === 'number'
                ? h('span', { style: styles.turn }, t('card.turn', { turn: record.turn }))
                : null), h('div', { style: styles.headerActions }, h('span', {
                style: { ...styles.phase, color: phaseColor(phase) },
                'data-phase': phase === undefined ? 'recorded' : phase,
            }, phaseLabel(t, phase)), h('button', {
                type: 'button',
                style: styles.referenceButton,
                // A host render without the session input actions keeps the
                // affordance visible but inert instead of throwing on click.
                disabled: inputActions === undefined || sessions === undefined,
                title: t('reference.button'),
                'data-dsh-decision-reference': record.callId,
                'aria-label': `${t('reference.button')}: ${title}`,
                onClick: () => {
                    // Structured chip: the composer replaces the caret span with a
                    // reference node whose clipboard and model form is the mention.
                    insertDecisionReference(sessions, sessionId, inputActions, cardTitle, record.callId);
                },
            }, t('reference.button')))), brief === undefined ? null : h('p', { style: styles.brief }, brief), rows.length === 0 ? null : h('dl', { style: styles.fields }, rows));
        }
        /**
         * Session-scoped view over the actionCards projection: every recorded
         * critical-decision card, read through the slot's standard `useProjection`.
         * Absent means the projection has not arrived (or its host unit is not
         * mounted); no "empty" claim is made until a value exists.
         */
        function CriticalDecisionsView(props) {
            const { useProjection, sessionId, sessions, inputActions, t } = props;
            const view = useProjection('actionCards');
            const records = cardRecordsOf(view);
            const ready = view !== undefined;
            return h('div', {
                style: styles.page,
                'data-dsh-critical-decisions': 'view',
                'data-session-id': sessionId,
            }, h('section', { style: styles.section, 'aria-label': t('view.title') }, h('header', { style: styles.header }, h('div', null, h('h2', { style: styles.title }, t('view.title')), records.length === 0
                ? null
                : h('p', { style: styles.count }, t('view.count', { count: records.length })))), records.length === 0
                ? (ready
                    ? h('div', { style: styles.empty }, h('p', { style: styles.emptyTitle }, t('view.emptyTitle')), h('p', { style: styles.emptyBody }, t('view.emptyBody')))
                    : null)
                : h('div', { style: styles.list }, records.map(record => h(DecisionCard, {
                    key: record.callId,
                    record,
                    decision: decisionOf(view, record.callId),
                    sessionId,
                    sessions,
                    inputActions,
                    t,
                })))));
        }
        /**
         * Inline chip for one durable decision mention. The mention text already
         * carries the title and the call id, so this renderer needs no Facts and
         * no lookup: the same text round-trips through copy, paste, and persistence.
         */
        function DecisionMention(props) {
            const { node, raw, t } = props;
            return h('span', {
                style: styles.mention,
                'data-dsh-decision-mention': node.data.callId,
                title: raw,
            }, t('reference.chip', { title: node.data.title }));
        }
        // -----------------------------------------------------------------
        // `@` decision reference source
        // -----------------------------------------------------------------
        /**
         * Build the `@` source for one client context. Candidates are read
         * synchronously from the Session's `actionCards` projection: the Host has
         * already computed it, so opening the menu costs no RPC and a pick cannot
         * race a fetch.
         */
        function createSource(sessions, t) {
            const section = t('reference.section');
            const projectionOf = (sessionId) => {
                // No retained binding (session not open in this client) means no cards
                // to reference; the menu still opens, it just has nothing to offer.
                const binding = sessions.binding(sessionId);
                if (binding === undefined)
                    return undefined;
                const value = binding.session.projections.faceOf('actionCards').getSnapshot();
                if (!isRecord(value))
                    return undefined;
                return value;
            };
            return {
                trigger: '@',
                name: SOURCE_NAME,
                // After the file/session reference group of the same `@` menu.
                order: 10,
                // Rows carry a localized `section`, so the group title row would only
                // repeat the raw source name.
                showGroupTitle: false,
                async candidates(session, request) {
                    const entries = decisionEntriesOf(projectionOf(session.sessionId));
                    return rankedEntries(entries, request.query).map(entry => candidateOf(entry, section));
                },
                onPick(pick) {
                    const payload = parseCandidateValue(pick.candidate.value);
                    if (payload === undefined)
                        return undefined;
                    const reference = referenceOf(payload.title, payload.callId);
                    if (reference === undefined)
                        return undefined;
                    // The reference IS the mention: `ref` and `clipboardText` are the
                    // stable text, so the chip projects to the same literal in the draft
                    // and in the prompt. `insert` is the structured outcome the pipeline
                    // applies through the scoped `slash/input-insert-reference` event,
                    // which replaces the live `@query` span with a reference chip (see
                    // `PickOutcome`). The userText rule below renders the same mention
                    // on the durable user message.
                    return { insert: reference };
                },
                codec: {
                    clipboardText: ref => ref,
                    serialize: ref => Promise.resolve(ref),
                },
            };
        }
        // -----------------------------------------------------------------
        // userText rule for the durable mention
        // -----------------------------------------------------------------
        /**
         * Forward matcher over original message text. Order 20 wins the same start
         * offset against the file-reference rule (order 30), whose `@<token>`
         * grammar would otherwise claim the leading `@[`.
         */
        const decisionMentionRule = {
            id: 'decision',
            order: 20,
            match(text, from) {
                const pattern = new RegExp(MENTION_SOURCE, 'gu');
                pattern.lastIndex = from;
                const found = pattern.exec(text);
                if (found === null)
                    return undefined;
                const title = found[1];
                const callId = found[2];
                if (title === undefined || callId === undefined)
                    return undefined;
                return {
                    id: 'decision',
                    start: found.index,
                    end: found.index + found[0].length,
                    data: { callId, title },
                };
            },
        };
        // -----------------------------------------------------------------
        // Registration
        // -----------------------------------------------------------------
        // Required for the View, the mention chip, and their copy. The `@` source
        // depends on `inputTriggers` instead through a scoped `inject` below: the
        // View must keep working in a composition without the trigger pipeline.
        const inject = ['slots', 'locale', 'uiConversation', 'sessions'];
        function apply(ctx) {
            ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-critical-decisions: locale');
            const t = ctx.locale.bind(NS);
            // Session-scoped list entry: one tab beside Chat and Trajectory. The label
            // is a thunk, so the tab follows the active locale without re-registration.
            // Components never receive `ctx`; this thin registration wrapper projects
            // the one service the card button needs into the component's props, so the
            // insert resolves the live Session scope only when the button is clicked.
            ctx.slots.inject('conversation.view', () => ctx.slots.register({
                name: 'conversation.view',
                id: 'critical-decisions',
                order: 20,
                locale: NS,
                label: () => t('view.label'),
            }, (props) => h(CriticalDecisionsView, { ...props, sessions: ctx.sessions })));
            // Keyed inline renderer for one durable decision mention.
            ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
                name: 'conversation.user.text.node',
                key: MENTION_NODE_KEY,
                priority: 100,
                locale: NS,
            }, DecisionMention));
            ctx.effect(() => ctx.uiConversation.userText.register(decisionMentionRule), 'dsh-critical-decisions: decision mention rule');
            // Scoped contribution: resolves once the trigger pipeline is available
            // (and unregisters with this plugin), without gating the View on it.
            ctx.inject(['inputTriggers'], (scope) => {
                const inputTriggers = scope.get('inputTriggers');
                scope.effect(() => inputTriggers.registerSource(createSource(ctx.sessions, t)), 'dsh-critical-decisions: @ decision source');
            });
        }
        return { inject, apply };
    },
});
