function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isExtractorOutputValid(value) {
    return isPlainObject(value) && Array.isArray(value.actions);
}

export function isJudgeOutputValid(value) {
    return isPlainObject(value) && Array.isArray(value.identity_conflicts) && Array.isArray(value.bio_sync_patch);
}

export function isHistorianOutputValid(value) {
    return isPlainObject(value) && Array.isArray(value.milestones);
}
