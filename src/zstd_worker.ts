/// <reference lib="webworker" />
import * as fzstd from "fzstd";

const ctx = self as DedicatedWorkerGlobalScope;
const decompressor = new fzstd.Decompress();

// 出力: コピーしてから transfer（detach 回避）
(decompressor as any).ondata = (chunk: Uint8Array) => {
    const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
    ctx.postMessage({ type: "data", chunk: ab }, [ab]);
};

ctx.onmessage = (e: MessageEvent) => {
    const { type, chunk, isLast } = e.data || {};
    switch (type) {
        case "push": {
            const input = chunk ? new Uint8Array(chunk) : new Uint8Array(0);
            // 伸長（同期で ondata が走る）
            decompressor.push(input, !!isLast);
            // この入力分を確実に消費したので進捗 ACK
            ctx.postMessage({ type: "progress", bytes: input.byteLength });

            if (isLast) {
                // すべての data を postMessage した後に end
                ctx.postMessage({ type: "end" });
                ctx.close();
            }
            break;
        }
        case "cancel": {
            try { (decompressor as any).ondata = null; } catch {}
            ctx.close();
            break;
        }
    }
};

// 型目的のダミー default（TS1192 回避）
export default (null as unknown) as { new (): Worker };
