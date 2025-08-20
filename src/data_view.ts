import { Loader, ColumnBuffer } from "./loader";

interface DataViewIF {
    getX(i: number): number;
    getY(i: number): number;
    getState(i: number): number;
    getStartIdx(yStart: number): number;
    getEndIdx(yEnd: number): number;
    getMaxX(): number;
    getMaxY(): number;
    test(headers: string[]): boolean;
}

class OpenCL_DataView implements DataViewIF {
    cycles_ = new ColumnBuffer();
    cus_ = new ColumnBuffer();
    wfs_ = new ColumnBuffer();
    states_ = new ColumnBuffer();
    maxCycle_ = 0;
    maxWf_ = 0;
    maxCu_ = 0;
    maxX_ = 0;
    numRows_ = 0; // 行数

    init(loader: Loader) {
        const stats = loader.stats;

        this.cycles_ = loader.columnFromName("cycle");
        this.cus_ = loader.columnFromName("cu");
        this.wfs_ = loader.columnFromName("wf");
        this.states_ = loader.columnFromName("state");

        this.maxCu_ = stats["cu"].max;
        this.maxWf_ = stats["wf"].max;

        this.maxX_ = (this.maxCu_ + 1) * (this.maxWf_ + 1);
        this.maxCycle_ = stats["cycle"].max;

        this.numRows_ = loader.numRows;
    }

    test(headers: string[]): boolean {
        // headers に expectedHeaders が含まれているかチェック
        const expectedHeaders = ["cycle", "cu", "wf", "state"];
        for (const h of expectedHeaders) {
            if (!headers.includes(h)) {
                return false;
            }
        }
        return true;
    }

    getX(i: number): number {
        return this.cus_.buffer[i] * (this.maxWf_ + 1) + this.wfs_.buffer[i];
    };
    getY(i: number): number { 
        return  this.cycles_.buffer[i]; 
    }
    getState(i: number): number {
        return this.states_.buffer[i];  
    }

    lowerBound_(arr: Int32Array, length: number, target: number): number {
        let lo = 0, hi = length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (arr[mid] < target) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    };
    getStartIdx(yStart: number): number {
        return this.lowerBound_(this.cycles_.buffer, this.numRows_, yStart);
    }
    getEndIdx(yEnd: number): number {
        return Math.min(this.lowerBound_(this.cycles_.buffer, this.numRows_, yEnd), this.numRows_);
    }

    getMaxX(): number {
        return this.maxX_;
    }
    getMaxY(): number {
        return this.maxCycle_;
    }
};


class GenericDataView implements DataViewIF {
    y_ = new ColumnBuffer();
    x_ = new ColumnBuffer();
    states_: null | ColumnBuffer = new ColumnBuffer();
    numRows_ = 0; // 行数

    test(headers: string[]): boolean {
        // 2個以上あれば OK
        return headers.length >= 2;
    }

    init(loader: Loader) {
        const columns = loader.columns;
        const headers = loader.headers;
        this.y_ = columns[0];
        this.x_ = columns[1];
        this.states_ = headers.length > 2 ? columns[2] : null;
        this.numRows_ = loader.numRows;
    }

    getX(i: number): number {
        return this.x_.getNumber(i);
    };
    getY(i: number): number { 
        return  this.y_.getNumber(i); 
    }
    getState(i: number): number {
        return this.states_ ? this.states_.getNumber(i) : 0;
    }

    lowerBound_(arr: Int32Array, length: number, target: number): number {
        let lo = 0, hi = length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (arr[mid] < target) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    };
    getStartIdx(yStart: number): number {
        return this.lowerBound_(this.y_.buffer, this.numRows_, yStart);
    }
    getEndIdx(yEnd: number): number {
        return Math.min(this.lowerBound_(this.y_.buffer, this.numRows_, yEnd), this.numRows_);
    }

    getMaxX(): number {
        return this.x_.stat.max;
    }
    getMaxY(): number {
        return this.y_.stat.max;
    }
};


const GetDataView = (loader: Loader): DataViewIF => {
    const candidates = [OpenCL_DataView, GenericDataView];

    for (const ViewClass of candidates) {
        const view = new ViewClass();
        if (view.test(loader.headers)) {
            view.init(loader);
            return view;
        }
    }

    throw new Error("No suitable DataView found");
}

export { DataViewIF, GetDataView };
