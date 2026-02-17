export const CURRENT_SCHEMA_VERSION = 3;
const SCHEMA_META_NAME = 'kg-sidecar';

const MIGRATIONS = [
    {
        version: 1,
        queries: [
            'CREATE CONSTRAINT kg_schema_meta_name IF NOT EXISTS FOR (m:KGSchemaMeta) REQUIRE m.name IS UNIQUE',
            'CREATE CONSTRAINT kg_entity_uuid IF NOT EXISTS FOR (e:KGEntity) REQUIRE e.uuid IS UNIQUE',
            'CREATE CONSTRAINT kg_turn_turn_id IF NOT EXISTS FOR (t:KGTurn) REQUIRE t.turn_id IS UNIQUE',
            'CREATE CONSTRAINT kg_rel_event_id IF NOT EXISTS FOR (ev:KGRelEvent) REQUIRE ev.event_id IS UNIQUE',
            'CREATE CONSTRAINT kg_milestone_id IF NOT EXISTS FOR (m:KGMilestone) REQUIRE m.milestone_id IS UNIQUE',
        ],
    },
    {
        version: 2,
        queries: [
            'CREATE INDEX kg_turn_conversation IF NOT EXISTS FOR (t:KGTurn) ON (t.conversation_id)',
            'CREATE INDEX kg_entity_name IF NOT EXISTS FOR (e:KGEntity) ON (e.name)',
            'CREATE INDEX kg_rel_conversation IF NOT EXISTS FOR ()-[r:KG_REL]-() ON (r.conversation_id)',
            'CREATE INDEX kg_rel_last_step IF NOT EXISTS FOR ()-[r:KG_REL]-() ON (r.last_step)',
            'CREATE INDEX kg_event_conversation IF NOT EXISTS FOR (ev:KGRelEvent) ON (ev.conversation_id)',
            'CREATE INDEX kg_event_turn IF NOT EXISTS FOR (ev:KGRelEvent) ON (ev.turn_id)',
            'CREATE INDEX kg_milestone_conversation IF NOT EXISTS FOR (m:KGMilestone) ON (m.conversation_id)',
        ],
    },
    {
        version: 3,
        queries: [
            'CREATE CONSTRAINT kg_entity_key IF NOT EXISTS FOR (e:KGEntity) REQUIRE e.entity_key IS UNIQUE',
            'CREATE CONSTRAINT kg_event_key IF NOT EXISTS FOR (ev:KGEvent) REQUIRE ev.event_key IS UNIQUE',
            'CREATE INDEX kg_entity_id IF NOT EXISTS FOR (e:KGEntity) ON (e.id)',
            'CREATE INDEX kg_entity_bio IF NOT EXISTS FOR (e:KGEntity) ON (e.bio)',
            'CREATE INDEX kg_event_id IF NOT EXISTS FOR (ev:KGEvent) ON (ev.event_id)',
            `
                MATCH (e:KGEntity)
                SET e.entity_key = coalesce(e.entity_key, e.uuid, e.name),
                    e.id = coalesce(e.id, e.name, replace(e.uuid, '角色:', '')),
                    e.bio = coalesce(e.bio, '简介待补充')
            `,
            `
                MATCH (rev:KGRelEvent)-[:FROM_ENTITY]->(fromEntity:KGEntity)
                OPTIONAL MATCH (rev)-[:TO_ENTITY]->(toEntity:KGEntity)
                WITH rev, fromEntity, toEntity
                MERGE (ev:KGEvent {event_key: rev.event_id})
                ON CREATE SET ev.created_at = datetime()
                SET ev.event_id = coalesce(rev.event_name, rev.event_id),
                    ev.turn_id = rev.turn_id,
                    ev.conversation_id = rev.conversation_id,
                    ev.action = rev.action,
                    ev.evidence_quote = rev.evidence_quote,
                    ev.updated_at = datetime()
                MERGE (fromEntity)-[rf:INVOLVES]->(ev)
                SET rf.role = coalesce(rf.role, 'subject')
                FOREACH (_ IN CASE WHEN toEntity IS NULL THEN [] ELSE [1] END |
                    MERGE (toEntity)-[rt:INVOLVES]->(ev)
                    SET rt.role = coalesce(rt.role, 'object')
                )
            `,
        ],
    },
];

function asNumber(value, fallback = 0) {
    if (value && typeof value.toNumber === 'function') {
        return value.toNumber();
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

export function getSchemaMigrationQueries(fromVersion) {
    const currentVersion = asNumber(fromVersion, 0);
    const queries = MIGRATIONS
        .filter(item => item.version > currentVersion)
        .flatMap(item => item.queries);

    return {
        targetVersion: CURRENT_SCHEMA_VERSION,
        queries,
    };
}

export async function ensureNeo4jSchema({ driver, database = 'neo4j' }) {
    const session = driver.session({ database });
    try {
        const versionBefore = await session.executeWrite(async (tx) => {
            const out = await tx.run(`
                MERGE (m:KGSchemaMeta {name: $name})
                ON CREATE SET m.version = 0,
                              m.created_at = datetime(),
                              m.updated_at = datetime()
                RETURN m.version AS version
            `, { name: SCHEMA_META_NAME });
            return asNumber(out.records[0]?.get('version'), 0);
        });

        const plan = getSchemaMigrationQueries(versionBefore);
        if (plan.queries.length > 0) {
            for (const query of plan.queries) {
                await session.run(query);
            }

            await session.executeWrite(async (tx) => {
                await tx.run(`
                    MATCH (m:KGSchemaMeta {name: $name})
                    SET m.version = $version,
                        m.updated_at = datetime()
                `, {
                    name: SCHEMA_META_NAME,
                    version: plan.targetVersion,
                });
            });
        }

        return {
            schema_meta: SCHEMA_META_NAME,
            version_before: versionBefore,
            version_after: plan.targetVersion,
            migrations_applied: plan.queries.length,
        };
    } finally {
        await session.close();
    }
}
