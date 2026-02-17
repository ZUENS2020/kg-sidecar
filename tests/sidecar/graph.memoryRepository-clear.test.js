import { describe, expect, test } from '@jest/globals';
import { MemoryGraphRepository } from '../../src/sidecar/kg/graph/memoryRepository.js';

describe('MemoryGraphRepository clearGraph', () => {
    test('resets all graph collections and reports deleted counts', async () => {
        const repo = new MemoryGraphRepository();

        await repo.commitMutation({
            actions: [{
                action: 'EVOLVE',
                from_uuid: '角色:Alice',
                to_uuid: '角色:Bob',
                from_name: 'Alice',
                to_name: 'Bob',
                delta_weight: 0.1,
                evidence_quote: 'Alice supports Bob',
                event_name: '并肩作战',
            }],
            judgeOut: { identity_conflicts: [], bio_sync_patch: [] },
            historianOut: { milestones: [], timeline_items: [] },
            entities: [
                { uuid: '角色:Alice', name: 'Alice', bio: 'A' },
                { uuid: '角色:Bob', name: 'Bob', bio: 'B' },
            ],
            turnId: 't1',
            step: 1,
            conversationId: 'c1',
        });

        const out = await repo.clearGraph();
        const after = repo.getState();

        expect(out.ok).toBe(true);
        expect(out.storage).toBe('memory');
        expect(out.deleted_nodes).toBeGreaterThan(0);
        expect(Object.keys(after.entities)).toHaveLength(0);
        expect(Object.keys(after.relations)).toHaveLength(0);
        expect(after.events).toHaveLength(0);
        expect(after.event_links).toHaveLength(0);
        expect(after.milestones).toHaveLength(0);
    });
});

