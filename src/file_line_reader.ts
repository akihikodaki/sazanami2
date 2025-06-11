/**
 * FileLineReader: Webストリームを使って File を行単位で読み込むクラス。
 */
export class FileLineReader {
    private reader: ReadableStreamDefaultReader<Uint8Array>;
    private decoder = new TextDecoder('utf-8');
    private buffer = '';

    constructor(private file: File) {
        // ファイルのストリームからリーダーを取得
        this.reader = this.file.stream().getReader();
    }

    /**
     * 次の行を読み込む。
     * トレイリング改行なしの文字列を返すか、EOF で null を返す。
     */
    private async readLine(): Promise<string | null> {
        while (true) {
            const { done, value } = await this.reader.read();
            if (done) {
                // バッファに残ったテキストを返す
                if (this.buffer.length > 0) {
                    const line = this.buffer;
                    this.buffer = '';
                    return line;
                }
                return null;
            }
            // デコードしてバッファに追加
            this.buffer += this.decoder.decode(value, { stream: true });

            // 改行が含まれるかチェック
            const newlineIndex = this.buffer.indexOf('\n');
            if (newlineIndex !== -1) {
                // 改行までを1行として抽出
                const line = this.buffer.slice(0, newlineIndex);
                // バッファを更新
                this.buffer = this.buffer.slice(newlineIndex + 1);
                return line;
            }
        }
    }

    /**
     * コールバックを受け取り、1行読み込むたびに onLineRead を呼び出す。
     * @param onLineRead 行ごとに実行するコールバック関数
     */
    async readLinesWithCallback(onLineRead: (line: string) => void): Promise<void> {
        let line: string | null;
        while ((line = await this.readLine()) !== null) {
            onLineRead(line);
        }
    }
}
