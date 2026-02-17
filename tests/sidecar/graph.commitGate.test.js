import { describe, expect, test } from '@jest/globals';
import { canCommit } from '../../src/sidecar/kg/graph/commitGate.js';

describe('canCommit', () => {
    test('commit blocked when judge has identity conflicts', () => {
        const ok = canCommit({
            judgeOut: { identity_conflicts: [{ x: 1 }], bio_sync_patch: [] },
            extractorOut: { actions: [{}] },
        });
        expect(ok).toBe(false);
    });

    test('commit allowed with valid actions and no conflicts', () => {
        const ok = canCommit({
            judgeOut: { identity_conflicts: [], bio_sync_patch: [] },
            extractorOut: { actions: [{ action: 'EVOLVE' }] },
        });
        expect(ok).toBe(true);
    });
});
