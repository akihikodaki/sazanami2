import { FileLineReader } from "./file_line_reader";

type ParsedColumns = { [column: string]: string[] };

class Loader {
    lineNum = 1;                          // 読み込んだ行数
    private headers_: string[];          // ヘッダー行_
    private columns_: ParsedColumns;     // 解析結果_
    private static readonly REPORT_INTERVAL = 1024 * 256;

    constructor() {
        this.lineNum = 1;
        this.headers_ = [];
        this.columns_ = {};
    }

    /**
     * TSVファイルを読み込み、各列を配列としてcolumns_に格納
     */
    load(
        reader: FileLineReader,
        finishCallback: () => void,
        progressCallback: (lineNum: number, line: string) => void,
        errorCallback: (error: any, lineNum: number) => void
    ) {
        // 読み込み前に状態をリセット
        this.lineNum = 1;
        this.headers_ = [];
        this.columns_ = {};

        reader.load(
            (line: string) => {
                // 各行のパース
                this.parseLine_(line, errorCallback);

                // 一定間隔ごとに進捗コールバック
                if (this.lineNum % Loader.REPORT_INTERVAL === 0) {
                    progressCallback(this.lineNum, line);
                }
                this.lineNum++;
            },
            () => {
                finishCallback();
            },
            (error: any) => {
                errorCallback(error, this.lineNum);
            }
        );
    }

    private parseLine_(
        line: string,
        errorCallback: (error: any, lineNum: number) => void
    ): void {
        if (this.lineNum === 1) {            // ヘッダー行の設定
            this.headers_ = line.split("\t");
            this.headers_.forEach(header => {
                this.columns_[header] = [];
            });
        } else {            // データ行の解析
            const values = line.split("\t");
            if (values.length < this.headers_.length) {
                errorCallback(
                    new Error(
                        `Expected ${this.headers_.length} columns, but got ${values.length}`
                    ),
                    this.lineNum
                );
            } else {
                this.headers_.forEach((header, index) => {
                    this.columns_[header].push(values[index] ?? "");
                });
            }
        }
    }

    public get columns(): ParsedColumns {
        return this.columns_;
    }
}

export { Loader, ParsedColumns };
