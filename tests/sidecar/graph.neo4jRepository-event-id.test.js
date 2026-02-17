import { describe, expect, test } from '@jest/globals';
import { buildEventNodeKey, buildRelEventId } from '../../src/sidecar/kg/graph/neo4jRepository.js';

describe('Neo4jGraphRepository event id', () => {
    test('includes turn dimension so relation events do not overwrite across turns', () => {
        const base = {
            index: 0,
            action: 'EVOLVE',
            fromUuid: '角色:Alice',
            toUuid: '角色:Bob',
            eventName: '事件:EVOLVE:Alice→Bob',
        };

        const first = buildRelEventId({ ...base, turnId: 'turn_1' });
        const second = buildRelEventId({ ...base, turnId: 'turn_2' });

        expect(first).not.toBe(second);
        expect(first).toContain('turn_1');
        expect(second).toContain('turn_2');
    });

    test('event node key stays unique while event id stays human readable', () => {
        const key1 = buildEventNodeKey({
            turnId: 'turn_1',
            index: 0,
            eventName: '并肩作战',
        });
        const key2 = buildEventNodeKey({
            turnId: 'turn_2',
            index: 0,
            eventName: '并肩作战',
        });

        expect(key1).not.toBe(key2);
        expect(key1).toContain('并肩作战');
        expect(key2).toContain('并肩作战');
    });
});
