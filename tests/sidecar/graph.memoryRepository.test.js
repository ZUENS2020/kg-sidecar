import { describe, expect, test } from '@jest/globals';
import { MemoryGraphRepository } from '../../src/sidecar/kg/graph/memoryRepository.js';

describe('MemoryGraphRepository', () => {
    test('stores character nodes with display id/bio and binds events to multiple characters', async () => {
        const repo = new MemoryGraphRepository();
        const result = await repo.commitMutation({
            actions: [{
                action: 'EVOLVE',
                from_uuid: '角色:Alice',
                to_uuid: '角色:Bob',
                from_name: 'Alice',
                to_name: 'Bob',
                delta_weight: 0.1,
                evidence_quote: 'Alice 支持 Bob',
                event_name: '并肩作战',
                participants: [
                    { uuid: '角色:Alice', name: 'Alice', bio: '侦察队长 Alice' },
                    { uuid: '角色:Bob', name: 'Bob', bio: '战术顾问 Bob' },
                    { uuid: '角色:Carol', name: 'Carol', bio: '后勤官 Carol' },
                ],
            }],
            judgeOut: {
                identity_conflicts: [],
                bio_sync_patch: [{
                    uuid: '角色:Alice',
                    before: '侦察员',
                    after: '侦察队长',
                    cause: '职位晋升',
                }],
            },
            historianOut: {
                milestones: ['[剧情里程碑] 关系线持续演进'],
                timeline_items: [{ id: '里程碑:turn_1:1', tag: '[剧情里程碑] 关系线持续演进' }],
            },
            entities: [
                { uuid: '角色:Alice', name: 'Alice', bio: '侦察员 Alice' },
                { uuid: '角色:Bob', name: 'Bob', bio: '战术顾问 Bob' },
                { uuid: '角色:Carol', name: 'Carol', bio: '后勤官 Carol' },
            ],
            turnId: 'turn_1',
            step: 1,
            conversationId: 'conv_1',
        });

        const state = repo.getState();

        expect(result.committed).toBe(true);
        expect(state.entities['角色:Alice']).toMatchObject({
            id: 'Alice',
            bio: '侦察队长',
        });
        expect(state.entities['角色:Carol']).toMatchObject({
            id: 'Carol',
            bio: '后勤官 Carol',
        });
        expect(state.relations['conv_1:角色:Alice->角色:Bob']).toMatchObject({
            name: 'ALLY',
            status: 'ALLY',
            weight: 0.1,
        });
        expect(state.events[0].event_id).toBe('并肩作战');
        expect(state.events[0].participants.map(x => x.id)).toEqual(
            expect.arrayContaining(['Alice', 'Bob', 'Carol']),
        );
        expect(state.event_links.filter(x => x.event_id === '并肩作战').length).toBe(3);
        expect(state.milestones[0].milestone_id).toBe('里程碑:turn_1:1');
    });
});
