export class FileLineReader {
    private reader: ReadableStreamDefaultReader<Uint8Array>;
    private decoder = new TextDecoder('utf-8');
    private buffer = '';

    constructor(private file: File) {
        this.reader = this.file.stream().getReader();
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

        // 改行がなければストリームから追加読み込み
        while (true) {
            const { done, value } = await this.reader.read();
            if (done) {
                if (this.buffer.length > 0) {
                    const line = this.buffer;
                    this.buffer = '';
                    return line;
                }
                return null;
            }
            this.buffer += this.decoder.decode(value, { stream: true });

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
