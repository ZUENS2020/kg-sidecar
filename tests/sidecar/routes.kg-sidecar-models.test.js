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

describe('kg-sidecar models route', () => {
    test('builtin model list endpoint returns available models', async () => {
        const app = express();
        app.use('/api/kg-sidecar', kgRouter);
        const { server, baseUrl } = await listen(app);

        try {
            const response = await fetch(`${baseUrl}/api/kg-sidecar/models?provider=builtin`);
            const body = await response.json();
            expect(response.status).toBe(200);
            expect(body.ok).toBe(true);
            expect(body.provider).toBe('builtin');
            expect(Array.isArray(body.models)).toBe(true);
            expect(body.models.length).toBeGreaterThan(0);
        } finally {
            server.close();
        }
    });
});
