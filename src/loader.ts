import { FileLineReader } from "./file_line_reader";

type ParsedColumns = { [column: string]: (string | number)[] };
type ColumnType = 'integer' | 'string';

interface ColumnStats {
    min: number;
    max: number;
}

class Loader {
    lineNum = 1;                                 // 読み込んだ行数
    private headers_: string[];                  // ヘッダー行_
    private headerIndex_: { [column: string]: number }; // ヘッダー名→インデックス
    private columnsArr_: (string | number)[][];  // インデックスアクセス用データ
    private types_: { [column: string]: ColumnType };   // カラムの型
    private statsArr_: ColumnStats[];            // インデックスアクセス用 stats
    private stringDictArr_: { [value: string]: number }[]; // 文字列辞書

    // 型検出用
    private rawBuffer_: { [column: string]: string[] };
    private detection_: { [column: string]: ColumnType };
    private detectionCount_: number;
    private detectionDone_: boolean;
    private static readonly TYPE_DETECT_COUNT = 100;
    private static readonly REPORT_INTERVAL = 1024 * 256;

    constructor() {
        this.lineNum = 1;
        this.headers_ = [];
        this.headerIndex_ = {};
        this.columnsArr_ = [];
        this.types_ = {};
        this.statsArr_ = [];
        this.stringDictArr_ = [];
        this.rawBuffer_ = {};
        this.detection_ = {};
        this.detectionCount_ = 0;
        this.detectionDone_ = false;
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
        // リセット
        this.lineNum = 1;
        this.headers_ = [];
        this.headerIndex_ = {};
        this.columnsArr_ = [];
        this.types_ = {};
        this.statsArr_ = [];
        this.stringDictArr_ = [];
        this.rawBuffer_ = {};
        this.detection_ = {};
        this.detectionCount_ = 0;
        this.detectionDone_ = false;

        reader.load(
            (line: string) => {
                this.parseLine_(line, errorCallback);
                if (this.lineNum % Loader.REPORT_INTERVAL === 0) {
                    progressCallback(this.lineNum, line);
                }
                this.lineNum++;
            },
            () => {
                if (!this.detectionDone_) {
                    this.finalizeTypes_();
                }
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
        const values = line.split("\t");
        if (this.lineNum === 1) {
            // ヘッダー行設定
            this.headers_ = values;
            this.columnsArr_ = values.map(() => []);
            this.statsArr_ = values.map(() => ({ min: Infinity, max: -Infinity }));
            this.stringDictArr_ = values.map(() => ({}));
            values.forEach((header, i) => {
                this.headerIndex_[header] = i;
                this.types_[header] = 'string';
                this.rawBuffer_[header] = [];
                this.detection_[header] = 'integer';
            });
        } else {
            if (values.length > this.headers_.length) {
                errorCallback(
                    new Error(
                        `Expected ${this.headers_.length} columns, but got ${values.length}`
                    ),
                    this.lineNum
                );
                return;
            }
            if (!this.detectionDone_) {
                this.detectionCount_++;
                values.forEach((raw, index) => {
                    const header = this.headers_[index];
                    this.detectTypePhase_(header, raw ?? "");
                });
                if (this.detectionCount_ === Loader.TYPE_DETECT_COUNT) {
                    this.finalizeTypes_();
                    this.detectionDone_ = true;
                }
            } else {
                // 型確定後
                values.forEach((raw, index) => {
                    const header = this.headers_[index];
                    if (this.types_[header] === 'integer') {
                        this.pushIntegerByIndex_(index, raw ?? "");
                    } else {
                        this.pushStringByIndex_(index, raw ?? "");
                    }
                });
            }
        }
    }

    /** 型検出フェーズのロジック */
    private detectTypePhase_(header: string, value: string): void {
        this.rawBuffer_[header].push(value);
        const isHex = /^0[xX][0-9A-Fa-f]+$/.test(value);
        const isInt = /^-?\d+$/.test(value);
        if (this.detection_[header] === 'integer' && !isHex && !isInt) {
            this.detection_[header] = 'string';
        }
    }

    /** 型検出終了時に buffer 反映 */
    private finalizeTypes_(): void {
        const lastIdx = this.headers_.length - 1;
        this.headers_.forEach((header, index) => {
            const type = this.detection_[header];
            this.types_[header] = type;
            this.rawBuffer_[header].forEach(val => {
                if (type === 'integer') {
                    this.pushIntegerByIndex_(index, val);
                } else {
                    this.pushStringByIndex_(index, val, index === lastIdx);
                }
            });
            delete this.rawBuffer_[header];
        });
    }

    /** 整数値を columnsArr_ と statsArr_ に追加 */
    private pushIntegerByIndex_(index: number, raw: string): void {
        const num = /^0[xX]/.test(raw) ? parseInt(raw, 16) : parseInt(raw, 10);
        this.columnsArr_[index].push(num);
        const stat = this.statsArr_[index];
        if (num < stat.min) stat.min = num;
        if (num > stat.max) stat.max = num;
    }

    /**
     * 文字列を辞書登録し、インデックスを columnsArr_ に追加
     * @param index カラムインデックス
     * @param raw   セル文字列
     * @param keepRawLast 最後の列なら生文字列を保持
     */
    private pushStringByIndex_(index: number, raw: string, keepRawLast: boolean = false): void {
        if (keepRawLast) {
            this.columnsArr_[index].push(raw);
        } else {
            const dict = this.stringDictArr_[index];
            if (!(raw in dict)) {
                dict[raw] = Object.keys(dict).length;
            }
            this.columnsArr_[index].push(dict[raw]);
        }
    }

    /** 全カラムのデータを取得（オブジェクト形式） */
    public get columns(): ParsedColumns {
        const result: ParsedColumns = {};
        this.headers_.forEach((header, i) => {
            result[header] = this.columnsArr_[i];
        });
        return result;
    }

    /** カラムの型情報を取得 */
    public get types(): { [column: string]: ColumnType } {
        return this.types_;
    }

    /** カラムの min/max 情報を取得 */
    public get stats(): { [column: string]: ColumnStats } {
        const result: { [column: string]: ColumnStats } = {};
        this.headers_.forEach((header, i) => {
            result[header] = this.statsArr_[i];
        });
        return result;
    }
}

export { Loader, ParsedColumns, ColumnType };
