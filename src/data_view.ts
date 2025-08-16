import { Loader, ParsedColumns } from "./loader";

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
    cycles_ = new Int32Array();
    cus_ = new Int32Array();
    wfs_ = new Int32Array();
    states_ = new Int32Array();
    maxCycle_ = 0;
    maxWf_ = 0;
    maxCu_ = 0;
    maxX_ = 0;
    numRows_ = 0; // 行数

    init(loader: Loader) {
        const columns: ParsedColumns = loader.columns;
        const stats = loader.stats;

        this.cycles_ = columns["cycle"] as Int32Array;
        this.cus_ = columns["cu"] as Int32Array;
        this.wfs_ = columns["wf"] as Int32Array;
        this.states_ = columns["state"] as Int32Array;

        this.maxCu_ = stats["cu"].max;
        this.maxWf_ = stats["wf"].max;

        this.maxX_ = (this.maxCu_ + 1) * (this.maxWf_ + 1);
        this.maxCycle_ = stats["cycle"].max;

        this.numRows_ = loader.numRows;
    }

    getX(i: number): number {
        return this.cus_[i] * (this.maxWf_ + 1) + this.wfs_[i];
    };
    getY(i: number): number { 
        return  this.cycles_[i]; 
    }
    getState(i: number): number {
        return this.states_[i];  
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
        return this.lowerBound_(this.cycles_, this.numRows_, yStart);
    }
    getEndIdx(yEnd: number): number {
        return Math.min(this.lowerBound_(this.cycles_, this.numRows_, yEnd), this.numRows_);
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
