import { Loader, ParsedColumns, ColumnBuffer } from "./loader";

interface DataViewIF {
    getX(i: number): number;
    getY(i: number): number;
    getState(i: number): number;
    getStartIdx(yStart: number): number;
    getEndIdx(yEnd: number): number;
    getMaxX(): number;
    getMaxY(): number;
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
        const columns = loader.columns;
        const stats = loader.stats;

        this.cycles_ = columns["cycle"];
        this.cus_ = columns["cu"];
        this.wfs_ = columns["wf"];
        this.states_ = columns["state"];

        this.maxCu_ = stats["cu"].max;
        this.maxWf_ = stats["wf"].max;

        this.maxX_ = (this.maxCu_ + 1) * (this.maxWf_ + 1);
        this.maxCycle_ = stats["cycle"].max;

        this.numRows_ = loader.numRows;
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


const GetDataView = (loader: Loader): DataViewIF => {
    const dataView = new OpenCL_DataView();
    dataView.init(loader);
    return dataView;
}

export { DataViewIF, GetDataView };
