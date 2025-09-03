import { Loader, ColumnBuffer } from "./loader";

// ビュー仕様
type ViewSpec = {
    // 軸は式（最大2変数）
    // __index__ を使うと仮想的に行インデクスになる
    axisX: string;                
    axisY: string;                

    // 色（状態）列名。なければ null
    stateField?: string | null;   
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
}

// ColumnBuffer と同等に使える最小限の型
// 仮想 行インデクスで使用
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

// 軸の線形化・探索（式→コンパイル）
class AxisProjector {
    private expr: string = "";
    private varNames: string[] = [];                  // 式に出現する変数（最大2）
    private cols: NumberColumn[] = [];                // 変数に対応する列（IndexColumn を含む）
    
    private compiledExp_!: (...args: number[]) => number;       // new Function で作る合成関数
    private fastExp_: ((i: number) => number) | null = null;    // fast path: 単一変数の恒等式なら直接列を読むクロージャ

    private numRows_ = 0;

    private min_ = 0;                           // 近似最小
    private max_ = 0;                           // 近似最大

    init(loader: Loader, axisExpr: string, numRows: number) {
        this.expr = axisExpr.trim();
        this.numRows_ = numRows;

        // 変数抽出（識別子を列名と解釈、最大2個まで）
        this.varNames = this.extractVariables_(this.expr);
        if (this.varNames.length > 2) {
            throw new Error(`Axis expression uses more than 2 variables: ${this.expr}`);
        }

        // 対応する列を束縛（__index__ は仮想カラム）
        this.cols = this.varNames.map(name => {
            if (name === "__index__") return new IndexColumn(numRows);
            return loader.columnFromName(name) as unknown as NumberColumn;
        });

        // 簡易サニタイズ（数字・演算子・括弧・空白・識別子のみ許可）
        if (!this.isSafeExpression_(this.expr)) {
            throw new Error(`Unsafe axis expression: ${this.expr}`);
        }

        if (this.varNames.length === 1 && this.isIdentityExpr_(this.expr, this.varNames[0])) {
            const c0 = this.cols[0];
            this.fastExp_ = (i: number) => c0.getNumber(i);
            this.min_ = c0.stat.min;
            this.max_ = c0.stat.max;
            return; // コンパイルは不要
        }

        // 変数名を引数名に置換して Function をコンパイル
        const argNames = this.varNames.map((_, i) => `v${i}raw`); // v0raw, v1raw
        const rewritten = this.rewriteExpression_(this.expr, this.varNames, argNames);
        const body = `return (${rewritten});`;
        this.compiledExp_ = new Function(...argNames, body) as (...args: number[]) => number;

        // min/max を「各列の min/max の組み合わせ評価」で推定する
        const k = this.cols.length;
        if (k === 0) {
            const v = (this.compiledExp_ as () => number)();
            this.min_ = v;
            this.max_ = v;
        } else if (k === 1) {
            const c0 = this.cols[0];
            const a = (this.compiledExp_ as (v0raw: number) => number)(c0.stat.min);
            const b = (this.compiledExp_ as (v0raw: number) => number)(c0.stat.max);
            this.min_ = Math.min(a, b);
            this.max_ = Math.max(a, b);
        } else {
            const c0 = this.cols[0];
            const c1 = this.cols[1];
            const eval2 = this.compiledExp_ as (v0raw: number, v1raw: number) => number;

            // 4つのコーナー（(min,min), (min,max), (max,min), (max,max)）
            const v00 = eval2(c0.stat.min, c1.stat.min);
            const v01 = eval2(c0.stat.min, c1.stat.max);
            const v10 = eval2(c0.stat.max, c1.stat.min);
            const v11 = eval2(c0.stat.max, c1.stat.max);

            this.min_ = Math.min(v00, v01, v10, v11);
            this.max_ = Math.max(v00, v01, v10, v11);
        }
    }

    // コンパイル済み関数を使って展開
    value(i: number): number {
        if (this.fastExp_) {
            return this.fastExp_(i);
        }
        
        const k = this.cols.length;
        let v0raw = 0, v1raw = 0;
        if (k >= 1) { v0raw = this.cols[0].getNumber(i); } 
        if (k >= 2) { v1raw = this.cols[1].getNumber(i); }
        return this.compiledExp_(v0raw, v1raw);
    }

    // 二分探索
    lowerBound(target: number): number {
        let lo = 0;
        let hi = this.numRows_;
        while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (this.value(mid) < target) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    getMin(): number { return this.min_; }
    getMax(): number { return this.max_; }
    
    // 式が単一変数の恒等式か（空白・外側の括弧は無視）
    private isIdentityExpr_(expr: string, varName: string): boolean {
        let s = expr.replace(/\s+/g, "");
        // 外側の括弧を可能な限り剥がす
        while (s.startsWith("(") && s.endsWith(")")) {
            s = s.slice(1, -1);
        }
        return s === varName;
    }

    // 識別子抽出（簡易）：英数字と '_' からなる単語を列名候補に
    private extractVariables_(expr: string): string[] {
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
            vars.add(id);
        }
        return Array.from(vars);
    }

    // 変数名 → 引数名に安全に置換（単語境界）
    private rewriteExpression_(expr: string, vars: string[], args: string[]): string {
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
    private isSafeExpression_(expr: string): boolean {
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

    init(loader: Loader, spec: ViewSpec) {
        this.spec = spec;
        this.numRows_ = loader.numRows;

        this.xAxis.init(loader, spec.axisX, this.numRows_);
        this.yAxis.init(loader, spec.axisY, this.numRows_);

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
const inferViewSpec = (loader: Loader): ViewSpec => {

    // ヘルパ：列の基数（= max+1）を取得
    const base = (name: string) => loader.columnFromName(name).stat.max + 1;

    // 大文字小文字を無視した等価判定
    const eqCI = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

    // 指定名に一致するヘッダを検索（大文字小文字無視）
    const findHeader = (headers: string[], name: string): string | null => {
        const hit = headers.find(h => eqCI(h, name));
        return hit ?? null;
    }

    // すべての列名が存在するか確認
    const hasAll = (headers: string[], names: string[]): boolean => {
        return names.every(n => headers.some(h => eqCI(h, n)));
    }

    const h = loader.headers;

    // OpenCL 形：x = cu * (max(wf)+1) + wf, y = cycle
    if (hasAll(h, ["cycle", "cu", "wf"])) {
        const cycle = findHeader(h, "cycle")!;
        const cu = findHeader(h, "cu")!;
        const wf = findHeader(h, "wf")!;
        const state = findHeader(h, "state");
        const wfBase = base(wf);
        return {
            axisX: `${cu} * ${wfBase} + ${wf}`,
            axisY: `${cycle}`,
            stateField: state ?? null
        };
    }

    // TAGE 形：x = Bank * 8 + (TblIdx % 8), y = __index__
    if (hasAll(h, ["Bank", "TblIdx"])) {
        const bank = findHeader(h, "Bank")!;
        const tbl = findHeader(h, "TblIdx")!;
        const actual = findHeader(h, "Actual");
        return {
            axisX: `${bank} * 8 + (${tbl} % 8)`,
            axisY: "__index__",
            stateField: actual ?? null
        };
    }

    // フォールバック：
    // 列数が1:  y = __index__ , x = 1列目
    // 列数が2:  y = 1列目     , x = 2列目
    // 列数>=3:  y = 1列目     , x = 2列目 , state = 3列目
    const n = h.length;
    if (n === 0) {
        // データが無い場合の安全策
        return { axisX: "__index__", axisY: "__index__", stateField: null };
    } else if (n === 1) {
        const c0 = h[0];
        return { axisX: `${c0}`, axisY: "__index__", stateField: null };
    } else if (n === 2) {
        const c0 = h[0], c1 = h[1];
        return { axisX: `${c1}`, axisY: `${c0}`, stateField: null };
    } else {
        const c0 = h[0], c1 = h[1], c2 = h[2];
        return { axisX: `${c1}`, axisY: `${c0}`, stateField: c2 };
    }
}

// エクスポート API
const GetDataView = (loader: Loader): DataViewIF => {
    const spec = inferViewSpec(loader);
    const view = new UnifiedDataView();
    view.init(loader, spec);
    return view;
};

export { DataViewIF, GetDataView };
