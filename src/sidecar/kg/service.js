import { TurnOrchestrator } from './orchestrator/turnOrchestrator.js';

let singleton = null;

export function getKgService() {
    if (!singleton) {
        singleton = new TurnOrchestrator();
    }

    return singleton;
}

export function createKgService() {
    return new TurnOrchestrator();
}
