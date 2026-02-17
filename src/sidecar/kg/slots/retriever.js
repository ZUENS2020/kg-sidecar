import { selectModelForSlot } from '../model/modelRouter.js';
import {
    buildSlotSystemPrompt,
    compactJson,
    nonEmptyString,
    resolveOpenRouterSlotTimeoutMs,
    toReadableEntityId,
    tryOpenRouterJson,
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

const LATIN_STOPWORDS = new Set([
    'the',
    'and',
    'with',
    'from',
    'this',
    'that',
    'still',
    'again',
    'trusts',
    'supports',
    'continues',
    'enemy',
    'ally',
    'mentor',
    'traitor',
]);

function sanitizeName(name) {
    return String(name || '').trim().slice(0, 80);
}

function isGenericEntityName(name) {
    const key = sanitizeName(name).toLowerCase();
    return key ? GENERIC_ENTITY_NAMES.has(key) : true;
}

function uniqByName(items) {
    const out = [];
    const seen = new Set();
    for (const item of items) {
        const name = sanitizeName(item);
        if (!name) {
            continue;
        }

        const key = name.toLowerCase();
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        out.push(name);
    }
    return out;
}

function collectNamesFromText(text) {
    const content = String(text || '');
    const hanChunks = content.match(/[\p{Script=Han}]{2,8}/gu) || [];
    const latinChunks = content.match(/\b[A-Za-z][A-Za-z0-9_-]{1,20}\b/g) || [];

    const latinNames = latinChunks.filter((token) => {
        const normalized = token.toLowerCase();
        if (LATIN_STOPWORDS.has(normalized) || isGenericEntityName(normalized)) {
            return false;
        }
        return /^[A-Z]/.test(token);
    });

    return uniqByName([...hanChunks, ...latinNames]).filter(name => !isGenericEntityName(name));
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

function buildFallbackFocus({ userMessage, chatWindow }) {
    const fromWindow = (chatWindow || []).map(item => sanitizeName(item?.name)).filter(Boolean);
    const fromWindowFiltered = fromWindow.filter(name => !isGenericEntityName(name));
    const fromHistoryText = collectNamesFromText(
        (chatWindow || [])
            .filter(item => !item?.role || String(item.role).toLowerCase() === 'user')
            .map(item => String(item?.text || ''))
            .join(' '),
    );
    const fromMessage = collectNamesFromText(userMessage);
    const names = uniqByName([...fromMessage, ...fromWindowFiltered, ...fromHistoryText]);
    const fallbackNames = names.length >= 2 ? names : uniqByName([...names, ...fromWindow]);
    return fallbackNames
        .map(name => toEntity(name))
        .filter(Boolean)
        .slice(0, 6);
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

export async function retrieveEntities({
    userMessage,
    chatWindow,
    debug = {},
    config = {},
    runtime,
    graphRepository,
    conversationId,
}) {
    const routed = selectModelForSlot({ slot: 'retriever', models: config?.models });
    const llmRetriever = routed.provider === 'openrouter';
    const fallbackFocus = buildFallbackFocus({ userMessage, chatWindow });
    const openRouterJson = runtime?.openRouterJson || tryOpenRouterJson;

    let modelPayload = null;
    if (llmRetriever && !runtime?.userDirectories) {
        throw Object.assign(new Error('Retriever requires LLM runtime (OpenRouter) and refuses local fallback.'), {
            code: 'RETRIEVER_LLM_REQUIRED',
            stage: 'retriever',
            retryable: false,
        });
    }

    if (llmRetriever && runtime?.userDirectories) {
        const systemPrompt = buildSlotSystemPrompt(
            'Retriever',
            '识别本轮关键实体，输出 focus_entities 与 relation_hints。实体需要用真实称谓，不要创造不存在的人名。',
        );
        const userPrompt = [
            '输入上下文(JSON):',
            compactJson({
                user_message: userMessage,
                chat_window: (chatWindow || []).slice(-20),
            }),
            '输出 JSON schema:',
            '{"focus_entities":[{"name":"角色名"}],"relation_hints":[{"from_name":"A","to_name":"B","label":"ALLY|TRAITOR|ENEMY|MENTOR","confidence":0.0}],"retrieval_notes":"..."}',
        ].join('\n');

        const maybePayload = await openRouterJson({
            directories: runtime.userDirectories,
            model: routed.model,
            systemPrompt,
            userMessage: userPrompt,
            temperature: routed.temperature,
            maxTokens: 700,
            timeoutMs: resolveOpenRouterSlotTimeoutMs({
                config,
                slot: 'retriever',
                fallbackMs: 18000,
            }),
        }, () => null);

        if (maybePayload && typeof maybePayload === 'object') {
            modelPayload = maybePayload;
        }

        if (!modelPayload) {
            throw Object.assign(new Error('Retriever LLM call failed; no local fallback allowed for OpenRouter retriever.'), {
                code: 'RETRIEVER_LLM_FAILED',
                stage: 'retriever',
                retryable: true,
            });
        }
    }

    const relationHints = Array.isArray(modelPayload?.relation_hints)
        ? modelPayload.relation_hints.slice(0, 4)
        : [];
    const modelFocus = normalizeModelFocus(modelPayload, []);
    if (llmRetriever && modelFocus.length === 0) {
        throw Object.assign(new Error('Retriever LLM produced empty focus_entities; turn rejected.'), {
            code: 'RETRIEVER_LLM_EMPTY',
            stage: 'retriever',
            retryable: true,
        });
    }
    const focusEntities = mergeFocusEntities({
        modelFocus,
        relationHints,
        fallbackFocus: llmRetriever ? [] : fallbackFocus,
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

    return {
        focus_entities: focusEntities,
        entities: focusEntities,
        candidates,
        current_relations: currentRelations,
        relation_hints: relationHints,
        retrieval_notes: nonEmptyString(modelPayload?.retrieval_notes)
            || `Retrieved ${focusEntities.length} focus entities for message.`,
    };
}
