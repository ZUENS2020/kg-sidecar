import fetch from 'node-fetch';
import { OPENROUTER_HEADERS } from '../../../constants.js';

const OPENROUTER_CHAT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

function normalizeContent(content) {
    if (typeof content === 'string') {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map(item => {
                if (typeof item === 'string') {
                    return item;
                }

                if (item && typeof item === 'object' && 'text' in item) {
                    return String(item.text || '');
                }

                return '';
            })
            .join('\n')
            .trim();
    }

    return '';
}

function stripCodeFence(text) {
    const raw = String(text || '').trim();
    if (!raw.startsWith('```')) {
        return raw;
    }

    return raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function parseMaybeJson(text) {
    const cleaned = stripCodeFence(text);
    return JSON.parse(cleaned);
}

export async function callOpenRouter({
    directories,
    model,
    messages,
    temperature = 0.7,
    maxTokens = 400,
    timeoutMs = 35000,
}) {
    if (!directories) {
        throw new Error('Missing user directories for secret lookup.');
    }

    const { readSecret, SECRET_KEYS } = await import('../../../endpoints/secrets.js');
    const apiKey = readSecret(directories, SECRET_KEYS.OPENROUTER);
    if (!apiKey) {
        throw new Error('OpenRouter API key not found.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 35000));
    let response;
    try {
        response = await fetch(OPENROUTER_CHAT_ENDPOINT, {
            method: 'POST',
            headers: {
                ...OPENROUTER_HEADERS,
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: model || 'openrouter/auto',
                temperature,
                max_tokens: maxTokens,
                messages: Array.isArray(messages) && messages.length > 0
                    ? messages
                    : [{ role: 'user', content: '' }],
            }),
            signal: controller.signal,
        });
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error(`OpenRouter request timed out after ${Math.max(1000, Number(timeoutMs) || 35000)} ms`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenRouter request failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    const content = normalizeContent(data?.choices?.[0]?.message?.content);
    if (!content) {
        throw new Error('OpenRouter returned empty content.');
    }

    return {
        content,
        provider: data?.provider || null,
        model: data?.model || null,
        usage: data?.usage || null,
    };
}

export async function generateOpenRouterReply({
    directories,
    model,
    systemPrompt,
    userMessage,
    temperature = 0.7,
    maxTokens = 400,
    timeoutMs = 35000,
}) {
    const out = await callOpenRouter({
        directories,
        model,
        temperature,
        maxTokens,
        timeoutMs,
        messages: [
            {
                role: 'system',
                content: systemPrompt || 'You are a helpful assistant.',
            },
            {
                role: 'user',
                content: userMessage || '',
            },
        ],
    });

    return out.content;
}

export async function generateOpenRouterJson({
    directories,
    model,
    systemPrompt,
    userMessage,
    temperature = 0.2,
    maxTokens = 700,
    timeoutMs = 35000,
}) {
    const out = await callOpenRouter({
        directories,
        model,
        temperature,
        maxTokens,
        timeoutMs,
        messages: [
            {
                role: 'system',
                content: `${systemPrompt || ''}\n请仅输出 JSON，不要输出其它文本。`,
            },
            {
                role: 'user',
                content: userMessage || '',
            },
        ],
    });

    try {
        return parseMaybeJson(out.content);
    } catch (error) {
        throw new Error(`OpenRouter JSON parse failed: ${error.message}`);
    }
}

export async function tryOpenRouterJson(input, fallbackFactory) {
    try {
        return await generateOpenRouterJson(input);
    } catch (error) {
        if (String(error?.message || '').toLowerCase().includes('timed out')) {
            throw Object.assign(new Error(String(error.message || 'OpenRouter timeout')), {
                code: 'OPENROUTER_TIMEOUT',
                retryable: true,
            });
        }
        console.warn('KG Sidecar OpenRouter JSON fallback:', error?.message || error);
        return fallbackFactory();
    }
}

export async function tryOpenRouterReply(input, fallbackFactory) {
    try {
        return await generateOpenRouterReply(input);
    } catch (error) {
        if (String(error?.message || '').toLowerCase().includes('timed out')) {
            throw Object.assign(new Error(String(error.message || 'OpenRouter timeout')), {
                code: 'OPENROUTER_TIMEOUT',
                retryable: true,
            });
        }
        console.warn('KG Sidecar OpenRouter reply fallback:', error?.message || error);
        return fallbackFactory();
    }
}

export function compactJson(value, maxChars = 5000) {
    const text = JSON.stringify(value);
    if (text.length <= maxChars) {
        return text;
    }

    return `${text.slice(0, maxChars)}...`;
}

export function buildSlotSystemPrompt(slotName, instructions) {
    return [
        `你是知识图谱流水线中的 ${slotName} 槽位。`,
        '输出必须保持稳定、可机读、避免幻觉。',
        instructions || '',
    ].join('\n');
}

export function normalizeEntityName(name) {
    return String(name || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 80);
}

export function readableEventId(prefix, turnId, index) {
    return `${prefix}:${turnId}:${index + 1}`;
}

export function readableNameToKey(name) {
    return String(name || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^\p{L}\p{N}_-]/gu, '')
        .slice(0, 80);
}

export function toReadableEntityId(name) {
    const normalized = normalizeEntityName(name);
    const key = readableNameToKey(normalized);
    return key ? `角色:${key}` : '';
}

export function fromReadableEntityId(entityId) {
    return String(entityId || '').replace(/^角色:/, '').replace(/_/g, ' ').trim();
}

export function relationHintKey(fromUuid, toUuid) {
    return `${fromUuid}->${toUuid}`;
}

export function asArray(value) {
    return Array.isArray(value) ? value : [];
}

export function nonEmptyString(value) {
    const text = String(value || '').trim();
    return text.length > 0 ? text : '';
}

export function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, num));
}

export function maybeBool(value) {
    return Boolean(value);
}

export function pickString(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
}

export function pickAction(value, fallback = 'EVOLVE') {
    const action = String(value || '').toUpperCase();
    if (['EVOLVE', 'REPLACE', 'DELETE'].includes(action)) {
        return action;
    }

    return fallback;
}

export function takeFirstN(items, n) {
    return asArray(items).slice(0, n);
}

export function nowIso() {
    return new Date().toISOString();
}

export function withDefault(objectLike, fallback) {
    if (objectLike && typeof objectLike === 'object') {
        return objectLike;
    }

    return fallback;
}

export function normalizeSlotModel(routedModel, fallbackModel = 'openrouter/auto') {
    return {
        provider: pickString(routedModel?.provider, 'builtin'),
        model: pickString(routedModel?.model, fallbackModel),
        temperature: clampNumber(routedModel?.temperature, 0, 2, 0.2),
    };
}

export function resolveOpenRouterSlotTimeoutMs({ config = {}, slot = '', fallbackMs = 35000 } = {}) {
    const perSlot = Number(config?.slot_timeouts_ms?.[slot]);
    const globalTimeout = Number(config?.openrouter_timeout_ms ?? config?.timeout_ms);

    let selected = fallbackMs;
    if (Number.isFinite(perSlot) && perSlot > 0) {
        selected = perSlot;
    } else if (Number.isFinite(globalTimeout) && globalTimeout > 0) {
        selected = globalTimeout;
    }

    return Math.max(1000, Math.floor(Number(selected) || Number(fallbackMs) || 35000));
}

export function toSafeEvidence(text) {
    return String(text || '').slice(0, 200);
}

export function toSafeReasoning(text) {
    return String(text || '').slice(0, 300);
}

export function actionIsReplace(action) {
    return String(action || '').toUpperCase() === 'REPLACE';
}

export function actionIsDelete(action) {
    return String(action || '').toUpperCase() === 'DELETE';
}

export function actionIsEvolve(action) {
    return String(action || '').toUpperCase() === 'EVOLVE';
}

export function maybeParseJson(text) {
    try {
        return parseMaybeJson(text);
    } catch {
        return null;
    }
}

export function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function sanitizeMilestoneText(value) {
    return String(value || '').trim().slice(0, 180);
}

export function buildEventName(action, fromName, toName) {
    const a = pickAction(action);
    return `事件:${a}:${fromName || 'Unknown'}→${toName || 'Unknown'}`;
}

export function buildMilestoneName(turnId, index, content) {
    return `里程碑:${turnId}:${index + 1}:${sanitizeMilestoneText(content)}`;
}

export function toDebugSummary(routedModel, providerModel) {
    return `${pickString(routedModel?.provider)}/${pickString(routedModel?.model)} => ${pickString(providerModel)}`;
}
