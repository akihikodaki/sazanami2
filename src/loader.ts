import { FileLineReader } from "./file_line_reader";
import { GetDataView, DataViewIF } from "./data_view";

// カラムデータは整数列ならInt32Array、文字列列なら文字列配列
type ParsedColumns = { [column: string]: Int32Array | string[] };
type ColumnType = 'integer' | 'string' | 'raw_string';

interface ColumnStats {
    min: number;
    max: number;
}

// 動的に拡張可能な整数バッファ
class ColumnBuffer {
    private static readonly INITIAL_CAPACITY = 1024;

    buffer: Int32Array;
    type: ColumnType;

    // 文字列の種類が少ない場合，code で保持し，圧縮して持つ
    // code は 0 から始まる連続値
    codeDict: { [value: string]: number };  // 文字列に対応する code を格納
    stringList: string[];                   // code に対応する文字列のリスト

    raw_string: string[];                   // 文字列列用の文字列リスト
    length: number;

    constructor() {
        this.buffer = new Int32Array(ColumnBuffer.INITIAL_CAPACITY);
        this.length = 0;
        this.type = 'string';
        this.codeDict = {};
        this.stringList = [];
        this.raw_string = [];
    }

}

class Loader {
    private lineNum: number = 1;
    private numWarning: number = 0;

    private headers_: string[] = [];
    private headerIndex_: { [column: string]: number } = {};

    // データ保持: 常にIntegerColumnBuffer（最終列は別管理）
    private columnsArr_: ColumnBuffer[] = [];
    private lastColumnArr_: string[] = [];
    private statsArr_: ColumnStats[] = [];

    // 型検出用
    private rawBuffer_: { [column: string]: string[] } = {};
    private detection_: { [column: string]: ColumnType } = {};
    private detectionCount_: number = 0;
    private detectionDone_: boolean = false;
    private static readonly TYPE_DETECT_COUNT = 100;
    private static readonly REPORT_INTERVAL = 1024 * 256;

    constructor() {
        this.reset();
    }

    reset() {
        this.lineNum = 1;
        this.numWarning = 0;
        this.headers_ = [];
        this.headerIndex_ = {};
        this.columnsArr_ = [];
        this.lastColumnArr_ = [];
        this.statsArr_ = [];
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
        this.reset();
        reader.load(
            (line: string) => { // onLineRead
                this.parseLine_(line, errorCallback);
                if (this.lineNum % Loader.REPORT_INTERVAL === 0) {
                    progressCallback(this.lineNum, line);
                }
                this.lineNum++;
            },
            () => { // onFinish
                if (!this.detectionDone_) {
                    this.finalizeTypes_();
                }
                finishCallback();
            },
            (error: any) => {   // onError
                errorCallback(error, this.lineNum);
            }
        );
    }

    // ヘッダー行設定
    private parseHeader_(line: string): void {
        let values = line.split("\t");
        this.headers_ = values;

        // 全てIntegerColumnBufferで初期化
        this.columnsArr_ = values.map((_, i) => (new ColumnBuffer()));
        this.lastColumnArr_ = [];
        this.statsArr_ = values.map(() => ({ min: Infinity, max: -Infinity }));
        values.forEach((header, i) => {
            this.headerIndex_[header] = i;
            this.rawBuffer_[header] = [];
            this.detection_[header] = 'integer';
        });
    }

    private parseLine_(
        line: string,
        errorCallback: (error: any, lineNum: number) => void
    ): void {
        if (this.lineNum === 1) {
            this.parseHeader_(line);
        } else {
            let values = line.split("\t");
            if (values.length > this.headers_.length) {
                this.numWarning++;
                if (this.numWarning <= 10) {
                    errorCallback(
                        new Error(`Line:${this.lineNum} Expected ${this.headers_.length} columns, but got ${values.length}`),
                        this.lineNum
                    );
                }
                values = values.slice(0, this.headers_.length);
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
                    } else if (this.columnsArr_[index].type === 'integer') {
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
            this.columnsArr_[index].type = type;
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
        const codeDict = this.columnsArr_[index].codeDict;
        const strList = this.columnsArr_[index].stringList;
        let code: number;
        if (codeDict.hasOwnProperty(raw)) {
            code = codeDict[raw];
        } else {
            code = strList.length;
            codeDict[raw] = code;
            strList.push(raw);
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

    // タイプの辞書を作って返す
    public get types(): { [column: string]: ColumnType } {
        const result: { [column: string]: ColumnType } = {};
        this.headers_.forEach((header, i) => {
            result[header] = this.columnsArr_[i].type;
        });
        return result;
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
        const list = this.columnsArr_[idx].stringList;
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
        // stringList のシャローコピーを返す
        return [...this.columnsArr_[idx].stringList];
    }

    public GetDataView(): DataViewIF {
        return GetDataView(this);
    }
}

export { Loader, ParsedColumns, ColumnType, DataViewIF };
