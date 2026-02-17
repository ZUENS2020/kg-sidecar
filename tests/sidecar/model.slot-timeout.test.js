import { resolveOpenRouterSlotTimeoutMs } from '../../src/sidecar/kg/model/openRouterTextClient.js';

test('resolveOpenRouterSlotTimeoutMs prefers per-slot timeout over global timeout', () => {
    const timeoutMs = resolveOpenRouterSlotTimeoutMs({
        config: {
            openrouter_timeout_ms: 55000,
            slot_timeouts_ms: {
                retriever: 90000,
            },
        },
        slot: 'retriever',
        fallbackMs: 18000,
    });

    expect(timeoutMs).toBe(90000);
});

test('resolveOpenRouterSlotTimeoutMs uses global timeout when slot timeout is missing', () => {
    const timeoutMs = resolveOpenRouterSlotTimeoutMs({
        config: {
            timeout_ms: 72000,
        },
        slot: 'judge',
        fallbackMs: 12000,
    });

    expect(timeoutMs).toBe(72000);
});

test('resolveOpenRouterSlotTimeoutMs falls back for invalid values and enforces minimum', () => {
    const timeoutMs = resolveOpenRouterSlotTimeoutMs({
        config: {
            openrouter_timeout_ms: -1,
            slot_timeouts_ms: {
                historian: 'abc',
            },
        },
        slot: 'historian',
        fallbackMs: 800,
    });

    expect(timeoutMs).toBe(1000);
});
