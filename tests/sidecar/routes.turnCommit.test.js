import { describe, expect, test } from '@jest/globals';
import { createApp } from '../../src/sidecar/kg/app.js';

function listen(app) {
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                server,
                baseUrl: `http://127.0.0.1:${address.port}`,
            });
        });
    });
}

describe('kg sidecar routes', () => {
    test('turn commit returns rollback on identity conflict', async () => {
        const app = createApp();
        const { server, baseUrl } = await listen(app);

        try {
            const response = await fetch(`${baseUrl}/turn/commit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversation_id: 'c1',
                    turn_id: 't1',
                    step: 1,
                    user_message: '队长其实是卧底',
                    chat_window: [{ role: 'user', name: '玩家', text: '队长其实是卧底' }],
                    debug: { forceIdentityConflict: true },
                }),
            });

            const body = await response.json();
            expect(body.ok).toBe(false);
            expect(body.commit.status).toBe('ROLLED_BACK');
            expect(body.commit.reason_code).toBe('IDENTITY_CONFLICT');
        } finally {
            server.close();
        }
    });

    test('health endpoint works', async () => {
        const app = createApp();
        const { server, baseUrl } = await listen(app);

        try {
            const response = await fetch(`${baseUrl}/health/pipeline`);
            const body = await response.json();
            expect(response.status).toBe(200);
            expect(body.ok).toBe(true);
        } finally {
            server.close();
        }
    });
});
