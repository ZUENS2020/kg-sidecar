import { validateTurnCommitRequest } from '../contracts/validateTurnCommitRequest.js';
import { canCommit } from '../graph/commitGate.js';
import { GraphRepositoryFactory } from '../graph/repositoryFactory.js';
import { runTurnStateMachine } from './turnStateMachine.js';
import { ConversationLock } from '../runtime/conversationLock.js';
import { IdempotencyStore } from '../runtime/idempotencyStore.js';
import { retrieveEntities } from '../slots/retriever.js';
import { injectMemory } from '../slots/injector.js';
import { generateAssistantReply } from '../slots/actor.js';
import { extractActions } from '../slots/extractor.js';
import { judgeMutations } from '../slots/judge.js';
import { buildMilestones } from '../slots/historian.js';
import { buildModelRouteAudit, selectModelForSlot } from '../model/modelRouter.js';

function makeRollback(body, failedStage, reasonCode, reason, retryable = false) {
    return {
        ok: false,
        conversation_id: body.conversation_id,
        turn_id: body.turn_id,
        commit: {
            status: 'ROLLED_BACK',
            failed_stage: failedStage,
            reason_code: reasonCode,
            reason,
        },
        retryable,
    };
}

export class TurnOrchestrator {
    constructor() {
        this.lock = new ConversationLock();
        this.idempotencyStore = new IdempotencyStore();
        this.repositoryFactory = new GraphRepositoryFactory();
        this.turnStatus = new Map();
        this.turnRequests = new Map();
    }

    getTurnStatus(turnId) {
        return this.turnStatus.get(turnId) || null;
    }

    async retryTurn(turnId) {
        const request = this.turnRequests.get(turnId);
        if (!request) {
            return {
                ok: false,
                commit: {
                    status: 'ROLLED_BACK',
                    failed_stage: 'retry',
                    reason_code: 'TURN_NOT_FOUND',
                    reason: 'No stored request for turn id.',
                },
                retryable: false,
            };
        }

        return await this.commitTurn(request, { forceRetry: true });
    }

    async clearDatabase({ dbConfig = null } = {}) {
        const repositoryResolution = await this.repositoryFactory.resolveRepository(dbConfig || null);
        if (dbConfig?.provider === 'neo4j' && repositoryResolution.storage !== 'neo4j') {
            return {
                ok: false,
                reason_code: repositoryResolution.fallback_reason || 'NEO4J_UNAVAILABLE',
                reason: 'Neo4j repository is unavailable for clear operation.',
                storage: repositoryResolution.storage,
            };
        }

        const repository = repositoryResolution.repository;
        if (!repository?.clearGraph) {
            return {
                ok: false,
                reason_code: 'CLEAR_NOT_SUPPORTED',
                reason: 'Selected repository does not support clear operation.',
                storage: repositoryResolution.storage,
            };
        }

        const out = await repository.clearGraph();
        return {
            ...out,
            storage: repositoryResolution.storage,
        };
    }

    async commitTurn(body, options = {}) {
        const validation = validateTurnCommitRequest(body);
        if (!validation.ok) {
            const out = {
                ok: false,
                commit: {
                    status: 'ROLLED_BACK',
                    failed_stage: 'validate',
                    reason_code: validation.errorCode,
                    reason: validation.message,
                },
                retryable: false,
            };
            this.turnStatus.set(body?.turn_id || 'unknown', out);
            return out;
        }

        const idempotencyKey = `${body.conversation_id}:${body.turn_id}`;
        if (!options.forceRetry) {
            const existing = this.idempotencyStore.get(idempotencyKey);
            if (existing && ['COMMITTED', 'ROLLED_BACK'].includes(existing.commit?.status)) {
                return existing;
            }
        }

        if (!this.lock.acquire(body.conversation_id)) {
            return {
                ok: false,
                conversation_id: body.conversation_id,
                turn_id: body.turn_id,
                commit: {
                    status: 'ROLLED_BACK',
                    failed_stage: 'lock',
                    reason_code: 'IN_PROGRESS',
                    reason: 'Another turn is processing this conversation.',
                },
                retryable: true,
            };
        }

        this.turnRequests.set(body.turn_id, structuredClone(body));

        try {
            const machine = await runTurnStateMachine(async (transition) => {
                const runtimeHasUserDirectories = Boolean(options.runtime?.userDirectories);
                const routedModels = {
                    retriever: selectModelForSlot({ slot: 'retriever', models: body?.config?.models }),
                    injector: selectModelForSlot({ slot: 'injector', models: body?.config?.models }),
                    actor: selectModelForSlot({ slot: 'actor', models: body?.config?.models }),
                    extractor: selectModelForSlot({ slot: 'extractor', models: body?.config?.models }),
                    judge: selectModelForSlot({ slot: 'judge', models: body?.config?.models }),
                    historian: selectModelForSlot({ slot: 'historian', models: body?.config?.models }),
                };
                const modelRouteAudit = buildModelRouteAudit({
                    models: body?.config?.models,
                    runtimeHasUserDirectories,
                });
                const repositoryResolution = await this.repositoryFactory.resolveRepository(body?.config?.db || null);
                const graphRepository = repositoryResolution.repository;
                const requiresStrongNeo4j = body?.config?.strong_consistency === true
                    && body?.config?.db?.provider === 'neo4j';
                if (requiresStrongNeo4j && repositoryResolution.storage !== 'neo4j') {
                    throw Object.assign(new Error('Neo4j unavailable under strong consistency mode.'), {
                        code: repositoryResolution.fallback_reason || 'NEO4J_UNAVAILABLE',
                        stage: 'repository',
                        retryable: true,
                    });
                }

                transition('RETRIEVING');
                const retrieverOut = await retrieveEntities({
                    userMessage: body.user_message,
                    chatWindow: body.chat_window,
                    step: body.step,
                    debug: body.debug,
                    config: body.config,
                    runtime: options.runtime,
                    graphRepository,
                    conversationId: body.conversation_id,
                });

                transition('INJECTING');
                const injectionOut = await injectMemory({
                    retrieverOut,
                    userMessage: body.user_message,
                    chatWindow: body.chat_window,
                    config: body.config,
                    runtime: options.runtime,
                });

                let assistantReply = '';
                if (body?.config?.disable_actor_slot === true) {
                    transition('ACTING');
                } else {
                    transition('ACTING');
                    assistantReply = await generateAssistantReply({
                        userMessage: body.user_message,
                        injectionOut,
                        modelConfig: body.config,
                        runtime: options.runtime,
                    });
                }

                transition('EXTRACTING');
                const extractorOut = await extractActions({
                    retrieverOut,
                    userMessage: body.user_message,
                    chatWindow: body.chat_window,
                    step: body.step,
                    config: body.config,
                    runtime: options.runtime,
                });

                transition('JUDGING');
                const judgeOut = await judgeMutations({
                    candidates: retrieverOut.candidates,
                    actions: extractorOut.actions,
                    globalAudit: extractorOut.global_audit,
                    chatWindow: body.chat_window,
                    debug: body.debug,
                    config: body.config,
                    runtime: options.runtime,
                });

                transition('HISTORIANING');
                const historianOut = await buildMilestones(extractorOut.actions, body.turn_id, {
                    globalAudit: extractorOut.global_audit,
                    chatWindow: body.chat_window,
                    config: body.config,
                    runtime: options.runtime,
                });

                if (!canCommit({ judgeOut, extractorOut, historianOut })) {
                    const reasonCode = (judgeOut.identity_conflicts?.length || 0) > 0
                        ? 'IDENTITY_CONFLICT'
                        : 'INVALID_STAGE_OUTPUT';
                    throw Object.assign(new Error('Commit gate blocked this turn.'), {
                        code: reasonCode,
                        stage: 'judge',
                        retryable: false,
                    });
                }

                transition('PREPARED');
                transition('COMMITTING');

                const tx = await graphRepository.commitMutation({
                    actions: extractorOut.actions,
                    judgeOut,
                    historianOut,
                    entities: retrieverOut.entities || retrieverOut.focus_entities || [],
                    turnId: body.turn_id,
                    step: body.step,
                    conversationId: body.conversation_id,
                });

                if (!tx.committed) {
                    throw Object.assign(new Error('Failed to commit transaction.'), {
                        code: 'NEO4J_TX_FAILED',
                        stage: 'commit',
                        retryable: true,
                    });
                }

                return {
                    conversation_id: body.conversation_id,
                    turn_id: body.turn_id,
                    assistant_reply: assistantReply,
                    injection_packet: injectionOut.injection_packet,
                    commit: {
                        status: 'COMMITTED',
                        neo4j_tx_id: tx.txId || `${body.turn_id}:tx`,
                        applied_actions: extractorOut.actions.length,
                        storage: tx.storage || 'memory',
                    },
                    graph_delta: {
                        evolve: extractorOut.actions.filter(x => x.action === 'EVOLVE').length,
                        replace: extractorOut.actions.filter(x => x.action === 'REPLACE').length,
                        delete: extractorOut.actions.filter(x => x.action === 'DELETE').length,
                    },
                    milestones: historianOut.milestones,
                    timeline_items: historianOut.timeline_items || [],
                    audit_summary: {
                        bio_sync_updated_entities: judgeOut.bio_sync_patch.length,
                        identity_conflicts: judgeOut.identity_conflicts.length,
                        storage_compare_items: extractorOut.global_audit?.storage_compare?.length || 0,
                    },
                    global_audit: extractorOut.global_audit,
                    model_routes: routedModels,
                    model_route_audit: modelRouteAudit,
                    storage_resolution: {
                        storage: repositoryResolution.storage,
                        fallback_reason: repositoryResolution.fallback_reason,
                    },
                };
            });

            if (!machine.ok) {
                const error = machine.error || {};
                const rollback = makeRollback(
                    body,
                    error.stage || 'unknown',
                    error.code || 'UNKNOWN_ERROR',
                    error.message || 'Unknown error',
                    Boolean(error.retryable),
                );

                this.turnStatus.set(body.turn_id, rollback);
                this.idempotencyStore.set(idempotencyKey, rollback);
                return rollback;
            }

            const committed = {
                ok: true,
                ...machine.output,
                pipeline_timeline: machine.timeline,
            };

            this.turnStatus.set(body.turn_id, committed);
            this.idempotencyStore.set(idempotencyKey, committed);
            return committed;
        } finally {
            this.lock.release(body.conversation_id);
        }
    }
}
