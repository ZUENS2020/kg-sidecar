import { selectModelForSlot } from '../model/modelRouter.js';
import {
    buildSlotSystemPrompt,
    compactJson,
    generateOpenRouterJson,
    isOpenRouterTimeoutError,
    nonEmptyString,
    resolveOpenRouterSlotTimeoutMs,
    resolveSlotContextWindowMessages,
    toReadableEntityId,
} from '../model/openRouterTextClient.js';

const GENERIC_ENTITY_NAMES = new Set([
    'user',
    'assistant',
    'system',
    'ai',
    'bot',
    'you',
    'me',
    'i',
    'we',
    'they',
    'their',
    'he',
    'she',
    'it',
    '用户',
    '助手',
    '系统',
    '自己',
    '我',
    '你',
    '他',
    '她',
]);

function sanitizeName(name) {
    return String(name || '').trim().slice(0, 80);
}

function isGenericEntityName(name) {
    const key = sanitizeName(name).toLowerCase();
    return key ? GENERIC_ENTITY_NAMES.has(key) : true;
}

function toEntity(name) {
    const normalized = sanitizeName(name);
    const uuid = toReadableEntityId(normalized);
    if (!normalized || !uuid || isGenericEntityName(normalized)) {
        return null;
    }
    return { name: normalized, uuid };
}

function appendUniqueEntity(target, name) {
    const entity = toEntity(name);
    if (!entity) {
        return;
    }

    if (target.some(item => item.name.toLowerCase() === entity.name.toLowerCase())) {
        return;
    }

    target.push(entity);
}

async function tryResolveCandidates(name, graphRepository, fallbackUuid) {
    if (!graphRepository?.resolveEntityCandidatesByName) {
        return [fallbackUuid];
    }

    try {
        const fromGraph = await graphRepository.resolveEntityCandidatesByName(name);
        const uuids = Array.isArray(fromGraph)
            ? fromGraph.map(item => nonEmptyString(item?.uuid)).filter(Boolean)
            : [];
        return uuids.length > 0 ? uuids : [fallbackUuid];
    } catch {
        return [fallbackUuid];
    }
}

async function findCurrentRelation(graphRepository, conversationId, fromEntity, toEntity) {
    if (!graphRepository?.getRelation || !fromEntity?.uuid || !toEntity?.uuid) {
        return null;
    }

    try {
        return await graphRepository.getRelation({
            conversationId,
            fromUuid: fromEntity.uuid,
            toUuid: toEntity.uuid,
        });
    } catch {
        return null;
    }
}

function fallbackRelation(focusEntities, relationHint = null) {
    if ((focusEntities || []).length < 2) {
        return [];
    }

    const from = focusEntities[0];
    const to = focusEntities[1];
    return [{
        from_uuid: from.uuid,
        to_uuid: to.uuid,
        from_name: from.name,
        to_name: to.name,
        label: relationHint?.label || 'ALLY',
        weight: 0.5,
        last_step: 0,
    }];
}

function normalizeModelFocus(payload, fallbackFocus) {
    const entities = Array.isArray(payload?.focus_entities) ? payload.focus_entities : [];
    const list = entities
        .map(item => sanitizeName(item?.name || item))
        .filter(name => name && !isGenericEntityName(name))
        .slice(0, 6);

    if (list.length === 0) {
        return fallbackFocus;
    }

    return list.map(name => toEntity(name)).filter(Boolean);
}

function mergeFocusEntities({ modelFocus, relationHints, fallbackFocus }) {
    const merged = [];

    for (const entity of modelFocus || []) {
        appendUniqueEntity(merged, entity.name);
    }

    for (const hint of relationHints || []) {
        appendUniqueEntity(merged, hint?.from_name);
        appendUniqueEntity(merged, hint?.to_name);
    }

    for (const entity of fallbackFocus || []) {
        appendUniqueEntity(merged, entity.name);
    }

    return merged.slice(0, 6);
}

async function queryKeyEvents({
    graphRepository,
    conversationId,
    focusEntities,
    step,
    config,
}) {
    if (!graphRepository?.queryKeyEvents || !conversationId) {
        return [];
    }

    const focusEntityUuids = (focusEntities || [])
        .map(entity => String(entity?.uuid || '').trim())
        .filter(Boolean);
    if (focusEntityUuids.length === 0) {
        return [];
    }

    const maxAgeSteps = Math.max(
        1,
        Number(config?.key_event_max_age_steps)
        || Number(config?.context_window_messages)
        || 80,
    );
    const limit = Math.max(1, Math.min(12, Number(config?.key_event_limit) || 4));

    try {
        const out = await graphRepository.queryKeyEvents({
            conversationId,
            focusEntityUuids,
            limit,
            currentStep: Number.isFinite(Number(step)) ? Number(step) : null,
            maxAgeSteps,
        });
        return Array.isArray(out) ? out : [];
    } catch {
        return [];
    }
}

export async function retrieveEntities({
    userMessage,
    chatWindow,
    step,
    debug = {},
    config = {},
    runtime,
    graphRepository,
    conversationId,
}) {
    const routed = selectModelForSlot({ slot: 'retriever', models: config?.models });
    const openRouterJson = runtime?.openRouterJson || generateOpenRouterJson;

    if (routed.provider !== 'openrouter') {
        throw Object.assign(new Error('Retriever is in strict mode and requires OpenRouter provider.'), {
            code: 'RETRIEVER_STRICT_OPENROUTER_REQUIRED',
            stage: 'retriever',
            retryable: false,
        });
    }

    if (!runtime?.userDirectories && !runtime?.openRouterJson) {
        throw Object.assign(new Error('Retriever requires LLM runtime (OpenRouter) and refuses local fallback.'), {
            code: 'RETRIEVER_LLM_REQUIRED',
            stage: 'retriever',
            retryable: false,
        });
    }

    const contextMessages = resolveSlotContextWindowMessages({
        config,
        slot: 'retriever',
        fallbackCount: 80,
    });
    const systemPrompt = buildSlotSystemPrompt(
        'Retriever',
        [
            '识别本轮关键人物实体，输出 focus_entities 与 relation_hints。',
            'focus_entities 只能是人物名，不得把动作短语、关系短语、事件描述当成人物。',
            '若无法确认人物，返回空数组并在 retrieval_notes 解释原因。',
        ].join('\n'),
    );
    const userPrompt = [
        '输入上下文(JSON):',
        compactJson({
            user_message: userMessage,
            chat_window: (chatWindow || []).slice(-contextMessages),
        }, 32000),
        '输出 JSON schema:',
        '{"focus_entities":[{"name":"角色名"}],"relation_hints":[{"from_name":"A","to_name":"B","label":"ALLY|TRAITOR|ENEMY|MENTOR","confidence":0.0}],"retrieval_notes":"..."}',
    ].join('\n');

    let modelPayload = null;
    try {
        const maybePayload = await openRouterJson({
            directories: runtime.userDirectories,
            model: routed.model,
            systemPrompt,
            userMessage: userPrompt,
            temperature: routed.temperature,
            maxTokens: 1200,
            timeoutMs: resolveOpenRouterSlotTimeoutMs({
                config,
                slot: 'retriever',
                fallbackMs: 22000,
            }),
        });

        if (maybePayload && typeof maybePayload === 'object') {
            modelPayload = maybePayload;
        }
    } catch (error) {
        throw Object.assign(new Error(`Retriever LLM call failed: ${String(error?.message || error)}`), {
            code: isOpenRouterTimeoutError(error) ? 'OPENROUTER_TIMEOUT' : 'RETRIEVER_LLM_FAILED',
            stage: 'retriever',
            retryable: true,
        });
    }

    if (!modelPayload) {
        throw Object.assign(new Error('Retriever LLM returned empty payload.'), {
            code: 'RETRIEVER_LLM_EMPTY_PAYLOAD',
            stage: 'retriever',
            retryable: true,
        });
    }

    const relationHints = Array.isArray(modelPayload?.relation_hints)
        ? modelPayload.relation_hints.slice(0, 4)
        : [];
    const modelFocus = normalizeModelFocus(modelPayload, []);
    if (modelFocus.length === 0) {
        throw Object.assign(new Error('Retriever LLM produced empty focus_entities; turn rejected.'), {
            code: 'RETRIEVER_LLM_EMPTY',
            stage: 'retriever',
            retryable: true,
        });
    }
    const focusEntities = mergeFocusEntities({
        modelFocus,
        relationHints,
        fallbackFocus: [],
    }).slice(0, 2);

    const candidates = [];
    for (const entity of focusEntities) {
        const uuids = await tryResolveCandidates(entity.name, graphRepository, entity.uuid);
        if (debug.forceIdentityConflict && candidates.length === 0) {
            candidates.push({ name: entity.name, uuids: [entity.uuid, `${entity.uuid}:alias`] });
            continue;
        }
        candidates.push({ name: entity.name, uuids });
    }

    for (const entity of focusEntities.slice(candidates.length)) {
        candidates.push({ name: entity.name, uuids: [entity.uuid] });
    }

    const relationHint = relationHints[0] || null;
    let currentRelations = fallbackRelation(focusEntities, relationHint);
    if (focusEntities.length >= 2) {
        const graphRelation = await findCurrentRelation(graphRepository, conversationId, focusEntities[0], focusEntities[1]);
        if (graphRelation) {
            currentRelations = [{
                from_uuid: graphRelation.from_uuid || focusEntities[0].uuid,
                to_uuid: graphRelation.to_uuid || focusEntities[1].uuid,
                from_name: focusEntities[0].name,
                to_name: focusEntities[1].name,
                label: graphRelation.label || relationHint?.label || 'ALLY',
                weight: Number(graphRelation.weight ?? 0.5),
                last_step: Number(graphRelation.last_step ?? 0),
            }];
        }
    }

    const keyEvents = await queryKeyEvents({
        graphRepository,
        conversationId,
        focusEntities,
        step,
        config,
    });
    const eventRetrievalNotes = keyEvents.length > 0
        ? `Retrieved ${keyEvents.length} key events from graph.`
        : 'Retrieved 0 key events from graph.';

    return {
        focus_entities: focusEntities,
        entities: focusEntities,
        candidates,
        current_relations: currentRelations,
        relation_hints: relationHints,
        key_events: keyEvents,
        event_retrieval_notes: eventRetrievalNotes,
        retrieval_notes: nonEmptyString(modelPayload?.retrieval_notes)
            || `Retrieved ${focusEntities.length} focus entities for message.`,
    };
}
