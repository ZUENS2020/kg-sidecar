import { createApp } from './app.js';

const app = createApp();
const port = Number(process.env.KG_SIDECAR_PORT || 8091);
const host = process.env.KG_SIDECAR_HOST || '127.0.0.1';

app.listen(port, host, () => {
    console.log(`KG sidecar listening on http://${host}:${port}`);
});
