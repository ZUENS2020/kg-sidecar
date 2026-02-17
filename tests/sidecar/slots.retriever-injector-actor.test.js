import { describe, expect, test } from '@jest/globals';
import { retrieveEntities } from '../../src/sidecar/kg/slots/retriever.js';
import { buildInjectionPacket } from '../../src/sidecar/kg/slots/injector.js';
import { buildModelRouteAudit, selectModelForSlot } from '../../src/sidecar/kg/model/modelRouter.js';

describe('retriever/injector/actor adapters', () => {
    test('injector creates mixed perspective packet', () => {
        const packet = buildInjectionPacket({ entity: 'A' }, { rel: 'ALLY' }, { context: 'battlefield' });
        expect(packet.second_person_psychology).toContain('你');
        expect(packet.third_person_relations).toContain('A');
        expect(packet.neutral_background).toContain('battlefield');
    });

    test('retriever returns up to two focus entities', async () => {
        const out = await retrieveEntities({
            userMessage: 'Alice 怀疑 Bob',
            chatWindow: [
                { name: 'Alice', text: 'x' },
                { name: 'Bob', text: 'y' },
                { name: 'Carol', text: 'z' },
            ],
        });
        expect(out.focus_entities.length).toBe(2);
        expect(out.focus_entities[0].uuid).toMatch(/^角色:/);
    });

    test('retriever prioritizes role entities over generic speaker names', async () => {
        const out = await retrieveEntities({
            userMessage: 'LinChe trusts GuYao and still supports GuYao.',
            chatWindow: [
                { name: 'user', text: 'x' },
                { name: 'assistant', text: 'y' },
            ],
        });

        const names = out.focus_entities.map(x => x.name);
        expect(names).toContain('LinChe');
        expect(names).toContain('GuYao');
        expect(names).not.toContain('user');
        expect(names).not.toContain('assistant');
    });

    test('retriever can recover entities from chat history when current turn is pronoun-only', async () => {
        const out = await retrieveEntities({
            userMessage: 'They continue the conflict.',
            chatWindow: [
                { name: 'user', text: 'LinChe and GuYao become enemy rivals.' },
                { name: 'assistant', text: 'Understood, LinChe is hostile to GuYao now.' },
            ],
        });

        const names = out.focus_entities.map(x => x.name);
        expect(names).toContain('LinChe');
        expect(names).toContain('GuYao');
        expect(names).not.toContain('Understood');
    });

    test('retriever with openrouter config refuses local fallback when runtime is missing', async () => {
        await expect(retrieveEntities({
            userMessage: '林澈与顾瑶并肩作战，陈默提供支援。',
            chatWindow: [
                { name: 'user', text: 'x' },
                { name: 'assistant', text: 'y' },
            ],
            config: {
                models: {
                    retriever: { provider: 'openrouter', model: 'openrouter/auto', temperature: 0.2 },
                },
            },
            runtime: {},
        })).rejects.toMatchObject({
            code: 'RETRIEVER_LLM_REQUIRED',
            stage: 'retriever',
        });
    });

    test('retriever does not fallback to alternate model when configured model fails', async () => {
        const calls = [];
        await expect(retrieveEntities({
            userMessage: 'ZUENS2020 是我的朋友',
            chatWindow: [{ role: 'user', name: 'user', text: 'x' }],
            config: {
                models: {
                    retriever: { provider: 'openrouter', model: 'google/gemini-3-flash-preview', temperature: 0.2 },
                },
            },
            runtime: {
                userDirectories: { root: '/tmp/mock' },
                openRouterJson: async ({ model }, fallbackFactory) => {
                    calls.push(model);
                    return fallbackFactory();
                },
            },
        })).rejects.toMatchObject({
            code: 'RETRIEVER_LLM_FAILED',
            stage: 'retriever',
        });

        expect(calls).toEqual(['google/gemini-3-flash-preview']);
    });

    test('model router resolves default and override configs', () => {
        const defaults = selectModelForSlot({});
        const actorOverride = selectModelForSlot({
            slot: 'actor',
            models: {
                actor: { provider: 'openai', model: 'gpt-4o-mini' },
            },
        });
        const openRouterFallback = selectModelForSlot({
            slot: 'retriever',
            models: {
                retriever: { provider: 'openrouter', model: 'kg-retriever-v1' },
            },
        });

        expect(defaults.provider).toBeTruthy();
        expect(defaults.model).toBeTruthy();
        expect(actorOverride.provider).toBe('openai');
        expect(actorOverride.model).toBe('gpt-4o-mini');
        expect(openRouterFallback.model).toBe('openrouter/auto');
    });

    test('model route audit marks openrouter slots as fallback without runtime directories', () => {
        const audit = buildModelRouteAudit({
            models: {
                retriever: { provider: 'openrouter', model: 'openrouter/auto' },
            },
            runtimeHasUserDirectories: false,
        });

        expect(audit.retriever.status).toBe('fallback');
        expect(audit.retriever.warning_code).toBe('OPENROUTER_RUNTIME_UNAVAILABLE');
        expect(audit.retriever.effective_provider).toBe('builtin');
    });
});
