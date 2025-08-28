/// <reference lib="webworker" />
import * as fzstd from "fzstd";

const ctx = self as DedicatedWorkerGlobalScope;
const decompressor = new fzstd.Decompress();

decompressor.ondata = (chunk: Uint8Array) => {
    // fzstd が再利用する可能性のあるバッファを守るためにコピーを作る
    const out = new Uint8Array(chunk.byteLength);
    out.set(chunk); // ここでコピー
    
    // transfer するのは “コピーした側” の buffer のみ
    ctx.postMessage({ type: "data", chunk: out.buffer }, [out.buffer]);
};

ctx.onmessage = (e: MessageEvent) => {
    const { type, chunk, isLast } = e.data || {};
    switch (type) {
        case "push": {
            // 受け取った圧縮チャンクをデコーダへ投入
            const input = chunk ? new Uint8Array(chunk) : new Uint8Array(0);
            decompressor.push(input, !!isLast);
            if (isLast) {
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
