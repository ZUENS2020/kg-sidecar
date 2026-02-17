import { selectModelForSlot } from '../model/modelRouter.js';

function buildSystemPrompt(injectionOut) {
    const packet = injectionOut?.injection_packet || {};
    return [
        '你是剧情角色助手，需要在保证连贯叙事的前提下回复用户。',
        '[Second Person Psychology]',
        packet.second_person_psychology || '',
        '[Third Person Relations]',
        packet.third_person_relations || '',
        '[Neutral Background]',
        packet.neutral_background || '',
    ].join('\n');
}

export async function generateAssistantReply({ userMessage, injectionOut, modelConfig, runtime }) {
    const summary = injectionOut?.injection_packet?.third_person_relations || '';
    const routed = selectModelForSlot({ slot: 'actor', models: modelConfig?.models });

    if (routed.provider === 'openrouter' && runtime?.userDirectories) {
        try {
            const {
                generateOpenRouterReply,
                resolveOpenRouterSlotTimeoutMs,
            } = await import('../model/openRouterTextClient.js');
            return await generateOpenRouterReply({
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
            console.warn('KG Sidecar actor OpenRouter fallback to builtin:', error?.message || error);
        }
    }

    return `已接收你的输入：${userMessage}\n（图谱上下文）${summary}\n（模型路由）${routed.provider}/${routed.model}`;
}
