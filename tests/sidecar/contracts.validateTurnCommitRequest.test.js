import { describe, expect, test } from '@jest/globals';
import { validateTurnCommitRequest } from '../../src/sidecar/kg/contracts/validateTurnCommitRequest.js';

describe('validateTurnCommitRequest', () => {
    test('rejects payload without conversation_id', () => {
        const result = validateTurnCommitRequest({
            turn_id: 't1',
            step: 1,
            user_message: 'x',
            chat_window: [],
        });

        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('INVALID_REQUEST');
    });

    test('accepts valid payload', () => {
        const result = validateTurnCommitRequest({
            conversation_id: 'c1',
            turn_id: 't1',
            step: 1,
            user_message: 'x',
            chat_window: [],
        });

        expect(result.ok).toBe(true);
    });

    test('rejects neo4j config when required fields are missing', () => {
        const result = validateTurnCommitRequest({
            conversation_id: 'c1',
            turn_id: 't1',
            step: 1,
            user_message: 'x',
            chat_window: [],
            config: {
                db: {
                    provider: 'neo4j',
                    uri: 'bolt://127.0.0.1:7687',
                    username: '',
                    password: '',
                },
            },
        });

        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('INVALID_REQUEST');
        expect(result.message).toContain('neo4j');
    });
});
