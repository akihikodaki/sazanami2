import getFZSTD_Reader from "./zstd_reader"

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

    /** 初期化：拡張子で判定し、必要なら zstd 伸長ストリームを用意（pull 駆動） */
    private async init_(): Promise<void> {
        if (this.initialized_) return;
        this.initialized_ = true;

        /** ファイル名から zstd かどうかを判定 */
        if (/\.(zst|zstd)(?:\.txt)?$/i.test(this.file_.name)) {
            this.isZstd_ = true;
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
