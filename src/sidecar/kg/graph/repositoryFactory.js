import { Neo4jGraphRepository } from './neo4jRepository.js';

function buildKey(dbConfig) {
    return `${dbConfig.uri}|${dbConfig.username}|${dbConfig.database || 'neo4j'}`;
}

function isNeo4jConfigValid(dbConfig) {
    return Boolean(
        dbConfig &&
        dbConfig.provider === 'neo4j' &&
        dbConfig.uri &&
        dbConfig.username &&
        dbConfig.password,
    );
}

export class GraphRepositoryFactory {
    constructor() {
        this.neo4jCache = new Map();
    }

    getRepository(dbConfig) {
        const key = buildKey(dbConfig);
        let repo = this.neo4jCache.get(key);

        if (!repo) {
            repo = new Neo4jGraphRepository({
                uri: dbConfig.uri,
                username: dbConfig.username,
                password: dbConfig.password,
                database: dbConfig.database || 'neo4j',
            });
            this.neo4jCache.set(key, repo);
        }

        return repo;
    }

    async resolveRepository(dbConfig) {
        if (!isNeo4jConfigValid(dbConfig)) {
            return {
                repository: null,
                storage: 'neo4j',
                fallback_reason: 'NEO4J_CONFIG_INVALID',
            };
        }

        const repo = this.getRepository(dbConfig);
        const healthy = await repo.healthCheck();
        if (!healthy) {
            return {
                repository: null,
                storage: 'neo4j',
                fallback_reason: 'NEO4J_UNAVAILABLE',
            };
        }

        return {
            repository: repo,
            storage: 'neo4j',
            fallback_reason: null,
        };
    }
}
