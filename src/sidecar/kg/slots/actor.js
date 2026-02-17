import { selectModelForSlot } from '../model/modelRouter.js';
import { generateOpenRouterReply, isOpenRouterTimeoutError, resolveOpenRouterSlotTimeoutMs } from '../model/openRouterTextClient.js';

function buildSystemPrompt(injectionOut) {
    const packet = injectionOut?.injection_packet || {};
    return [
        '你是剧情角色助手，需要在保证连贯叙事的前提下回复用户。',
        '严格区分人物实体与事件实体。',
        '当用户问“谁/哪些人/人物”时，只返回人物实体，不得把事件名称当成人物。',
        '当用户问“什么事件/发生了什么/回顾事件”时，再返回事件实体。',
        '[Second Person Psychology]',
        packet.second_person_psychology || '',
        '[Third Person Relations]',
        packet.third_person_relations || '',
        '[Neutral Background]',
        packet.neutral_background || '',
        '[Event Evidence Context]',
        packet.event_evidence_context || '',
    ].join('\n');
}

export async function generateAssistantReply({ userMessage, injectionOut, modelConfig, runtime }) {
    const routed = selectModelForSlot({ slot: 'actor', models: modelConfig?.models });
    const openRouterReply = runtime?.openRouterReply || generateOpenRouterReply;

    if (routed.provider !== 'openrouter') {
        throw Object.assign(new Error('Actor is in strict mode and requires OpenRouter provider.'), {
            code: 'ACTOR_STRICT_OPENROUTER_REQUIRED',
            stage: 'actor',
            retryable: false,
        });
    }

    if (!runtime?.userDirectories && !runtime?.openRouterReply) {
        throw Object.assign(new Error('Actor requires OpenRouter runtime and refuses local fallback.'), {
            code: 'ACTOR_LLM_REQUIRED',
            stage: 'actor',
            retryable: false,
        });
    }

    try {
        return await openRouterReply({
            directories: runtime?.userDirectories,
            model: routed.model,
            systemPrompt: buildSystemPrompt(injectionOut),
            userMessage,
            temperature: routed.temperature,
            maxTokens: 400,
            timeoutMs: resolveOpenRouterSlotTimeoutMs({
                config: modelConfig,
                slot: 'actor',
                fallbackMs: 12000,
            }),
        });
    } catch (error) {
        throw Object.assign(new Error(`Actor LLM call failed: ${String(error?.message || error)}`), {
            code: isOpenRouterTimeoutError(error) ? 'OPENROUTER_TIMEOUT' : 'ACTOR_LLM_FAILED',
            stage: 'actor',
            retryable: true,
        });
    }
}
