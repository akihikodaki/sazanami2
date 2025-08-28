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

export class FileLineReader {
    private reader_!: ReadableStreamDefaultReader<Uint8Array>;
    private decoder_ = new TextDecoder('utf-8');
    private buffer_ = '';
    private bytesRead_ = 0; // 読み取ったバイト数
    private numLine_ = 0;
    private initialized_ = false;
    private isZstd_ = false;
    private canceled_ = false;

    constructor(private file_: File) {
    }

    /** 現在までの読み取り割合（0〜1）。空ファイルは 1。 */
    getProgress(): number {
        const total = this.file_.size;
        if (total === 0) return 1;
        return Math.min(1, this.bytesRead_ / total);
    }

    /** ファイル名から zstd かどうかを判定 */
    private inferIsZstdFromName_(name: string): boolean {
        return /\.(zst|zstd)(?:\.txt)?$/i.test(name);
    }

    /** 初期化：拡張子で判定し、必要なら zstd 伸長ストリームを用意（pull 駆動） */
    private async init_(): Promise<void> {
        if (this.initialized_) return;
        this.initialized_ = true;

        this.isZstd_ = this.inferIsZstdFromName_(this.file_.name);
        if (this.isZstd_) {
            this.reader_ = getFZSTD_Reader(this.file_, (bytes) => {
                this.bytesRead_ += bytes;
            });
        }
        else {
            this.reader_ = this.file_.stream().getReader();
        }
    }

    /** 次の行を読み込む。トレイリング改行なし。EOF で null。 */
    private async readLine_(): Promise<string | null> {

        this.numLine_++;
        if (this.numLine_ % 50000 === 0) {
            // UI の更新を待つために一瞬スリープをいれる
            await new Promise(r => setTimeout(r, 0)); 
            if (this.canceled_) return null;
        }

        // まず内部バッファを確認
        let newlineIndex = this.buffer_.indexOf('\n');
        if (newlineIndex !== -1) {
            const line = this.buffer_.slice(0, newlineIndex);
            this.buffer_ = this.buffer_.slice(newlineIndex + 1);
            return line;
        }

        // 追加読み込み（必要になった分だけ pull で進む）
        while (true) {
            const { done, value } = await this.reader_.read();
            if (done) {
                // 終端で進捗を 100%
                this.bytesRead_ = this.file_.size;
                if (this.buffer_.length > 0) {
                    const line = this.buffer_;
                    this.buffer_ = '';
                    return line;
                }
                return null;
            }

            if (value) {
                this.buffer_ += this.decoder_.decode(value, { stream: true });
                // 非 zstd のときだけ、生バイトをここで進捗加算
                if (!this.isZstd_) {
                    this.bytesRead_ += value.byteLength;
                }
            }

            newlineIndex = this.buffer_.indexOf('\n');
            if (newlineIndex !== -1) {
                const line = this.buffer_.slice(0, newlineIndex);
                this.buffer_ = this.buffer_.slice(newlineIndex + 1);
                return line;
            }
        }
    }

    /** コールバックを受け取り、1行読み込むたびに onLineRead を呼ぶ。 */
    async load(
        onLineRead: (line: string) => void,
        finishCallback: () => void,
        errorCallback: (e: any) => void
    ): Promise<void> {
        try {
            await this.init_();

            let line: string | null;
            while ((line = await this.readLine_()) !== null) {
                onLineRead(line);
            }
            if (this.canceled_) 
                return;
            finishCallback();
        } catch (e) {
            errorCallback(e);
        }
    }

    cancel() {
        if (this.reader_) {
            this.reader_.cancel();
            this.canceled_ = true;
        }
    }
}
