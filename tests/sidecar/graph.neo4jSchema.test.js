import { describe, expect, test } from '@jest/globals';
import { CURRENT_SCHEMA_VERSION, getSchemaMigrationQueries } from '../../src/sidecar/kg/graph/neo4jSchema.js';

describe('neo4j schema migrations', () => {
    test('returns migration queries for empty schema', () => {
        const plan = getSchemaMigrationQueries(0);
        expect(plan.targetVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(plan.queries.length).toBeGreaterThan(0);
        expect(plan.queries.join('\n')).toContain('CREATE CONSTRAINT');
        expect(plan.queries.join('\n')).toContain('KGEvent');
        expect(plan.queries.join('\n')).toContain('entity_key');
    });
});
