export class BroadcasterDebug {
    static debug;
    static setDebugger(debug) {
        this.debug = debug;
    }
    static log(msg) {
        if (this.debug) {
            this.debug.log(msg);
        }
    }
    static error(err, ignoreInTests = false) {
        if (this.debug) {
            this.debug.error(err);
        }
        if (process.env.NODE_ENV === 'test' && !ignoreInTests) {
            console.error(err);
        }
    }
}
//# sourceMappingURL=broadcaster-debug.js.map