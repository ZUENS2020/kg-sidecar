function relationKey(conversationId, fromUuid, toUuid) {
    return `${conversationId}:${fromUuid}->${toUuid}`;
}

function cleanEntityDisplayId(nameOrUuid) {
    return String(nameOrUuid || '')
        .replace(/^角色:/, '')
        .replace(/_/g, ' ')
        .trim()
        .slice(0, 120);
}

function nowIso() {
    return new Date().toISOString();
}

function actionPriority(action) {
    const normalized = String(action || '').toUpperCase();
    if (normalized === 'REPLACE') {
        return 3;
    }
    if (normalized === 'DELETE') {
        return 2;
    }
    return 1;
}

function ensureEntityNode(draft, { uuid, name, bio, step }) {
    if (!uuid) {
        return null;
    }

    const existing = draft.entities[uuid] || {};
    const id = cleanEntityDisplayId(name || existing.id || uuid);
    draft.entities[uuid] = {
        uuid,
        entity_key: uuid,
        id,
        name: id,
        canonical_name: id,
        bio: String(bio || existing.bio || '简介待补充').slice(0, 500),
        updated_at: nowIso(),
        last_seen_step: step,
        bio_before: existing.bio_before || null,
        bio_last_cause: existing.bio_last_cause || null,
        bio_updated_at: existing.bio_updated_at || null,
    };

    return draft.entities[uuid];
}

function normalizeParticipants(action) {
    const fromParticipant = {
        uuid: action.from_uuid,
        name: action.from_name || action.from_uuid,
        role: 'subject',
    };
    const toParticipant = {
        uuid: action.to_uuid,
        name: action.to_name || action.to_uuid,
        role: 'object',
    };

    const extra = Array.isArray(action.participants) ? action.participants : [];
    const out = [];
    const seen = new Set();

    for (const raw of [fromParticipant, toParticipant, ...extra]) {
        const uuid = String(raw?.uuid || '').trim();
        if (!uuid || seen.has(uuid)) {
            continue;
        }
        seen.add(uuid);
        out.push({
            uuid,
            name: String(raw?.name || uuid).trim(),
            bio: String(raw?.bio || '').trim(),
            role: String(raw?.role || (uuid === action.from_uuid ? 'subject' : 'participant')).trim(),
        });
    }

    return out;
}

export class MemoryGraphRepository {
    #state;

    constructor() {
        this.#state = {
            entities: {},
            relations: {},
            events: [],
            event_links: [],
            milestones: [],
        };
    }

    getState() {
        return structuredClone(this.#state);
    }

    async resolveEntityCandidatesByName(name) {
        const target = String(name || '').trim().toLowerCase();
        if (!target) {
            return [];
        }

        return Object.values(this.#state.entities)
            .filter(entity => String(entity.name || '').trim().toLowerCase() === target)
            .map(entity => ({ uuid: entity.uuid, name: entity.name, bio: entity.bio || '' }));
    }

    async getRelation({ conversationId, fromUuid, toUuid }) {
        const key = relationKey(conversationId, fromUuid, toUuid);
        const relation = this.#state.relations[key];
        return relation ? structuredClone(relation) : null;
    }

    async commitMutation({ actions, judgeOut, historianOut, entities = [], turnId, step, conversationId }) {
        const draft = structuredClone(this.#state);

        try {
            for (const entity of entities || []) {
                ensureEntityNode(draft, {
                    uuid: entity?.uuid,
                    name: entity?.name || entity?.uuid,
                    bio: entity?.bio,
                    step,
                });
            }

            for (const [index, action] of actions.entries()) {
                const key = relationKey(conversationId, action.from_uuid, action.to_uuid);
                const existing = draft.relations[key];

                ensureEntityNode(draft, {
                    uuid: action.from_uuid,
                    name: action.from_name || action.from_uuid,
                    bio: action.from_bio,
                    step,
                });
                ensureEntityNode(draft, {
                    uuid: action.to_uuid,
                    name: action.to_name || action.to_uuid,
                    bio: action.to_bio,
                    step,
                });

                const relationStatus = String(
                    action.action === 'REPLACE'
                        ? (action.new_label || 'ALLY')
                        : (existing?.label || action.new_label || action.old_label || 'ALLY'),
                ).trim();

                if (action.action === 'EVOLVE') {
                    draft.relations[key] = {
                        key,
                        conversation_id: conversationId,
                        from_uuid: action.from_uuid,
                        to_uuid: action.to_uuid,
                        label: relationStatus,
                        status: relationStatus,
                        name: relationStatus,
                        weight: Number(existing?.weight || 0) + Number(action.delta_weight || 0),
                        last_step: step,
                        last_turn_id: turnId,
                        last_evidence_quote: action.evidence_quote,
                    };
                }

                if (action.action === 'REPLACE') {
                    delete draft.relations[key];
                    draft.relations[key] = {
                        key,
                        conversation_id: conversationId,
                        from_uuid: action.from_uuid,
                        to_uuid: action.to_uuid,
                        label: relationStatus,
                        status: relationStatus,
                        name: relationStatus,
                        weight: 0.5,
                        last_step: step,
                        last_turn_id: turnId,
                        last_evidence_quote: action.evidence_quote,
                    };
                }

                if (action.action === 'DELETE') {
                    delete draft.relations[key];
                }

                const eventId = String(
                    action.event_name || `事件:${action.action}:${action.from_uuid}->${action.to_uuid}`,
                ).trim();
                const eventKey = `${turnId}:${index + 1}:${eventId}`;
                const participants = normalizeParticipants(action);
                for (const participant of participants) {
                    ensureEntityNode(draft, {
                        uuid: participant.uuid,
                        name: participant.name,
                        bio: participant.bio,
                        step,
                    });
                }

                draft.events.push({
                    event_key: eventKey,
                    event_id: eventId,
                    id: eventId,
                    name: eventId,
                    turn_id: turnId,
                    conversation_id: conversationId,
                    step,
                    action: action.action,
                    old_label: action.old_label || null,
                    new_label: action.new_label || null,
                    delta_weight: action.delta_weight || null,
                    evidence_quote: action.evidence_quote,
                    from_uuid: action.from_uuid,
                    to_uuid: action.to_uuid,
                    cause: action.cause || null,
                    judge_result: judgeOut.identity_conflicts.length === 0 ? 'ALLOW' : 'BLOCK',
                    bio_sync_patch: structuredClone(judgeOut.bio_sync_patch),
                    participants: participants.map((participant) => ({
                        uuid: participant.uuid,
                        id: cleanEntityDisplayId(participant.name || participant.uuid),
                        role: participant.role,
                    })),
                });

                for (const participant of participants) {
                    const id = cleanEntityDisplayId(participant.name || participant.uuid);
                    const linkKey = `${eventKey}|${participant.uuid}`;
                    if (draft.event_links.some(link => link.link_key === linkKey)) {
                        continue;
                    }
                    draft.event_links.push({
                        link_key: linkKey,
                        event_key: eventKey,
                        event_id: eventId,
                        entity_uuid: participant.uuid,
                        entity_id: id,
                        role: participant.role,
                    });
                }
            }

            for (const patch of judgeOut.bio_sync_patch || []) {
                if (!patch?.uuid) {
                    continue;
                }
                ensureEntityNode(draft, {
                    uuid: patch.uuid,
                    name: patch.uuid,
                    bio: patch.after,
                    step,
                });
                draft.entities[patch.uuid].bio_before = String(patch.before || '').slice(0, 500);
                draft.entities[patch.uuid].bio_last_cause = String(patch.cause || '').slice(0, 500);
                draft.entities[patch.uuid].bio_updated_at = nowIso();
            }

            const timelineItems = Array.isArray(historianOut.timeline_items)
                ? historianOut.timeline_items
                : (historianOut.milestones || []).map((tag, index) => ({
                    id: `里程碑:${turnId}:${index + 1}`,
                    tag,
                }));

            for (const item of timelineItems) {
                draft.milestones.push({
                    milestone_id: item.id,
                    turn_id: turnId,
                    conversation_id: conversationId,
                    content: item.tag,
                });
            }

            this.#state = draft;

            return {
                committed: true,
                txId: `${turnId}:memory`,
                storage: 'memory',
            };
        } catch (error) {
            return {
                committed: false,
                storage: 'memory',
                error,
            };
        }
    }

    async clearGraph() {
        const deletedNodes = Object.keys(this.#state.entities).length
            + this.#state.events.length
            + this.#state.milestones.length;
        const deletedRelations = Object.keys(this.#state.relations).length + this.#state.event_links.length;

        this.#state = {
            entities: {},
            relations: {},
            events: [],
            event_links: [],
            milestones: [],
        };

        return {
            ok: true,
            storage: 'memory',
            deleted_nodes: deletedNodes,
            deleted_relationships: deletedRelations,
        };
    }

    async queryKeyEvents({
        conversationId,
        focusEntityUuids = [],
        limit = 4,
        currentStep = null,
        maxAgeSteps = 30,
    }) {
        const focus = Array.isArray(focusEntityUuids)
            ? focusEntityUuids.map(x => String(x || '').trim()).filter(Boolean)
            : [];
        const topN = Math.max(1, Math.min(20, Number(limit) || 4));
        const maxAge = Math.max(1, Number(maxAgeSteps) || 30);
        const nowStep = Number.isFinite(Number(currentStep)) ? Number(currentStep) : null;

        const events = this.#state.events
            .filter(event => String(event?.conversation_id || '') === String(conversationId || ''))
            .filter((event) => {
                if (focus.length === 0) {
                    return true;
                }
                const participants = Array.isArray(event?.participants) ? event.participants : [];
                return participants.some(x => focus.includes(String(x?.uuid || '')));
            })
            .filter((event) => {
                if (nowStep === null) {
                    return true;
                }
                const step = Number(event?.step);
                if (!Number.isFinite(step)) {
                    return true;
                }
                return Math.abs(nowStep - step) <= maxAge;
            })
            .map((event) => {
                const step = Number.isFinite(Number(event?.step)) ? Number(event.step) : 0;
                const agePenalty = nowStep === null ? 0 : Math.max(0, Math.abs(nowStep - step));
                const recencyScore = nowStep === null ? 0 : (maxAge - Math.min(maxAge, agePenalty)) / maxAge;
                const priority = actionPriority(event?.action);
                const scoreHint = Number((priority * 2 + recencyScore).toFixed(3));
                return {
                    event_id: event.event_id,
                    action: event.action,
                    evidence_quote: event.evidence_quote,
                    participants: Array.isArray(event.participants) ? structuredClone(event.participants) : [],
                    turn_id: event.turn_id,
                    step,
                    score_hint: scoreHint,
                };
            })
            .sort((a, b) => {
                if (b.score_hint !== a.score_hint) {
                    return b.score_hint - a.score_hint;
                }
                return Number(b.step || 0) - Number(a.step || 0);
            })
            .slice(0, topN);

        return events;
    }
}
