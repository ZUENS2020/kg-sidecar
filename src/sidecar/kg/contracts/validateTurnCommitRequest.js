export function validateTurnCommitRequest(body) {
    if (!body || typeof body !== 'object') {
        return { ok: false, errorCode: 'INVALID_REQUEST', message: 'Request body must be an object.' };
    }

    if (!body.conversation_id || typeof body.conversation_id !== 'string') {
        return { ok: false, errorCode: 'INVALID_REQUEST', message: 'conversation_id is required.' };
    }

    if (!body.turn_id || typeof body.turn_id !== 'string') {
        return { ok: false, errorCode: 'INVALID_REQUEST', message: 'turn_id is required.' };
    }

    if (!Number.isInteger(body.step) || body.step < 0) {
        return { ok: false, errorCode: 'INVALID_REQUEST', message: 'step must be a non-negative integer.' };
    }

    if (typeof body.user_message !== 'string') {
        return { ok: false, errorCode: 'INVALID_REQUEST', message: 'user_message must be a string.' };
    }

    if (!Array.isArray(body.chat_window)) {
        return { ok: false, errorCode: 'INVALID_REQUEST', message: 'chat_window must be an array.' };
    }

    const dbConfig = body?.config?.db;
    if (!dbConfig || typeof dbConfig !== 'object') {
        return {
            ok: false,
            errorCode: 'INVALID_REQUEST',
            message: 'config.db is required and must be an object.',
        };
    }

    const provider = String(dbConfig.provider || '').toLowerCase();
    if (provider !== 'neo4j') {
        return {
            ok: false,
            errorCode: 'INVALID_REQUEST',
            message: 'config.db.provider must be neo4j.',
        };
    }

    const uri = String(dbConfig.uri || '').trim();
    const username = String(dbConfig.username || '').trim();
    const password = String(dbConfig.password || '').trim();
    if (!uri || !username || !password) {
        return {
            ok: false,
            errorCode: 'INVALID_REQUEST',
            message: 'neo4j db config requires uri, username, and password.',
        };
    }

    return { ok: true };
}
