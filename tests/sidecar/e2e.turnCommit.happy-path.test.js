import { describe, expect, test } from '@jest/globals';
import { createKgService } from '../../src/sidecar/kg/service.js';

describe('kg sidecar e2e turn commit', () => {
    test('happy path returns COMMITTED and graph_delta', async () => {
        const service = createKgService();

        const result = await service.commitTurn({
            conversation_id: 'conv_happy_1',
            turn_id: 'turn_happy_1',
            step: 2,
            user_message: 'Alice 信任 Bob',
            chat_window: [
                { role: 'user', name: 'Alice', text: '我信任 Bob' },
                { role: 'assistant', name: 'Bob', text: '我会支持你' },
            ],
            config: {
                strong_consistency: true,
                db: { provider: 'memory' },
            },
        });

        expect(result.ok).toBe(true);
        expect(result.commit.status).toBe('COMMITTED');
        expect(result.graph_delta).toEqual(expect.objectContaining({
            evolve: expect.any(Number),
            replace: expect.any(Number),
            delete: expect.any(Number),
        }));
        expect(Array.isArray(result.global_audit?.storage_compare)).toBe(true);
        expect(Array.isArray(result.timeline_items)).toBe(true);
        if (result.timeline_items.length > 0) {
            expect(result.timeline_items[0].id).toMatch(/^里程碑:/);
        }
        expect(Array.isArray(result.pipeline_timeline)).toBe(true);
    });

    test('disable_actor_slot skips sidecar actor generation', async () => {
        const service = createKgService();

        const result = await service.commitTurn({
            conversation_id: 'conv_happy_2',
            turn_id: 'turn_happy_2',
            step: 3,
            user_message: 'Alice 仍然信任 Bob',
            chat_window: [
                { role: 'user', name: 'Alice', text: '我仍然信任 Bob' },
            ],
            config: {
                strong_consistency: true,
                disable_actor_slot: true,
                db: { provider: 'memory' },
            },
        });

        expect(result.ok).toBe(true);
        expect(result.commit.status).toBe('COMMITTED');
        expect(result.assistant_reply).toBe('');
    });
});
