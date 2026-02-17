import { describe, expect, test } from '@jest/globals';
import { TurnOrchestrator } from '../../src/sidecar/kg/orchestrator/turnOrchestrator.js';
import { MemoryGraphRepository } from '../../src/sidecar/kg/graph/memoryRepository.js';

describe('TurnOrchestrator repository resolution', () => {
    test('rolls back when strong consistency requires neo4j but repository falls back', async () => {
        const orchestrator = new TurnOrchestrator();
        orchestrator.repositoryFactory.resolveRepository = async () => ({
            repository: new MemoryGraphRepository(),
            storage: 'memory',
            fallback_reason: 'NEO4J_UNAVAILABLE',
        });

        const result = await orchestrator.commitTurn({
            conversation_id: 'c_repo_1',
            turn_id: 't_repo_1',
            step: 1,
            user_message: 'Alice trusts Bob',
            chat_window: [{ role: 'user', name: 'Alice', text: 'Alice trusts Bob' }],
            config: {
                strong_consistency: true,
                db: {
                    provider: 'neo4j',
                    uri: 'bolt://127.0.0.1:7687',
                    database: 'neo4j',
                    username: 'neo4j',
                    password: 'test',
                },
            },
        });

        expect(result.ok).toBe(false);
        expect(result.commit.status).toBe('ROLLED_BACK');
        expect(result.commit.reason_code).toBe('NEO4J_UNAVAILABLE');
        expect(result.commit.failed_stage).toBe('repository');
    });
});
