import { test, expect } from '@playwright/test';

const TURN_COMMIT_ENDPOINT = '/api/kg-sidecar/turn/commit';
const TURN_STATUS_ENDPOINT = '/api/kg-sidecar/turn/status';
const DB_CLEAR_ENDPOINT = '/api/kg-sidecar/db/clear';

test.describe('KG Sidecar extension e2e', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120000);
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        const userSelect = page.locator('#userList .userSelect').last();
        if (await userSelect.count() > 0) {
            await userSelect.click({ timeout: 5000 }).catch(() => {});
        }
        await page.waitForFunction(() => document.getElementById('preloader') === null, { timeout: 60000 });
        await page.waitForFunction(() => typeof globalThis.kg_sidecar_generate_interceptor === 'function', { timeout: 60000 });
    });

    test('registers generate interceptor and runtime settings', async ({ page }) => {
        const out = await page.evaluate(() => ({
            interceptor: typeof globalThis.kg_sidecar_generate_interceptor,
            hasSettings: Boolean(globalThis.SillyTavern?.getContext?.()?.extensionSettings?.kgSidecar),
            endpoint: String(globalThis.SillyTavern?.getContext?.()?.extensionSettings?.kgSidecar?.endpoint || ''),
            hasDbProfiles: Array.isArray(globalThis.SillyTavern?.getContext?.()?.extensionSettings?.kgSidecar?.dbProfiles),
        }));

        expect(out.interceptor).toBe('function');
        expect(out.hasSettings).toBe(true);
        expect(out.endpoint).toBe('/api/kg-sidecar/turn/commit');
        expect(out.hasDbProfiles).toBe(true);
    });

    test('can commit one turn through sidecar endpoint with memory backend', async ({ page }) => {
        const conversationId = `e2e_mem_${Date.now()}`;
        const turnId = `turn_${Date.now()}`;
        const commitResult = await ajaxJson(page, TURN_COMMIT_ENDPOINT, 'POST', {
            conversation_id: conversationId,
            turn_id: turnId,
            step: 1,
            user_message: '记住我是你的伙伴',
            chat_window: [
                { role: 'assistant', name: 'Seraphina', text: '你现在很安全。' },
                { role: 'user', name: 'ZUENS2020', text: '记住我是你的伙伴' },
            ],
            config: {
                strong_consistency: true,
                decay_base: 0.98,
                delete_threshold: 0.12,
                db: { provider: 'memory' },
                models: {
                    retriever: { provider: 'builtin', model: 'kg-retriever-v1', temperature: 0.2 },
                    injector: { provider: 'builtin', model: 'kg-injector-v1', temperature: 0.2 },
                    actor: { provider: 'builtin', model: 'kg-actor-v1', temperature: 0.7 },
                    extractor: { provider: 'builtin', model: 'kg-extractor-v1', temperature: 0.2 },
                    judge: { provider: 'builtin', model: 'kg-judge-v1', temperature: 0.1 },
                    historian: { provider: 'builtin', model: 'kg-historian-v1', temperature: 0.3 },
                },
            },
        });

        expect(commitResult.ok).toBe(true);
        expect(commitResult.body?.ok).toBe(true);
        expect(commitResult.body?.commit?.status).toBe('COMMITTED');
        expect(commitResult.body?.storage_resolution?.storage).toBe('memory');
        expect(typeof commitResult.body?.assistant_reply).toBe('string');

        const statusResult = await ajaxJson(page, `${TURN_STATUS_ENDPOINT}/${encodeURIComponent(turnId)}`, 'GET');
        expect(statusResult.ok).toBe(true);
        expect(statusResult.body?.ok).toBe(true);
        expect(statusResult.body?.status?.commit?.status).toBe('COMMITTED');
    });

    test('can clear Neo4j db after a committed turn when Neo4j is enabled', async ({ page }) => {
        test.skip(process.env.KG_E2E_NEO4J !== '1', 'Set KG_E2E_NEO4J=1 to run Neo4j e2e test.');

        const dbConfig = {
            provider: 'neo4j',
            uri: process.env.KG_E2E_NEO4J_URI || 'bolt://127.0.0.1:7687',
            database: process.env.KG_E2E_NEO4J_DATABASE || 'neo4j',
            username: process.env.KG_E2E_NEO4J_USERNAME || 'neo4j',
            password: process.env.KG_E2E_NEO4J_PASSWORD || 'neo4j',
        };

        const firstClear = await ajaxJson(page, DB_CLEAR_ENDPOINT, 'POST', {
            confirm: true,
            config: { db: dbConfig },
        });
        expect(firstClear.ok).toBe(true);
        expect(firstClear.body?.ok).toBe(true);

        const conversationId = `e2e_neo4j_${Date.now()}`;
        const turnId = `turn_${Date.now()}`;
        const commitResult = await ajaxJson(page, TURN_COMMIT_ENDPOINT, 'POST', {
            conversation_id: conversationId,
            turn_id: turnId,
            step: 2,
            user_message: '记住我是你的伙伴',
            chat_window: [
                { role: 'assistant', name: 'Seraphina', text: '你现在很安全。' },
                { role: 'user', name: 'ZUENS2020', text: '记住我是你的伙伴' },
            ],
            config: {
                strong_consistency: true,
                decay_base: 0.98,
                delete_threshold: 0.12,
                db: dbConfig,
                models: {
                    retriever: { provider: 'builtin', model: 'kg-retriever-v1', temperature: 0.2 },
                    injector: { provider: 'builtin', model: 'kg-injector-v1', temperature: 0.2 },
                    actor: { provider: 'builtin', model: 'kg-actor-v1', temperature: 0.7 },
                    extractor: { provider: 'builtin', model: 'kg-extractor-v1', temperature: 0.2 },
                    judge: { provider: 'builtin', model: 'kg-judge-v1', temperature: 0.1 },
                    historian: { provider: 'builtin', model: 'kg-historian-v1', temperature: 0.3 },
                },
            },
        });
        expect(commitResult.ok).toBe(true);
        expect(commitResult.body?.ok).toBe(true);
        expect(commitResult.body?.commit?.status).toBe('COMMITTED');
        expect(commitResult.body?.storage_resolution?.storage).toBe('neo4j');

        const secondClear = await ajaxJson(page, DB_CLEAR_ENDPOINT, 'POST', {
            confirm: true,
            config: { db: dbConfig },
        });
        expect(secondClear.ok).toBe(true);
        expect(secondClear.body?.ok).toBe(true);
        expect(Number(secondClear.body?.deleted_nodes || 0)).toBeGreaterThanOrEqual(1);
    });
});

async function ajaxJson(page, url, method, body = undefined) {
    return page.evaluate(async ({ url, method, body }) => {
        if (!globalThis.$?.ajax) {
            return {
                ok: false,
                status: 0,
                body: null,
                text: 'jQuery.ajax is unavailable in page context.',
            };
        }

        try {
            const options = { url, method, dataType: 'json' };
            if (body !== undefined) {
                options.contentType = 'application/json';
                options.data = JSON.stringify(body);
            }

            const responseBody = await globalThis.$.ajax(options);
            return { ok: true, status: 200, body: responseBody, text: '' };
        } catch (error) {
            let parsedBody = null;
            const responseText = String(error?.responseText || error?.statusText || error || '');
            try {
                parsedBody = JSON.parse(responseText);
            } catch {
                parsedBody = null;
            }
            return {
                ok: false,
                status: Number(error?.status || 0),
                body: parsedBody,
                text: responseText,
            };
        }
    }, { url, method, body });
}
