export class FileLineReader {
    private reader: ReadableStreamDefaultReader<Uint8Array>;
    private decoder = new TextDecoder('utf-8');
    private buffer = '';
    private bytesRead = 0; // 読み取ったバイト数を累積
    private numBufferUpdate = 0;    // バッファ更新回数

    constructor(private file: File) {
        this.reader = this.file.stream().getReader();
    }

    /**
     * 現在までの読み取り割合（0〜1）を返す。
     * 空ファイルの場合は 1 を返す。
     */
    getProgress(): number {
        const total = this.file.size;
        if (total === 0) return 1;
        // 念のため上限を超えないようにクリップ
        return Math.min(1, this.bytesRead / total);
    }

    /**
     * 次の行を読み込む。
     * トレイリング改行なしの文字列を返すか、EOF で null を返す。
     */
    private async readLine(): Promise<string | null> {
        // まずバッファ内に改行がないかチェック
        let newlineIndex = this.buffer.indexOf('\n');
        if (newlineIndex !== -1) {
            const line = this.buffer.slice(0, newlineIndex);
            this.buffer = this.buffer.slice(newlineIndex + 1);
            return line;
        }

        this.numBufferUpdate++;
        if (this.numBufferUpdate % 10 === 0) {
            // UI の更新を待つために一瞬スリープをいれる
            await new Promise(r => setTimeout(r, 0));
        }

        // 改行がなければストリームから追加読み込み
        while (true) {
            const { done, value } = await this.reader.read();
            if (done) {
                // 読み取り完了として進捗を100%に
                this.bytesRead = this.file.size;
                if (this.buffer.length > 0) {
                    const line = this.buffer;
                    this.buffer = '';
                    return line;
                }
                return null;
            }

            // 読み込んだバイト数を累積
            if (value) {
                this.bytesRead += value.byteLength;
                this.buffer += this.decoder.decode(value, { stream: true });
            }

            newlineIndex = this.buffer.indexOf('\n');
            if (newlineIndex !== -1) {
                const line = this.buffer.slice(0, newlineIndex);
                this.buffer = this.buffer.slice(newlineIndex + 1);
                return line;
            }
        }
    }

    /**
     * コールバックを受け取り、1行読み込むたびに onLineRead を呼び出す。
     */
    async load(
        onLineRead: (line: string) => void,
        finishCallback: () => void,
        errorCallback: (e: any) => void
    ): Promise<void> {
        try {
            let line: string | null;
            while ((line = await this.readLine()) !== null) {
                onLineRead(line);
            }
            finishCallback();
        } catch (e) {
            errorCallback(e);
        }
    }
}
