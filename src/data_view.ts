import { Loader, ColumnBuffer } from "./loader";

// ビュー仕様：軸は式（最大2変数）。__index__ を使うと行インデクス。
type ViewSpec = {
    axisX: string;                // 例: "__index__", "cu * 9 + wf", "Bank * 8 + (TblIdx % 8)"
    axisY: string;                // 例: "cycle", "__index__", "y0 * 1000 + y1"
    stateField?: string | null;   // 色（状態）列名。なければ null
};

interface DataViewIF {
    getX(i: number): number;
    getY(i: number): number;
    getState(i: number): number;
    getStartIdx(yStart: number): number;
    getEndIdx(yEnd: number): number;
    getMaxX(): number;
    getMaxY(): number;
    getMinY(): number;
    test(headers: string[]): boolean;
}

// ColumnBuffer と同等に使える最小限の型
interface NumberColumn {
    getNumber(i: number): number;
    stat: { min: number; max: number };
}

// 行インデクスを返す仮想カラム
class IndexColumn implements NumberColumn {
    private nRows: number;
    stat: { min: number; max: number };
    constructor(nRows: number) {
        this.nRows = nRows;
        this.stat = { min: 0, max: Math.max(0, nRows - 1) };
    }
    getNumber(i: number): number {
        return i;
    }
}

// 軸初期化引数（式を与える）
type AxisInit = {
    axis: string;     // "__index__" や "cu * 8 + (wf % 8)" など
};

// 軸の線形化・探索（式→コンパイル）
class AxisProjector {
    private expr: string = "";
    private varNames: string[] = [];                 // 式に出現する変数（最大2）
    private cols: NumberColumn[] = [];               // 変数に対応する列（IndexColumn を含む）
    private compiled!: (...args: number[]) => number;// new Function で作る合成関数
    private numRows = 0;

    private minLinear = 0;                           // データから実測した最小
    private maxLinear = 0;                           // データから実測した最大

    init(loader: Loader, axisInit: AxisInit, numRows: number) {
        this.expr = axisInit.axis.trim();
        this.numRows = numRows;

        // 変数抽出（識別子を列名と解釈、最大2個まで）
        this.varNames = AxisProjector.extractVariables(this.expr);
        if (this.varNames.length > 2) {
            throw new Error(`Axis expression uses more than 2 variables: ${this.expr}`);
        }

        // 対応する列を束縛（__index__ は仮想カラム）
        this.cols = this.varNames.map(name => {
            if (name === "__index__") return new IndexColumn(numRows);
            // ColumnBuffer を NumberColumn として扱う
            return loader.columnFromName(name) as unknown as NumberColumn;
        });

        // 安全性のため簡易サニタイズ（数字・演算子・括弧・空白・識別子のみ許可）
        if (!AxisProjector.isSafeExpression(this.expr)) {
            throw new Error(`Unsafe axis expression: ${this.expr}`);
        }

        // 変数名を引数名に置換して Function をコンパイル
        const argNames = this.varNames.map((_, i) => `v${i}raw`); // v0raw, v1raw
        const rewritten = AxisProjector.rewriteExpression(this.expr, this.varNames, argNames);
        const body = `return (${rewritten});`;
        this.compiled = new Function(...argNames, body) as (...args: number[]) => number;

        // 実データを 1 パスして min/max を実測（正確）
        if (numRows > 0) {
            let minV = Number.POSITIVE_INFINITY;
            let maxV = Number.NEGATIVE_INFINITY;
            for (let i = 0; i < numRows; i++) {
                const val = this.evalAt(i);
                if (val < minV) minV = val;
                if (val > maxV) maxV = val;
            }
            this.minLinear = Number.isFinite(minV) ? minV : 0;
            this.maxLinear = Number.isFinite(maxV) ? maxV : 0;
        } else {
            this.minLinear = 0;
            this.maxLinear = 0;
        }
    }

    // i 行目で式を評価（getNumber → コンパイル済み関数）
    value(i: number): number {
        return this.evalAt(i);
    }

    // 二分探索（ビット演算は使わない）
    lowerBound(target: number): number {
        let lo = 0;
        let hi = this.numRows;
        while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (this.value(mid) < target) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    getMin(): number { return this.minLinear; }
    getMax(): number { return this.maxLinear; }

    // 内部：i 行目の raw 値を取り出して compiled に渡す
    private evalAt(i: number): number {
        if (this.cols.length === 0) {
            // 変数が無い定数式
            return (this.compiled as () => number)();
        } else if (this.cols.length === 1) {
            const v0raw = this.cols[0].getNumber(i);
            return (this.compiled as (v0raw: number) => number)(v0raw);
        } else {
            const v0raw = this.cols[0].getNumber(i);
            const v1raw = this.cols[1].getNumber(i);
            return (this.compiled as (v0raw: number, v1raw: number) => number)(v0raw, v1raw);
        }
    }

    // 識別子抽出（簡易）：英数字と '_' からなる単語を列名候補に
    private static extractVariables(expr: string): string[] {
        const idRegex = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
        const disallow = new Set([
            // JS 予約語（最低限）
            "return","var","let","const","function","new","this","if","else","for","while","do","switch","case","break","continue","try","catch","finally","throw",
            "class","extends","super","import","export","default","delete","in","instanceof","typeof","void","yield","await","with","debugger",
            // グローバル識別子
            "Math","Number","String","Boolean","Array","Object","Date","JSON","RegExp","Infinity","NaN","undefined","null"
        ]);
        const vars = new Set<string>();
        let m: RegExpExecArray | null;
        while ((m = idRegex.exec(expr)) !== null) {
            const id = m[0];
            if (disallow.has(id)) continue;
            // 数字のみや即値は拾わない（この正規表現では数字始まりはヒットしない）
            vars.add(id);
        }
        return Array.from(vars);
    }

    // 変数名 → 引数名に安全に置換（単語境界）
    private static rewriteExpression(expr: string, vars: string[], args: string[]): string {
        let rewritten = expr;
        for (let i = 0; i < vars.length; i++) {
            const v = vars[i];
            const a = args[i];
            const re = new RegExp(`\\b${v}\\b`, "g");
            rewritten = rewritten.replace(re, a);
        }
        return rewritten;
    }

    // 許可トークンのみかの簡易チェック
    private static isSafeExpression(expr: string): boolean {
        // 許容：数字・小数点・空白・演算子 + - * / % () そして識別子・下線
        // セミコロンや =、?、:、{}、[] などは不許可
        const safe = /^[0-9\s+\-*/%().A-Za-z_]+$/.test(expr);
        return safe;
    }
}

// 汎用 DataView 実装（式ベース）
class UnifiedDataView implements DataViewIF {
    private spec!: ViewSpec;

    private xAxis = new AxisProjector();
    private yAxis = new AxisProjector();
    private stateCol: ColumnBuffer | null = null;
    private numRows_ = 0;

    test(_headers: string[]): boolean {
        return true;
    }

    init(loader: Loader, spec: ViewSpec) {
        this.spec = spec;
        this.numRows_ = loader.numRows;

        this.xAxis.init(loader, { axis: spec.axisX }, this.numRows_);
        this.yAxis.init(loader, { axis: spec.axisY }, this.numRows_);

        this.stateCol = spec.stateField ? loader.columnFromName(spec.stateField) : null;
    }

    getX(i: number): number {
        return this.xAxis.value(i);
    }
    getY(i: number): number {
        return this.yAxis.value(i);
    }
    getState(i: number): number {
        if (!this.stateCol) return 0;
        return this.stateCol.getNumber(i);
    }

    getStartIdx(yStart: number): number {
        return this.yAxis.lowerBound(yStart);
    }
    getEndIdx(yEnd: number): number {
        return Math.min(this.yAxis.lowerBound(yEnd), this.numRows_);
    }

    getMaxX(): number {
        return this.xAxis.getMax();
    }
    getMaxY(): number {
        return this.yAxis.getMax();
    }
    getMinY(): number {
        return this.yAxis.getMin();
    }
}

// ヘッダから式を推論し、定数を埋め込む（radix/mod は式内にリテラル）
function inferViewSpec(loader: Loader): ViewSpec {
    const H = loader.headers;

    // ヘルパ：列の基数（= max+1）を取得
    const base = (name: string) => loader.columnFromName(name).stat.max + 1;

    // OpenCL 形：x = cu * (max(wf)+1) + wf, y = cycle
    if (hasAll(H, ["cycle", "cu", "wf"])) {
        const cycle = findHeader(H, "cycle")!;
        const cu = findHeader(H, "cu")!;
        const wf = findHeader(H, "wf")!;
        const state = findHeader(H, "state");
        const wfBase = base(wf);
        return {
            axisX: `${cu} * ${wfBase} + ${wf}`,
            axisY: `${cycle}`,
            stateField: state ?? null
        };
    }

    // TAGE 形：x = Bank * 8 + (TblIdx % 8), y = __index__
    if (hasAll(H, ["Bank", "TblIdx"])) {
        const bank = findHeader(H, "Bank")!;
        const tbl = findHeader(H, "TblIdx")!;
        const actual = findHeader(H, "Actual");
        // Bank の上位桁は 8（TblIdx の基数）を掛ける
        return {
            axisX: `${bank} * 8 + (${tbl} % 8)`,
            axisY: "__index__",
            stateField: actual ?? null
        };
    }

    // フォールバック：
    //   Y は先頭2列を可能なら線形化: y0 * base(y1) + y1
    //   X は次の2列を可能なら線形化: x0 * base(x1) + x1
    //   どれも無い場合は __index__
    const y0 = H[0];
    const x0 = H[1];
    const y1 = H[2];
    const x1 = H[3];
    const st = H[4] ?? null;

    const axisY =
        y0 && y1 ? `${y0} * ${base(y1)} + ${y1}` :
        y0 ? `${y0}` :
        "__index__";

    const axisX =
        x0 && x1 ? `${x0} * ${base(x1)} + ${x1}` :
        x0 ? `${x0}` :
        "__index__";

    return {
        axisX,
        axisY,
        stateField: st
    };
}

// 大文字小文字を無視した等価判定
function eqCI(a: string, b: string) { return a.toLowerCase() === b.toLowerCase(); }

// 指定名に一致するヘッダを検索
function findHeader(headers: string[], name: string): string | null {
    const hit = headers.find(h => eqCI(h, name));
    return hit ?? null;
}

// すべての列名が存在するか確認
function hasAll(headers: string[], names: string[]): boolean {
    return names.every(n => headers.some(h => eqCI(h, n)));
}

// エクスポート API
const GetDataView = (loader: Loader): DataViewIF => {
    const spec = inferViewSpec(loader);
    const view = new UnifiedDataView();
    (view as UnifiedDataView).init(loader, spec);
    return view;
};

export { DataViewIF, GetDataView };
