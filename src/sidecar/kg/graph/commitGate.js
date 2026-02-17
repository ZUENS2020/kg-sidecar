import {
    isExtractorOutputValid,
    isHistorianOutputValid,
    isJudgeOutputValid,
} from '../contracts/stageContracts.js';

export function canCommit({ judgeOut, extractorOut, historianOut }) {
    if (!isExtractorOutputValid(extractorOut)) {
        return false;
    }

    if (!isJudgeOutputValid(judgeOut)) {
        return false;
    }

    if (historianOut && !isHistorianOutputValid(historianOut)) {
        return false;
    }

    if ((judgeOut.identity_conflicts?.length || 0) > 0) {
        return false;
    }

    if (judgeOut.allowCommit === false) {
        return false;
    }

    return true;
}
