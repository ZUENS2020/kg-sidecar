import {
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    getRequestHeaders,
    saveSettingsDebounced,
    setExtensionPrompt,
} from '../../../script.js';
import {
    extension_settings,
    getContext,
    renderExtensionTemplateAsync,
} from '../../extensions.js';
import {
    chat_completion_sources,
    oai_settings,
} from '../../openai.js';

const MODULE_NAME = 'kg-sidecar';
const PROMPT_TAG = '6_kg_sidecar';
const CHAT_COMPLETIONS_STATUS_ENDPOINT = '/api/backends/chat-completions/status';
const CLEAR_DB_ENDPOINT = '/api/kg-sidecar/db/clear';
const ALL_SLOT_KEYS = ['retriever', 'injector', 'actor', 'extractor', 'judge', 'historian'];
const CONFIGURABLE_SLOT_KEYS = ['retriever', 'injector', 'extractor', 'judge', 'historian'];
const SLOT_LABELS = {
    retriever: 'Retriever',
    injector: 'Injector',
    actor: 'Actor',
    extractor: 'Extractor',
    judge: 'Judge',
    historian: 'Historian',
};
const PROVIDER_LABELS = {
    [chat_completion_sources.OPENAI]: 'OpenAI',
    [chat_completion_sources.CLAUDE]: 'Claude',
    [chat_completion_sources.OPENROUTER]: 'OpenRouter',
    [chat_completion_sources.AI21]: 'AI21',
    [chat_completion_sources.MAKERSUITE]: 'Google AI Studio',
    [chat_completion_sources.VERTEXAI]: 'Vertex AI',
    [chat_completion_sources.MISTRALAI]: 'MistralAI',
    [chat_completion_sources.CUSTOM]: 'Custom',
    [chat_completion_sources.COHERE]: 'Cohere',
    [chat_completion_sources.PERPLEXITY]: 'Perplexity',
    [chat_completion_sources.GROQ]: 'Groq',
    [chat_completion_sources.ELECTRONHUB]: 'ElectronHub',
    [chat_completion_sources.CHUTES]: 'Chutes',
    [chat_completion_sources.NANOGPT]: 'NanoGPT',
    [chat_completion_sources.DEEPSEEK]: 'DeepSeek',
    [chat_completion_sources.AIMLAPI]: 'AIMLAPI',
    [chat_completion_sources.XAI]: 'xAI',
    [chat_completion_sources.POLLINATIONS]: 'Pollinations',
    [chat_completion_sources.MOONSHOT]: 'Moonshot',
    [chat_completion_sources.FIREWORKS]: 'Fireworks',
    [chat_completion_sources.COMETAPI]: 'CometAPI',
    [chat_completion_sources.AZURE_OPENAI]: 'Azure OpenAI',
    [chat_completion_sources.ZAI]: 'Z.AI',
    [chat_completion_sources.SILICONFLOW]: 'SiliconFlow',
};
const SLOT_TEMPERATURE_DEFAULTS = {
    retriever: 0.2,
    injector: 0.2,
    actor: 0.7,
    extractor: 0.2,
    judge: 0.1,
    historian: 0.3,
};

function getChatCompletionProviderEntries() {
    const uiOptions = document.getElementById('chat_completion_source')?.options;
    if (uiOptions?.length) {
        const entries = [];
        const seen = new Set();
        for (const option of uiOptions) {
            const id = String(option.value || '').trim();
            if (!id || seen.has(id)) {
                continue;
            }
            seen.add(id);
            entries.push({
                id,
                label: String(option.textContent || option.label || PROVIDER_LABELS[id] || id).trim() || id,
            });
        }
        if (entries.length > 0) {
            return entries;
        }
    }

    return Object.values(chat_completion_sources)
        .map((id) => ({
            id,
            label: PROVIDER_LABELS[id] || id,
        }))
        .filter((item, index, list) => list.findIndex(x => x.id === item.id) === index);
}

function getCurrentChatProvider() {
    return String(oai_settings?.chat_completion_source || chat_completion_sources.OPENROUTER || 'openrouter');
}

function resolveDefaultChatProvider() {
    const provider = String(getCurrentChatProvider() || '').toLowerCase();
    return isValidChatProvider(provider) ? provider : String(chat_completion_sources.OPENROUTER);
}

function getDefaultModelForProvider(provider) {
    const source = String(provider || '').toLowerCase();
    switch (source) {
        case chat_completion_sources.OPENAI:
            return String(oai_settings?.openai_model || 'gpt-4o-mini');
        case chat_completion_sources.CLAUDE:
            return String(oai_settings?.claude_model || 'claude-sonnet-4-5');
        case chat_completion_sources.OPENROUTER:
            return String(oai_settings?.openrouter_model || 'openrouter/auto');
        case chat_completion_sources.AI21:
            return String(oai_settings?.ai21_model || 'jamba-large');
        case chat_completion_sources.MAKERSUITE:
            return String(oai_settings?.google_model || 'gemini-2.5-pro');
        case chat_completion_sources.VERTEXAI:
            return String(oai_settings?.vertexai_model || 'gemini-2.5-pro');
        case chat_completion_sources.MISTRALAI:
            return String(oai_settings?.mistralai_model || 'mistral-large-latest');
        case chat_completion_sources.CUSTOM:
            return String(oai_settings?.custom_model || '');
        case chat_completion_sources.COHERE:
            return String(oai_settings?.cohere_model || 'command-r-plus');
        case chat_completion_sources.PERPLEXITY:
            return String(oai_settings?.perplexity_model || 'sonar-pro');
        case chat_completion_sources.GROQ:
            return String(oai_settings?.groq_model || 'llama-3.3-70b-versatile');
        case chat_completion_sources.ELECTRONHUB:
            return String(oai_settings?.electronhub_model || 'gpt-4o-mini');
        case chat_completion_sources.CHUTES:
            return String(oai_settings?.chutes_model || 'deepseek-ai/DeepSeek-V3-0324');
        case chat_completion_sources.NANOGPT:
            return String(oai_settings?.nanogpt_model || 'gpt-4o-mini');
        case chat_completion_sources.DEEPSEEK:
            return String(oai_settings?.deepseek_model || 'deepseek-chat');
        case chat_completion_sources.AIMLAPI:
            return String(oai_settings?.aimlapi_model || 'chatgpt-4o-latest');
        case chat_completion_sources.XAI:
            return String(oai_settings?.xai_model || 'grok-3-beta');
        case chat_completion_sources.POLLINATIONS:
            return String(oai_settings?.pollinations_model || 'openai');
        case chat_completion_sources.MOONSHOT:
            return String(oai_settings?.moonshot_model || 'kimi-latest');
        case chat_completion_sources.FIREWORKS:
            return String(oai_settings?.fireworks_model || 'accounts/fireworks/models/kimi-k2-instruct');
        case chat_completion_sources.COMETAPI:
            return String(oai_settings?.cometapi_model || 'gpt-4o');
        case chat_completion_sources.AZURE_OPENAI:
            return String(oai_settings?.azure_openai_model || '');
        case chat_completion_sources.ZAI:
            return String(oai_settings?.zai_model || 'glm-4.6');
        case chat_completion_sources.SILICONFLOW:
            return String(oai_settings?.siliconflow_model || 'deepseek-ai/DeepSeek-V3');
        default:
            return 'openrouter/auto';
    }
}

function buildSlotDefaults() {
    const provider = resolveDefaultChatProvider();
    const model = getDefaultModelForProvider(provider) || 'openrouter/auto';
    return {
        retriever: { provider, model, temperature: SLOT_TEMPERATURE_DEFAULTS.retriever },
        injector: { provider, model, temperature: SLOT_TEMPERATURE_DEFAULTS.injector },
        actor: { provider, model, temperature: SLOT_TEMPERATURE_DEFAULTS.actor },
        extractor: { provider, model, temperature: SLOT_TEMPERATURE_DEFAULTS.extractor },
        judge: { provider, model, temperature: SLOT_TEMPERATURE_DEFAULTS.judge },
        historian: { provider, model, temperature: SLOT_TEMPERATURE_DEFAULTS.historian },
    };
}
const DB_PROFILE_BASE = Object.freeze({
    provider: 'neo4j',
    uri: 'bolt://127.0.0.1:7687',
    database: 'neo4j',
    username: 'neo4j',
    password: '',
});

const defaultSettings = {
    enabled: false,
    endpoint: '/api/kg-sidecar/turn/commit',
    statusEndpoint: '/api/kg-sidecar/turn/status',
    timeoutMs: 12000,
    contextWindowMessages: 80,
    position: extension_prompt_types.IN_PROMPT,
    role: extension_prompt_roles.SYSTEM,
    depth: 2,
    lastTurnId: '',
    db: { ...DB_PROFILE_BASE },
    dbProfiles: [{
        id: 'default',
        name: 'default',
        ...DB_PROFILE_BASE,
    }],
    activeDbProfileId: 'default',
    conversationDbBindings: {},
    timelineByConversation: {},
    turnSnapshots: {},
    maxMilestonesPerConversation: 80,
    models: createDefaultModels(),
};

const settings = structuredClone(defaultSettings);
const modelCatalog = {};
const modelCatalogLoaded = {};

function createDefaultModels() {
    const slotDefaults = buildSlotDefaults();
    const models = {};
    for (const slot of ALL_SLOT_KEYS) {
        models[slot] = { ...slotDefaults[slot] };
    }
    return models;
}

function isValidChatProvider(provider) {
    return getChatCompletionProviderEntries().some(item => item.id === provider);
}

function ensureModelSettings(rawModels) {
    const slotDefaults = buildSlotDefaults();
    const defaultProvider = resolveDefaultChatProvider();
    const result = {};
    for (const slot of ALL_SLOT_KEYS) {
        const fallback = slotDefaults[slot];
        const source = rawModels?.[slot] || {};
        const preferredProvider = String(source.provider || fallback.provider || defaultProvider).toLowerCase();
        const provider = isValidChatProvider(preferredProvider) ? preferredProvider : defaultProvider;
        let model = String(source.model || fallback.model || getDefaultModelForProvider(provider)).trim();
        if (!model || /^kg-/i.test(model)) {
            model = getDefaultModelForProvider(provider) || 'openrouter/auto';
        }

        result[slot] = {
            provider,
            model,
            temperature: Number.isFinite(Number(source.temperature))
                ? Number(source.temperature)
                : fallback.temperature,
        };
    }
    return result;
}

function normalizeDbProvider(value) {
    void value;
    return 'neo4j';
}

function toProfileId(name) {
    const base = String(name || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 48);
    return base || `db-${Date.now()}`;
}

function normalizeDbProfile(raw, fallbackId = 'default') {
    const id = String(raw?.id || fallbackId).trim() || fallbackId;
    const name = String(raw?.name || id).trim() || id;
    return {
        id,
        name,
        provider: normalizeDbProvider(raw?.provider),
        uri: String(raw?.uri || DB_PROFILE_BASE.uri),
        database: String(raw?.database || DB_PROFILE_BASE.database),
        username: String(raw?.username || DB_PROFILE_BASE.username),
        password: String(raw?.password || DB_PROFILE_BASE.password),
    };
}

function ensureDbProfiles(rawProfiles, legacyDb) {
    const source = Array.isArray(rawProfiles) ? rawProfiles : [];
    const out = [];
    const seen = new Set();

    for (const item of source) {
        const normalized = normalizeDbProfile(item, `db-${out.length + 1}`);
        let id = normalized.id;
        let seq = 1;
        while (seen.has(id)) {
            id = `${normalized.id}-${seq++}`;
        }
        seen.add(id);
        out.push({ ...normalized, id });
    }

    if (out.length === 0) {
        const base = normalizeDbProfile({
            id: 'default',
            name: 'default',
            ...(legacyDb || DB_PROFILE_BASE),
        }, 'default');
        out.push(base);
    }

    return out;
}

function getConversationKey() {
    const context = getContext();
    return String(context.chatId || context.groupId || context.characterId || 'default');
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatTime(isoTime) {
    if (!isoTime) {
        return '';
    }
    const date = new Date(isoTime);
    if (Number.isNaN(date.getTime())) {
        return String(isoTime);
    }
    return date.toLocaleString();
}

function ensureTimelineStore() {
    if (!settings.timelineByConversation || typeof settings.timelineByConversation !== 'object') {
        settings.timelineByConversation = {};
    }
    if (!settings.turnSnapshots || typeof settings.turnSnapshots !== 'object') {
        settings.turnSnapshots = {};
    }
}

function pruneTimeline(conversationId) {
    ensureTimelineStore();
    const list = Array.isArray(settings.timelineByConversation[conversationId])
        ? settings.timelineByConversation[conversationId]
        : [];
    const maxItems = Math.max(10, Math.min(400, Number(settings.maxMilestonesPerConversation) || 80));
    if (list.length > maxItems) {
        settings.timelineByConversation[conversationId] = list.slice(-maxItems);
    }
}

function pruneTurnSnapshots() {
    ensureTimelineStore();
    const usedTurnIds = new Set();
    for (const items of Object.values(settings.timelineByConversation)) {
        if (!Array.isArray(items)) {
            continue;
        }
        for (const item of items) {
            const turnId = String(item?.turnId || '').trim();
            if (turnId) {
                usedTurnIds.add(turnId);
            }
        }
    }

    for (const turnId of Object.keys(settings.turnSnapshots)) {
        if (!usedTurnIds.has(turnId)) {
            delete settings.turnSnapshots[turnId];
        }
    }
}

function renderMilestonePreview(snapshot, milestoneTag = '') {
    const preview = $('#kg_sidecar_milestone_preview');
    if (preview.length === 0) {
        return;
    }

    if (!snapshot) {
        preview.html('点击里程碑可回溯快照');
        return;
    }

    const lines = [];
    if (milestoneTag) {
        lines.push(`<div><b>里程碑</b>: ${escapeHtml(milestoneTag)}</div>`);
    }
    lines.push(`<div><b>Turn</b>: ${escapeHtml(snapshot.turnId)}</div>`);
    lines.push(`<div><b>时间</b>: ${escapeHtml(formatTime(snapshot.createdAt))}</div>`);
    if (snapshot.userMessage) {
        lines.push(`<div><b>用户</b>: ${escapeHtml(snapshot.userMessage)}</div>`);
    }
    if (snapshot.assistantReply) {
        lines.push(`<div><b>助手</b>: ${escapeHtml(snapshot.assistantReply)}</div>`);
    }
    preview.html(lines.join(''));
}

function renderMilestoneTimeline() {
    const container = $('#kg_sidecar_milestone_list');
    if (container.length === 0) {
        return;
    }
    ensureTimelineStore();

    const conversationId = getConversationKey();
    const list = Array.isArray(settings.timelineByConversation[conversationId])
        ? settings.timelineByConversation[conversationId]
        : [];
    if (list.length === 0) {
        container.html('<div class="kg-sidecar-milestone-empty">暂无里程碑</div>');
        renderMilestonePreview(null);
        return;
    }

    const html = [...list].reverse().map(item => {
        const stepText = Number.isFinite(Number(item.step)) ? `#${Number(item.step)}` : '';
        return `
            <button class="kg-sidecar-milestone-item" type="button" data-turn-id="${escapeHtml(item.turnId)}" data-tag="${escapeHtml(item.tag)}">
                <span class="kg-sidecar-milestone-tag">${escapeHtml(item.tag)}</span>
                <span class="kg-sidecar-milestone-time">${escapeHtml(formatTime(item.createdAt))} ${escapeHtml(stepText)}</span>
            </button>
        `;
    }).join('');
    container.html(html);
}

function rememberTurnCommit(payload, body) {
    ensureTimelineStore();
    const conversationId = String(payload?.conversation_id || getConversationKey());
    const turnId = String(payload?.turn_id || body?.turn_id || '');
    if (!conversationId || !turnId) {
        return;
    }

    const createdAt = new Date().toISOString();
    const injectionPrompt = body?.injection_packet ? buildInjectionPrompt(body.injection_packet) : '';
    settings.turnSnapshots[turnId] = {
        conversationId,
        turnId,
        step: Number(payload?.step || 0),
        createdAt,
        userMessage: String(payload?.user_message || ''),
        assistantReply: String(body?.assistant_reply || ''),
        injectionPrompt,
        graphDelta: body?.graph_delta || {},
    };

    const rawItems = Array.isArray(body?.timeline_items) && body.timeline_items.length > 0
        ? body.timeline_items
        : (Array.isArray(body?.milestones)
            ? body.milestones.map((tag, index) => ({ id: `${turnId}:${index}`, tag }))
            : []);
    if (!Array.isArray(settings.timelineByConversation[conversationId])) {
        settings.timelineByConversation[conversationId] = [];
    }

    const timeline = settings.timelineByConversation[conversationId];
    for (let i = 0; i < rawItems.length; i++) {
        const item = rawItems[i] || {};
        const tag = String(item.tag || '').trim();
        if (!tag) {
            continue;
        }
        const id = String(item.id || `${turnId}:${i}`);
        const existingIndex = timeline.findIndex(x => x.id === id);
        const entry = {
            id,
            turnId,
            tag,
            createdAt,
            step: Number(payload?.step || 0),
        };
        if (existingIndex >= 0) {
            timeline[existingIndex] = entry;
            continue;
        }
        timeline.push({
            ...entry,
        });
    }

    pruneTimeline(conversationId);
    pruneTurnSnapshots();
}

function triggerGraphRefresh(payload, body) {
    const detail = {
        conversationId: String(payload?.conversation_id || getConversationKey()),
        turnId: String(payload?.turn_id || body?.turn_id || ''),
        graphDelta: body?.graph_delta || { evolve: 0, replace: 0, delete: 0 },
        storage: String(body?.commit?.storage || ''),
    };

    try {
        globalThis.dispatchEvent?.(new CustomEvent('kg-sidecar:graph-updated', { detail }));
    } catch (error) {
        console.warn('KG Sidecar: graph update event dispatch failed', error);
    }

    try {
        const bridge = globalThis.kgSidecarGraphBridge;
        if (bridge && typeof bridge.refresh === 'function') {
            bridge.refresh(detail);
        }
    } catch (error) {
        console.warn('KG Sidecar: graph bridge refresh failed', error);
    }
}

function getDbProfileById(profileId) {
    const id = String(profileId || '').trim();
    return settings.dbProfiles.find(x => x.id === id) || null;
}

function ensureActiveDbProfile() {
    let profile = getDbProfileById(settings.activeDbProfileId);
    if (!profile) {
        profile = settings.dbProfiles[0] || null;
        settings.activeDbProfileId = profile?.id || '';
    }
    if (profile) {
        settings.db = {
            provider: profile.provider,
            uri: profile.uri,
            database: profile.database,
            username: profile.username,
            password: profile.password,
        };
    }
    return profile;
}

function getBoundProfileForConversation(conversationId) {
    const boundId = String(settings.conversationDbBindings?.[conversationId] || '').trim();
    return getDbProfileById(boundId);
}

function resolveDbProfileForConversation(conversationId) {
    const bound = getBoundProfileForConversation(conversationId);
    if (bound) {
        return bound;
    }
    return ensureActiveDbProfile();
}

function renderDbProfileOptions() {
    const select = $('#kg_sidecar_db_profile_select');
    if (select.length === 0) {
        return;
    }

    const active = ensureActiveDbProfile();
    const options = settings.dbProfiles.map(profile => {
        const desc = `neo4j:${profile.database}`;
        return `<option value="${profile.id}">${profile.name} (${desc})</option>`;
    }).join('');
    select.html(options);
    if (active) {
        select.val(active.id);
    }
}

function renderDbProfileFields() {
    const profile = ensureActiveDbProfile();
    if (!profile) {
        return;
    }
    $('#kg_sidecar_db_uri').val(profile.uri);
    $('#kg_sidecar_db_name').val(profile.database);
    $('#kg_sidecar_db_user').val(profile.username);
    $('#kg_sidecar_db_password').val(profile.password);
}

function updateActiveDbProfileFromForm() {
    const profile = ensureActiveDbProfile();
    if (!profile) {
        return;
    }
    profile.provider = 'neo4j';
    profile.uri = String($('#kg_sidecar_db_uri').val() || DB_PROFILE_BASE.uri);
    profile.database = String($('#kg_sidecar_db_name').val() || DB_PROFILE_BASE.database);
    profile.username = String($('#kg_sidecar_db_user').val() || DB_PROFILE_BASE.username);
    profile.password = String($('#kg_sidecar_db_password').val() || '');
    settings.db = {
        provider: profile.provider,
        uri: profile.uri,
        database: profile.database,
        username: profile.username,
        password: profile.password,
    };
}

function renderDbBindingStatus() {
    const el = $('#kg_sidecar_db_binding_status');
    if (el.length === 0) {
        return;
    }

    const conversationId = getConversationKey();
    const bound = getBoundProfileForConversation(conversationId);
    const active = ensureActiveDbProfile();
    if (bound) {
        el.text(`${conversationId} -> ${bound.name}`);
        el.removeClass('err').addClass('ok');
    } else if (active) {
        el.text(`${conversationId} -> (默认) ${active.name}`);
        el.removeClass('err').addClass('ok');
    } else {
        el.text('未绑定');
        el.removeClass('ok').addClass('err');
    }
}

function renderModelSettings() {
    const container = $('#kg_sidecar_model_fields');
    if (container.length === 0) {
        return;
    }
    const providerOptions = getChatCompletionProviderEntries()
        .map(item => `<option value="${item.id}">${item.label}</option>`)
        .join('');

    const rows = CONFIGURABLE_SLOT_KEYS.map(slot => {
        const label = SLOT_LABELS[slot] || slot;
        return `
            <div class="kg-sidecar-model-row">
                <div class="kg-sidecar-model-name">${label}</div>
                <select class="text_pole" id="kg_sidecar_model_provider_${slot}" data-slot="${slot}" data-field="provider">
                    ${providerOptions}
                </select>
                <select class="text_pole" id="kg_sidecar_model_id_${slot}" data-slot="${slot}" data-field="model"></select>
                <input class="text_pole" id="kg_sidecar_model_temp_${slot}" data-slot="${slot}" data-field="temperature" type="number" min="0" max="2" step="0.1" />
            </div>
        `;
    }).join('');

    container.html(rows);
}

function updateStatus(text, cssClass = '') {
    const status = $('#kg_sidecar_status');
    status.text(text);
    status.removeClass('ok err').addClass(cssClass);
}

function ensureModelOption(provider, modelId) {
    if (!modelCatalog[provider]) {
        modelCatalog[provider] = [];
    }
    const list = modelCatalog[provider] || [];
    const id = String(modelId || '').trim();
    if (!id) {
        return;
    }
    if (list.some(item => item.id === id)) {
        return;
    }
    list.unshift({ id, label: `${id} (current)` });
    modelCatalog[provider] = list;
}

function renderSlotModelOptions(slot) {
    const provider = settings.models[slot].provider;
    const select = $(`#kg_sidecar_model_id_${slot}`);
    if (select.length === 0) {
        return;
    }

    const options = (modelCatalog[provider] || []).map(model => `
        <option value="${model.id}">${model.label || model.id}</option>
    `).join('');
    select.html(options);
    ensureModelOption(provider, settings.models[slot].model);
    if (select.find(`option[value="${settings.models[slot].model}"]`).length === 0) {
        select.prepend(`<option value="${settings.models[slot].model}">${settings.models[slot].model}</option>`);
    }
    select.val(settings.models[slot].model);
}

function renderAllSlotModelOptions() {
    for (const slot of CONFIGURABLE_SLOT_KEYS) {
        renderSlotModelOptions(slot);
    }
}

async function fetchProviderModels(provider, forceRefresh = false) {
    const target = String(provider || resolveDefaultChatProvider()).toLowerCase();
    if (!isValidChatProvider(target)) {
        throw new Error(`Unsupported provider: ${target}`);
    }

    if (!modelCatalog[target]) {
        modelCatalog[target] = [];
    }

    if (!forceRefresh && modelCatalogLoaded[target] && Array.isArray(modelCatalog[target]) && modelCatalog[target].length > 0) {
        return modelCatalog[target];
    }

    const payload = {
        reverse_proxy: oai_settings?.reverse_proxy || '',
        proxy_password: oai_settings?.proxy_password || '',
        chat_completion_source: target,
    };
    if (target === chat_completion_sources.CUSTOM) {
        payload.custom_url = oai_settings?.custom_url || '';
        payload.custom_include_headers = oai_settings?.custom_include_headers || '';
    }
    if (target === chat_completion_sources.AZURE_OPENAI) {
        payload.azure_base_url = oai_settings?.azure_base_url || '';
        payload.azure_deployment_name = oai_settings?.azure_deployment_name || '';
        payload.azure_api_version = oai_settings?.azure_api_version || '';
    }
    if (target === chat_completion_sources.ZAI) {
        payload.zai_endpoint = oai_settings?.zai_endpoint || 'common';
    }

    const response = await fetch(CHAT_COMPLETIONS_STATUS_ENDPOINT, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`Model endpoint failed: HTTP_${response.status}`);
    }

    let body = null;
    try {
        body = await response.json();
    } catch {
        throw new Error('Model endpoint returned non-JSON payload.');
    }

    const fromData = Array.isArray(body?.data)
        ? body.data
        : (Array.isArray(body?.data?.data) ? body.data.data : []);
    const fromModels = Array.isArray(body?.models) ? body.models : [];
    const sourceModels = fromData.length > 0 ? fromData : fromModels;

    const models = sourceModels.map((item) => {
        if (typeof item === 'string') {
            return { id: item, label: item };
        }
        const id = String(item?.id || item?.name || '').trim();
        const label = String(item?.name || item?.id || '').trim() || id;
        return { id, label };
    }).filter(item => item.id);

    if (models.length === 0) {
        const modelId = getDefaultModelForProvider(target);
        modelCatalog[target] = modelId ? [{ id: modelId, label: modelId }] : [];
    } else {
        modelCatalog[target] = models;
    }
    modelCatalogLoaded[target] = true;
    return modelCatalog[target];
}

async function refreshModelCatalog(forceRefresh = false) {
    updateStatus('loading models...');
    const defaultProvider = resolveDefaultChatProvider();
    const providers = new Set();
    for (const slot of CONFIGURABLE_SLOT_KEYS) {
        const provider = String(settings.models?.[slot]?.provider || defaultProvider).toLowerCase();
        if (isValidChatProvider(provider)) {
            providers.add(provider);
        }
    }

    let failed = 0;
    try {
        for (const provider of providers) {
            try {
                await fetchProviderModels(provider, forceRefresh);
            } catch (error) {
                failed += 1;
                console.warn(`KG Sidecar model fetch failed for provider: ${provider}`, error);
            }
        }
        renderAllSlotModelOptions();
        if (failed > 0) {
            updateStatus('model list partial', 'err');
        } else {
            updateStatus('models ready', 'ok');
        }
    } catch (error) {
        console.warn('KG Sidecar model catalog refresh failed', error);
        renderAllSlotModelOptions();
        updateStatus('model list fallback', 'err');
    }
}

function loadSettings() {
    if (!extension_settings.kgSidecar) {
        extension_settings.kgSidecar = structuredClone(defaultSettings);
    }

    Object.assign(settings, defaultSettings, extension_settings.kgSidecar);
    settings.dbProfiles = ensureDbProfiles(
        extension_settings.kgSidecar?.dbProfiles,
        extension_settings.kgSidecar?.db,
    );
    settings.activeDbProfileId = String(
        extension_settings.kgSidecar?.activeDbProfileId || settings.dbProfiles[0]?.id || 'default',
    );
    settings.conversationDbBindings = extension_settings.kgSidecar?.conversationDbBindings
        && typeof extension_settings.kgSidecar.conversationDbBindings === 'object'
        ? { ...extension_settings.kgSidecar.conversationDbBindings }
        : {};
    settings.timelineByConversation = extension_settings.kgSidecar?.timelineByConversation
        && typeof extension_settings.kgSidecar.timelineByConversation === 'object'
        ? structuredClone(extension_settings.kgSidecar.timelineByConversation)
        : {};
    settings.turnSnapshots = extension_settings.kgSidecar?.turnSnapshots
        && typeof extension_settings.kgSidecar.turnSnapshots === 'object'
        ? structuredClone(extension_settings.kgSidecar.turnSnapshots)
        : {};
    settings.maxMilestonesPerConversation = Number.isFinite(Number(extension_settings.kgSidecar?.maxMilestonesPerConversation))
        ? Number(extension_settings.kgSidecar.maxMilestonesPerConversation)
        : defaultSettings.maxMilestonesPerConversation;
    settings.contextWindowMessages = Number.isFinite(Number(extension_settings.kgSidecar?.contextWindowMessages))
        ? Number(extension_settings.kgSidecar.contextWindowMessages)
        : defaultSettings.contextWindowMessages;
    ensureTimelineStore();
    ensureActiveDbProfile();
    settings.models = ensureModelSettings(extension_settings.kgSidecar?.models);

    renderModelSettings();
    renderDbProfileOptions();
    renderDbProfileFields();
    renderDbBindingStatus();
    renderMilestoneTimeline();

    $('#kg_sidecar_enabled').prop('checked', settings.enabled);
    $('#kg_sidecar_endpoint').val(settings.endpoint);
    $('#kg_sidecar_timeout').val(settings.timeoutMs);
    $('#kg_sidecar_context_messages').val(settings.contextWindowMessages);

    for (const slot of CONFIGURABLE_SLOT_KEYS) {
        $(`#kg_sidecar_model_provider_${slot}`).val(settings.models[slot].provider);
        $(`#kg_sidecar_model_temp_${slot}`).val(settings.models[slot].temperature);
        ensureModelOption(settings.models[slot].provider, settings.models[slot].model);
    }
    renderAllSlotModelOptions();
}

function persistSettings() {
    ensureActiveDbProfile();
    Object.assign(extension_settings.kgSidecar, settings);
    saveSettingsDebounced();
}

function buildTurnPayload(chat) {
    const conversationId = getConversationKey();
    const turnId = `turn_${Date.now()}`;
    const dbProfile = resolveDbProfileForConversation(conversationId) || normalizeDbProfile({}, 'default');

    const contextWindowMessages = Math.max(10, Math.min(200, Number(settings.contextWindowMessages) || 80));
    const chatWindow = chat
        .slice(-contextWindowMessages)
        .map(message => ({
            role: message?.is_user ? 'user' : 'assistant',
            name: String(message?.name || ''),
            text: String(message?.mes || ''),
        }));

    const userMessage = String(chat.filter(x => x?.is_user).at(-1)?.mes || '');
    const models = structuredClone(settings.models);
    delete models.actor;

    return {
        conversation_id: conversationId,
        turn_id: turnId,
        step: chat.length,
        user_message: userMessage,
        chat_window: chatWindow,
        config: {
            strong_consistency: true,
            disable_actor_slot: true,
            decay_base: 0.98,
            delete_threshold: 0.12,
            context_window_messages: contextWindowMessages,
            db: {
                provider: dbProfile.provider,
                uri: dbProfile.uri,
                database: dbProfile.database,
                username: dbProfile.username,
                password: dbProfile.password,
            },
            models,
        },
    };
}

function computeCommitTimeoutMs(payload) {
    const configured = Number(settings.timeoutMs) || defaultSettings.timeoutMs;
    const models = payload?.config?.models || {};
    const llmSlots = Object.values(models).filter(slot => Boolean(String(slot?.provider || '').trim())).length;
    const contextWindowMessages = Number(payload?.config?.context_window_messages) || 80;
    // 多槽位串行较慢，按槽位数动态抬高超时，避免“明明在跑但前端先超时”。
    const contextPenalty = Math.max(0, contextWindowMessages - 40) * 120;
    const recommended = Math.max(12000, llmSlots * 15000 + 12000 + contextPenalty);
    return Math.max(configured, recommended);
}

async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function buildInjectionPrompt(packet) {
    return [
        '[KG Memory]',
        packet.second_person_psychology,
        packet.third_person_relations,
        packet.neutral_background,
        packet.event_evidence_context || '',
    ].join('\n');
}

async function callCommit(chat) {
    const payload = buildTurnPayload(chat);
    const timeoutMs = computeCommitTimeoutMs(payload);

    const headers = {
        ...getRequestHeaders(),
        'Content-Type': 'application/json',
    };

    const response = await fetchWithTimeout(settings.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    }, timeoutMs);

    let body = {};
    try {
        body = await response.json();
    } catch {
        body = { ok: false };
    }

    return { response, body, turnId: payload.turn_id, payload, timeoutMs };
}

async function callClearDatabase(profile) {
    const headers = {
        ...getRequestHeaders(),
        'Content-Type': 'application/json',
    };

    const response = await fetchWithTimeout(CLEAR_DB_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            confirm: true,
            config: {
                db: {
                    provider: profile.provider,
                    uri: profile.uri,
                    database: profile.database,
                    username: profile.username,
                    password: profile.password,
                },
            },
        }),
    }, Number(settings.timeoutMs) || 12000);

    let body = {};
    try {
        body = await response.json();
    } catch {
        body = { ok: false };
    }

    return { response, body };
}

async function refreshTurnStatus() {
    if (!settings.lastTurnId) {
        return;
    }

    const endpoint = `${settings.statusEndpoint}/${encodeURIComponent(settings.lastTurnId)}`;
    try {
        const response = await fetch(endpoint, { method: 'GET', headers: getRequestHeaders() });
        if (!response.ok) {
            return;
        }

        const body = await response.json();
        if (body?.ok && body?.status?.commit?.status === 'COMMITTED') {
            updateStatus('committed', 'ok');
        }
    } catch {
        // No-op, keep current status.
    }
}

globalThis.kg_sidecar_generate_interceptor = async (chat, _contextSize, _abort, type) => {
    if (!settings.enabled || type === 'quiet') {
        return;
    }

    if (!Array.isArray(chat) || chat.length === 0) {
        return;
    }

    renderDbBindingStatus();
    updateStatus('syncing...');

    try {
        const { response, body, turnId, payload, timeoutMs } = await callCommit(chat);

        if (!response.ok || !body?.ok) {
            const reason = body?.commit?.reason_code || `HTTP_${response.status}`;
            updateStatus(`rollback: ${reason}`, 'err');
            return;
        }

        settings.lastTurnId = turnId;

        if (body.injection_packet) {
            const prompt = buildInjectionPrompt(body.injection_packet);
            setExtensionPrompt(PROMPT_TAG, prompt, settings.position, settings.depth, false, settings.role);
        }

        rememberTurnCommit(payload, body);
        renderMilestoneTimeline();
        triggerGraphRefresh(payload, body);
        persistSettings();
        updateStatus(`committed (${timeoutMs}ms)`, 'ok');
    } catch (error) {
        console.warn('KG Sidecar: commit call failed', error);
        const reason = String(error?.name || '').toLowerCase() === 'aborterror'
            ? 'error: timeout'
            : `error: ${String(error?.message || 'commit failed')}`;
        updateStatus(reason, 'err');
    }
};

jQuery(async () => {
    const template = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
    $('#kg_sidecar_container').append(template);

    loadSettings();
    await refreshModelCatalog();

    $('#kg_sidecar_enabled').on('input', () => {
        settings.enabled = Boolean($('#kg_sidecar_enabled').prop('checked'));
        persistSettings();
    });

    $('#kg_sidecar_endpoint').on('change', () => {
        settings.endpoint = String($('#kg_sidecar_endpoint').val() || defaultSettings.endpoint);
        persistSettings();
    });

    $('#kg_sidecar_timeout').on('input', () => {
        settings.timeoutMs = Number($('#kg_sidecar_timeout').val() || defaultSettings.timeoutMs);
        persistSettings();
    });

    $('#kg_sidecar_context_messages').on('input', () => {
        settings.contextWindowMessages = Math.max(
            10,
            Math.min(200, Number($('#kg_sidecar_context_messages').val() || defaultSettings.contextWindowMessages)),
        );
        persistSettings();
    });

    $('#kg_sidecar_db_profile_select').on('change', () => {
        settings.activeDbProfileId = String($('#kg_sidecar_db_profile_select').val() || settings.activeDbProfileId);
        renderDbProfileFields();
        renderDbBindingStatus();
        persistSettings();
    });

    $('#kg_sidecar_db_profile_create').on('click', () => {
        const seed = `db-${settings.dbProfiles.length + 1}`;
        const name = String(globalThis.prompt?.('输入数据库配置名称', seed) || '').trim();
        if (!name) {
            return;
        }

        const base = ensureActiveDbProfile() || normalizeDbProfile({}, 'default');
        let id = toProfileId(name);
        let seq = 1;
        while (settings.dbProfiles.some(x => x.id === id)) {
            id = `${toProfileId(name)}-${seq++}`;
        }

        settings.dbProfiles.push({
            id,
            name,
            provider: base.provider,
            uri: base.uri,
            database: base.database,
            username: base.username,
            password: base.password,
        });
        settings.activeDbProfileId = id;
        renderDbProfileOptions();
        renderDbProfileFields();
        renderDbBindingStatus();
        persistSettings();
    });

    $('#kg_sidecar_db_profile_delete').on('click', () => {
        const profile = ensureActiveDbProfile();
        if (!profile) {
            return;
        }
        if (settings.dbProfiles.length <= 1) {
            updateStatus('至少保留一个数据库配置', 'err');
            return;
        }

        const ok = globalThis.confirm?.(`确认删除数据库配置: ${profile.name} ?`) ?? false;
        if (!ok) {
            return;
        }

        settings.dbProfiles = settings.dbProfiles.filter(x => x.id !== profile.id);
        for (const [key, boundId] of Object.entries(settings.conversationDbBindings || {})) {
            if (boundId === profile.id) {
                delete settings.conversationDbBindings[key];
            }
        }
        settings.activeDbProfileId = settings.dbProfiles[0]?.id || 'default';
        renderDbProfileOptions();
        renderDbProfileFields();
        renderDbBindingStatus();
        persistSettings();
    });

    $('#kg_sidecar_db_bind_current').on('click', () => {
        const conversationId = getConversationKey();
        const profile = ensureActiveDbProfile();
        if (!conversationId || !profile) {
            return;
        }
        settings.conversationDbBindings[conversationId] = profile.id;
        renderDbBindingStatus();
        persistSettings();
    });

    $('#kg_sidecar_db_clear_current').on('click', async () => {
        const conversationId = getConversationKey();
        const profile = resolveDbProfileForConversation(conversationId);
        if (!profile) {
            updateStatus('未找到数据库配置', 'err');
            return;
        }

        const scope = settings.conversationDbBindings[conversationId]
            ? `会话绑定: ${conversationId} -> ${profile.name}`
            : `默认配置: ${profile.name}`;
        const ok = globalThis.confirm?.(`确认清空数据库？\n${scope}`) ?? false;
        if (!ok) {
            return;
        }

        updateStatus('clearing db...');
        try {
            const { response, body } = await callClearDatabase(profile);
            if (!response.ok || !body?.ok) {
                const reason = body?.reason_code || `HTTP_${response.status}`;
                updateStatus(`clear failed: ${reason}`, 'err');
                return;
            }
            const deleted = Number(body.deleted_nodes || 0);
            updateStatus(`db cleared: ${deleted} nodes`, 'ok');
        } catch (error) {
            console.warn('KG Sidecar: db clear failed', error);
            updateStatus('clear failed', 'err');
        }
    });

    $('#kg_sidecar_db_unbind_current').on('click', () => {
        const conversationId = getConversationKey();
        delete settings.conversationDbBindings[conversationId];
        renderDbBindingStatus();
        persistSettings();
    });

    $('#kg_sidecar_db_uri').on('change', () => {
        updateActiveDbProfileFromForm();
        persistSettings();
    });

    $('#kg_sidecar_db_name').on('change', () => {
        updateActiveDbProfileFromForm();
        persistSettings();
    });

    $('#kg_sidecar_db_user').on('change', () => {
        updateActiveDbProfileFromForm();
        persistSettings();
    });

    $('#kg_sidecar_db_password').on('change', () => {
        updateActiveDbProfileFromForm();
        persistSettings();
    });

    $('#kg_sidecar_model_fields').on('change', '[data-slot][data-field]', async function () {
        const slot = String($(this).data('slot'));
        const field = String($(this).data('field'));
        const slotDefaults = buildSlotDefaults();
        if (!CONFIGURABLE_SLOT_KEYS.includes(slot)) {
            return;
        }

        if (field === 'temperature') {
            settings.models[slot][field] = Number($(this).val() || slotDefaults[slot].temperature);
        } else {
            const rawValue = String($(this).val() || slotDefaults[slot][field] || '').trim();
            if (field === 'provider') {
                settings.models[slot][field] = rawValue.toLowerCase();
            } else {
                settings.models[slot][field] = rawValue;
            }
            if (field === 'provider') {
                const defaultProvider = resolveDefaultChatProvider();
                if (!isValidChatProvider(settings.models[slot][field])) {
                    settings.models[slot][field] = defaultProvider;
                }
                const preferredModel = getDefaultModelForProvider(settings.models[slot][field]) || settings.models[slot].model;
                if (!settings.models[slot].model || /^kg-/i.test(settings.models[slot].model || '')) {
                    settings.models[slot].model = preferredModel;
                }
            }
            if (field === 'provider') {
                ensureModelOption(settings.models[slot].provider, settings.models[slot].model);
                try {
                    await fetchProviderModels(settings.models[slot].provider, false);
                } catch (error) {
                    console.warn(`KG Sidecar provider switch model fetch failed: ${settings.models[slot].provider}`, error);
                }
                renderSlotModelOptions(slot);
            }
        }

        persistSettings();
    });

    $('#kg_sidecar_refresh_models').on('click', async () => {
        await refreshModelCatalog(true);
        persistSettings();
    });

    $('#kg_sidecar_milestone_list').on('click', '.kg-sidecar-milestone-item', function () {
        const turnId = String($(this).data('turn-id') || '');
        const tag = String($(this).data('tag') || '');
        const snapshot = settings.turnSnapshots?.[turnId];
        if (!snapshot) {
            renderMilestonePreview(null);
            updateStatus('快照不存在', 'err');
            return;
        }

        const restorePrompt = String(snapshot.injectionPrompt || '').trim();
        if (restorePrompt) {
            setExtensionPrompt(PROMPT_TAG, restorePrompt, settings.position, settings.depth, false, settings.role);
            updateStatus(`rewind: ${turnId}`, 'ok');
        } else {
            updateStatus(`rewind skip: ${turnId}`, 'err');
        }

        renderMilestonePreview(snapshot, tag);
    });

    $('#kg_sidecar_milestone_clear').on('click', () => {
        const conversationId = getConversationKey();
        const timeline = Array.isArray(settings.timelineByConversation?.[conversationId])
            ? settings.timelineByConversation[conversationId]
            : [];
        const turnIds = new Set(timeline.map(item => String(item.turnId || '')).filter(Boolean));
        delete settings.timelineByConversation[conversationId];
        for (const turnId of turnIds) {
            delete settings.turnSnapshots[turnId];
        }
        pruneTurnSnapshots();
        persistSettings();
        renderMilestoneTimeline();
        updateStatus('timeline cleared', 'ok');
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
        refreshTurnStatus();
        renderDbBindingStatus();
    });
    if (event_types.CHATCOMPLETION_SOURCE_CHANGED) {
        eventSource.on(event_types.CHATCOMPLETION_SOURCE_CHANGED, async () => {
            await refreshModelCatalog(true);
            renderAllSlotModelOptions();
        });
    }
    if (event_types.CHATCOMPLETION_MODEL_CHANGED) {
        eventSource.on(event_types.CHATCOMPLETION_MODEL_CHANGED, async () => {
            await refreshModelCatalog(true);
            renderAllSlotModelOptions();
        });
    }
    if (event_types.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            renderDbBindingStatus();
            renderMilestoneTimeline();
        });
    }
});
