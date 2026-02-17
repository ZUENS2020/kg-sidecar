import { describe, expect, test } from '@jest/globals';
import { computeDecayedWeight, decideAction, extractActions } from '../../src/sidecar/kg/slots/extractor.js';

describe('Extractor', () => {
    test('decayed weight below threshold triggers delete candidate', () => {
        const decayed = computeDecayedWeight(0.2, 50, 0.98);
        const action = decideAction({
            currentLabel: 'ALLY',
            detectedLabel: 'ALLY',
            decayedWeight: decayed,
            threshold: 0.12,
        });
        expect(action.action).toBe('DELETE');
    });

    test('label change triggers replace', () => {
        const action = decideAction({
            currentLabel: 'ALLY',
            detectedLabel: 'TRAITOR',
            decayedWeight: 0.5,
            threshold: 0.12,
        });
        expect(action.action).toBe('REPLACE');
        expect(action.old_label).toBe('ALLY');
        expect(action.new_label).toBe('TRAITOR');
    });

    test('extractor outputs global audit and readable event name', async () => {
        const out = await extractActions({
            retrieverOut: {
                focus_entities: [
                    { uuid: '角色:Alice', name: 'Alice' },
                    { uuid: '角色:Bob', name: 'Bob' },
                ],
                current_relations: [
                    {
                        from_uuid: '角色:Alice',
                        to_uuid: '角色:Bob',
                        from_name: 'Alice',
                        to_name: 'Bob',
                        label: 'ALLY',
                        weight: 0.7,
                        last_step: 1,
                    },
                ],
            },
            userMessage: 'Alice 怀疑 Bob 是叛徒',
            step: 2,
            config: {},
        });

        expect(Array.isArray(out.actions)).toBe(true);
        expect(out.actions[0].event_name).toMatch(/^事件:/);
        expect(out.global_audit).toEqual(expect.objectContaining({
            storage_compare: expect.any(Array),
            bio_rewrites: expect.any(Array),
        }));
    });
});
