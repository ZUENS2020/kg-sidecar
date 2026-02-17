import { describe, expect, test, jest } from '@jest/globals';
import { Neo4jGraphRepository } from '../../src/sidecar/kg/graph/neo4jRepository.js';

describe('Neo4jGraphRepository participant-event linkage query', () => {
    test('includes WITH between entity SET and event MATCH', async () => {
        const tx = { run: jest.fn(async () => ({})) };
        const session = {
            executeWrite: async (fn) => fn(tx),
            close: async () => {},
        };

        const repo = new Neo4jGraphRepository({
            uri: 'bolt://127.0.0.1:7687',
            username: 'neo4j',
            password: 'neo4j',
            database: 'neo4j',
        });

        repo.ensureReady = async () => ({ version: 1 });
        repo.driver = { session: () => session };

        const out = await repo.commitMutation({
            actions: [{
                action: 'EVOLVE',
                from_uuid: '角色:Alice',
                to_uuid: '角色:Bob',
                from_name: 'Alice',
                to_name: 'Bob',
                delta_weight: 0.1,
                evidence_quote: 'Alice 支援 Bob',
                event_name: '事件:EVOLVE:Alice→Bob',
                participants: [
                    { uuid: '角色:Alice', name: 'Alice', role: 'subject' },
                    { uuid: '角色:Bob', name: 'Bob', role: 'object' },
                ],
            }],
            judgeOut: { bio_sync_patch: [], identity_conflicts: [] },
            historianOut: { milestones: [], timeline_items: [] },
            entities: [
                { uuid: '角色:Alice', name: 'Alice', bio: '简介待补充' },
                { uuid: '角色:Bob', name: 'Bob', bio: '简介待补充' },
            ],
            turnId: 'turn_test',
            step: 1,
            conversationId: 'conv_test',
        });

        expect(out.committed).toBe(true);
        const query = tx.run.mock.calls
            .map(call => String(call[0] || ''))
            .find(text => text.includes('MATCH (ev:KGEvent {event_key: $eventKey})'));
        expect(query).toBeDefined();
        expect(query).toContain('WITH e');
    });
});
