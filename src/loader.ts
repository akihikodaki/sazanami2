import { FileLineReader } from "./file_line_reader";
import { GetDataView, DataViewIF } from "./data_view";

// カラムデータは整数列ならInt32Array、文字列列なら文字列配列
type ParsedColumns = { [column: string]: ColumnBuffer };
enum ColumnType { INTEGER, STRING_CODE, RAW_STRING};

class ColumnStats {
    min: number = Infinity;
    max: number = -Infinity;
}

// 動的に拡張可能な整数バッファ
class ColumnBuffer {
    private static readonly INITIAL_CAPACITY = 1024;

    buffer: Int32Array;
    type: ColumnType;

    // 文字列の種類が少ない場合，code で保持し，圧縮して持つ
    // code は 0 から始まる連続値
    stringToCodeDict: { [value: string]: number };  // 文字列に対応する code を格納
    codeToStringList: string[];                     // code に対応する文字列のリスト

    rawStringList: string[];                   // 文字列列用の文字列リスト
    length: number;

    stat: ColumnStats;

    constructor() {
        this.buffer = new Int32Array(ColumnBuffer.INITIAL_CAPACITY);
        this.length = 0;
        this.type = ColumnType.INTEGER; // 初期は整数列
        this.stringToCodeDict = {};
        this.codeToStringList = [];
        this.rawStringList = [];
        this.stat = new ColumnStats();
    }

    get(index: number): number|string {
        if (this.type == ColumnType.RAW_STRING) {
            return this.rawStringList[index];
        }
        else {
            return this.buffer[index];
        }
    }

    getString(index: number): string {
        if (this.type === ColumnType.RAW_STRING) {
            return this.rawStringList[index];
        } else if (this.type === ColumnType.STRING_CODE) {
            const code = this.buffer[index];
            return this.codeToStringList[code];
        } else {
            return this.buffer[index].toString();
        }
    }

    getNumber(index: number): number {
        if (this.type === ColumnType.RAW_STRING || this.type === ColumnType.STRING_CODE) {
            throw new Error("Cannot get number from string column");
        }
        return this.buffer[index];
    }
}


class Loader {
    private lineNum: number = 1;
    private numWarning: number = 0;

    private headers_: string[] = [];
    private headerIndex_: { [column: string]: number } = {};

    // データ保持
    private columnsArr_: ColumnBuffer[] = [];

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
        values.forEach((header, i) => {
            this.headerIndex_[header] = i;
            this.rawBuffer_[header] = [];
            this.detection_[header] = ColumnType.INTEGER; // 初期は整数列
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
            if (!this.detectionDone_) { // 一定の行数までは型検出を行う
                this.detectionCount_++;
                values.forEach((raw, index) => {
                    this.detectTypePhase_(this.headers_[index], raw ?? ""); // null or undefined to empty string
                });
                if (this.detectionCount_ === Loader.TYPE_DETECT_COUNT) {
                    this.finalizeTypes_();
                    this.detectionDone_ = true;
                }
            } else {
                values.forEach((raw, index) => {
                    const val = raw ?? "";
                    this.pushValue(index, val);
                });
            }
        }
    }


    private detectTypePhase_(header: string, value: string): void {
        this.rawBuffer_[header].push(value);
        const isHex = /^0[xX][0-9A-Fa-f]+$/.test(value);
        const isInt = /^-?\d+$/.test(value);
        // 数値じゃ無いものが1度でも現れたら code に変更
        if (this.detection_[header] == ColumnType.INTEGER && !isHex && !isInt) {
            this.detection_[header] = ColumnType.STRING_CODE;
        }
        // 文字列が中に空白を含んでいるか，12文字より長い場合は文字列型に変更
        if (this.detection_[header] === ColumnType.STRING_CODE && (value.length > 12 || value.includes(" "))) {
            this.detection_[header] = ColumnType.RAW_STRING;
        }
    }

    private finalizeTypes_(): void {
        this.headers_.forEach((header, index) => {
            const type = this.detection_[header];
            this.columnsArr_[index].type = type;
            // rawBufferからデータをバッファへ反映
            this.rawBuffer_[header].forEach(val => {
                this.pushValue(index, val);
            });
            delete this.rawBuffer_[header];
        });
    }

    private pushValue(index: number, raw: string): void {
        const col = this.columnsArr_[index];
        if (col.type === ColumnType.INTEGER) {
            this.pushBufferValue_(index, raw);
        } else if (col.type === ColumnType.STRING_CODE) {
            this.pushStringCode_(index, raw);
        } else {
            this.pushRawString_(index, raw);
        }
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
        const stat = col.stat;
        if (num < stat.min) stat.min = num;
        if (num > stat.max) stat.max = num;
    }

    /** 文字列をコード化してbufferに追加 */
    private pushStringCode_(index: number, raw: string): void {
        const codeDict = this.columnsArr_[index].stringToCodeDict;
        const strList = this.columnsArr_[index].codeToStringList;
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

    // 文字列列の生データを追加
    private pushRawString_(index: number, raw: string): void {
        const col = this.columnsArr_[index];
        col.rawStringList.push(raw);
        col.length++;
    }

    public get columns(): ParsedColumns {
        const result: ParsedColumns = {};
        this.headers_.forEach((header, i) => {
            result[header] = this.columnsArr_[i];
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
            result[header] = this.columnsArr_[i].stat;
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
        if (idx == null) {
            throw new Error("Invalid column name: " + column);
        }
        const list = this.columnsArr_[idx].codeToStringList;
        if (code < 0 || code >= list.length) {
            throw new Error(`Invalid code ${code} for column ${column}`);
        }
        return list[code];
    }

    public getDictionary(column: string): string[] {
        const idx = this.headerIndex_[column];
        if (idx == null) {
            throw new Error("Invalid column name: " + column);
        }
        // stringList のシャローコピーを返す
        return [...this.columnsArr_[idx].codeToStringList];
    }

    public GetDataView(): DataViewIF {
        return GetDataView(this);
    }
}

export { Loader, ParsedColumns, ColumnType, ColumnBuffer, DataViewIF };
