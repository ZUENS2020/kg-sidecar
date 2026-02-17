const SLOT_DEFAULTS = Object.freeze({
    retriever: { provider: 'openrouter', model: 'openrouter/auto', temperature: 0.2 },
    injector: { provider: 'openrouter', model: 'openrouter/auto', temperature: 0.2 },
    actor: { provider: 'openrouter', model: 'openrouter/auto', temperature: 0.7 },
    extractor: { provider: 'openrouter', model: 'openrouter/auto', temperature: 0.2 },
    judge: { provider: 'openrouter', model: 'openrouter/auto', temperature: 0.1 },
    historian: { provider: 'openrouter', model: 'openrouter/auto', temperature: 0.3 },
});
const SLOT_KEYS = Object.freeze(Object.keys(SLOT_DEFAULTS));

function normalizeSlot(slot) {
    const value = String(slot || 'actor').toLowerCase();
    return Object.hasOwn(SLOT_DEFAULTS, value) ? value : 'actor';
}

export function getDefaultSlotModels() {
    return SLOT_DEFAULTS;
}

export function selectModelForSlot({ slot = 'actor', models = {} } = {}) {
    const target = normalizeSlot(slot);
    const fallback = SLOT_DEFAULTS[target];
    const override = models?.[target];

    if (!override || typeof override !== 'object') {
        return { ...fallback };
    }

    const provider = String(override.provider || fallback.provider);
    let model = String(override.model || fallback.model);
    if (provider === 'openrouter' && (!model || /^kg-/i.test(model))) {
        model = 'openrouter/auto';
    }

    return {
        provider,
        model,
        temperature: Number.isFinite(Number(override.temperature))
            ? Number(override.temperature)
            : fallback.temperature,
    };
}

export function buildModelRouteAudit({ models = {}, runtimeHasUserDirectories = false } = {}) {
    const out = {};
    for (const slot of SLOT_KEYS) {
        const configured = selectModelForSlot({ slot, models });
        let effective = { ...configured };
        let status = 'ok';
        let warning_code = null;

        if (configured.provider === 'openrouter' && !runtimeHasUserDirectories) {
            effective = { ...configured };
            status = 'blocked';
            warning_code = 'OPENROUTER_RUNTIME_UNAVAILABLE';
        }

        out[slot] = {
            configured_provider: configured.provider,
            configured_model: configured.model,
            effective_provider: effective.provider,
            effective_model: effective.model,
            status,
            warning_code,
        };
    }

    return out;
}
