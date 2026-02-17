import { describe, expect, test } from '@jest/globals';
import { GraphRepositoryFactory } from '../../src/sidecar/kg/graph/repositoryFactory.js';
import { MemoryGraphRepository } from '../../src/sidecar/kg/graph/memoryRepository.js';
import { Neo4jGraphRepository } from '../../src/sidecar/kg/graph/neo4jRepository.js';

describe('GraphRepositoryFactory', () => {
    test('returns memory repository by default', () => {
        const factory = new GraphRepositoryFactory();
        const repo = factory.getRepository();
        expect(repo).toBeInstanceOf(MemoryGraphRepository);
    });

    test('returns neo4j repository when db config is complete', () => {
        const factory = new GraphRepositoryFactory();
        const repo = factory.getRepository({
            provider: 'neo4j',
            uri: 'bolt://127.0.0.1:7687',
            database: 'neo4j',
            username: 'neo4j',
            password: 'test',
        });
        expect(repo).toBeInstanceOf(Neo4jGraphRepository);
    });

    test('resolveRepository falls back to memory when neo4j health check fails', async () => {
        const factory = new GraphRepositoryFactory();
        const config = {
            provider: 'neo4j',
            uri: 'bolt://127.0.0.1:7687',
            database: 'neo4j',
            username: 'neo4j',
            password: 'test',
        };
        const repo = factory.getRepository(config);
        repo.healthCheck = async () => false;

        const resolved = await factory.resolveRepository(config);
        expect(resolved.repository).toBeInstanceOf(MemoryGraphRepository);
        expect(resolved.storage).toBe('memory');
        expect(resolved.fallback_reason).toBe('NEO4J_UNAVAILABLE');
    });
});
