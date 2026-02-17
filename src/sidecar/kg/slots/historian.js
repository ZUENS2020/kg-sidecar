import { selectModelForSlot } from '../model/modelRouter.js';
import {
    buildMilestoneName,
    resolveOpenRouterSlotTimeoutMs,
    buildSlotSystemPrompt,
    compactJson,
    tryOpenRouterJson,
} from '../model/openRouterTextClient.js';

function fallbackMilestoneText(action) {
    if (action.action === 'REPLACE') {
        return `[剧情里程碑] ${action.old_label || '旧关系'} -> ${action.new_label || '新关系'}`;
    }

    if (action.action === 'DELETE') {
        return '[剧情里程碑] 关系线终结';
    }

    return '[剧情里程碑] 关系线持续演进';
}

function buildFallback(actions = [], turnId = '') {
    const milestones = actions.map(fallbackMilestoneText);
    return {
        turn_id: turnId,
        milestones,
        timeline_items: milestones.map((tag, index) => ({
            id: buildMilestoneName(turnId, index, tag),
            tag,
        })),
    };
}

function normalizeModelOutput(payload, fallback) {
    if (!payload || typeof payload !== 'object') {
        return fallback;
    }

    const rawMilestones = Array.isArray(payload.milestones) ? payload.milestones : fallback.milestones;
    const milestones = rawMilestones.map(item => String(item || '').trim()).filter(Boolean);
    if (milestones.length === 0) {
        return fallback;
    }

    return {
        turn_id: fallback.turn_id,
        milestones,
        timeline_items: milestones.map((tag, index) => ({
            id: buildMilestoneName(fallback.turn_id, index, tag),
            tag,
        })),
    };
}

export async function buildMilestones(actions = [], turnId = '', options = {}) {
    const fallback = buildFallback(actions, turnId);
    const config = options?.config || {};
    const runtime = options?.runtime;
    const routed = selectModelForSlot({ slot: 'historian', models: config?.models });

    if (routed.provider !== 'openrouter' || !runtime?.userDirectories || actions.length === 0) {
        return fallback;
    }

    const systemPrompt = buildSlotSystemPrompt(
        'Historian',
        '请根据动作列表输出剧情里程碑摘要，必须以 [剧情里程碑] 开头，简洁且按时间顺序。',
    );
    const userPrompt = [
        '输入上下文(JSON):',
        compactJson({
            turn_id: turnId,
            actions,
            global_audit: options?.globalAudit || {},
        }),
        '仅输出 JSON schema:',
        '{"milestones":["[剧情里程碑] ...","[剧情里程碑] ..."]}',
    ].join('\n');

    const modelOutput = await tryOpenRouterJson({
        directories: runtime.userDirectories,
        model: routed.model,
        systemPrompt,
        userMessage: userPrompt,
        temperature: routed.temperature,
        maxTokens: 600,
        timeoutMs: resolveOpenRouterSlotTimeoutMs({
            config,
            slot: 'historian',
            fallbackMs: 10000,
        }),
    }, () => null);

    return normalizeModelOutput(modelOutput, fallback);
}
