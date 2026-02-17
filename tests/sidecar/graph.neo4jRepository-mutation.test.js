import { describe, expect, test, jest } from '@jest/globals';
import { applyRelationMutation } from '../../src/sidecar/kg/graph/neo4jRepository.js';

describe('neo4j relation mutation', () => {
    test('replace executes physical delete before creating new relation', async () => {
        const tx = { run: jest.fn(async () => ({})) };
        const params = {
            actionType: 'REPLACE',
            from: '角色:A',
            to: '角色:B',
            key: 'c:角色:A->角色:B',
        };

        await applyRelationMutation(tx, params);

        expect(tx.run).toHaveBeenCalledTimes(2);
        expect(tx.run.mock.calls[0][0]).toContain('DELETE r');
        expect(tx.run.mock.calls[1][0]).toContain('entity_key');
        expect(tx.run.mock.calls[1][0]).toContain('MERGE (a)-[r:KG_REL {key: $key}]->(b)');
        expect(tx.run.mock.calls[1][0]).toContain('r.name =');
    });
});
