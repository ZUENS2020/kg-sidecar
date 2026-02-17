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
        event_evidence_context: '',
    };
}

function resolveEvidenceBudget(config) {
    const contextMessages = Number(config?.context_window_messages);
    const base = Number.isFinite(contextMessages) && contextMessages > 0
        ? contextMessages * 30
        : 1200;
    return Math.max(400, Math.min(2400, Math.floor(base)));
}

function buildEventEvidenceContext(keyEvents, budgetChars) {
    const events = Array.isArray(keyEvents) ? keyEvents : [];
    if (events.length === 0) {
        return '关键事件证据: 暂无';
    }

    const peopleSet = new Set();
    const eventSet = new Set();
    for (const event of events) {
        const eventId = String(event?.event_id || '').trim();
        if (eventId) {
            eventSet.add(eventId);
        }
        for (const participant of (Array.isArray(event?.participants) ? event.participants : [])) {
            const pid = String(participant?.id || participant?.uuid || '').trim();
            if (pid) {
                peopleSet.add(pid);
            }
        }
    }

    const peopleSummary = peopleSet.size > 0 ? Array.from(peopleSet).slice(0, 8).join(', ') : '暂无';
    const eventSummary = eventSet.size > 0 ? Array.from(eventSet).slice(0, 8).join(', ') : '暂无';
    const lines = [
        '关键事件证据:',
        `- 人物实体: ${peopleSummary}`,
        `- 事件实体: ${eventSummary}`,
    ];
    let used = lines.join('\n').length;
    for (const event of events) {
        const participants = Array.isArray(event?.participants)
            ? event.participants
                .map(x => String(x?.id || x?.uuid || '').trim())
                .filter(Boolean)
                .slice(0, 4)
                .join(', ')
            : '';
        const line = `- [${String(event?.action || 'EVOLVE')}] 事件=${String(event?.event_id || '').trim()} @turn ${String(event?.turn_id || '').trim()} | 人物=${participants || '未知'} | 证据=${String(event?.evidence_quote || '').trim()}`;
        if (!line.trim()) {
            continue;
        }
        if (used + line.length + 1 > budgetChars) {
            break;
        }
        lines.push(line);
        used += line.length + 1;
    }

    return lines.join('\n');
}

function normalizePacket(payload, fallbackEvidenceContext) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const packet = {
        second_person_psychology: String(payload.second_person_psychology || '').trim(),
        third_person_relations: String(payload.third_person_relations || '').trim(),
        neutral_background: String(payload.neutral_background || '').trim(),
        event_evidence_context: String(payload.event_evidence_context || '').trim(),
    };

    if (!packet.second_person_psychology || !packet.third_person_relations || !packet.neutral_background) {
        return null;
    }

    if (!packet.event_evidence_context) {
        packet.event_evidence_context = fallbackEvidenceContext;
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
        '将输入上下文转换为混合人称记忆包，严格输出 JSON 字段 second_person_psychology/third_person_relations/neutral_background/event_evidence_context。',
    );
    const evidenceBudget = resolveEvidenceBudget(config);
    const eventEvidenceContext = buildEventEvidenceContext(retrieverOut?.key_events, evidenceBudget);
    const userPrompt = [
        '上下文(JSON):',
        compactJson({
            focus_entities: retrieverOut.focus_entities,
            current_relations: retrieverOut.current_relations,
            relation_hints: retrieverOut.relation_hints,
            key_events: retrieverOut.key_events,
            event_retrieval_notes: retrieverOut.event_retrieval_notes,
            event_evidence_context: eventEvidenceContext,
            user_message: userMessage,
            chat_window: (chatWindow || []).slice(-contextMessages),
        }, 32000),
        '仅输出 JSON schema:',
        '{"second_person_psychology":"...","third_person_relations":"...","neutral_background":"...","event_evidence_context":"..."}',
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

    const packet = normalizePacket(maybePacket, eventEvidenceContext);
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
