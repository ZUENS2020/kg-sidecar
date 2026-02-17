function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function lowerText(value) {
    return String(value || '').toLowerCase();
}

function containsZuensSignal(turn) {
    const relationText = String(turn?.injection_packet?.third_person_relations || '');
    const milestoneText = Array.isArray(turn?.milestones) ? turn.milestones.join(' ') : '';
    const combined = `${relationText} ${milestoneText}`;
    return /zuens2020/i.test(combined);
}

export function summarizeLongDialogueRun({ expectedTurns = 20, turnResults = [] } = {}) {
    const summary = {
        expectedTurns: toNumber(expectedTurns, 20),
        totalTurns: Array.isArray(turnResults) ? turnResults.length : 0,
        committedTurns: 0,
        rolledBackTurns: 0,
        timeoutErrors: 0,
        graphDelta: {
            evolve: 0,
            replace: 0,
            delete: 0,
        },
        hasReplaceMilestone: false,
        hasZuensRecallSignal: false,
    };

    for (const turn of turnResults || []) {
        if (turn?.ok && turn?.commit?.status === 'COMMITTED') {
            summary.committedTurns += 1;
            summary.graphDelta.evolve += toNumber(turn?.graph_delta?.evolve, 0);
            summary.graphDelta.replace += toNumber(turn?.graph_delta?.replace, 0);
            summary.graphDelta.delete += toNumber(turn?.graph_delta?.delete, 0);
        } else if (turn?.commit?.status === 'ROLLED_BACK') {
            summary.rolledBackTurns += 1;
        }

        const reasonCode = lowerText(turn?.commit?.reason_code);
        const errorText = `${lowerText(turn?.error)} ${lowerText(turn?.reason)}`;
        if (reasonCode.includes('timeout') || errorText.includes('aborterror') || errorText.includes('timeout')) {
            summary.timeoutErrors += 1;
        }

        const milestones = Array.isArray(turn?.milestones) ? turn.milestones : [];
        if (milestones.some(item => /\[剧情里程碑\]/.test(String(item)) && /->/.test(String(item)))) {
            summary.hasReplaceMilestone = true;
        }
        if (containsZuensSignal(turn)) {
            summary.hasZuensRecallSignal = true;
        }
    }

    if (summary.graphDelta.replace > 0) {
        summary.hasReplaceMilestone = true;
    }

    return summary;
}

export function validateLongDialogueSummary(summary, options = {}) {
    const expectedTurns = toNumber(options.expectedTurns, summary?.expectedTurns || 20);
    const minCommitRatio = Number.isFinite(Number(options.minCommitRatio))
        ? Number(options.minCommitRatio)
        : 1;
    const requireReplaceMilestone = options.requireReplaceMilestone !== false;
    const requireZuensRecallSignal = options.requireZuensRecallSignal !== false;
    const requireNoTimeout = options.requireNoTimeout !== false;

    const totalTurns = toNumber(summary?.totalTurns, 0);
    const committedTurns = toNumber(summary?.committedTurns, 0);
    const timeoutErrors = toNumber(summary?.timeoutErrors, 0);
    const hasReplaceMilestone = Boolean(summary?.hasReplaceMilestone);
    const hasZuensRecallSignal = Boolean(summary?.hasZuensRecallSignal);
    const graphReplace = toNumber(summary?.graphDelta?.replace, 0);

    const failures = [];
    if (totalTurns < expectedTurns) {
        failures.push(`expected turns not met: expected=${expectedTurns}, actual=${totalTurns}`);
    }

    const ratio = expectedTurns > 0 ? committedTurns / expectedTurns : 0;
    if (ratio < minCommitRatio) {
        failures.push(`commit ratio below threshold: ratio=${ratio.toFixed(2)}, required=${minCommitRatio}`);
    }

    if (requireReplaceMilestone && !hasReplaceMilestone && graphReplace <= 0) {
        failures.push('replace milestone check failed');
    }

    if (requireZuensRecallSignal && !hasZuensRecallSignal) {
        failures.push('ZUENS2020 recall signal missing');
    }

    if (requireNoTimeout && timeoutErrors > 0) {
        failures.push(`timeout observed: count=${timeoutErrors}`);
    }

    return {
        ok: failures.length === 0,
        failures,
    };
}
