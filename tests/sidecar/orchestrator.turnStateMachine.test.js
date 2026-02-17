import { describe, expect, test } from '@jest/globals';
import { runTurnStateMachine } from '../../src/sidecar/kg/orchestrator/turnStateMachine.js';

describe('runTurnStateMachine', () => {
    test('valid path reaches COMMITTED', async () => {
        const result = await runTurnStateMachine(async (transition) => {
            transition('RETRIEVING');
            transition('INJECTING');
            transition('ACTING');
            transition('EXTRACTING');
            transition('JUDGING');
            transition('HISTORIANING');
            transition('PREPARED');
            transition('COMMITTING');
            return { ok: true };
        });

        expect(result.state).toBe('COMMITTED');
        expect(result.timeline).toContain('COMMITTING');
    });
});
