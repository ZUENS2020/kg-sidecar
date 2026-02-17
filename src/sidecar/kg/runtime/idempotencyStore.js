export class IdempotencyStore {
    #entries = new Map();

    get(key) {
        return this.#entries.get(key);
    }

    set(key, value) {
        this.#entries.set(key, value);
        return value;
    }
}
