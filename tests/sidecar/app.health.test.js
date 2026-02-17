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

describe('kg sidecar health', () => {
    test('GET /health/pipeline returns ready state and service id', async () => {
        const app = createApp();
        const { server, baseUrl } = await listen(app);

        try {
            const response = await fetch(`${baseUrl}/health/pipeline`);
            const body = await response.json();

            expect(response.status).toBe(200);
            expect(body.ok).toBe(true);
            expect(body.status).toBe('ready');
            expect(body.service).toBe('kg-sidecar');
        } finally {
            server.close();
        }
    });
});
