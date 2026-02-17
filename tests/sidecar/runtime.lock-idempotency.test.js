import { describe, expect, test } from '@jest/globals';
import { ConversationLock } from '../../src/sidecar/kg/runtime/conversationLock.js';
import { IdempotencyStore } from '../../src/sidecar/kg/runtime/idempotencyStore.js';

describe('ConversationLock', () => {
    test('second lock on same conversation is rejected', () => {
        const lock = new ConversationLock();
        expect(lock.acquire('conv-1')).toBe(true);
        expect(lock.acquire('conv-1')).toBe(false);
        lock.release('conv-1');
        expect(lock.acquire('conv-1')).toBe(true);
    });
});

describe('IdempotencyStore', () => {
    test('stores and reuses finalized entries', () => {
        const store = new IdempotencyStore();
        const key = 'c1:t1';
        expect(store.get(key)).toBeUndefined();
        store.set(key, { status: 'COMMITTED', body: { ok: true } });
        expect(store.get(key)?.status).toBe('COMMITTED');
    });
});

