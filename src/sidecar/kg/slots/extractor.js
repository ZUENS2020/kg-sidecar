import { selectModelForSlot } from '../model/modelRouter.js';
import {
    buildEventName,
    buildSlotSystemPrompt,
    clampNumber,
    compactJson,
    pickAction,
    resolveOpenRouterSlotTimeoutMs,
    toSafeEvidence,
    toSafeReasoning,
    tryOpenRouterJson,
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

function normalizeModelAction(action, index, fallback) {
    const normalized = {
        action: pickAction(action?.action, fallback.action),
        from_uuid: String(action?.from_uuid || fallback.from_uuid || '').trim(),
        to_uuid: String(action?.to_uuid || fallback.to_uuid || '').trim(),
        from_name: String(action?.from_name || fallback.from_name || '').trim(),
        to_name: String(action?.to_name || fallback.to_name || '').trim(),
        old_label: String(action?.old_label || fallback.old_label || '').trim() || null,
        new_label: String(action?.new_label || fallback.new_label || '').trim() || null,
        delta_weight: action?.delta_weight == null ? fallback.delta_weight : Number(action.delta_weight),
        evidence_quote: toSafeEvidence(String(action?.evidence_quote || fallback.evidence_quote || '')),
        reasoning: toSafeReasoning(String(action?.reasoning || fallback.reasoning || '')),
        cause: String(action?.cause || fallback.cause || '').slice(0, 300),
        event_name: String(action?.event_name || fallback.event_name || '').trim(),
    };

    if (!normalized.event_name) {
        normalized.event_name = buildEventName(normalized.action, normalized.from_name, normalized.to_name);
    }

    if (!normalized.from_uuid || !normalized.to_uuid) {
        return {
            ...fallback,
            event_name: fallback.event_name || buildEventName(fallback.action, fallback.from_name, fallback.to_name),
            reasoning: `fallback_${index}`,
        };
    }

    return normalized;
}

function normalizeModelOutput(modelOutput, fallbackActions, fallbackAudit) {
    if (!modelOutput || typeof modelOutput !== 'object') {
        return { actions: fallbackActions, global_audit: fallbackAudit };
    }

    const actions = Array.isArray(modelOutput.actions) && modelOutput.actions.length > 0
        ? modelOutput.actions.map((action, index) => normalizeModelAction(action, index, fallbackActions[index] || fallbackActions[0] || {}))
        : fallbackActions;

    const globalAudit = modelOutput.global_audit && typeof modelOutput.global_audit === 'object'
        ? {
            storage_compare: Array.isArray(modelOutput.global_audit.storage_compare)
                ? modelOutput.global_audit.storage_compare
                : fallbackAudit.storage_compare,
            bio_rewrites: Array.isArray(modelOutput.global_audit.bio_rewrites)
                ? modelOutput.global_audit.bio_rewrites
                : fallbackAudit.bio_rewrites,
        }
        : fallbackAudit;

    return { actions, global_audit: globalAudit };
}

export async function extractActions({ retrieverOut, userMessage, step, config = {}, runtime }) {
    const threshold = Number(config.delete_threshold ?? 0.12);
    const decayBase = Number(config.decay_base ?? 0.98);
    const routed = selectModelForSlot({ slot: 'extractor', models: config?.models });

    const fallbackActions = buildDefaultActions({
        retrieverOut,
        userMessage,
        step,
        threshold,
        decayBase,
    });
    const fallbackAudit = buildGlobalAudit(fallbackActions);

    if (fallbackActions.length === 0) {
        return {
            actions: [],
            global_audit: fallbackAudit,
        };
    }

    if (routed.provider !== 'openrouter' || !runtime?.userDirectories) {
        return {
            actions: fallbackActions,
            global_audit: fallbackAudit,
        };
    }

    const systemPrompt = buildSlotSystemPrompt(
        'Extractor',
        '你负责三动作审计(EVOLVE/REPLACE/DELETE)。必须基于输入证据输出 actions + global_audit。',
    );
    const userPrompt = [
        '输入上下文(JSON):',
        compactJson({
            user_message: userMessage,
            step,
            threshold,
            decay_base: decayBase,
            current_relations: retrieverOut.current_relations,
            relation_hints: retrieverOut.relation_hints,
            fallback_actions: fallbackActions,
        }),
        '严格输出 JSON schema:',
        '{"actions":[{"action":"EVOLVE|REPLACE|DELETE","from_uuid":"...","to_uuid":"...","from_name":"...","to_name":"...","old_label":"...","new_label":"...","delta_weight":0.1,"evidence_quote":"...","reasoning":"...","cause":"...","event_name":"事件:..."}],"global_audit":{"storage_compare":[{"relation_key":"A->B","action":"EVOLVE|REPLACE|DELETE","conflict_with_bio":false,"note":"..."}],"bio_rewrites":[{"uuid":"角色:...","before":"...","after":"...","cause":"..."}]}}',
    ].join('\n');

    const modelOutput = await tryOpenRouterJson({
        directories: runtime.userDirectories,
        model: routed.model,
        systemPrompt,
        userMessage: userPrompt,
        temperature: routed.temperature,
        maxTokens: 1000,
        timeoutMs: resolveOpenRouterSlotTimeoutMs({
            config,
            slot: 'extractor',
            fallbackMs: 15000,
        }),
    }, () => null);

    return normalizeModelOutput(modelOutput, fallbackActions, fallbackAudit);
}
