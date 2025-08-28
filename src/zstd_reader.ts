// src/io/getFZSTD_Reader.ts
import ZstdWorker from "./zstd_worker";

const getFZSTD_Reader = (file: File, updateByteReads: (bytes: number) => void) => {
    const compressedReader = file.stream().getReader();
    const worker = new ZstdWorker();

    const outQueue: Uint8Array[] = [];
    let pendingResolve: ((v: Uint8Array | null) => void) | null = null;

    // end を受けても「すぐ閉じない」ためのフラグ
    let endedFromWorker = false;
    let eofSent = false;

    worker.onmessage = (e: MessageEvent) => {
        const { type } = e.data || {};
        if (type === "data") {
            const data = new Uint8Array(e.data.chunk);
            if (pendingResolve) {
                const resolve = pendingResolve; pendingResolve = null;
                resolve(data);
            } else {
                outQueue.push(data);
            }
        } else if (type === "progress") {
            // 消費済みバイトで進捗更新
            const bytes: number = e.data.bytes >>> 0;
            if (bytes > 0) updateByteReads(bytes);
        } else if (type === "end") {
            // すべての data を吐き切った“後”に閉じたい
            endedFromWorker = true;
            if (pendingResolve && outQueue.length === 0) {
                const resolve = pendingResolve; pendingResolve = null;
                resolve(null);
            }
        }
    };

    const decompressedStream = new ReadableStream<Uint8Array>({
        start() {},
        pull: async (controller) => {
            // 1) まず手元のキューを優先して吐く
            if (outQueue.length > 0) {
                controller.enqueue(outQueue.shift()!);
                return;
            }

            // 2) 既に worker 側は終了合図済み & キュー空 → 閉じる
            if (endedFromWorker) {
                controller.close();
                // 正常終了でも念のため掃除
                try { worker.terminate(); } catch {}
                return;
            }

            // 3) 次の伸長チャンクを待ちつつ、圧縮側を1ステップ進める
            const nextChunk = await new Promise<Uint8Array | null>(async (resolve) => {
                pendingResolve = resolve;

                const { done, value } = await compressedReader.read();

                if (done) {
                    if (!eofSent) {
                        eofSent = true;
                        const empty = new Uint8Array(0);
                        worker.postMessage({ type: "push", chunk: empty, isLast: true }, [empty.buffer]);
                        await compressedReader.cancel().catch(() => {});
                    }
                    return; // resolve は worker 側の "end" で行う
                }

                if (value && value.byteLength > 0) {
                    // 進捗は worker からの "progress" に統一
                    worker.postMessage({ type: "push", chunk: value, isLast: false }, [value.buffer]);
                }
            });

            if (nextChunk) {
                controller.enqueue(nextChunk);
                return;
            }

            // ここに来るのは "end" により resolve(null) されたとき
            controller.close();
            try { worker.terminate(); } catch {}
        },
        cancel: async () => {
            try { worker.postMessage({ type: "cancel" }); } catch {}
            try { worker.terminate(); } catch {}
            await compressedReader.cancel().catch(() => {});
        }
    });

    return decompressedStream.getReader();
};

export default getFZSTD_Reader;