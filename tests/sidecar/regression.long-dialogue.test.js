import {
    summarizeLongDialogueRun,
    validateLongDialogueSummary,
} from '../../src/sidecar/kg/regression/longDialogueRegression.js';

test('summarizeLongDialogueRun aggregates turn outcomes and graph deltas', () => {
    const summary = summarizeLongDialogueRun({
        expectedTurns: 4,
        turnResults: [
            {
                ok: true,
                commit: { status: 'COMMITTED' },
                graph_delta: { evolve: 1, replace: 0, delete: 0 },
                milestones: [],
                injection_packet: { third_person_relations: '关系网络观察: ZUENS2020' },
            },
            {
                ok: true,
                commit: { status: 'COMMITTED' },
                graph_delta: { evolve: 1, replace: 1, delete: 0 },
                milestones: ['[剧情里程碑] ALLY -> TRAITOR'],
                injection_packet: { third_person_relations: '关系网络观察: Seraphina, ZUENS2020' },
            },
            {
                ok: false,
                commit: { status: 'ROLLED_BACK', reason_code: 'IN_PROGRESS' },
            },
            {
                ok: false,
                error: 'AbortError',
                reason: 'timeout',
            },
        ],
    });

    expect(summary.expectedTurns).toBe(4);
    expect(summary.totalTurns).toBe(4);
    expect(summary.committedTurns).toBe(2);
    expect(summary.rolledBackTurns).toBe(1);
    expect(summary.timeoutErrors).toBe(1);
    expect(summary.graphDelta.evolve).toBe(2);
    expect(summary.graphDelta.replace).toBe(1);
    expect(summary.graphDelta.delete).toBe(0);
    expect(summary.hasReplaceMilestone).toBe(true);
    expect(summary.hasZuensRecallSignal).toBe(true);
});

test('validateLongDialogueSummary returns failures for weak regression results', () => {
    const out = validateLongDialogueSummary({
        expectedTurns: 20,
        totalTurns: 20,
        committedTurns: 15,
        rolledBackTurns: 5,
        timeoutErrors: 1,
        hasReplaceMilestone: false,
        hasZuensRecallSignal: false,
        graphDelta: { evolve: 4, replace: 0, delete: 0 },
    }, {
        minCommitRatio: 1,
        requireReplaceMilestone: true,
        requireZuensRecallSignal: true,
        requireNoTimeout: true,
    });

    expect(out.ok).toBe(false);
    expect(out.failures).toEqual(expect.arrayContaining([
        expect.stringContaining('commit ratio'),
        expect.stringContaining('replace milestone'),
        expect.stringContaining('ZUENS2020 recall'),
        expect.stringContaining('timeout'),
    ]));
});
