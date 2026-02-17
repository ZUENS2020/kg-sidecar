import express from 'express';
import fetch from 'node-fetch';

import { getKgService } from '../sidecar/kg/service.js';
import { getDefaultSlotModels } from '../sidecar/kg/model/modelRouter.js';

export const router = express.Router();
const service = getKgService();
const OPENROUTER_MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 5 * 60 * 1000;
const modelCache = new Map();

function getBuiltinModelList() {
    const defaults = getDefaultSlotModels();
    const unique = Array.from(new Set(Object.values(defaults).map(item => item.model)));
    return unique.map(id => ({ id, label: id }));
}

async function getOpenRouterModelList(request) {
    const cacheKey = 'openrouter';
    const cached = modelCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.models;
    }

    const headers = { 'Accept': 'application/json' };
    if (request.user?.directories) {
        try {
            const { readSecret, SECRET_KEYS } = await import('./secrets.js');
            const apiKey = readSecret(request.user.directories, SECRET_KEYS.OPENROUTER);
            if (apiKey) {
                headers.Authorization = `Bearer ${apiKey}`;
            }
        } catch (error) {
            console.warn('KG Sidecar model list: secret read skipped', error?.message || error);
        }
    }

    const response = await fetch(OPENROUTER_MODELS_ENDPOINT, {
        method: 'GET',
        headers,
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenRouter models request failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    const models = (Array.isArray(data?.data) ? data.data : [])
        .map(model => ({
            id: String(model?.id || '').trim(),
            label: String(model?.name || model?.id || '').trim(),
            context_length: Number(model?.context_length || 0),
        }))
        .filter(model => model.id)
        .sort((a, b) => a.id.localeCompare(b.id));

    modelCache.set(cacheKey, {
        models,
        expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return models;
}

router.post('/turn/commit', async (request, response) => {
    const result = await service.commitTurn(request.body || {}, {
        runtime: {
            userDirectories: request.user?.directories,
        },
    });

    if (!result.ok && result.commit?.reason_code === 'INVALID_REQUEST') {
        return response.status(400).json(result);
    }

    if (!result.ok && result.commit?.reason_code === 'IN_PROGRESS') {
        return response.status(409).json(result);
    }

    if (!result.ok) {
        return response.status(422).json(result);
    }

    return response.json(result);
});

router.get('/turn/status/:turnId', (request, response) => {
    const status = service.getTurnStatus(request.params.turnId);

    if (!status) {
        return response.status(404).json({ ok: false, reason: 'Turn not found.' });
    }

    return response.json({ ok: true, status });
});

router.post('/turn/retry', async (request, response) => {
    const turnId = String(request.body?.turn_id || '');
    const result = await service.retryTurn(turnId);

    return response.status(result.ok ? 200 : 422).json(result);
});

router.post('/db/clear', async (request, response) => {
    const confirm = request.body?.confirm === true;
    if (!confirm) {
        return response.status(400).json({
            ok: false,
            reason_code: 'CLEAR_CONFIRM_REQUIRED',
            reason: 'Database clear requires confirm=true.',
        });
    }

    try {
        const dbConfig = request.body?.config?.db || null;
        const result = await service.clearDatabase({ dbConfig });
        if (!result.ok) {
            return response.status(422).json(result);
        }
        return response.json(result);
    } catch (error) {
        return response.status(500).json({
            ok: false,
            reason_code: 'CLEAR_FAILED',
            reason: String(error?.message || error),
        });
    }
});

router.get('/health/pipeline', (_request, response) => {
    return response.json({ ok: true, status: 'ready', service: 'kg-sidecar' });
});

router.get('/models', async (request, response) => {
    const provider = String(request.query?.provider || 'openrouter').toLowerCase();
    if (provider === 'builtin') {
        return response.json({
            ok: true,
            provider,
            cached: true,
            models: getBuiltinModelList(),
        });
    }

    try {
        const models = await getOpenRouterModelList(request);
        return response.json({
            ok: true,
            provider: 'openrouter',
            cached: true,
            models,
        });
    } catch (error) {
        console.warn('KG Sidecar model list failed:', error?.message || error);
        return response.status(502).json({
            ok: false,
            provider: 'openrouter',
            reason_code: 'MODELS_FETCH_FAILED',
            reason: String(error?.message || error),
        });
    }
});
