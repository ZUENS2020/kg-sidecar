import { selectModelForSlot } from '../model/modelRouter.js';
import {
    buildSlotSystemPrompt,
    compactJson,
    resolveOpenRouterSlotTimeoutMs,
    tryOpenRouterJson,
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

export async function injectMemory({ retrieverOut, userMessage, config = {}, runtime }) {
    const fallbackPacket = buildInjectionPacket(
        { focus: retrieverOut.focus_entities },
        { relations: retrieverOut.current_relations },
        { user_message: userMessage },
    );

    const routed = selectModelForSlot({ slot: 'injector', models: config?.models });
    let packet = fallbackPacket;

    if (routed.provider === 'openrouter' && runtime?.userDirectories) {
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
            }),
            '仅输出 JSON schema:',
            '{"second_person_psychology":"...","third_person_relations":"...","neutral_background":"..."}',
        ].join('\n');

        const maybePacket = await tryOpenRouterJson({
            directories: runtime.userDirectories,
            model: routed.model,
            systemPrompt,
            userMessage: userPrompt,
            temperature: routed.temperature,
            maxTokens: 700,
            timeoutMs: resolveOpenRouterSlotTimeoutMs({
                config,
                slot: 'injector',
                fallbackMs: 12000,
            }),
        }, () => null);

        packet = normalizePacket(maybePacket, fallbackPacket);
    }

    return {
        injection_packet: packet,
        token_estimate: JSON.stringify(packet).length,
    };
}
