// data_view.ts
import { Loader, ColumnBuffer } from "./loader";

// 軸と色の仕様
type ViewSpec = {
    axisXField: string;
    axisYField: string;
    stateField?: string | null;
};

// 行の仕様
type ColumnSpec = Record<string, string>;

// View と Columns をまとめた全体の仕様
type ViewDefinition = {
    view: ViewSpec;
    columns: ColumnSpec;
};

// 一致比較
export const isEqualViewDefinition = (a: ViewDefinition, b: ViewDefinition): boolean => {
    const va = a.view, vb = b.view;
    if (
        va.axisXField !== vb.axisXField ||
        va.axisYField !== vb.axisYField ||
        (va.stateField ?? null) !== (vb.stateField ?? null)
    ) {
        return false;
    }
    const ca = a.columns ?? {};
    const cb = b.columns ?? {};
    const aKeys = Object.keys(ca).sort();
    const bKeys = Object.keys(cb).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
        if (aKeys[i] !== bKeys[i]) return false;
        const k = aKeys[i];
        if (ca[k] !== cb[k]) return false;
    }
    return true;
};

// 内部で共有する最小インタフェース
interface NumberColumn {
    getNumber(i: number): number;
    stat: { min: number; max: number };
}

// 行インデクスを返す仮想カラム
class IndexColumn implements NumberColumn {
    stat: { min: number; max: number };
    private nRows_: number;

    constructor(nRows: number) {
        this.nRows_ = nRows;
        this.stat = { min: 0, max: Math.max(0, nRows - 1) };
    }

    getNumber(i: number): number {
        return i;
    }
}

// 仮想列で使用する式エンジン
class ExpressionProjector {
    private expr_ = "";
    private varNames_: string[] = [];
    private cols_: NumberColumn[] = [];
    private compiledExp_!: (...args: number[]) => number;
    private fastExp_: ((i: number) => number) | null = null;
    private numRows_ = 0;
    private min_ = 0;
    private max_ = 0;

    static isSafeExpression(expr: string): boolean {
        // 許容：数字・小数点・空白・演算子 + - * / % () 、識別子・下線
        // セミコロンや =、?、:、{}、[] などは禁止
        return /^[0-9\s+\-*/%().A-Za-z_]+$/.test(expr);
    }

    static extractVariables(expr: string): string[] {
        const idRegex = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
        const disallow = new Set([
            "return","var","let","const","function","new","this","if","else","for","while","do","switch","case",
            "break","continue","try","catch","finally","throw","class","extends","super","import","export","default",
            "delete","in","instanceof","typeof","void","yield","await","with","debugger",
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

    static isIdentityExpr(expr: string, varName: string): boolean {
        let s = expr.replace(/\s+/g, "");
        while (s.startsWith("(") && s.endsWith(")")) {
            s = s.slice(1, -1);
        }
        return s === varName;
    }

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

    init(resolveColumn: (name: string) => NumberColumn, expr: string, numRows: number) {
        this.expr_ = expr.trim();
        this.numRows_ = numRows;

        // 変数抽出（最大2）
        this.varNames_ = ExpressionProjector.extractVariables(this.expr_);
        if (this.varNames_.length > 2) {
            throw new Error(`Expression uses more than 2 variables: ${this.expr_}`);
        }

        // 列束縛
        this.cols_ = this.varNames_.map(name => resolveColumn(name));

        // サニタイズ
        if (!ExpressionProjector.isSafeExpression(this.expr_)) {
            throw new Error(`Unsafe expression: ${this.expr_}`);
        }

        // fast path: 単一変数の恒等式
        if (this.varNames_.length === 1 && ExpressionProjector.isIdentityExpr(this.expr_, this.varNames_[0])) {
            const c0 = this.cols_[0];
            this.fastExp_ = (i: number) => c0.getNumber(i);
            this.min_ = c0.stat.min;
            this.max_ = c0.stat.max;
            return;
        }

        // new Function コンパイル
        const argNames = this.varNames_.map((_, i) => `v${i}raw`);
        const rewritten = this.rewriteExpression_(this.expr_, this.varNames_, argNames);
        const body = `return (${rewritten});`;
        this.compiledExp_ = new Function(...argNames, body) as (...args: number[]) => number;

        // min/max 推定（列 min/max を用いたコーナー評価）
        const k = this.cols_.length;
        if (k === 0) {
            const v = (this.compiledExp_ as () => number)();
            this.min_ = v;
            this.max_ = v;
        } else if (k === 1) {
            const c0 = this.cols_[0];
            const a = (this.compiledExp_ as (v0raw: number) => number)(c0.stat.min);
            const b = (this.compiledExp_ as (v0raw: number) => number)(c0.stat.max);
            this.min_ = Math.min(a, b);
            this.max_ = Math.max(a, b);
        } else {
            const c0 = this.cols_[0];
            const c1 = this.cols_[1];
            const eval2 = this.compiledExp_ as (v0raw: number, v1raw: number) => number;
            const v00 = eval2(c0.stat.min, c1.stat.min);
            const v01 = eval2(c0.stat.min, c1.stat.max);
            const v10 = eval2(c0.stat.max, c1.stat.min);
            const v11 = eval2(c0.stat.max, c1.stat.max);
            this.min_ = Math.min(v00, v01, v10, v11);
            this.max_ = Math.max(v00, v01, v10, v11);
        }
    }

    value(i: number): number {
        if (this.fastExp_) return this.fastExp_(i);
        const k = this.cols_.length;
        let v0raw = 0, v1raw = 0;
        if (k >= 1) v0raw = this.cols_[0].getNumber(i);
        if (k >= 2) v1raw = this.cols_[1].getNumber(i);
        return this.compiledExp_(v0raw, v1raw);
    }

    getMin(): number { return this.min_; }
    getMax(): number { return this.max_; }
}

// 式の評価結果を返す仮想数値カラム 
class ExpressionColumn implements NumberColumn {
    readonly name: string;
    private projector_: ExpressionProjector;
    stat: { min: number; max: number };

    constructor(name: string, projector: ExpressionProjector) {
        this.name = name;
        this.projector_ = projector;
        this.stat = { min: projector.getMin(), max: projector.getMax() };
    }

    getNumber(i: number): number {
        return this.projector_.value(i);
    }
}

// 仮想カラムレジストリ
// 仮想列は他の仮想列を参照不可
class VirtualColumnRegistry {
    private defs_ = new Map<string, string>();           // name → expr
    private columns_ = new Map<string, NumberColumn>();   // name → 実体
    private loader_!: Loader;
    private numRows_ = 0;

    bind(loader: Loader) {
        this.loader_ = loader;
        this.numRows_ = loader.numRows;
    }

    add(name: string, expr: string) {
        const errors = collectColumnSpecErrors(this.loader_, { [name]: expr }, new Set(this.defs_.keys()));
        if (errors.length > 0) {
            throw new Error(errors.join("\n"));
        }
        this.defs_.set(name, expr);
    }

    list(): string[] {
        return Array.from(this.defs_.keys());
    }

    compileAll() {
        // 追加時に検証済みだが、未知列などの安全側チェックも再実施
        const errors = collectColumnSpecErrors(this.loader_, Object.fromEntries(this.defs_), new Set());
        if (errors.length > 0) {
            throw new Error(errors.join("\n"));
        }

        const resolveColumn = (name: string): NumberColumn => {
            if (name === "__index__") return new IndexColumn(this.numRows_);
            // 仮想列参照は不可（仕様）
            if (this.defs_.has(name) || this.columns_.has(name)) {
                throw new Error(`Virtual column may not reference another virtual column: ${name}`);
            }
            const col = this.loader_.columnFromName(name) as unknown as NumberColumn;
            if (!col || typeof col.getNumber !== "function") {
                throw new Error(`Unknown column: ${name}`);
            }
            return col;
        };

        for (const [name, expr] of this.defs_) {
            const projector = new ExpressionProjector();
            projector.init(resolveColumn, expr, this.numRows_);
            const col = new ExpressionColumn(name, projector);
            this.columns_.set(name, col);
        }
    }

    get(name: string): NumberColumn | undefined {
        return this.columns_.get(name);
    }
}

// 公開 DataView
export class DataView {
    private def_!: ViewDefinition;
    private numRows_ = 0;
    private xCol_!: NumberColumn;
    private yCol_!: NumberColumn;
    private stateCol_: NumberColumn | null = null;

    // 内部レジストリ（非公開）
    private registry_ = new VirtualColumnRegistry();

    // ColumnSpec が loader に対して追加可能かどうかを事前検証する。
    // エラーがある場合は ok:false とエラーメッセージ配列を返す。
    validateColumnSpec(loader: Loader, columns: ColumnSpec): { ok: boolean; errors: string[] } {
        const errors = collectColumnSpecErrors(loader, columns, new Set());
        return { ok: errors.length === 0, errors };
    }

    // DataView は Definition を受け取って初期化する
    init(loader: Loader, def: ViewDefinition): void {
        const spec = def.view;
        const columns = def.columns ?? {};

        this.numRows_ = loader.numRows;

        // レジストリ準備
        this.registry_.bind(loader);

        // ColumnSpec 登録（仮想→実体化）
        if (Object.keys(columns).length > 0) {
            const validation = this.validateColumnSpec(loader, columns);
            if (!validation.ok) {
                throw new Error(validation.errors.join("\n"));
            }
            for (const [name, expr] of Object.entries(columns)) {
                this.registry_.add(name, expr);
            }
            this.registry_.compileAll();
        }

        // 列解決
        const resolveByName = (name: string): NumberColumn => {
            if (name === "__index__") return new IndexColumn(this.numRows_);
            const vcol = this.registry_.get(name);
            if (vcol) return vcol;
            return loader.columnFromName(name) as unknown as NumberColumn;
        };

        this.xCol_ = resolveByName(spec.axisXField);
        this.yCol_ = resolveByName(spec.axisYField);
        this.stateCol_ = spec.stateField ? resolveByName(spec.stateField) : null;

        this.def_ = { view: { ...spec }, columns: { ...columns } };
    }

    // 引数で与えられた definition と一致しているか（View + Columns）
    isEqualViewDefinition(def: ViewDefinition): boolean {
        return isEqualViewDefinition(this.def_, def);
    }

    getX(i: number): number { return this.xCol_.getNumber(i); }
    getY(i: number): number { return this.yCol_.getNumber(i); }
    getState(i: number): number { return this.stateCol_ ? this.stateCol_.getNumber(i) : 0; }

    // 2分探索
    lowerBound_(col: NumberColumn, target: number): number {
        let lo = 0;
        let hi = this.numRows_;
        while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (col.getNumber(mid) < target) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    getStartIdx(xStart: number, yStart: number): number {
        let xIndexStart = this.lowerBound_(this.xCol_, xStart);
        let yIndexStart = this.lowerBound_(this.yCol_, yStart);
        return Math.min(xIndexStart, yIndexStart);
    }

    getEndIdx(xEnd: number, yEnd: number): number {
        let xIndexEnd = Math.min(this.lowerBound_(this.xCol_, xEnd), this.numRows_);
        let yIndexEnd = Math.min(this.lowerBound_(this.yCol_, yEnd), this.numRows_);
        return Math.max(xIndexEnd, yIndexEnd);
    }

    getMaxX(): number { return this.xCol_.stat.max; }
    getMaxY(): number { return this.yCol_.stat.max; }
    getMinY(): number { return this.yCol_.stat.min; }

    get definition() { return this.def_; }
}

// 必要に応じて仮想列と列の仕様を返す
export const inferViewDefinition = (loader: Loader): ViewDefinition => {
    const h = loader.headers;
    if (h.length === 0) {
        return {
            view: { axisXField: "__index__", axisYField: "__index__", stateField: null },
            columns: {}
        };
    }

    const eqCI = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    const findHeader = (headers: string[], name: string) => headers.find(h => eqCI(h, name)) ?? null;
    const hasAll = (headers: string[], names: string[]) => names.every(n => headers.some(h => eqCI(h, n)));

    const base = (name: string) => (loader.columnFromName(name) as ColumnBuffer).stat.max + 1;

    // OpenCL 形：x = cu * (max(wf)+1) + wf, y = cycle
    if (hasAll(h, ["cycle", "cu", "wf"])) {
        const cycle = findHeader(h, "cycle")!;
        const cu = findHeader(h, "cu")!;
        const wf = findHeader(h, "wf")!;
        const state = findHeader(h, "state");
        const wfBase = base(wf);
        const xExpr = `${cu} * ${wfBase} + ${wf}`;
        const xName = "cu_wf";
        return {
            view: { axisXField: xName, axisYField: cycle, stateField: state ?? null },
            columns: { [xName]: xExpr }
        };
    }

    // TAGE 形：x = Bank * 8 + (TblIdx % 8), y = __index__
    if (hasAll(h, ["Bank", "TblIdx"])) {
        const bank = findHeader(h, "Bank")!;
        const tbl = findHeader(h, "TblIdx")!;
        const actual = findHeader(h, "Actual");
        const xExpr = `${bank} * 8 + (${tbl} % 8)`;
        const xName = "bank_and_idx";
        return {
            view: { axisXField: xName, axisYField: "__index__", stateField: actual ?? null },
            columns: { [xName]: xExpr }
        };
    }

    // フォールバック
    const n = h.length;
    if (n === 1) {
        const c0 = h[0];
        return {
            view: { axisXField: c0, axisYField: "__index__", stateField: null },
            columns: {}
        };
    } else if (n === 2) {
        const c0 = h[0], c1 = h[1];
        return {
            view: { axisXField: c1, axisYField: c0, stateField: null },
            columns: {}
        };
    } else {
        const c0 = h[0], c1 = h[1], c2 = h[2];
        return {
            view: { axisXField: c1, axisYField: c0, stateField: c2 },
            columns: {}
        };
    }
};

//  add/compileAll の事前チェックを共通化
//  既存列名と衝突したら常にエラー（大文字小文字は無視して判定）
//  仮想列は他の仮想列を参照不可
//  未知の列参照、非安全式、3変数以上はエラー
const collectColumnSpecErrors = (
    loader: Loader,
    columns: ColumnSpec,
    existingVirtualNames: Set<string>
): string[] => {
    const errors: string[] = [];
    const headers = loader.headers;
    const realLC = new Set(headers.map(h => h.toLowerCase()));
    const specNames = Object.keys(columns);
    const specNameSet = new Set<string>();

    for (const name of specNames) {
        if (!name) {
            errors.push("Virtual column name must be non-empty.");
            continue;
        }
        if (specNameSet.has(name)) {
            errors.push(`Duplicate virtual column name in ColumnSpec: '${name}'.`);
        } else {
            specNameSet.add(name);
        }
        if (realLC.has(name.toLowerCase())) {
            errors.push(`Virtual column name collides with real column: '${name}'.`);
        }
        if (existingVirtualNames.has(name)) {
            errors.push(`Virtual column already defined: '${name}'.`);
        }
    }

    for (const [name, expr] of Object.entries(columns)) {
        if (!expr) {
            errors.push(`Expression for virtual column '${name}' must be non-empty.`);
            continue;
        }
        if (!ExpressionProjector.isSafeExpression(expr)) {
            errors.push(`Unsafe virtual column expression for '${name}': ${expr}`);
            continue;
        }

        const vars = ExpressionProjector.extractVariables(expr);
        if (vars.length > 2) {
            errors.push(`Virtual column '${name}' uses more than 2 variables (${vars.length}).`);
        }

        for (const v of vars) {
            if (v === "__index__") continue;

            // 仮想列参照は禁止（自分以外の spec 内/既存仮想）
            if (specNameSet.has(v) || existingVirtualNames.has(v)) {
                errors.push(`Virtual column '${name}' may not reference another virtual column '${v}'.`);
                continue;
            }

            // 実在列チェック（厳密：大文字小文字も一致させる）
            if (!headers.includes(v)) {
                errors.push(`Unknown column referenced in '${name}': '${v}'.`);
            }
        }
    }

    return errors;
}

export { ViewSpec, ColumnSpec, ViewDefinition };
