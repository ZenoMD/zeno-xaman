import { BroadcasterDebugger } from '../models/export-models.js';
export declare class BroadcasterDebug {
    private static debug;
    static setDebugger(debug: BroadcasterDebugger): void;
    static log(msg: string): void;
    static error(err: Error, ignoreInTests?: boolean): void;
}
