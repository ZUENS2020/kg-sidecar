import express from 'express';

export function createTurnRouter(service) {
    const router = express.Router();

    router.post('/commit', async (request, response) => {
        const result = await service.commitTurn(request.body || {});

        if (!result.ok && result.commit?.reason_code === 'INVALID_REQUEST') {
            return response.status(400).json(result);
        }

        if (!result.ok && result.commit?.reason_code === 'IN_PROGRESS') {
            return response.status(409).json(result);
        }

        if (!result.ok) {
            return response.status(422).json(result);
        }

        return response.json(result);
    });

    router.get('/status/:turnId', (request, response) => {
        const status = service.getTurnStatus(request.params.turnId);

        if (!status) {
            return response.status(404).json({ ok: false, reason: 'Turn not found.' });
        }

        return response.json({ ok: true, status });
    });

    router.post('/retry', async (request, response) => {
        const turnId = String(request.body?.turn_id || '');
        const result = await service.retryTurn(turnId);
        return response.status(result.ok ? 200 : 422).json(result);
    });

    return router;
}
