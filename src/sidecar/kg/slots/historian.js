import { selectModelForSlot } from '../model/modelRouter.js';
import {
    buildMilestoneName,
    resolveOpenRouterSlotTimeoutMs,
    resolveSlotContextWindowMessages,
    buildSlotSystemPrompt,
    compactJson,
    generateOpenRouterJson,
    isOpenRouterTimeoutError,
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
        return null;
    }

    const rawMilestones = Array.isArray(payload.milestones) ? payload.milestones : [];
    const milestones = rawMilestones.map(item => String(item || '').trim()).filter(Boolean);
    if (milestones.length === 0) {
        return null;
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
    const chatWindow = options?.chatWindow || [];
    const runtime = options?.runtime;
    const routed = selectModelForSlot({ slot: 'historian', models: config?.models });
    const openRouterJson = runtime?.openRouterJson || generateOpenRouterJson;

    if (actions.length === 0) {
        return fallback;
    }
    if (routed.provider !== 'openrouter') {
        throw Object.assign(new Error('Historian is in strict mode and requires OpenRouter provider.'), {
            code: 'HISTORIAN_STRICT_OPENROUTER_REQUIRED',
            stage: 'historian',
            retryable: false,
        });
    }
    if (!runtime?.userDirectories && !runtime?.openRouterJson) {
        throw Object.assign(new Error('Historian requires OpenRouter runtime and refuses local fallback.'), {
            code: 'HISTORIAN_LLM_REQUIRED',
            stage: 'historian',
            retryable: false,
        });
    }
    const contextMessages = resolveSlotContextWindowMessages({
        config,
        slot: 'historian',
        fallbackCount: 80,
    });

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
            chat_window: (chatWindow || []).slice(-contextMessages),
        }, 30000),
        '仅输出 JSON schema:',
        '{"milestones":["[剧情里程碑] ...","[剧情里程碑] ..."]}',
    ].join('\n');

    let modelOutput = null;
    try {
        modelOutput = await openRouterJson({
            directories: runtime.userDirectories,
            model: routed.model,
            systemPrompt,
            userMessage: userPrompt,
            temperature: routed.temperature,
            maxTokens: 900,
            timeoutMs: resolveOpenRouterSlotTimeoutMs({
                config,
                slot: 'historian',
                fallbackMs: 18000,
            }),
        });
    } catch (error) {
        throw Object.assign(new Error(`Historian LLM call failed: ${String(error?.message || error)}`), {
            code: isOpenRouterTimeoutError(error) ? 'OPENROUTER_TIMEOUT' : 'HISTORIAN_LLM_FAILED',
            stage: 'historian',
            retryable: true,
        });
    }

    const normalized = normalizeModelOutput(modelOutput, fallback);
    if (!normalized) {
        throw Object.assign(new Error('Historian LLM output is invalid or empty.'), {
            code: 'HISTORIAN_LLM_INVALID',
            stage: 'historian',
            retryable: true,
        });
    }

    return normalized;
}
