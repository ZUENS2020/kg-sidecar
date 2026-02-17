import express from 'express';

export function createHealthRouter() {
    const router = express.Router();

    router.get('/pipeline', (_request, response) => {
        return response.json({ ok: true, status: 'ready', service: 'kg-sidecar' });
    });

    return router;
}
