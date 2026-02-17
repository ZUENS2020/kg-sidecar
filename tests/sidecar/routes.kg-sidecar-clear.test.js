import express from 'express';
import { describe, expect, test } from '@jest/globals';
import { router as kgRouter } from '../../src/endpoints/kg-sidecar.js';

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

describe('kg-sidecar clear db route', () => {
    test('db clear requires explicit confirm flag', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/kg-sidecar', kgRouter);
        const { server, baseUrl } = await listen(app);

        try {
            const response = await fetch(`${baseUrl}/api/kg-sidecar/db/clear`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    config: {
                        db: { provider: 'memory' },
                    },
                }),
            });
            const body = await response.json();
            expect(response.status).toBe(400);
            expect(body.ok).toBe(false);
            expect(body.reason_code).toBe('CLEAR_CONFIRM_REQUIRED');
        } finally {
            server.close();
        }
    });

    test('db clear removes graph data for selected storage', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/kg-sidecar', kgRouter);
        const { server, baseUrl } = await listen(app);

        try {
            await fetch(`${baseUrl}/api/kg-sidecar/turn/commit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversation_id: 'clear_route_conv',
                    turn_id: 'clear_route_turn_1',
                    step: 1,
                    user_message: 'Alice trusts Bob',
                    chat_window: [{ role: 'user', name: 'Alice', text: 'Alice trusts Bob' }],
                    config: { db: { provider: 'memory' } },
                }),
            });

            const response = await fetch(`${baseUrl}/api/kg-sidecar/db/clear`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    confirm: true,
                    config: {
                        db: { provider: 'memory' },
                    },
                }),
            });
            const body = await response.json();

            expect(response.status).toBe(200);
            expect(body.ok).toBe(true);
            expect(body.storage).toBe('memory');
            expect(Number(body.deleted_nodes || 0)).toBeGreaterThan(0);
        } finally {
            server.close();
        }
    });
});

