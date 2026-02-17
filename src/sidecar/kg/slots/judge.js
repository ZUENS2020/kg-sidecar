import { selectModelForSlot } from '../model/modelRouter.js';
import {
    buildSlotSystemPrompt,
    compactJson,
    nonEmptyString,
    resolveOpenRouterSlotTimeoutMs,
    tryOpenRouterJson,
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

function normalizeJudgeModelOutput(payload, fallback) {
    if (!payload || typeof payload !== 'object') {
        return fallback;
    }

    const identityConflicts = Array.isArray(payload.identity_conflicts)
        ? payload.identity_conflicts
            .map(item => ({
                name: String(item?.name || '').trim(),
                uuids: Array.isArray(item?.uuids) ? item.uuids.map(x => String(x || '').trim()).filter(Boolean) : [],
                reason: nonEmptyString(item?.reason) || 'MODEL_FLAGGED',
            }))
            .filter(item => item.name && item.uuids.length > 1)
        : fallback.identity_conflicts;

    const bioSyncPatch = Array.isArray(payload.bio_sync_patch)
        ? payload.bio_sync_patch
            .map(item => ({
                uuid: String(item?.uuid || '').trim(),
                before: String(item?.before || '').slice(0, 500),
                after: String(item?.after || '').slice(0, 500),
                cause: String(item?.cause || '').slice(0, 500),
            }))
            .filter(item => item.uuid && item.after)
        : fallback.bio_sync_patch;

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
    debug = {},
    config = {},
    runtime,
}) {
    const routed = selectModelForSlot({ slot: 'judge', models: config?.models });
    const identityConflicts = buildIdentityConflicts(candidates);

    if (debug.forceIdentityConflict && identityConflicts.length === 0 && candidates[0]) {
        identityConflicts.push({
            name: candidates[0].name,
            uuids: candidates[0].uuids?.length > 1
                ? candidates[0].uuids
                : [candidates[0].uuids?.[0] || 'unknown_a', 'unknown_b'],
            reason: 'DEBUG_FORCED',
        });
    }

    const fallback = {
        identity_conflicts: identityConflicts,
        allowCommit: identityConflicts.length === 0,
        bio_sync_patch: buildFallbackBioSync(actions, globalAudit),
    };

    if (routed.provider !== 'openrouter' || !runtime?.userDirectories) {
        return fallback;
    }

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
            fallback,
        }),
        '仅输出 JSON schema:',
        '{"identity_conflicts":[{"name":"...","uuids":["...","..."],"reason":"..."}],"allowCommit":true,"bio_sync_patch":[{"uuid":"角色:...","before":"...","after":"...","cause":"..."}]}',
    ].join('\n');

    const modelOutput = await tryOpenRouterJson({
        directories: runtime.userDirectories,
        model: routed.model,
        systemPrompt,
        userMessage: userPrompt,
        temperature: routed.temperature,
        maxTokens: 900,
        timeoutMs: resolveOpenRouterSlotTimeoutMs({
            config,
            slot: 'judge',
            fallbackMs: 12000,
        }),
    }, () => null);

    return normalizeJudgeModelOutput(modelOutput, fallback);
}
