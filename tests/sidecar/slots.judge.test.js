import { describe, expect, test } from '@jest/globals';
import { judgeMutations } from '../../src/sidecar/kg/slots/judge.js';

describe('Judge', () => {
    test('identity collision produces conflict and blocks commit', async () => {
        const out = await judgeMutations({
            candidates: [{ name: '队长', uuids: ['e1', 'e9'] }],
            actions: [{ action: 'REPLACE' }],
        });
        expect(out.identity_conflicts.length).toBeGreaterThan(0);
        expect(out.allowCommit).toBe(false);
    });

    test('single resolved candidate allows commit', async () => {
        const out = await judgeMutations({
            candidates: [{ name: '队长', uuids: ['e1'] }],
            actions: [{ action: 'EVOLVE' }],
        });
        expect(out.identity_conflicts.length).toBe(0);
        expect(out.allowCommit).toBe(true);
    });

    test('replace action can generate bio sync patch with readable uuid', async () => {
        const out = await judgeMutations({
            candidates: [{ name: 'Alice', uuids: ['角色:Alice'] }],
            actions: [{
                action: 'REPLACE',
                from_uuid: '角色:Alice',
                old_label: 'ALLY',
                new_label: 'TRAITOR',
                evidence_quote: 'Alice 背叛 Bob',
            }],
            globalAudit: {
                bio_rewrites: [{
                    uuid: '角色:Alice',
                    before: '忠诚',
                    after: '偏执',
                    cause: '背叛事件',
                }],
            },
        });

        expect(out.allowCommit).toBe(true);
        expect(out.bio_sync_patch[0]).toEqual(expect.objectContaining({
            uuid: '角色:Alice',
        }));
    });
});
