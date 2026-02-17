export class ConversationLock {
    #held = new Set();

    acquire(conversationId) {
        if (!conversationId || this.#held.has(conversationId)) {
            return false;
        }

        this.#held.add(conversationId);
        return true;
    }

    release(conversationId) {
        this.#held.delete(conversationId);
    }
}
