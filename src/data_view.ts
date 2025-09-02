import { Loader, ColumnBuffer } from "./loader";

// 汎用スキーマ表現（x/y ともに最大2列までを想定）
type ViewSpec = {
    x: string[];
    y: string[];
    yIsIndex?: boolean;               // y が行インデックスなら true
    stateField?: string | null;       // 色（状態）列名。なければ null
    xRadix?: Record<string, number>;  // x 各列の基数（未指定は max+1）
    xMod?: Record<string, number>;    // x 各列の剰余（v % mod）
    yRadix?: Record<string, number>;  // y 各列の基数（未指定は max+1）
    yMod?: Record<string, number>;    // y 各列の剰余（v % mod）
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

// 大文字小文字を無視した等価判定
const eqCI = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// 指定名に一致するヘッダを検索（大文字小文字無視）
function findHeader(headers: string[], name: string): string | null {
    const hit = headers.find(h => eqCI(h, name));
    return hit ?? null;
}

// すべての列名が存在するか確認
function hasAll(headers: string[], names: string[]): boolean {
    return names.every(n => headers.some(h => eqCI(h, n)));
}

// 軸の初期化用パラメータ（共通化のための内部型）
type AxisInit = {
    names: string[];                  // 使用する列名（最大2）
    radix?: Record<string, number>;   // 各列の基数
    mod?: Record<string, number>;     // 各列の剰余
    asIndex?: boolean;                // 行インデックスとして扱うか
};

// 軸の線形化・検索を共通化する小クラス
class AxisProjector {
    private names: string[] = [];
    private cols: ColumnBuffer[] = [];    // getNumber を使うため ColumnBuffer を保持
    private mult: number[] = [];          // 混合基数の乗数（右端が最下位）
    private mods: number[] = [];          // 各列の mod（0 は mod 無し）
    private asIndex = false;
    private numRows = 0;

    private minLinear = 0;                // 線形化後の最小値（目安）
    private maxLinear = 0;                // 線形化後の最大値（目安）

    init(loader: Loader, axis: AxisInit, numRows: number) {
        this.asIndex = !!axis.asIndex;
        this.numRows = numRows;

        if (this.asIndex || axis.names.length === 0) {
            this.names = [];
            this.cols = [];
            this.mult = [];
            this.mods = [];
            this.minLinear = 0;
            this.maxLinear = numRows;
            return;
        }

        // 最大2列まで
        this.names = axis.names.slice(0, 2);
        this.cols = this.names.map(n => loader.columnFromName(n));

        // 基数を確定（未指定は max+1）
        const bases = this.cols.map((col, idx) => {
            const name = this.names[idx];
            const explicit = axis.radix?.[name];
            if (explicit != null) return explicit;
            return (loader.stats[name]?.max ?? col.stat.max) + 1;
        });

        // 乗数を構築
        this.mult = AxisProjector.buildMultipliers(bases);

        // mod を確定（0 は mod 無し）
        this.mods = this.cols.map((_, idx) => axis.mod?.[this.names[idx]] ?? 0);

        // min/max（概算）：mod 指定があれば [0, mod-1]、なければ列の統計値を使用
        const perMin = this.cols.map((col, idx) => {
            return this.mods[idx] ? 0 : (loader.stats[this.names[idx]]?.min ?? col.stat.min);
        });
        const perMax = this.cols.map((col, idx) => {
            if (this.mods[idx]) return this.mods[idx] - 1;
            return (loader.stats[this.names[idx]]?.max ?? col.stat.max);
        });

        this.minLinear = perMin.reduce((s, v, i) => s + v * this.mult[i], 0);
        this.maxLinear = perMax.reduce((s, v, i) => s + v * this.mult[i], 0);
    }

    // 値の線形化（getNumber を必ず経由）
    value(i: number): number {
        if (this.asIndex || this.cols.length === 0) return i;

        if (this.cols.length === 1) {
            const v0raw = this.cols[0].getNumber(i);
            const v0 = this.mods[0] ? v0raw % this.mods[0] : v0raw;
            return v0 * this.mult[0];
        }

        const v0raw = this.cols[0].getNumber(i);
        const v1raw = this.cols[1].getNumber(i);
        const v0 = this.mods[0] ? v0raw % this.mods[0] : v0raw;
        const v1 = this.mods[1] ? v1raw % this.mods[1] : v1raw;
        return v0 * this.mult[0] + v1 * this.mult[1];
    }

    // 二分探索（y 用に使用）
    lowerBound(target: number): number {
        if (this.asIndex || this.cols.length === 0) {
            const v = target;
            return Math.max(0, Math.min(this.numRows, v));
        }
        let lo = 0;
        let hi = this.numRows;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.value(mid) < target) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    // 乗数の構築（右端が最下位桁）
    private static buildMultipliers(bases: number[]): number[] {
        const n = bases.length;
        if (n === 0) return [];
        const mult = new Array(n).fill(1);
        for (let i = n - 2; i >= 0; i--) {
            mult[i] = mult[i + 1] * bases[i + 1];
        }
        return mult;
    }

    getMin(): number {
        return this.minLinear;
    }
    getMax(): number {
        return this.maxLinear;
    }
}

// 汎用 DataView 実装（x/y を AxisProjector で共通化）
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

        // x 軸の初期化
        this.xAxis.init(
            loader,
            {
                names: spec.x,
                radix: spec.xRadix,
                mod: spec.xMod,
                asIndex: false
            },
            this.numRows_
        );

        // y 軸の初期化
        const yAsIndex = !!spec.yIsIndex || spec.y.length === 0;
        this.yAxis.init(
            loader,
            {
                names: yAsIndex ? [] : spec.y,
                radix: spec.yRadix,
                mod: spec.yMod,
                asIndex: yAsIndex
            },
            this.numRows_
        );

        // state 列
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

// スキーマ推論（従来ルールを踏襲）
function inferViewSpec(loader: Loader): ViewSpec {
    const headers = loader.headers;

    // OpenCL 形
    if (hasAll(headers, ["cycle", "cu", "wf"])) {
        const cycle = findHeader(headers, "cycle")!;
        const cu = findHeader(headers, "cu")!;
        const wf = findHeader(headers, "wf")!;
        const state = findHeader(headers, "state");
        const wfMax = (loader.stats[wf]?.max ?? loader.columnFromName(wf).stat.max) + 1;

        return {
            x: [cu, wf],
            y: [cycle],
            stateField: state ?? null,
            yIsIndex: false,
            xRadix: { [wf]: wfMax }
        };
    }

    // TAGE 形
    if (hasAll(headers, ["Bank", "TblIdx"])) {
        const bank = findHeader(headers, "Bank")!;
        const tbl = findHeader(headers, "TblIdx")!;
        const actual = findHeader(headers, "Actual");
        const bankBase = (loader.stats[bank]?.max ?? loader.columnFromName(bank).stat.max) + 1;

        return {
            x: [bank, tbl],
            y: [],                      // y は行インデックス
            yIsIndex: true,
            stateField: actual ?? null,
            xRadix: { [bank]: bankBase, [tbl]: 8 },
            xMod: { [tbl]: 8 }
        };
    }

    // フォールバック：先頭2列を y、次の2列を x とする（あれば）
    const y1 = headers[0];
    const x1 = headers[1];
    const y2 = headers[2];
    const x2 = headers[3];
    const st = headers[4] ?? null;

    const y: string[] = [];
    if (y1) y.push(y1);
    if (y2) y.push(y2);

    const x: string[] = [];
    if (x1) x.push(x1);
    if (x2) x.push(x2);

    return {
        x,
        y,
        stateField: st,
        yIsIndex: y.length === 0
    };
}

// エクスポート API
const GetDataView = (loader: Loader): DataViewIF => {
    const spec = inferViewSpec(loader);
    const view = new UnifiedDataView();
    (view as UnifiedDataView).init(loader, spec);
    return view;
};

export { DataViewIF, GetDataView };
