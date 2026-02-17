import neo4j from 'neo4j-driver';
import { ensureNeo4jSchema } from './neo4jSchema.js';
import { fromReadableEntityId } from '../model/openRouterTextClient.js';

function relationKey(conversationId, fromUuid, toUuid) {
    return `${conversationId}:${fromUuid}->${toUuid}`;
}

function sanitizeText(value, max = 2000) {
    return String(value ?? '').slice(0, max);
}

function normalizeNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function cleanEntityDisplayId(nameOrUuid) {
    const raw = String(nameOrUuid || '').trim();
    if (!raw) {
        return '';
    }
    if (raw.startsWith('角色:')) {
        return sanitizeText(fromReadableEntityId(raw) || raw.replace(/^角色:/, ''), 120);
    }
    return sanitizeText(raw.replace(/_/g, ' '), 120);
}

function cleanBio(value) {
    return sanitizeText(value || '简介待补充', 500) || '简介待补充';
}

export function buildRelEventId({ turnId, index = 0, action, fromUuid, toUuid, eventName }) {
    const fallbackName = `事件:${action}:${fromUuid}->${toUuid}`;
    const readable = String(eventName || fallbackName).replace(/^事件:/, '');
    return sanitizeText(`事件:${turnId}:${index + 1}:${readable}`, 240);
}

export function buildEventNodeKey({ turnId, index = 0, eventName }) {
    return sanitizeText(`事件节点:${turnId}:${index + 1}:${eventName || '未知事件'}`, 240);
}

export async function applyRelationMutation(tx, params) {
    if (params.actionType === 'DELETE') {
        await tx.run(`
            MATCH (:KGEntity {entity_key: $fromKey})-[r:KG_REL {key: $key}]->(:KGEntity {entity_key: $toKey})
            DELETE r
        `, params);
        return;
    }

    if (params.actionType === 'REPLACE') {
        await tx.run(`
            MATCH (:KGEntity {entity_key: $fromKey})-[r:KG_REL {key: $key}]->(:KGEntity {entity_key: $toKey})
            DELETE r
        `, params);

        await tx.run(`
            MERGE (a:KGEntity {entity_key: $fromKey})
            ON CREATE SET a.created_at = datetime()
            SET a.uuid = $fromKey,
                a.id = $fromId,
                a.name = $fromName,
                a.canonical_name = $fromName,
                a.bio = coalesce(a.bio, $fromBio),
                a.last_seen_step = $step,
                a.updated_at = datetime()
            MERGE (b:KGEntity {entity_key: $toKey})
            ON CREATE SET b.created_at = datetime()
            SET b.uuid = $toKey,
                b.id = $toId,
                b.name = $toName,
                b.canonical_name = $toName,
                b.bio = coalesce(b.bio, $toBio),
                b.last_seen_step = $step,
                b.updated_at = datetime()
            MERGE (a)-[r:KG_REL {key: $key}]->(b)
            SET r.conversation_id = $conversationId,
                r.last_turn_id = $turnId,
                r.last_step = $step,
                r.last_evidence_quote = $evidence,
                r.weight = 0.5,
                r.label = $newLabel,
                r.status = $newLabel,
                r.name = $newLabel,
                r.updated_at = datetime()
        `, params);
        return;
    }

    await tx.run(`
        MERGE (a:KGEntity {entity_key: $fromKey})
        ON CREATE SET a.created_at = datetime()
        SET a.uuid = $fromKey,
            a.id = $fromId,
            a.name = $fromName,
            a.canonical_name = $fromName,
            a.bio = coalesce(a.bio, $fromBio),
            a.last_seen_step = $step,
            a.updated_at = datetime()
        MERGE (b:KGEntity {entity_key: $toKey})
        ON CREATE SET b.created_at = datetime()
        SET b.uuid = $toKey,
            b.id = $toId,
            b.name = $toName,
            b.canonical_name = $toName,
            b.bio = coalesce(b.bio, $toBio),
            b.last_seen_step = $step,
            b.updated_at = datetime()
        MERGE (a)-[r:KG_REL {key: $key}]->(b)
        SET r.conversation_id = $conversationId,
            r.last_turn_id = $turnId,
            r.last_step = $step,
            r.last_evidence_quote = $evidence,
            r.weight = coalesce(r.weight, 0) + $deltaWeight,
            r.label = coalesce(r.label, 'ALLY'),
            r.status = coalesce(r.status, r.label, 'ALLY'),
            r.name = coalesce(r.name, r.status, r.label, 'ALLY'),
            r.updated_at = datetime()
    `, params);
}

export class Neo4jGraphRepository {
    constructor({ uri, username, password, database = 'neo4j' }) {
        this.uri = uri;
        this.username = username;
        this.password = password;
        this.database = database;
        this.driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
            connectionTimeout: 5000,
            connectionAcquisitionTimeout: 5000,
            maxTransactionRetryTime: 3000,
            maxConnectionPoolSize: 20,
        });
        this.readyTimeoutMs = 8000;
        this.readyPromise = null;
        this.schemaInfo = null;
    }

    async ensureReady() {
        if (this.readyPromise) {
            return this.readyPromise;
        }

        this.readyPromise = (async () => {
            await Promise.race([
                this.driver.verifyConnectivity(),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`Neo4j connectivity timeout after ${this.readyTimeoutMs} ms`)), this.readyTimeoutMs);
                }),
            ]);
            this.schemaInfo = await ensureNeo4jSchema({
                driver: this.driver,
                database: this.database,
            });
            return this.schemaInfo;
        })().catch((error) => {
            this.readyPromise = null;
            throw error;
        });

        return this.readyPromise;
    }

    async healthCheck() {
        try {
            await this.ensureReady();
            return true;
        } catch {
            return false;
        }
    }

    async resolveEntityCandidatesByName(name) {
        await this.ensureReady();
        const session = this.driver.session({ database: this.database, defaultAccessMode: neo4j.session.READ });
        try {
            const result = await session.executeRead((tx) => tx.run(`
                MATCH (e:KGEntity)
                WHERE toLower(e.name) = toLower($name)
                RETURN e.entity_key AS uuid, e.name AS name, e.bio AS bio
                LIMIT 5
            `, { name: sanitizeText(name, 80) }));

            return result.records.map((record) => ({
                uuid: record.get('uuid'),
                name: record.get('name'),
                bio: record.get('bio'),
            }));
        } finally {
            await session.close();
        }
    }

    async getRelation({ conversationId, fromUuid, toUuid }) {
        await this.ensureReady();
        const session = this.driver.session({ database: this.database, defaultAccessMode: neo4j.session.READ });
        try {
            const result = await session.executeRead((tx) => tx.run(`
                MATCH (a:KGEntity {entity_key: $from})-[r:KG_REL {key: $key}]->(b:KGEntity {entity_key: $to})
                RETURN a.entity_key AS from_uuid,
                       b.entity_key AS to_uuid,
                       r.label AS label,
                       r.weight AS weight,
                       r.last_step AS last_step
                LIMIT 1
            `, {
                from: fromUuid,
                to: toUuid,
                key: relationKey(conversationId, fromUuid, toUuid),
            }));

            if (result.records.length === 0) {
                return null;
            }

            const row = result.records[0];
            return {
                from_uuid: row.get('from_uuid'),
                to_uuid: row.get('to_uuid'),
                label: row.get('label'),
                weight: normalizeNumber(row.get('weight'), 0.5),
                last_step: normalizeNumber(row.get('last_step'), 0),
            };
        } finally {
            await session.close();
        }
    }

    async queryKeyEvents({
        conversationId,
        focusEntityUuids = [],
        limit = 4,
        currentStep = null,
        maxAgeSteps = 30,
    }) {
        await this.ensureReady();
        const session = this.driver.session({ database: this.database, defaultAccessMode: neo4j.session.READ });
        try {
            const focus = Array.isArray(focusEntityUuids)
                ? focusEntityUuids.map(x => String(x || '').trim()).filter(Boolean)
                : [];
            const topN = Math.max(1, Math.min(20, Number(limit) || 4));
            const maxAge = Math.max(1, Number(maxAgeSteps) || 30);
            const nowStep = Number.isFinite(Number(currentStep)) ? Number(currentStep) : -1;

            const result = await session.executeRead((tx) => tx.run(`
                MATCH (ev:KGEvent)-[:IN_TURN]->(t:KGTurn)
                WHERE ev.conversation_id = $conversationId
                OPTIONAL MATCH (entity:KGEntity)-[inv:INVOLVES]->(ev)
                WITH ev, t, collect({
                    uuid: entity.entity_key,
                    id: coalesce(entity.id, entity.name, entity.entity_key),
                    role: coalesce(inv.role, 'participant')
                }) AS participants
                WHERE size($focus) = 0
                   OR any(participant IN participants WHERE participant.uuid IN $focus)
                WITH ev, t, participants,
                     CASE
                        WHEN ev.action = 'REPLACE' THEN 3
                        WHEN ev.action = 'DELETE' THEN 2
                        ELSE 1
                     END AS actionPriority
                WHERE $nowStep < 0
                   OR abs($nowStep - coalesce(t.step, 0)) <= $maxAge
                RETURN ev.event_id AS event_id,
                       ev.action AS action,
                       ev.evidence_quote AS evidence_quote,
                       ev.turn_id AS turn_id,
                       t.step AS step,
                       participants AS participants,
                       actionPriority AS action_priority
                ORDER BY actionPriority DESC, t.step DESC
                LIMIT $limit
            `, {
                conversationId: sanitizeText(conversationId, 120),
                focus,
                nowStep,
                maxAge,
                limit: topN,
            }));

            return result.records.map((record) => {
                const step = normalizeNumber(record.get('step'), 0);
                const actionPriority = normalizeNumber(record.get('action_priority'), 1);
                const agePenalty = nowStep < 0 ? 0 : Math.max(0, Math.abs(nowStep - step));
                const recencyScore = nowStep < 0 ? 0 : (maxAge - Math.min(maxAge, agePenalty)) / maxAge;
                const scoreHint = Number((actionPriority * 2 + recencyScore).toFixed(3));
                return {
                    event_id: record.get('event_id'),
                    action: record.get('action'),
                    evidence_quote: record.get('evidence_quote'),
                    turn_id: record.get('turn_id'),
                    step,
                    participants: Array.isArray(record.get('participants')) ? record.get('participants') : [],
                    score_hint: scoreHint,
                };
            });
        } finally {
            await session.close();
        }
    }

    async commitMutation({ actions, judgeOut, historianOut, entities = [], turnId, step, conversationId }) {
        await this.ensureReady();
        const session = this.driver.session({ database: this.database });
        const entityByUuid = new Map((entities || []).map(entity => [entity.uuid, entity]));
        const ensureEntityParamsByUuid = new Map();

        for (const entity of entities || []) {
            if (!entity?.uuid) {
                continue;
            }
            const displayId = cleanEntityDisplayId(entity.name || entity.uuid);
            ensureEntityParamsByUuid.set(entity.uuid, {
                entityKey: entity.uuid,
                id: displayId || sanitizeText(entity.uuid, 120),
                name: displayId || sanitizeText(entity.uuid, 120),
                bio: cleanBio(entity.bio),
                step,
            });
        }

        try {
            await session.executeWrite(async (tx) => {
                await tx.run(`
                    MERGE (t:KGTurn {turn_id: $turnId})
                    ON CREATE SET t.created_at = datetime()
                    SET t.conversation_id = $conversationId,
                        t.step = $step,
                        t.updated_at = datetime()
                `, {
                    turnId,
                    conversationId,
                    step,
                });

                for (const params of ensureEntityParamsByUuid.values()) {
                    await tx.run(`
                        MERGE (e:KGEntity {entity_key: $entityKey})
                        ON CREATE SET e.created_at = datetime()
                        SET e.uuid = $entityKey,
                            e.entity_key = $entityKey,
                            e.id = $id,
                            e.name = $name,
                            e.canonical_name = $name,
                            e.bio = coalesce(e.bio, $bio),
                            e.last_seen_step = $step,
                            e.updated_at = datetime()
                    `, params);
                }

                for (const [index, action] of actions.entries()) {
                    const key = relationKey(conversationId, action.from_uuid, action.to_uuid);
                    const fromEntity = entityByUuid.get(action.from_uuid) || {};
                    const toEntity = entityByUuid.get(action.to_uuid) || {};
                    const eventName = sanitizeText(
                        action.event_name || `事件:${action.action}:${action.from_uuid}->${action.to_uuid}`,
                        180,
                    );
                    const fromDisplay = cleanEntityDisplayId(action.from_name || fromEntity.name || action.from_uuid);
                    const toDisplay = cleanEntityDisplayId(action.to_name || toEntity.name || action.to_uuid);
                    const fromBio = cleanBio(action.from_bio || fromEntity.bio);
                    const toBio = cleanBio(action.to_bio || toEntity.bio);
                    const params = {
                        fromKey: action.from_uuid,
                        toKey: action.to_uuid,
                        fromId: fromDisplay || sanitizeText(action.from_uuid, 120),
                        toId: toDisplay || sanitizeText(action.to_uuid, 120),
                        fromName: fromDisplay || sanitizeText(action.from_uuid, 120),
                        toName: toDisplay || sanitizeText(action.to_uuid, 120),
                        fromBio,
                        toBio,
                        key,
                        conversationId,
                        turnId,
                        step,
                        evidence: sanitizeText(action.evidence_quote, 500),
                        deltaWeight: normalizeNumber(action.delta_weight, 0),
                        newLabel: sanitizeText(action.new_label || '', 120),
                        oldLabel: sanitizeText(action.old_label || '', 120),
                        actionType: action.action,
                        eventName,
                        eventKey: buildEventNodeKey({
                            turnId,
                            index,
                            eventName,
                        }),
                        eventId: buildRelEventId({
                            turnId,
                            index,
                            action: action.action,
                            fromUuid: action.from_uuid,
                            toUuid: action.to_uuid,
                            eventName,
                        }),
                        cause: sanitizeText(action.cause || '', 500),
                    };

                    await applyRelationMutation(tx, params);

                    const participantsRaw = Array.isArray(action.participants) ? action.participants : [];
                    const participants = [];
                    const participantSeen = new Set();
                    const fallbackParticipants = [
                        { uuid: action.from_uuid, name: fromDisplay || action.from_uuid, bio: fromBio, role: 'subject' },
                        { uuid: action.to_uuid, name: toDisplay || action.to_uuid, bio: toBio, role: 'object' },
                        ...participantsRaw,
                    ];
                    for (const item of fallbackParticipants) {
                        const uuid = String(item?.uuid || '').trim();
                        if (!uuid || participantSeen.has(uuid)) {
                            continue;
                        }
                        participantSeen.add(uuid);
                        const id = cleanEntityDisplayId(item?.name || uuid) || sanitizeText(uuid, 120);
                        participants.push({
                            uuid,
                            id,
                            name: id,
                            bio: cleanBio(item?.bio),
                            role: sanitizeText(item?.role || 'participant', 40),
                        });
                    }

                    for (const participant of participants) {
                        await tx.run(`
                            MERGE (e:KGEntity {entity_key: $entityKey})
                            ON CREATE SET e.created_at = datetime()
                            SET e.uuid = $entityKey,
                                e.entity_key = $entityKey,
                                e.id = $id,
                                e.name = $name,
                                e.canonical_name = $name,
                                e.bio = coalesce(e.bio, $bio),
                                e.last_seen_step = $step,
                                e.updated_at = datetime()
                        `, {
                            entityKey: participant.uuid,
                            id: participant.id,
                            name: participant.name,
                            bio: participant.bio,
                            step,
                        });
                    }

                    await tx.run(`
                        MERGE (fromEntity:KGEntity {entity_key: $fromKey})
                        ON CREATE SET fromEntity.created_at = datetime()
                        SET fromEntity.uuid = $fromKey,
                            fromEntity.entity_key = $fromKey,
                            fromEntity.id = $fromId,
                            fromEntity.name = $fromName,
                            fromEntity.canonical_name = $fromName,
                            fromEntity.bio = coalesce(fromEntity.bio, $fromBio),
                            fromEntity.last_seen_step = $step,
                            fromEntity.updated_at = datetime()
                        MERGE (toEntity:KGEntity {entity_key: $toKey})
                        ON CREATE SET toEntity.created_at = datetime()
                        SET toEntity.uuid = $toKey,
                            toEntity.entity_key = $toKey,
                            toEntity.id = $toId,
                            toEntity.name = $toName,
                            toEntity.canonical_name = $toName,
                            toEntity.bio = coalesce(toEntity.bio, $toBio),
                            toEntity.last_seen_step = $step,
                            toEntity.updated_at = datetime()
                        WITH fromEntity, toEntity
                        MATCH (t:KGTurn {turn_id: $turnId})
                        MERGE (ev:KGRelEvent {event_id: $eventId})
                        ON CREATE SET ev.created_at = datetime()
                        SET ev.turn_id = $turnId,
                            ev.conversation_id = $conversationId,
                            ev.event_name = $eventName,
                            ev.action = $actionType,
                            ev.old_label = CASE WHEN $oldLabel = '' THEN null ELSE $oldLabel END,
                            ev.new_label = CASE WHEN $newLabel = '' THEN null ELSE $newLabel END,
                            ev.delta_weight = $deltaWeight,
                            ev.evidence_quote = $evidence,
                            ev.cause = CASE WHEN $cause = '' THEN null ELSE $cause END
                        MERGE (ev)-[:IN_TURN]->(t)
                        MERGE (ev)-[:FROM_ENTITY]->(fromEntity)
                        MERGE (ev)-[:TO_ENTITY]->(toEntity)
                    `, params);

                    await tx.run(`
                        MATCH (t:KGTurn {turn_id: $turnId})
                        MERGE (ev:KGEvent {event_key: $eventKey})
                        ON CREATE SET ev.created_at = datetime()
                        SET ev.event_id = $eventName,
                            ev.id = $eventName,
                            ev.name = $eventName,
                            ev.turn_id = $turnId,
                            ev.conversation_id = $conversationId,
                            ev.action = $actionType,
                            ev.evidence_quote = $evidence,
                            ev.updated_at = datetime()
                        MERGE (ev)-[:IN_TURN]->(t)
                    `, params);

                    for (const participant of participants) {
                        await tx.run(`
                            MERGE (e:KGEntity {entity_key: $entityKey})
                            ON CREATE SET e.created_at = datetime()
                            SET e.uuid = $entityKey,
                                e.entity_key = $entityKey,
                                e.id = $entityId,
                                e.name = $entityId,
                                e.canonical_name = $entityId,
                                e.bio = coalesce(e.bio, $bio),
                                e.last_seen_step = $step,
                                e.updated_at = datetime()
                            WITH e
                            MATCH (ev:KGEvent {event_key: $eventKey})
                            MERGE (e)-[r:INVOLVES]->(ev)
                            SET r.role = $role
                        `, {
                            entityKey: participant.uuid,
                            entityId: participant.id,
                            bio: participant.bio,
                            eventKey: params.eventKey,
                            role: participant.role,
                            step,
                        });
                    }
                }

                for (const patch of (judgeOut?.bio_sync_patch || [])) {
                    await tx.run(`
                        MERGE (e:KGEntity {entity_key: $uuid})
                        SET e.bio = $after,
                            e.bio_before = $before,
                            e.bio_last_cause = $cause,
                            e.bio_updated_at = datetime()
                    `, {
                        uuid: patch.uuid,
                        before: sanitizeText(patch.before, 500),
                        after: sanitizeText(patch.after, 500),
                        cause: sanitizeText(patch.cause, 500),
                    });
                }

                const timelineItems = Array.isArray(historianOut.timeline_items)
                    ? historianOut.timeline_items
                    : (historianOut.milestones || []).map((tag, index) => ({
                        id: `里程碑:${turnId}:${index + 1}`,
                        tag,
                    }));

                for (const item of timelineItems) {
                    await tx.run(`
                        MATCH (t:KGTurn {turn_id: $turnId})
                        MERGE (m:KGMilestone {milestone_id: $milestoneId})
                        ON CREATE SET m.created_at = datetime()
                        SET m.turn_id = $turnId,
                            m.conversation_id = $conversationId,
                            m.content = $content
                        MERGE (m)-[:IN_TURN]->(t)
                    `, {
                        turnId,
                        conversationId,
                        milestoneId: sanitizeText(item.id, 180),
                        content: sanitizeText(item.tag, 500),
                    });
                }
            });

            return {
                committed: true,
                txId: `${turnId}:neo4j`,
                storage: 'neo4j',
            };
        } catch (error) {
            return {
                committed: false,
                storage: 'neo4j',
                error,
            };
        } finally {
            await session.close();
        }
    }

    async clearGraph() {
        await this.ensureReady();
        const session = this.driver.session({ database: this.database });
        try {
            const result = await session.executeWrite(async (tx) => {
                const out = await tx.run(`
                    MATCH (n)
                    WHERE n:KGEntity OR n:KGTurn OR n:KGRelEvent OR n:KGEvent OR n:KGMilestone
                    WITH collect(n) AS nodes, count(n) AS deleted_nodes
                    FOREACH (node IN nodes | DETACH DELETE node)
                    RETURN deleted_nodes
                `);
                const deletedNodesRaw = out.records[0]?.get('deleted_nodes');
                const deletedNodes = normalizeNumber(
                    deletedNodesRaw && typeof deletedNodesRaw.toNumber === 'function'
                        ? deletedNodesRaw.toNumber()
                        : deletedNodesRaw,
                    0,
                );
                return deletedNodes;
            });

            return {
                ok: true,
                storage: 'neo4j',
                deleted_nodes: result,
                deleted_relationships: null,
            };
        } finally {
            await session.close();
        }
    }
}
