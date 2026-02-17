import { describe, expect, test } from '@jest/globals';
import { buildMilestones } from '../../src/sidecar/kg/slots/historian.js';

describe('Historian', () => {
    test('replace action generates milestone tag', async () => {
        const out = await buildMilestones([{ action: 'REPLACE', old_label: 'ALLY', new_label: 'TRAITOR' }], 'turn_1');
        expect(out.milestones[0]).toContain('[剧情里程碑]');
        expect(out.timeline_items[0].id).toMatch(/^里程碑:/);
    });
});
