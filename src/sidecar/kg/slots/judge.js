import { selectModelForSlot } from '../model/modelRouter.js';
import {
    buildSlotSystemPrompt,
    compactJson,
    generateOpenRouterJson,
    isOpenRouterTimeoutError,
    nonEmptyString,
    resolveOpenRouterSlotTimeoutMs,
    resolveSlotContextWindowMessages,
} from '../model/openRouterTextClient.js';

function buildIdentityConflicts(candidates = []) {
    return candidates
        .filter(candidate => (candidate?.uuids?.length || 0) > 1)
        .map(candidate => ({
            name: candidate.name,
            uuids: candidate.uuids,
            reason: 'MULTI_UUID_CANDIDATE',
        }));
}

function buildFallbackBioSync(actions = [], globalAudit = {}) {
    const fromAudit = Array.isArray(globalAudit?.bio_rewrites) ? globalAudit.bio_rewrites : [];
    if (fromAudit.length > 0) {
        return fromAudit.map(item => ({
            uuid: String(item.uuid || '').trim(),
            before: String(item.before || '').slice(0, 500),
            after: String(item.after || '').slice(0, 500),
            cause: String(item.cause || '').slice(0, 500),
        })).filter(item => item.uuid && item.after);
    }

    return actions
        .filter(action => action.action === 'REPLACE')
        .map(action => ({
            uuid: action.from_uuid,
            before: `关系倾向:${action.old_label || 'UNKNOWN'}`,
            after: `关系倾向:${action.new_label || 'UNKNOWN'}`,
            cause: `${action.action}@${action.evidence_quote || ''}`.slice(0, 500),
        }));
}

function normalizeJudgeModelOutput(payload) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const identityConflicts = Array.isArray(payload.identity_conflicts)
        ? payload.identity_conflicts
            .map(item => ({
                name: String(item?.name || '').trim(),
                uuids: Array.isArray(item?.uuids) ? item.uuids.map(x => String(x || '').trim()).filter(Boolean) : [],
                reason: nonEmptyString(item?.reason) || 'MODEL_FLAGGED',
            }))
            .filter(item => item.name && item.uuids.length > 1)
        : null;

    const bioSyncPatch = Array.isArray(payload.bio_sync_patch)
        ? payload.bio_sync_patch
            .map(item => ({
                uuid: String(item?.uuid || '').trim(),
                before: String(item?.before || '').slice(0, 500),
                after: String(item?.after || '').slice(0, 500),
                cause: String(item?.cause || '').slice(0, 500),
            }))
            .filter(item => item.uuid && item.after)
        : null;

    if (!identityConflicts || !bioSyncPatch) {
        return null;
    }

    const allowCommit = payload.allowCommit == null
        ? identityConflicts.length === 0
        : Boolean(payload.allowCommit) && identityConflicts.length === 0;

    return {
        identity_conflicts: identityConflicts,
        allowCommit,
        bio_sync_patch: bioSyncPatch,
    };
}

export async function judgeMutations({
    candidates = [],
    actions = [],
    globalAudit = {},
    chatWindow = [],
    debug = {},
    config = {},
    runtime,
}) {
    const routed = selectModelForSlot({ slot: 'judge', models: config?.models });
    const openRouterJson = runtime?.openRouterJson || generateOpenRouterJson;
    if (routed.provider !== 'openrouter') {
        throw Object.assign(new Error('Judge is in strict mode and requires OpenRouter provider.'), {
            code: 'JUDGE_STRICT_OPENROUTER_REQUIRED',
            stage: 'judge',
            retryable: false,
        });
    }
    if (!runtime?.userDirectories && !runtime?.openRouterJson) {
        throw Object.assign(new Error('Judge requires OpenRouter runtime and refuses local fallback.'), {
            code: 'JUDGE_LLM_REQUIRED',
            stage: 'judge',
            retryable: false,
        });
    }
    const detectedConflictCandidates = buildIdentityConflicts(candidates);
    const guidanceBioSyncPatch = buildFallbackBioSync(actions, globalAudit);
    const contextMessages = resolveSlotContextWindowMessages({
        config,
        slot: 'judge',
        fallbackCount: 80,
    });

    const systemPrompt = buildSlotSystemPrompt(
        'Judge',
        '执行身份对齐与 Bio 同步审计。若发现同名污染，必须输出 identity_conflicts 并阻断提交。',
    );
    const userPrompt = [
        '输入上下文(JSON):',
        compactJson({
            candidates,
            actions,
            global_audit: globalAudit,
            chat_window: (chatWindow || []).slice(-contextMessages),
            detected_conflict_candidates: detectedConflictCandidates,
            guidance_bio_sync_patch: guidanceBioSyncPatch,
        }, 36000),
        '仅输出 JSON schema:',
        '{"identity_conflicts":[{"name":"...","uuids":["...","..."],"reason":"..."}],"allowCommit":true,"bio_sync_patch":[{"uuid":"角色:...","before":"...","after":"...","cause":"..."}]}',
    ].join('\n');

    let modelOutput = null;
    try {
        modelOutput = await openRouterJson({
            directories: runtime.userDirectories,
            model: routed.model,
            systemPrompt,
            userMessage: userPrompt,
            temperature: routed.temperature,
            maxTokens: 1400,
            timeoutMs: resolveOpenRouterSlotTimeoutMs({
                config,
                slot: 'judge',
                fallbackMs: 20000,
            }),
        });
    } catch (error) {
        throw Object.assign(new Error(`Judge LLM call failed: ${String(error?.message || error)}`), {
            code: isOpenRouterTimeoutError(error) ? 'OPENROUTER_TIMEOUT' : 'JUDGE_LLM_FAILED',
            stage: 'judge',
            retryable: true,
        });
    }

    const normalized = normalizeJudgeModelOutput(modelOutput);
    if (!normalized) {
        throw Object.assign(new Error('Judge LLM output is invalid or incomplete.'), {
            code: 'JUDGE_LLM_INVALID',
            stage: 'judge',
            retryable: true,
        });
    }

    if (debug.forceIdentityConflict && normalized.identity_conflicts.length === 0 && candidates[0]) {
        normalized.identity_conflicts.push({
            name: candidates[0].name,
            uuids: candidates[0].uuids?.length > 1
                ? candidates[0].uuids
                : [candidates[0].uuids?.[0] || 'unknown_a', 'unknown_b'],
            reason: 'DEBUG_FORCED',
        });
        normalized.allowCommit = false;
    }

    return normalized;
}
