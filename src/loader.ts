import { FileLineReader } from "./file_line_reader";

// カラムデータは整数列ならInt32Array、文字列列なら文字列配列
type ParsedColumns = { [column: string]: Int32Array | string[] };
type ColumnType = 'integer' | 'string' | 'raw_string';

interface ColumnStats {
    min: number;
    max: number;
}

// 動的に拡張可能な整数バッファ
interface IntegerColumnBuffer {
    buffer: Int32Array;
    length: number;
}

class Loader {
    lineNum = 1;
    private headers_: string[];
    private headerIndex_: { [column: string]: number };

    // データ保持: 常にIntegerColumnBuffer（最終列は別管理）
    private columnsArr_: IntegerColumnBuffer[];
    private lastColumnArr_: string[];
    private types_: { [column: string]: ColumnType };
    private statsArr_: ColumnStats[];
    private stringDictArr_: { [value: string]: number }[];
    private stringListArr_: string[][];

    // 型検出用
    private rawBuffer_: { [column: string]: string[] };
    private detection_: { [column: string]: ColumnType };
    private detectionCount_: number;
    private detectionDone_: boolean;
    private static readonly TYPE_DETECT_COUNT = 100;
    private static readonly REPORT_INTERVAL = 1024 * 256;
    private static readonly INITIAL_CAPACITY = 1024;

    constructor() {
        this.lineNum = 1;
        this.headers_ = [];
        this.headerIndex_ = {};
        this.columnsArr_ = [];
        this.lastColumnArr_ = [];
        this.types_ = {};
        this.statsArr_ = [];
        this.stringDictArr_ = [];
        this.stringListArr_ = [];
        this.rawBuffer_ = {};
        this.detection_ = {};
        this.detectionCount_ = 0;
        this.detectionDone_ = false;
    }

    load(
        reader: FileLineReader,
        finishCallback: () => void,
        progressCallback: (lineNum: number, line: string) => void,
        errorCallback: (error: any, lineNum: number) => void
    ) {
        // 初期化
        this.lineNum = 1;
        this.headers_ = [];
        this.headerIndex_ = {};
        this.columnsArr_ = [];
        this.lastColumnArr_ = [];
        this.types_ = {};
        this.statsArr_ = [];
        this.stringDictArr_ = [];
        this.stringListArr_ = [];
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
            const lastIdx = values.length - 1;
            // 全てIntegerColumnBufferで初期化
            this.columnsArr_ = values.map((_, i) => ({ buffer: new Int32Array(Loader.INITIAL_CAPACITY), length: 0 }));
            this.lastColumnArr_ = [];
            this.statsArr_ = values.map(() => ({ min: Infinity, max: -Infinity }));
            this.stringDictArr_ = values.map(() => ({}));
            this.stringListArr_ = values.map(() => []);
            values.forEach((header, i) => {
                this.headerIndex_[header] = i;
                this.types_[header] = 'string';
                this.rawBuffer_[header] = [];
                this.detection_[header] = 'integer';
            });
        } else {
            if (values.length > this.headers_.length) {
                errorCallback(
                    new Error(`Expected ${this.headers_.length} columns, but got ${values.length}`),
                    this.lineNum
                );
                return;
            }
            const lastIdx = this.headers_.length - 1;
            if (!this.detectionDone_) {
                this.detectionCount_++;
                values.forEach((raw, index) => {
                    this.detectTypePhase_(this.headers_[index], raw ?? "", index == lastIdx);
                });
                if (this.detectionCount_ === Loader.TYPE_DETECT_COUNT) {
                    this.finalizeTypes_();
                    this.detectionDone_ = true;
                }
            } else {
                values.forEach((raw, index) => {
                    const header = this.headers_[index];
                    const val = raw ?? "";
                    if (index === lastIdx) {
                        this.lastColumnArr_.push(val);
                    } else if (this.types_[header] === 'integer') {
                        this.pushBufferValue_(index, val);
                    } else {
                        // 文字列列も数値コードで格納
                        this.pushStringCode_(index, val);
                    }
                });
            }
        }
    }

    private detectTypePhase_(header: string, value: string, last: boolean): void {
        this.rawBuffer_[header].push(value);
        const isHex = /^0[xX][0-9A-Fa-f]+$/.test(value);
        const isInt = /^-?\d+$/.test(value);
        if (this.detection_[header] === 'integer' && !isHex && !isInt) {
            this.detection_[header] = last ? 'raw_string' : 'string';
        }
    }

    private finalizeTypes_(): void {
        const lastIdx = this.headers_.length - 1;
        this.headers_.forEach((header, index) => {
            const type = this.detection_[header];
            this.types_[header] = type;
            // last column handled separately
            // rawBufferからデータをバッファへ反映
            this.rawBuffer_[header].forEach(val => {
                if (index === lastIdx) {
                    this.lastColumnArr_.push(val);
                } else if (type === 'integer') {
                    this.pushBufferValue_(index, val);
                } else {
                    this.pushStringCode_(index, val);
                }
            });
            delete this.rawBuffer_[header];
        });
    }

    /** Int32Array bufferに数値を追加 (整数・16進 or 10進) */
    private pushBufferValue_(index: number, raw: string): void {
        const num = /^0[xX]/.test(raw) ? parseInt(raw, 16) : parseInt(raw, 10);
        const col = this.columnsArr_[index];
        if (col.length >= col.buffer.length) {
            const newBuf = new Int32Array(col.buffer.length * 2);
            newBuf.set(col.buffer);
            col.buffer = newBuf;
        }
        col.buffer[col.length] = num;
        col.length++;
        // stats更新
        const stat = this.statsArr_[index];
        if (num < stat.min) stat.min = num;
        if (num > stat.max) stat.max = num;
    }

    /** 文字列をコード化してbufferに追加 */
    private pushStringCode_(index: number, raw: string): void {
        const dict = this.stringDictArr_[index];
        const list = this.stringListArr_[index];
        let code: number;
        if (dict.hasOwnProperty(raw)) {
            code = dict[raw];
        } else {
            code = list.length;
            dict[raw] = code;
            list.push(raw);
        }
        // bufferに追加
        const col = this.columnsArr_[index];
        if (col.length >= col.buffer.length) {
            const newBuf = new Int32Array(col.buffer.length * 2);
            newBuf.set(col.buffer);
            col.buffer = newBuf;
        }
        col.buffer[col.length] = code;
        col.length++;
    }

    public get columns(): ParsedColumns {
        const result: ParsedColumns = {};
        const lastIdx = this.headers_.length - 1;
        this.headers_.forEach((header, i) => {
            if (i === lastIdx) {
                result[header] = this.lastColumnArr_;
            }
            else {
                result[header] = this.columnsArr_[i].buffer;
            }
        });
        return result;
    }

    public get types(): { [column: string]: ColumnType } {
        return this.types_;
    }

    public get stats(): { [column: string]: ColumnStats } {
        const result: { [column: string]: ColumnStats } = {};
        this.headers_.forEach((header, i) => {
            result[header] = this.statsArr_[i];
        });
        return result;
    }

    public get numRows(): number {
        // this.lineNum は次に読み込まれる行番号なので、
        // 実際に読み込んだ行数は lineNum - 1
        return this.lineNum - 1;
    }

    public getOriginalString(column: string, code: number): string {
        const idx = this.headerIndex_[column];
        if (idx == null || idx === this.headers_.length - 1) {
            throw new Error("Original string lookup is only valid for non-last string columns.");
        }
        const list = this.stringListArr_[idx];
        if (code < 0 || code >= list.length) {
            throw new Error(`Invalid code ${code} for column ${column}`);
        }
        return list[code];
    }

    public getDictionary(column: string): string[] {
        const idx = this.headerIndex_[column];
        if (idx == null || idx === this.headers_.length - 1) {
            throw new Error("Dictionary is only valid for non-last string columns.");
        }
        return [...this.stringListArr_[idx]];
    }

}

export { Loader, ParsedColumns, ColumnType };
