declare module 'pako' {
    export function deflate(data: Uint8Array, options?: { level?: number }): Uint8Array;
    export class Inflate {
        constructor(options?: { chunkSize?: number });
        err: number;
        msg: string;
        onData: (chunk: Uint8Array) => void;
        push(data: Uint8Array, final: boolean): boolean;
    }
}
