import { selectModelForSlot } from '../model/modelRouter.js';
import {
    buildSlotSystemPrompt,
    compactJson,
    generateOpenRouterJson,
    isOpenRouterTimeoutError,
    resolveOpenRouterSlotTimeoutMs,
    resolveSlotContextWindowMessages,
} from '../model/openRouterTextClient.js';

export function buildInjectionPacket(psychology, relations, background) {
    return {
        second_person_psychology: `你当前心理线索: ${JSON.stringify(psychology)}`,
        third_person_relations: `关系网络观察: ${JSON.stringify(relations)}`,
        neutral_background: `叙事背景: ${JSON.stringify(background)}`,
    };
}

function normalizePacket(payload, fallbackPacket) {
    if (!payload || typeof payload !== 'object') {
        return fallbackPacket;
    }

    const packet = {
        second_person_psychology: String(payload.second_person_psychology || '').trim(),
        third_person_relations: String(payload.third_person_relations || '').trim(),
        neutral_background: String(payload.neutral_background || '').trim(),
    };

    if (!packet.second_person_psychology || !packet.third_person_relations || !packet.neutral_background) {
        return fallbackPacket;
    }

    return packet;
}

export async function injectMemory({ retrieverOut, userMessage, chatWindow = [], config = {}, runtime }) {
    const routed = selectModelForSlot({ slot: 'injector', models: config?.models });
    const openRouterJson = runtime?.openRouterJson || generateOpenRouterJson;
    if (routed.provider !== 'openrouter') {
        throw Object.assign(new Error('Injector is in strict mode and requires OpenRouter provider.'), {
            code: 'INJECTOR_STRICT_OPENROUTER_REQUIRED',
            stage: 'injector',
            retryable: false,
        });
    }
    if (!runtime?.userDirectories && !runtime?.openRouterJson) {
        throw Object.assign(new Error('Injector requires OpenRouter runtime and refuses local fallback.'), {
            code: 'INJECTOR_LLM_REQUIRED',
            stage: 'injector',
            retryable: false,
        });
    }

    const contextMessages = resolveSlotContextWindowMessages({
        config,
        slot: 'injector',
        fallbackCount: 80,
    });
    const systemPrompt = buildSlotSystemPrompt(
        'Injector',
        '将输入上下文转换为混合人称记忆包，严格输出 JSON 字段 second_person_psychology/third_person_relations/neutral_background。',
    );
    const userPrompt = [
        '上下文(JSON):',
        compactJson({
            focus_entities: retrieverOut.focus_entities,
            current_relations: retrieverOut.current_relations,
            relation_hints: retrieverOut.relation_hints,
            user_message: userMessage,
            chat_window: (chatWindow || []).slice(-contextMessages),
        }, 32000),
        '仅输出 JSON schema:',
        '{"second_person_psychology":"...","third_person_relations":"...","neutral_background":"..."}',
    ].join('\n');

    let maybePacket = null;
    try {
        maybePacket = await openRouterJson({
            directories: runtime.userDirectories,
            model: routed.model,
            systemPrompt,
            userMessage: userPrompt,
            temperature: routed.temperature,
            maxTokens: 1200,
            timeoutMs: resolveOpenRouterSlotTimeoutMs({
                config,
                slot: 'injector',
                fallbackMs: 18000,
            }),
        });
    } catch (error) {
        throw Object.assign(new Error(`Injector LLM call failed: ${String(error?.message || error)}`), {
            code: isOpenRouterTimeoutError(error) ? 'OPENROUTER_TIMEOUT' : 'INJECTOR_LLM_FAILED',
            stage: 'injector',
            retryable: true,
        });
    }

    const packet = normalizePacket(maybePacket, null);
    if (!packet) {
        throw Object.assign(new Error('Injector LLM returned invalid injection packet.'), {
            code: 'INJECTOR_LLM_INVALID',
            stage: 'injector',
            retryable: true,
        });
    }

    return {
        injection_packet: packet,
        token_estimate: JSON.stringify(packet).length,
    };
}
