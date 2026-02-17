#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import fetch from 'node-fetch';

import {
    summarizeLongDialogueRun,
    validateLongDialogueSummary,
} from '../src/sidecar/kg/regression/longDialogueRegression.js';

function toInt(value, fallback) {
    const num = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(num) ? num : fallback;
}

function toBool(value, fallback = false) {
    if (value == null) {
        return fallback;
    }
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
        return false;
    }
    return fallback;
}

function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

async function loadKgSidecarSettings(settingsPath) {
    try {
        const raw = await fs.readFile(settingsPath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed?.extension_settings?.kgSidecar || null;
    } catch {
        return null;
    }
}

function buildScenarioMessages() {
    return [
        '记住：我是你的朋友 ZUENS2020，请记录这个关系。',
        '我是谁？你应该记得我叫 ZUENS2020。',
        '我们今天一起并肩调查了遗迹，请更新我们的关系强度。',
        '你刚才说过我是你的朋友，请再确认一次我的身份。',
        '事件：我给你提供了关键支援，我们的协作继续加深。',
        '事件：我们决定结盟，共同对抗影牙军团。',
        '事件：你开始怀疑我隐瞒了情报，但仍保持合作。',
        '重大事件：我被指认为叛徒，关系从盟友转向背叛。',
        '请明确记录：现在你把我视为叛徒还是朋友？',
        '事件：我们发生正面冲突，关系进入敌对状态。',
        '新增角色：莉亚加入，她支持你并反对我。',
        '事件：莉亚与我短暂合作，但互不信任。',
        '新增事件：北境议会召开，参与者有你、我、莉亚。',
        '请回忆一下：北境议会涉及了哪些人物？',
        '事件：我公开道歉，尝试修复与你的关系。',
        '事件：你接受部分道歉，但保持警惕。',
        '事件：我们再次合作完成任务，敌意降低。',
        '请确认：ZUENS2020 与你的当前关系是什么？',
        '事件：我们共同救下平民，协作再次增强。',
        '请最终总结：我是谁、我们关系如何、莉亚扮演什么角色？',
    ];
}

async function fetchJson(url, { method = 'GET', body, timeoutMs = 45000, headers = {} } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
            body: body == null ? undefined : JSON.stringify(body),
            signal: controller.signal,
        });
        let json = {};
        try {
            json = await response.json();
        } catch {
            json = { ok: false, reason: 'NON_JSON_RESPONSE' };
        }
        return { response, json };
    } finally {
        clearTimeout(timer);
    }
}

function buildCookieHeader(setCookieHeaders = []) {
    if (!Array.isArray(setCookieHeaders) || setCookieHeaders.length === 0) {
        return '';
    }
    return setCookieHeaders.map(item => String(item || '').split(';')[0]).filter(Boolean).join('; ');
}

async function createSessionHeaders(baseUrl, timeoutMs) {
    const origin = new URL(baseUrl).origin;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${origin}/csrf-token`, {
            method: 'GET',
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`CSRF_TOKEN_HTTP_${response.status}`);
        }

        const payload = await response.json();
        const token = String(payload?.token || '').trim();
        if (!token) {
            throw new Error('CSRF_TOKEN_MISSING');
        }

        const setCookies = typeof response.headers?.raw === 'function'
            ? response.headers.raw()['set-cookie'] || []
            : [];
        const cookie = buildCookieHeader(setCookies);
        if (!cookie) {
            throw new Error('CSRF_COOKIE_MISSING');
        }

        return {
            'x-csrf-token': token,
            'cookie': cookie,
        };
    } finally {
        clearTimeout(timer);
    }
}

function buildCommitPayload({
    conversationId,
    turnId,
    step,
    userMessage,
    chatWindow,
    slotModels,
    timeoutMs,
    dbConfig,
}) {
    return {
        conversation_id: conversationId,
        turn_id: turnId,
        step,
        user_message: userMessage,
        chat_window: chatWindow.slice(-20),
        config: {
            strong_consistency: true,
            disable_actor_slot: true,
            decay_base: 0.98,
            delete_threshold: 0.12,
            db: dbConfig,
            models: slotModels,
            timeout_ms: timeoutMs,
        },
    };
}

async function maybeClearDatabase(baseUrl, dbConfig, timeoutMs, clearBeforeRun, sessionHeaders) {
    if (!clearBeforeRun) {
        return { skipped: true };
    }
    const url = `${baseUrl}/db/clear`;
    try {
        const { response, json } = await fetchJson(url, {
            method: 'POST',
            body: {
                confirm: true,
                config: { db: dbConfig },
            },
            timeoutMs,
            headers: sessionHeaders,
        });
        return {
            skipped: false,
            status: response.status,
            body: json,
        };
    } catch (error) {
        return {
            skipped: false,
            status: 0,
            body: {
                ok: false,
                reason: String(error?.message || error),
            },
        };
    }
}

async function retryTurn(baseUrl, turnId, timeoutMs, sessionHeaders) {
    const { response, json } = await fetchJson(`${baseUrl}/turn/retry`, {
        method: 'POST',
        body: { turn_id: turnId },
        timeoutMs,
        headers: sessionHeaders,
    });
    return { response, json };
}

function redactedDbConfig(dbConfig) {
    return {
        ...dbConfig,
        password: dbConfig.password ? '***' : '',
    };
}

function mergeDbConfigFromEnv(base) {
    return {
        provider: String(process.env.KG_DB_PROVIDER || base.provider || 'neo4j'),
        uri: String(process.env.KG_DB_URI || base.uri || 'bolt://127.0.0.1:7687'),
        database: String(process.env.KG_DB_DATABASE || base.database || 'neo4j'),
        username: String(process.env.KG_DB_USERNAME || base.username || 'neo4j'),
        password: String(process.env.KG_DB_PASSWORD ?? base.password ?? ''),
    };
}

function normalizeSlot(slot, fallback) {
    return {
        provider: String(slot?.provider || fallback.provider),
        model: String(slot?.model || fallback.model),
        temperature: Number.isFinite(Number(slot?.temperature))
            ? Number(slot.temperature)
            : fallback.temperature,
    };
}

function buildSlotModels(settingsModels = null, overrideModel = '') {
    const fallback = {
        retriever: { provider: 'openrouter', model: 'openrouter/auto', temperature: 0.2 },
        injector: { provider: 'openrouter', model: 'openrouter/auto', temperature: 0.2 },
        extractor: { provider: 'openrouter', model: 'openrouter/auto', temperature: 0.2 },
        judge: { provider: 'openrouter', model: 'openrouter/auto', temperature: 0.1 },
        historian: { provider: 'openrouter', model: 'openrouter/auto', temperature: 0.3 },
    };
    const modelId = String(overrideModel || '').trim();
    if (modelId) {
        for (const key of Object.keys(fallback)) {
            fallback[key] = { ...fallback[key], model: modelId };
        }
    }

    const source = settingsModels && typeof settingsModels === 'object' ? settingsModels : {};
    return {
        retriever: normalizeSlot(source.retriever, fallback.retriever),
        injector: normalizeSlot(source.injector, fallback.injector),
        extractor: normalizeSlot(source.extractor, fallback.extractor),
        judge: normalizeSlot(source.judge, fallback.judge),
        historian: normalizeSlot(source.historian, fallback.historian),
    };
}

async function run() {
    const baseUrl = String(process.env.KG_SIDECAR_BASE_URL || 'http://127.0.0.1:8000/api/kg-sidecar').replace(/\/$/, '');
    const settingsPath = String(process.env.KG_SETTINGS_PATH || 'data/default-user/settings.json');
    const loadedSettings = await loadKgSidecarSettings(settingsPath);
    const turnCount = Math.max(1, toInt(process.env.KG_REGRESSION_TURNS, 20));
    const defaultTimeout = Math.max(120000, Number(loadedSettings?.timeoutMs || 0) * 10 || 0);
    const timeoutMs = Math.max(10000, toInt(process.env.KG_REGRESSION_TIMEOUT_MS, defaultTimeout));
    const clearBeforeRun = toBool(process.env.KG_REGRESSION_CLEAR_BEFORE, true);
    const retryableRetries = Math.max(0, toInt(process.env.KG_REGRESSION_RETRYABLE_RETRIES, 2));
    const conversationId = String(process.env.KG_REGRESSION_CONVERSATION_ID || `realnet-regression-${Date.now()}`);
    const overrideModel = String(process.env.KG_REGRESSION_MODEL || '');
    const slotModels = buildSlotModels(loadedSettings?.models || null, overrideModel);

    const dbConfig = mergeDbConfigFromEnv(loadedSettings?.db || {});

    const scenario = buildScenarioMessages();
    const turnResults = [];
    const chatWindow = [];
    const sessionHeaders = await createSessionHeaders(baseUrl, timeoutMs);

    const clearResult = await maybeClearDatabase(baseUrl, dbConfig, timeoutMs, clearBeforeRun, sessionHeaders);
    if (!clearResult.skipped) {
        const reason = clearResult.body?.ok ? 'ok' : (clearResult.body?.reason_code || clearResult.body?.reason || 'failed');
        console.log(`[clear] status=${clearResult.status} result=${reason}`);
    }

    for (let i = 0; i < turnCount; i++) {
        const step = i + 1;
        const userMessage = scenario[i % scenario.length];
        const turnId = `${conversationId}-turn-${step}`;
        const payload = buildCommitPayload({
            conversationId,
            turnId,
            step,
            userMessage,
            chatWindow,
            slotModels,
            timeoutMs,
            dbConfig,
        });

        let captured = null;
        try {
            const { response, json } = await fetchJson(`${baseUrl}/turn/commit`, {
                method: 'POST',
                body: payload,
                timeoutMs,
                headers: sessionHeaders,
            });
            let finalResponse = response;
            let finalJson = json;
            let retryCount = 0;

            while (!finalJson?.ok && finalJson?.retryable === true && retryCount < retryableRetries) {
                retryCount += 1;
                console.log(`[turn ${step}] retryable rollback (${finalJson?.commit?.reason_code || 'UNKNOWN'}), retry ${retryCount}/${retryableRetries}`);
                const retried = await retryTurn(baseUrl, turnId, timeoutMs, sessionHeaders);
                finalResponse = retried.response;
                finalJson = retried.json;
            }

            captured = finalJson;
            turnResults.push({
                turn_id: turnId,
                step,
                ok: Boolean(finalJson?.ok),
                http_status: finalResponse.status,
                commit: finalJson?.commit || null,
                graph_delta: finalJson?.graph_delta || null,
                milestones: Array.isArray(finalJson?.milestones) ? finalJson.milestones : [],
                injection_packet: finalJson?.injection_packet || null,
                storage_resolution: finalJson?.storage_resolution || null,
                reason: finalJson?.commit?.reason || '',
                retries: retryCount,
            });
            const status = finalJson?.commit?.status || `HTTP_${finalResponse.status}`;
            const applied = finalJson?.commit?.applied_actions ?? 0;
            console.log(`[turn ${step}] ${status} actions=${applied} retries=${retryCount}`);
        } catch (error) {
            turnResults.push({
                turn_id: turnId,
                step,
                ok: false,
                error: String(error?.name || 'ERROR'),
                reason: String(error?.message || error),
            });
            console.log(`[turn ${step}] ERROR ${String(error?.name || 'ERROR')}: ${String(error?.message || error)}`);
        }

        chatWindow.push({
            role: 'user',
            name: 'ZUENS2020',
            text: userMessage,
        });
        if (captured?.assistant_reply) {
            chatWindow.push({
                role: 'assistant',
                name: 'Assistant',
                text: String(captured.assistant_reply),
            });
        }
    }

    const summary = summarizeLongDialogueRun({
        expectedTurns: turnCount,
        turnResults,
    });
    const validation = validateLongDialogueSummary(summary, {
        expectedTurns: turnCount,
        minCommitRatio: 1,
        requireReplaceMilestone: true,
        requireZuensRecallSignal: true,
        requireNoTimeout: true,
    });

    const report = {
        created_at: new Date().toISOString(),
        base_url: baseUrl,
        conversation_id: conversationId,
        config: {
            turn_count: turnCount,
            timeout_ms: timeoutMs,
            clear_before_run: clearBeforeRun,
            retryable_retries: retryableRetries,
            model_override: overrideModel || '(from settings)',
            settings_path: settingsPath,
            models: slotModels,
            db: redactedDbConfig(dbConfig),
        },
        clear_result: clearResult,
        summary,
        validation,
        turn_results: turnResults,
    };

    const outputDir = path.resolve(process.cwd(), 'output');
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `kg-sidecar-realnet-regression-${nowStamp()}.json`);
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');

    console.log('\n=== KG Realnet Long-Dialogue Regression Summary ===');
    console.log(`report: ${outputPath}`);
    console.log(`committed: ${summary.committedTurns}/${summary.expectedTurns}`);
    console.log(`rolled_back: ${summary.rolledBackTurns}`);
    console.log(`timeouts: ${summary.timeoutErrors}`);
    console.log(`graph_delta: evolve=${summary.graphDelta.evolve}, replace=${summary.graphDelta.replace}, delete=${summary.graphDelta.delete}`);
    console.log(`replace_milestone: ${summary.hasReplaceMilestone}`);
    console.log(`zuens_recall_signal: ${summary.hasZuensRecallSignal}`);

    if (!validation.ok) {
        console.error('\nRegression failed:');
        for (const failure of validation.failures) {
            console.error(`- ${failure}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('\nRegression passed.');
    process.exitCode = 0;
}

run().catch((error) => {
    console.error('Regression runner crashed:', error);
    process.exitCode = 1;
});
