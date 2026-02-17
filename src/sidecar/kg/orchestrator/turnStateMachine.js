export async function runTurnStateMachine(executor) {
    let state = 'RECEIVED';
    const timeline = ['RECEIVED'];

    const transition = (nextState) => {
        state = nextState;
        timeline.push(nextState);
    };

    try {
        const output = await executor(transition);

        if (state !== 'COMMITTED') {
            transition('COMMITTED');
        }

        return {
            ok: true,
            state,
            timeline,
            output,
        };
    } catch (error) {
        if (state !== 'ROLLED_BACK') {
            transition('ROLLED_BACK');
        }

        return {
            ok: false,
            state,
            timeline,
            error,
        };
    }
}
