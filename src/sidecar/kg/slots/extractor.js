import { selectModelForSlot } from '../model/modelRouter.js';
import {
    buildEventName,
    buildSlotSystemPrompt,
    clampNumber,
    compactJson,
    generateOpenRouterJson,
    isOpenRouterTimeoutError,
    pickAction,
    resolveOpenRouterSlotTimeoutMs,
    resolveSlotContextWindowMessages,
    toSafeEvidence,
    toSafeReasoning,
} from '../model/openRouterTextClient.js';

export function computeDecayedWeight(oldWeight, deltaSteps, base = 0.98) {
    return Number(oldWeight) * (Number(base) ** Number(deltaSteps));
}

export function decideAction({ currentLabel, detectedLabel, decayedWeight, threshold }) {
    if (decayedWeight < threshold) {
        return { action: 'DELETE' };
    }

    if (currentLabel !== detectedLabel) {
        return {
            action: 'REPLACE',
            old_label: currentLabel,
            new_label: detectedLabel,
        };
    }

    return { action: 'EVOLVE' };
}

function inferLabelFromMessage(message, fallbackLabel = 'ALLY') {
    const text = String(message || '');
    if (/背叛|叛徒|betray|traitor/i.test(text)) {
        return 'TRAITOR';
    }
    if (/敌对|仇|enemy|hostile|死敌/i.test(text)) {
        return 'ENEMY';
    }
    if (/导师|指导|mentor|teacher/i.test(text)) {
        return 'MENTOR';
    }
    if (/信任|支持|ally|friend/i.test(text)) {
        return 'ALLY';
    }
    return fallbackLabel;
}

function buildDefaultActions({ retrieverOut, userMessage, step, threshold, decayBase }) {
    const relation = retrieverOut.current_relations?.[0];
    if (!relation) {
        return [];
    }

    const deltaSteps = Math.max(0, Number(step || 0) - Number(relation.last_step || 0));
    const decayedWeight = computeDecayedWeight(relation.weight, deltaSteps, decayBase);
    const inferredLabel = inferLabelFromMessage(userMessage, relation.label);
    const decision = decideAction({
        currentLabel: relation.label,
        detectedLabel: inferredLabel,
        decayedWeight,
        threshold,
    });

    const confidence = inferredLabel === relation.label ? 0.7 : 0.9;
    const deltaWeight = decision.action === 'EVOLVE'
        ? clampNumber(confidence * 0.18, 0.04, 0.4, 0.12)
        : null;

    const fromName = relation.from_name || relation.from_uuid;
    const toName = relation.to_name || relation.to_uuid;

    return [{
        ...decision,
        from_uuid: relation.from_uuid,
        to_uuid: relation.to_uuid,
        from_name: fromName,
        to_name: toName,
        delta_weight: deltaWeight,
        evidence_quote: toSafeEvidence(userMessage),
        reasoning: toSafeReasoning(`Rule-based with decayedWeight=${decayedWeight.toFixed(4)}`),
        cause: decision.action === 'REPLACE'
            ? `${relation.label} -> ${inferredLabel}`
            : `decayedWeight=${decayedWeight.toFixed(4)}`,
        event_name: buildEventName(decision.action, fromName, toName),
    }];
}

function buildGlobalAudit(actions = []) {
    const storageCompare = actions.map((action) => ({
        relation_key: `${action.from_uuid}->${action.to_uuid}`,
        action: action.action,
        conflict_with_bio: false,
        note: action.action === 'REPLACE'
            ? `Relation changed from ${action.old_label || 'N/A'} to ${action.new_label || 'N/A'}`
            : 'No direct contradiction detected.',
    }));

    const bioRewrites = actions
        .filter(action => action.action === 'REPLACE')
        .map(action => ({
            uuid: action.from_uuid,
            before: `关系倾向:${action.old_label || 'UNKNOWN'}`,
            after: `关系倾向:${action.new_label || 'UNKNOWN'}`,
            cause: action.cause || action.evidence_quote || '',
        }));

    return {
        storage_compare: storageCompare,
        bio_rewrites: bioRewrites,
    };
}

function trimWrappedQuotes(text) {
    return String(text || '')
        .trim()
        .replace(/^[“"'‘’「」『』\s]+/, '')
        .replace(/[”"'‘’「」『』\s]+$/, '')
        .trim();
}

function normalizeEventNameText(value) {
    const cleaned = trimWrappedQuotes(String(value || '').replace(/^事件[:：]\s*/, ''));
    return cleaned.slice(0, 120);
}

function isTemplateEventName(value) {
    const text = String(value || '').trim();
    if (!text) {
        return true;
    }
    const normalized = text.replace(/^事件[:：]\s*/, '').trim();
    return /^(EVOLVE|REPLACE|DELETE)(?:\b|[:：-].*(?:->|→|＞))/i.test(normalized);
}

function extractEventNameFromText(text) {
    const source = String(text || '').trim();
    if (!source) {
        return '';
    }

    const namedPatterns = [
        /(?:事件(?:叫|名为|称为)|叫做|名为|称为)\s*[“"「『']?([^，。！？；;、“”"'‘’「」『』\n\r]{2,40})[”"」』']?/giu,
        /[“"「『']([^”"」』\n\r]{2,40})[”"」』']/gu,
    ];
    for (const pattern of namedPatterns) {
        let match = pattern.exec(source);
        while (match) {
            const candidate = normalizeEventNameText(match[1]);
            if (candidate && !isTemplateEventName(candidate)) {
                return candidate;
            }
            match = pattern.exec(source);
        }
    }

    return '';
}

function resolveActionEventName(action, userMessage = '') {
    const explicitRaw = String(action?.event_name || '').trim();
    const explicitNormalized = normalizeEventNameText(explicitRaw);
    if (explicitNormalized && !isTemplateEventName(explicitNormalized)) {
        return explicitNormalized;
    }

    const inferred = [
        extractEventNameFromText(action?.evidence_quote),
        extractEventNameFromText(action?.cause),
        extractEventNameFromText(action?.reasoning),
        extractEventNameFromText(userMessage),
    ].find(Boolean);
    if (inferred) {
        return inferred;
    }

    if (explicitRaw) {
        return explicitRaw.slice(0, 120);
    }

    return buildEventName(action?.action, action?.from_name, action?.to_name);
}

function normalizeModelAction(action, { userMessage = '' } = {}) {
    const normalized = {
        action: pickAction(action?.action, ''),
        from_uuid: String(action?.from_uuid || '').trim(),
        to_uuid: String(action?.to_uuid || '').trim(),
        from_name: String(action?.from_name || '').trim(),
        to_name: String(action?.to_name || '').trim(),
        old_label: String(action?.old_label || '').trim() || null,
        new_label: String(action?.new_label || '').trim() || null,
        delta_weight: action?.delta_weight == null ? null : Number(action.delta_weight),
        evidence_quote: toSafeEvidence(String(action?.evidence_quote || '')),
        reasoning: toSafeReasoning(String(action?.reasoning || '')),
        cause: String(action?.cause || '').slice(0, 300),
        event_name: resolveActionEventName(action, userMessage),
    };

    if (!normalized.event_name) {
        normalized.event_name = buildEventName(normalized.action, normalized.from_name, normalized.to_name);
    }

    if (!normalized.action || !normalized.from_uuid || !normalized.to_uuid) {
        return null;
    }

    return normalized;
}

function normalizeModelOutput(modelOutput, context = {}) {
    if (!modelOutput || typeof modelOutput !== 'object') {
        return null;
    }

    const actions = Array.isArray(modelOutput.actions) && modelOutput.actions.length > 0
        ? modelOutput.actions.map(action => normalizeModelAction(action, context)).filter(Boolean)
        : [];

    if (Array.isArray(modelOutput.actions) && modelOutput.actions.length > 0 && actions.length === 0) {
        return null;
    }

    if (!modelOutput.global_audit || typeof modelOutput.global_audit !== 'object') {
        return null;
    }
    if (!Array.isArray(modelOutput.global_audit.storage_compare) || !Array.isArray(modelOutput.global_audit.bio_rewrites)) {
        return null;
    }

    return {
        actions,
        global_audit: {
            storage_compare: modelOutput.global_audit.storage_compare,
            bio_rewrites: modelOutput.global_audit.bio_rewrites,
        },
    };
}

export async function extractActions({ retrieverOut, userMessage, chatWindow = [], step, config = {}, runtime }) {
    const threshold = Number(config.delete_threshold ?? 0.12);
    const decayBase = Number(config.decay_base ?? 0.98);
    const routed = selectModelForSlot({ slot: 'extractor', models: config?.models });
    const openRouterJson = runtime?.openRouterJson || generateOpenRouterJson;
    if (routed.provider !== 'openrouter') {
        throw Object.assign(new Error('Extractor is in strict mode and requires OpenRouter provider.'), {
            code: 'EXTRACTOR_STRICT_OPENROUTER_REQUIRED',
            stage: 'extractor',
            retryable: false,
        });
    }
    if (!runtime?.userDirectories && !runtime?.openRouterJson) {
        throw Object.assign(new Error('Extractor requires OpenRouter runtime and refuses local fallback.'), {
            code: 'EXTRACTOR_LLM_REQUIRED',
            stage: 'extractor',
            retryable: false,
        });
    }

    const guidanceActions = buildDefaultActions({
        retrieverOut,
        userMessage,
        step,
        threshold,
        decayBase,
    });
    const guidanceAudit = buildGlobalAudit(guidanceActions);
    const contextMessages = resolveSlotContextWindowMessages({
        config,
        slot: 'extractor',
        fallbackCount: 80,
    });

    const systemPrompt = buildSlotSystemPrompt(
        'Extractor',
        '你负责三动作审计(EVOLVE/REPLACE/DELETE)。必须基于输入证据输出 actions + global_audit；输出不可为空对象。',
    );
    const userPrompt = [
        '输入上下文(JSON):',
        compactJson({
            user_message: userMessage,
            chat_window: (chatWindow || []).slice(-contextMessages),
            step,
            threshold,
            decay_base: decayBase,
            current_relations: retrieverOut.current_relations,
            relation_hints: retrieverOut.relation_hints,
            focus_entities: retrieverOut.focus_entities,
            guidance_actions: guidanceActions,
            guidance_global_audit: guidanceAudit,
        }, 42000),
        '严格输出 JSON schema:',
        '{"actions":[{"action":"EVOLVE|REPLACE|DELETE","from_uuid":"...","to_uuid":"...","from_name":"...","to_name":"...","old_label":"...","new_label":"...","delta_weight":0.1,"evidence_quote":"...","reasoning":"...","cause":"...","event_name":"事件:..."}],"global_audit":{"storage_compare":[{"relation_key":"A->B","action":"EVOLVE|REPLACE|DELETE","conflict_with_bio":false,"note":"..."}],"bio_rewrites":[{"uuid":"角色:...","before":"...","after":"...","cause":"..."}]}}',
    ].join('\n');

    let modelOutput = null;
    try {
        modelOutput = await openRouterJson({
            directories: runtime.userDirectories,
            model: routed.model,
            systemPrompt,
            userMessage: userPrompt,
            temperature: routed.temperature,
            maxTokens: 1800,
            timeoutMs: resolveOpenRouterSlotTimeoutMs({
                config,
                slot: 'extractor',
                fallbackMs: 22000,
            }),
        });
    } catch (error) {
        throw Object.assign(new Error(`Extractor LLM call failed: ${String(error?.message || error)}`), {
            code: isOpenRouterTimeoutError(error) ? 'OPENROUTER_TIMEOUT' : 'EXTRACTOR_LLM_FAILED',
            stage: 'extractor',
            retryable: true,
        });
    }

    const normalized = normalizeModelOutput(modelOutput, { userMessage });
    if (!normalized) {
        throw Object.assign(new Error('Extractor LLM output is invalid or incomplete.'), {
            code: 'EXTRACTOR_LLM_INVALID',
            stage: 'extractor',
            retryable: true,
        });
    }

    return normalized;
}
