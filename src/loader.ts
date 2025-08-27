import { FileLineReader } from "./file_line_reader";
import { GetDataView, DataViewIF } from "./data_view";

// STRING_CODE は，同一の文字列に対して連続したコードを割り当てる
// 文字列が多い場合は RAW_STRING にする
enum ColumnType { INTEGER, HEX, STRING_CODE, RAW_STRING};

class ColumnStats {
    min: number = Infinity;
    max: number = -Infinity;
}

// 動的に拡張可能なバッファ
class ColumnBuffer {
    private static readonly INITIAL_CAPACITY = 1024;

    // 格納タイプに応じて，buffer か string で持つかを変える
    type: ColumnType;
    length: number;

    buffer: Int32Array;
    rawStringList: string[]; // raw 文字列

    // 文字列の種類が少ない場合，code で保持し，圧縮して持つ
    // code は 0 から始まる連続値
    stringToCodeDict: { [value: string]: number };  // 文字列に対応する code を格納
    codeToStringList: string[];                     // code に対応する文字列のリスト

    // 統計情報
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
        // 色づけの際にコードが取得される場合がある
        if (this.type === ColumnType.RAW_STRING) {
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
    private rawStringMap_: { [column: string]: { [value: string]: number } } = {};

    private detectionCount_: number = 0;
    private detectionDone_: boolean = false;
    private static readonly TYPE_DETECT_COUNT = 2048;
    private static readonly REPORT_INTERVAL = 1024 * 256;
    private startTime_: number = 0;

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
        this.rawStringMap_ = {};
        this.detectionCount_ = 0;
        this.detectionDone_ = false;
        this.startTime_ = 0;
    }

    load(
        reader: FileLineReader,
        finishCallback: () => void,
        progressCallback: (progress: number, lineNum: number) => void,
        errorCallback: (error: any, lineNum: number) => void
    ) {
        this.reset();
        this.startTime_ = (new Date()).getTime();

        reader.load(
            (line: string) => { // onLineRead
                this.parseLine_(line, errorCallback);
                if (this.lineNum % Loader.REPORT_INTERVAL === 0) {
                    progressCallback(reader.getProgress(), this.lineNum);
                }
                this.lineNum++;
            },
            () => { // onFinish
                if (!this.detectionDone_) {
                    this.finalizeTypes_();
                }
                let elapsed = ((new Date()).getTime() - this.startTime_);
                console.log(`Loaded ${this.lineNum - 1} lines in ${elapsed} ms`);
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

        // データ列とタイプ検出用変数の初期化
        this.columnsArr_ = values.map((_, i) => (new ColumnBuffer()));
        values.forEach((header, i) => {
            this.headerIndex_[header] = i;
            this.rawBuffer_[header] = [];
            this.detection_[header] = ColumnType.INTEGER; // 初期は整数列
            this.rawStringMap_[header] = {};
        });
    }

    private parseLine_(
        line: string,
        errorCallback: (error: any, lineNum: number) => void
    ): void {
        line = line.trim();

        if (this.lineNum === 1) {
            this.parseHeader_(line);
        } else {
            let values = line.split("\t");

            // カラムに過不足がある場合
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
            while (values.length < this.headers_.length) {
                values.push("");    // 不足分は空文字で埋める
            }

            // TYPE_DETECT_COUNT までは型検出を行う
            if (!this.detectionDone_) { 
                this.detectionCount_++;
                values.forEach((raw, index) => {
                    this.detectType_(this.headers_[index], raw ?? ""); // null or undefined to empty string
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


    private detectType_(header: string, value: string): void {
        this.rawBuffer_[header].push(value);
        const isHex = /^(?:0[xX])?[0-9A-Fa-f]+$/.test(value);
        const isInt = /^-?\d+$/.test(value);

        // 16進数が現れたら HEX に変更
        if (this.detection_[header] < ColumnType.HEX && isHex && !isInt) {
            this.detection_[header] = ColumnType.HEX;
        }
        // 数値じゃ無いものが1度でも現れたら code に変更
        if (this.detection_[header] < ColumnType.STRING_CODE && !isHex && !isInt) {
            this.detection_[header] = ColumnType.STRING_CODE;
        }
        // 文字列の出現パターン数をカウントし，finalizeTypes_ で判定
        if (this.detection_[header] === ColumnType.STRING_CODE) {
            this.rawStringMap_[header][value] += 1;
        }
    }

    private finalizeTypes_(): void {
        this.headers_.forEach((header, index) => {
            // 文字列の出現パターン数をカウントし，一定割合を超えていたら raw string に
            if (Object.keys(this.rawStringMap_[header]).length > Loader.TYPE_DETECT_COUNT / 3) {
                this.detection_[header] = ColumnType.RAW_STRING;
            }

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
        if (col.type === ColumnType.INTEGER || col.type === ColumnType.HEX) {
            this.pushBufferValue_(index, raw);
        } else if (col.type === ColumnType.STRING_CODE) {
            this.pushStringCode_(index, raw);
        } else {
            this.pushRawString_(index, raw);
        }
    }

    // バッファサイズを拡張する
    private resizeBuffer_(index: number): void {
        const col = this.columnsArr_[index];
        if (col.length >= col.buffer.length) {
            const newBuf = new Int32Array(col.buffer.length * 2);
            newBuf.set(col.buffer);
            col.buffer = newBuf;
        }
    }

    /** Int32Array bufferに数値を追加 (整数・16進 or 10進) */
    private pushBufferValue_(index: number, raw: string): void {
        const col = this.columnsArr_[index];
        const num = col.type === ColumnType.HEX ? parseInt(raw, 16) : parseInt(raw, 10);
        if (col.length >= col.buffer.length) {
            this.resizeBuffer_(index);
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
            this.resizeBuffer_(index);
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

    public get headers(): string[] {
        return this.headers_;
    }

    public get columns(): ColumnBuffer[] {
        return this.columnsArr_;
    }

    public columnFromName(name: string): ColumnBuffer {
        return this.columnsArr_[this.headerIndex_[name]];
    }

    public get headerIndexDict(): { [column: string]: number } {
        return this.headerIndex_;
    }

    public get numRows(): number {
        // this.lineNum は次に読み込まれる行番号なので、
        // 実際に読み込んだ行数は lineNum - 1
        return this.lineNum - 1;
    }

    public GetDataView(): DataViewIF {
        return GetDataView(this);
    }
}

export { Loader, ColumnType, ColumnBuffer, DataViewIF };
