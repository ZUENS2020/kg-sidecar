import express from 'express';

import { createKgService } from './service.js';
import { createTurnRouter } from './routes/turnCommit.js';
import { createHealthRouter } from './routes/health.js';

export function createApp(service = createKgService()) {
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/turn', createTurnRouter(service));
    app.use('/health', createHealthRouter());
    return app;
}
