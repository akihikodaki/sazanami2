import { FileLineReader } from "./file_line_reader";

type ParsedColumns = { [column: string]: (string | number)[] };
type ColumnType = 'integer' | 'string';

class Loader {
    lineNum = 1;                          // 読み込んだ行数
    private headers_: string[];          // ヘッダー行_
    private columns_: ParsedColumns;     // 解析結果_
    private types_: { [column: string]: ColumnType }; // カラムのタイプ
    private static readonly REPORT_INTERVAL = 1024 * 256;

    constructor() {
        this.lineNum = 1;
        this.headers_ = [];
        this.columns_ = {};
        this.types_ = {};
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
                this.types_[header] = 'string'; // デフォルトは文字列
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
                    const raw = values[index] ?? "";
                    this.processCell_(header, index, raw);
                });
            }
        }
    }

    /**
     * セルの値を解析し、columns_とtypes_を更新
     * @param header カラム名
     * @param index カラムインデックス（未使用）
     * @param value セルの値
     */
    private processCell_(header: string, index: number, value: string): void {
        const intRegex = /^-?\d+$/;
        if (intRegex.test(value)) {
            // 整数として認識
            const num = parseInt(value, 10);
            this.types_[header] = 'integer';
            this.columns_[header].push(num);
        } else {
            // 文字列として扱う
            this.types_[header] = 'string';
            this.columns_[header].push(value);
        }
    }

    public get columns(): ParsedColumns {
        return this.columns_;
    }

    /**
     * カラムごとの型情報を取得
     */
    public get types(): { [column: string]: ColumnType } {
        return this.types_;
    }
}

export { Loader, ParsedColumns, ColumnType };
