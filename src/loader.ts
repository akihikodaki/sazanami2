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

    // 型推定用
    private rawBuffer_: { [column: string]: string[] };
    private detection_: { [column: string]: ColumnType };
    private detectionCount_: number;
    private detectionDone_: boolean;
    private static readonly TYPE_DETECT_COUNT = 100;
    private static readonly REPORT_INTERVAL = 1024 * 256;

    constructor() {
        this.lineNum = 1;
        this.headers_ = [];
        this.columns_ = {};
        this.types_ = {};
        this.stats_ = {};
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
        // 読み込み前に状態をリセット
        this.lineNum = 1;
        this.headers_ = [];
        this.columns_ = {};
        this.types_ = {};
        this.stats_ = {};
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
        if (this.lineNum === 1) {
            // ヘッダー行の設定
            this.headers_ = line.split("\t");
            this.headers_.forEach(header => {
                this.columns_[header] = [];
                this.types_[header] = 'string';
                this.stats_[header] = { min: Infinity, max: -Infinity };
                this.rawBuffer_[header] = [];
                this.detection_[header] = 'integer';
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
            } else if (!this.detectionDone_) {
                this.detectionCount_++;
                values.forEach((raw, index) => {
                    this.detectTypePhase_(this.headers_[index], raw ?? "");
                });
                if (this.detectionCount_ === Loader.TYPE_DETECT_COUNT) {
                    this.finalizeTypes_();
                    this.detectionDone_ = true;
                }
            } else {
                this.headers_.forEach((header, index) => {
                    this.processFixedType_(header, values[index] ?? "");
                });
            }
        }
    }

    /**
     * 型検出フェーズのロジックをここに集約
     */
    private detectTypePhase_(header: string, value: string): void {
        // バッファへ追加
        this.rawBuffer_[header].push(value);
        // 整数かどうか判定
        const isHex = /^0[xX][0-9A-Fa-f]+$/.test(value);
        const isInt = /^-?\d+$/.test(value);
        if (this.detection_[header] === 'integer' && !isHex && !isInt) {
            this.detection_[header] = 'string';
        }
    }

    /**
     * 型検出終了時に、buffered data を columns_ / stats_ に反映し、types_ を確定
     */
    private finalizeTypes_(): void {
        this.headers_.forEach(header => {
            const type = this.detection_[header];
            this.types_[header] = type;
            this.rawBuffer_[header].forEach(val => {
                if (type === 'integer') {
                    const num = /^0[xX]/.test(val) ? parseInt(val, 16) : parseInt(val, 10);
                    this.columns_[header].push(num);
                    const stat = this.stats_[header];
                    if (num < stat.min) stat.min = num;
                    if (num > stat.max) stat.max = num;
                } else {
                    this.columns_[header].push(val);
                }
            });
            delete this.rawBuffer_[header];
        });
    }

    /**
     * 型確定後：セルを columns_, stats_ に反映
     */
    private processFixedType_(header: string, value: string): void {
        if (this.types_[header] === 'integer') {
            const num = /^0[xX]/.test(value) ? parseInt(value, 16) : parseInt(value, 10);
            this.columns_[header].push(num);
            const stat = this.stats_[header];
            if (num < stat.min) stat.min = num;
            if (num > stat.max) stat.max = num;
        } else {
            this.columns_[header].push(value);
        }
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
