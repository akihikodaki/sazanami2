import { FileLineReader } from "./file_line_reader";

type ParsedColumns = { [column: string]: (string | number)[] };
type ColumnType = 'integer' | 'string';

interface ColumnStats {
    min: number;
    max: number;
}

class Loader {
    lineNum = 1;                          // 読み込んだ行数
    private headers_: string[];          // ヘッダー行_
    private columns_: ParsedColumns;     // 解析結果_
    private types_: { [column: string]: ColumnType }; // カラムのタイプ
    private stats_: { [column: string]: ColumnStats }; // 整数カラムのmin/max
    private static readonly REPORT_INTERVAL = 1024 * 256;

    constructor() {
        this.lineNum = 1;
        this.headers_ = [];
        this.columns_ = {};
        this.types_ = {};
        this.stats_ = {};
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
        this.types_ = {};
        this.stats_ = {};

        reader.load(
            (line: string) => {
                this.parseLine_(line, errorCallback);
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
        if (this.lineNum === 1) {
            // ヘッダー行の設定
            this.headers_ = line.split("\t");
            this.headers_.forEach(header => {
                this.columns_[header] = [];
                this.types_[header] = 'string';
                this.stats_[header] = { min: Infinity, max: -Infinity };
            });
        } else {
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
                    const raw = values[index] ?? "";
                    this.processCell_(header, raw);
                });
            }
        }
    }

    /**
     * セルの値を解析し、columns_, types_, stats_を更新
     * @param header カラム名
     * @param value セルの文字列値
     */
    private processCell_(header: string, value: string): void {
        const hexRegex = /^0[xX][0-9A-Fa-f]+$/;
        const intRegex = /^-?\d+$/;
        if (hexRegex.test(value)) {
            const num = parseInt(value, 16);
            this.pushInteger_(header, num);
        } else if (intRegex.test(value)) {
            const num = parseInt(value, 10);
            this.pushInteger_(header, num);
        } else {
            this.types_[header] = 'string';
            this.columns_[header].push(value);
        }
    }

    /**
     * 整数値をcolumns_に追加し、stats_も更新
     */
    private pushInteger_(header: string, num: number): void {
        this.types_[header] = 'integer';
        this.columns_[header].push(num);
        const stat = this.stats_[header];
        if (num < stat.min) stat.min = num;
        if (num > stat.max) stat.max = num;
    }

    /**
     * 全カラムのデータを取得
     */
    public get columns(): ParsedColumns {
        return this.columns_;
    }

    /**
     * カラムごとの型情報を取得
     */
    public get types(): { [column: string]: ColumnType } {
        return this.types_;
    }

    /**
     * 整数カラムのmin/max情報を取得
     */
    public get stats(): { [column: string]: ColumnStats } {
        return this.stats_;
    }
}

export { Loader, ParsedColumns, ColumnType };
