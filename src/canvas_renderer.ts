import { Loader, DataViewIF, ColumnType } from "./loader";

/**
 * Context holding canvas rendering state and loaded data
 */
class RendererContext {
    // canvasCtx!: CanvasRenderingContext2D;
    width = 0;
    height = 0;
    offsetX = 0;                       // horizontal scroll/offset
    offsetY = 0;                       // vertical scroll offset

    // スケール対数
    scaleXLog = Math.log(20);          // horizontal zoom scale (log)
    scaleYLog = 0;                     // vertical zoom scale (log)

    get scaleX() { return Math.exp(this.scaleXLog); }
    get scaleY() { return Math.exp(this.scaleYLog); }

    numRows = 0;                       // number of rows in the data

    dataView: DataViewIF|null = null;

    // 描画されたピクセルのインデックスを保持
    // マウスオーバー時に使用
    drawnIndex: Int32Array | null = null; 
}

class RawImageContext {
    // DOM/CSS 次元（読み取り専用）
    readonly imageHeightDOM_: number = 0;
    readonly imageWidthDOM_: number = 0;
    readonly imageHeightCSS_: number = 0;
    readonly imageWidthCSS_: number = 0;

    private ctx_: CanvasRenderingContext2D;
    private imageDataHandle_: ImageData | null = null;
    private imageDataUint32Ptr_: Uint32Array | null = null;
    private imageWidthScale_: number = 0;
    private imageHeightScale_: number = 0;

    private fillStylePrev: string = "";
    private fillHuePrev: number = -1;
    private fillRGB_Prev: number = -1;

    private lineWidthPrev: number = -1;
    private strokeStylePrev: string = "";
    private fontPrev: string = "";

    constructor(canvas: HTMLCanvasElement) {
        // 画像サイズ（DOM/CSS）
        this.imageHeightDOM_ = canvas.height;
        this.imageWidthDOM_ = canvas.width;
        this.imageHeightCSS_ = canvas.clientHeight;
        this.imageWidthCSS_ = canvas.clientWidth;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error("2D rendering context could not be obtained.");
        }
        this.ctx_ = ctx;

        this.imageWidthScale_ = canvas.width / Math.max(1, canvas.clientWidth);
        this.imageHeightScale_ = canvas.height / Math.max(1, canvas.clientHeight);
    }

    get clientWidth(): number {
        return this.ctx_.canvas.clientWidth;
    }

    get clientHeight(): number {
        return this.ctx_.canvas.clientHeight;
    }

    beginRawMode(): void {
        // キャンバス全体の ImageData を取得
        this.imageDataHandle_ = this.ctx_.getImageData(0, 0, this.imageWidthDOM_, this.imageHeightDOM_);
        this.imageDataUint32Ptr_ = new Uint32Array(this.imageDataHandle_.data.buffer);
    }

    endRawMode(): void {
        if (this.imageDataHandle_) {
            this.ctx_.putImageData(this.imageDataHandle_, 0, 0);
        }
        this.imageDataHandle_ = null;
        this.imageDataUint32Ptr_ = null;
    }

    private fillRectRaw_(
        cssLeft: number,
        cssTop: number,
        cssWidth: number,
        cssHeight: number,
        rgb: number
    ): void {
        if (!this.imageDataUint32Ptr_) return; // raw mode でなければ何もしない

        // left や top などの座標系は CSS 座標で与えられるが，
        // imageData は DOM 座標系で与えられるのでスケールする
        const sx = this.imageWidthScale_;
        const sy = this.imageHeightScale_;
        const wCSS = this.imageWidthCSS_;
        const hCSS = this.imageHeightCSS_;
        const wDOM = this.imageWidthDOM_;
        const hDOM = Math.floor(hCSS * sy);

        // CSS→DOM 変換
        let left   = cssLeft * sx;
        let top    = cssTop * sy;
        let right  = Math.min(cssLeft + cssWidth,  wCSS) * sx;
        let bottom = Math.min(cssTop  + cssHeight, hCSS) * sy;

        // 左・上もクランプ
        left   = Math.max(0, left);
        top    = Math.max(0, top);
        right  = Math.max(left,  Math.min(right,  wDOM));
        bottom = Math.max(top,   Math.min(bottom, hDOM));

        // width や height は小数になっている可能性があるので，
        // ループ回数の判定は小数のまま行う
        // 小数の空間で +1 づつサンプリングしていることになる
        // +0.5 は四捨五入のため
        const x0 = Math.floor(left + 0.5);
        const y0 = Math.floor(top  + 0.5);
        const x1 = Math.floor(right  - 0.5);
        const y1 = Math.floor(bottom - 0.5);

        const imageData = this.imageDataUint32Ptr_;

        let rowStart = y0 * wDOM;
        for (let y = y0; y <= y1; y++) {
            let p = rowStart + x0;
            const pEnd = rowStart + x1;
            for (; p <= pEnd; p++) {
                imageData[p] = rgb;
            }
            rowStart += wDOM;                  // 次の行へ（加算のみ）
        }
    }

    toStyle_(stateVal: number): string {
        const hue = stateVal * 360;
        const color = `hsl(${hue},60%,60%)`;
        return color;
    };

    hsl2rgb(h: number){
        let s = 0.6, l = 0.6;
        let r, g, b;
    
        if(s == 0){
            r = g = b = l;
        }else{
            let hue2rgb = (p:number, q:number, t:number) => {
                if(t < 0) t += 1;
                if(t > 1) t -= 1;
                if(t < 1/6) return p + (q - p) * 6 * t;
                if(t < 1/2) return q;
                if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
    
            let q = (l < 0.5) ? 
                (l * (1 + s)) : (l+s - l*s);
            let p = 2*l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        return 0xff000000 | (Math.floor(b*255)<<16) | (Math.floor(g*255)<<8) | Math.floor(r*255);
    }

    fillRect(cssLeft: number, cssTop: number, cssWidth: number, cssHeight: number, hue: number): void {
        if (this.imageDataUint32Ptr_)  {
            // raw mode 中: style(string) → rgb(number) に変換して描画
            if (this.fillHuePrev !== hue) {
                const rgb = this.hsl2rgb(hue);
                if (this.fillRGB_Prev !== rgb) {
                    this.fillRGB_Prev = rgb;
                }
            }
            this.fillRectRaw_(cssLeft, cssTop, cssWidth, cssHeight, this.fillRGB_Prev);
        }
        else {
            if (this.fillHuePrev !== hue) {
                this.fillHuePrev = hue;
                this.fillStylePrev = "";
                let style = this.toStyle_(hue);
                this.ctx_.fillStyle = style;
            }
            this.ctx_.fillRect(cssLeft, cssTop, cssWidth, cssHeight);
        }
    }

    strokeRect(cssLeft: number, cssTop: number, cssWidth: number, cssHeight: number, strokeStyle: string, lineWidth: number): void {
        if (this.lineWidthPrev !== lineWidth) {
            this.lineWidthPrev = lineWidth;
            this.ctx_.lineWidth = lineWidth;
        }
        if (this.strokeStylePrev !== strokeStyle) {
            this.strokeStylePrev = strokeStyle;
            this.ctx_.strokeStyle = strokeStyle;
        }
        this.ctx_.strokeRect(cssLeft, cssTop, cssWidth, cssHeight);
    }

    fillText(text: string, x: number, y: number, font: string, fillStyle: string): void {
        if (this.fillStylePrev !== fillStyle) {
            this.fillStylePrev = fillStyle;
            this.fillHuePrev = -1;
            this.ctx_.fillStyle = fillStyle;
        }
        if (this.fontPrev !== font) {
            this.fontPrev = font;
            this.ctx_.font = font;
        }
        this.ctx_.fillText(text, x, y);
    }
}

class CanvasRenderer {
    MARGIN_LEFT_ = 50;
    MARGIN_BOTTOM_ = 20;
    BASE_HEIGHT_ = 1000;
    ZOOM_STEP_LOG_ = Math.log(1.2); // 対数ズーム量

    constructor() {}

    // uniform zoom
    // renderCtx を更新（対数スケールを加減算で更新）
    zoomUniform(renderCtx: RendererContext, mouseX: number, mouseY: number, zoomIn: boolean) {
        const prevX = renderCtx.scaleX;
        const prevY = renderCtx.scaleY;
        const step = this.ZOOM_STEP_LOG_;

        // 対数空間での加減算によりズーム更新
        if (zoomIn) {
            renderCtx.scaleXLog += step;
            renderCtx.scaleYLog += step;
        } else {
            renderCtx.scaleXLog -= step;
            renderCtx.scaleYLog -= step;
        }

        const newX = renderCtx.scaleX;
        const newY = renderCtx.scaleY;
        const relX = mouseX - this.MARGIN_LEFT_ + renderCtx.offsetX;
        const relY = mouseY + renderCtx.offsetY;
        renderCtx.offsetX = relX * (newX / prevX) - (mouseX - this.MARGIN_LEFT_);
        renderCtx.offsetY = relY * (newY / prevY) - mouseY;
    }

    // horizontal-only zoom（対数スケール）
    zoomHorizontal(renderCtx: RendererContext, mouseX: number, mouseY: number, zoomIn: boolean) {
        const prevX = renderCtx.scaleX;
        const step = this.ZOOM_STEP_LOG_;

        renderCtx.scaleXLog += zoomIn ? step : -step;

        const newX = renderCtx.scaleX;
        const relX = mouseX - this.MARGIN_LEFT_ + renderCtx.offsetX;
        renderCtx.offsetX = relX * (newX / prevX) - (mouseX - this.MARGIN_LEFT_);
    }

    // 10進で上位2桁を 1, 2, 5, 10 のいずれかに丸めて「見やすい数値」を返す
    niceNum_(x: number): number {
        const exponent = Math.floor(Math.log10(x)); // 10 で対数を取って切り捨て
        const base = Math.pow(10, exponent);    // 10 のべき乗
        const fraction = x / base;  // 基数で割って10進数で上位二桁を取り出す
        let niceFraction: number;
        // 1, 2, 5 のいずれかに丸める
        if (fraction <= 1) niceFraction = 1;
        else if (fraction <= 2) niceFraction = 2;
        else if (fraction <= 5) niceFraction = 5;
        else niceFraction = 10;
        return niceFraction * base;
    };

    // 背景クリア
    clear(canvasCtx: CanvasRenderingContext2D, renderCtx: RendererContext) {
        if (!canvasCtx) return;
        const { width, height } = renderCtx;
        canvasCtx.fillStyle = '#1c1e23';
        canvasCtx.fillRect(0, 0, width, height);
    }


    draw(canvas: HTMLCanvasElement, renderCtx: RendererContext) {
        let canvasCtx = canvas.getContext("2d")!;
        if (!canvasCtx) return;

        // let startTime = (new Date()).getTime();

        const { width, height, dataView, offsetX, offsetY } = renderCtx;
        const scaleX = renderCtx.scaleX;
        const scaleY = renderCtx.scaleY;

        this.clear(canvasCtx, renderCtx);

        if (!dataView) return;
        const plotHeight = height - this.MARGIN_BOTTOM_;
        const plotWidth = width - this.MARGIN_LEFT_;

        // 表示セル数
        const visibleCols = Math.ceil((width - this.MARGIN_LEFT_) / scaleX);
        const visibleRows = Math.ceil(plotHeight / scaleY);

        // グリッドの上限を設定
        const MAX_RES = 128;
        const gridCols = Math.min(visibleCols, MAX_RES);
        const gridRows = Math.min(visibleRows, MAX_RES);

        // 1ピクセルに描画される論理高さ
        const ratioY = 1 / scaleY; 

        // データ描画用ピクセルサイズ
        const pxW = Math.max(scaleX, ratioY > 32 ? 0.5 : 1);
        const pxH = Math.max(scaleY, ratioY > 32 ? 0.5 : 1);

        // 描画セルの start/end インデックス
        const xStart = Math.floor((offsetX - this.MARGIN_LEFT_) / scaleX);
        const yStart = Math.floor(offsetY / scaleY);
        const startIdx = dataView.getStartIdx(yStart);
        const endIdx   = dataView.getEndIdx(yStart + visibleRows - 1);

        // drawnIndex を gridCols × gridRows で初期化
        renderCtx.drawnIndex = new Int32Array(gridCols * gridRows).fill(-1);

        // 描画まびき
        // X 方向の密度に応じても間引き量をかえる
        const avgNumPointX = (dataView.getEndIdx(Infinity) - dataView.getStartIdx(-Infinity)) / (dataView.getMaxY() - dataView.getMinY());
        const step = Math.max(1, Math.floor(ratioY * avgNumPointX / 4 / 32));
        // const step = Math.max(1, Math.floor(ratioY / 32));

        // データ描画＆インデックス記録
        let rawImageContext = new RawImageContext(canvas);
        if (ratioY > 1) {
            rawImageContext.beginRawMode();
        }

        for (let i = startIdx; i < endIdx; i += step) {
            const yVal = dataView.getY(i);
            if (yVal == 0) {
                continue;
            }
            const xVal = dataView.getX(i);
            const x = this.MARGIN_LEFT_ + xVal * scaleX - offsetX;
            const y = yVal * scaleY - offsetY;
            const color = (dataView.getState(i) * 135) % 360 /360;
            rawImageContext.fillRect(x, y, pxW, pxH, color);

            // visible 範囲内なら、grid 上のセルに記録
            const col = xVal - xStart;
            const row = yVal - yStart;

            if (col >= 0 && col < visibleCols && row >= 0 && row < visibleRows) {
                // 大きい解像度を小さい grid にマップ
                const gridCol = Math.floor(col * gridCols / visibleCols);
                const gridRow = Math.floor(row * gridRows / visibleRows);
                const cellIndex = gridRow * gridCols + gridCol;
                renderCtx.drawnIndex[cellIndex] = i;
            }
        }
        if (ratioY > 1) {
            rawImageContext.endRawMode();
        }

        // Axes
        canvasCtx.strokeStyle = '#eee';
        canvasCtx.lineWidth = 1;
        canvasCtx.beginPath();
        canvasCtx.moveTo(this.MARGIN_LEFT_, 0);
        canvasCtx.lineTo(this.MARGIN_LEFT_, plotHeight);
        canvasCtx.moveTo(this.MARGIN_LEFT_, plotHeight);
        canvasCtx.lineTo(width, plotHeight);
        canvasCtx.stroke();

        // 余白部分を塗りつぶして、プロット要素を隠す
        canvasCtx.fillStyle = 'rgb(35,38,45)';
        canvasCtx.fillRect(0, 0, this.MARGIN_LEFT_, height);
        canvasCtx.fillRect(0, plotHeight, width, this.MARGIN_BOTTOM_);

        // Y-axis ticks and grid
        canvasCtx.fillStyle = '#eee';
        canvasCtx.textAlign = 'right';
        canvasCtx.textBaseline = 'middle';
        const pixelMinSpacingY = 40;
        const rawDataSpacingY = pixelMinSpacingY / scaleY;
        let tickSpacingY = this.niceNum_(rawDataSpacingY);
        tickSpacingY = tickSpacingY < 1 ? 1 : tickSpacingY; // 最小値を 1 に設定
        for (let val = 0; val <= dataView.getMaxY(); val += tickSpacingY) {
            const y = val * scaleY - offsetY;
            if (y < 0) continue;
            if (y > plotHeight) break;
            canvasCtx.strokeStyle = '#444';
            canvasCtx.lineWidth = 1;
            canvasCtx.beginPath();
            canvasCtx.moveTo(this.MARGIN_LEFT_, y);
            canvasCtx.lineTo(width, y);
            canvasCtx.stroke();
            canvasCtx.fillText(val.toString(), this.MARGIN_LEFT_ - 5, y);
        }

        // X-axis ticks
        canvasCtx.textAlign = 'center';
        canvasCtx.textBaseline = 'top';
        const pixelMinSpacingX = dataView.getMaxX() < 16 ? 10 : 40; // 数字が小さい場合は最小間隔を 10 に設定
        const rawDataSpacingX = pixelMinSpacingX / scaleX;
        let tickSpacingX = this.niceNum_(rawDataSpacingX);
        tickSpacingX = tickSpacingX < 1 ? 1 : tickSpacingX; // 最小値を 1 に設定
        for (let i = 0; i < dataView.getMaxX(); i += tickSpacingX) {
            const val = i;
            const x = this.MARGIN_LEFT_ + val * scaleX + (scaleX / 2) - offsetX;
            if (x < 0) continue;
            if (x > plotWidth) break;
            canvasCtx.fillText(val.toString(), x, plotHeight + 3);
        }

        // let elapsedTime = (new Date()).getTime() - startTime;
        // console.log(`draw() done: ${elapsedTime} ms`);
    };

    // マウス位置（CSSピクセル）に対応するデータの文字列を取得
    getText(mouseX: number, mouseY: number, renderCtx: RendererContext, loader: Loader): string {

        if (!renderCtx.dataView || !renderCtx.drawnIndex) {
            return "";
        }

        // 共通パラメータ
        const plotHeight = renderCtx.height - this.MARGIN_BOTTOM_;

        // 可視セル数（カラム数・行数）
        const visibleCols = Math.ceil((renderCtx.width - this.MARGIN_LEFT_) / renderCtx.scaleX);
        const visibleRows = Math.ceil(plotHeight / renderCtx.scaleY);

        // 最大解像度制限
        const MAX_RES = 128;
        const gridCols = Math.min(visibleCols, MAX_RES);
        const gridRows = Math.min(visibleRows, MAX_RES);

        const xStart = Math.floor((renderCtx.offsetX - this.MARGIN_LEFT_) / renderCtx.scaleX);
        const yStart = Math.floor(renderCtx.offsetY / renderCtx.scaleY);

        const xVal = Math.floor((mouseX - this.MARGIN_LEFT_ + renderCtx.offsetX) / renderCtx.scaleX);
        const yVal = Math.floor((mouseY + renderCtx.offsetY) / renderCtx.scaleY);
        const col = xVal - xStart;
        const row = yVal - yStart;

        let recordIndex = -1;
        if (col >= 0 && col < visibleCols && row >= 0 && row < visibleRows) {
            const gridCol = Math.floor(col * gridCols / visibleCols);
            const gridRow = Math.floor(row * gridRows / visibleRows);
            const cellIndex = gridRow * gridCols + gridCol;
            recordIndex = renderCtx.drawnIndex[cellIndex] ?? -1;
        }

        // 全 columns を走査して "列名: 値, " の文字列を組み立て
        let payload = "";
        if (recordIndex >= 0) {
            const cols = loader.headers;    // ParsedColumns 型
            const types = loader.types;     // 各列の型情報
            payload = cols.map((colName) => {
                const arr = loader.columnFromName(colName);
                let value = arr.getString(recordIndex);
                return `${colName}: ${value}`;
            }).join(", ") + ", ";
        }

        return payload;
    }

    /**
     * データ全体（X: 0..maxX-1, Y: minY..maxY）がプロット領域に収まるように
     * scaleXLog / scaleYLog を設定し、オフセットもリセットする。
     */
    fitScaleToData(renderCtx: RendererContext, paddingRatio = 1.0) {
        if (!renderCtx.dataView) return;

        const { width, height } = renderCtx;
        const plotWidth  = Math.max(1, width  - this.MARGIN_LEFT_);
        const plotHeight = Math.max(1, height - this.MARGIN_BOTTOM_);

        const maxX = Math.max(0, renderCtx.dataView.getMaxX());
        const maxY = Math.max(0, renderCtx.dataView.getMaxY());
        const minY = Math.max(0, renderCtx.dataView.getMinY ? renderCtx.dataView.getMinY() : 0);

        // X方向は 0..maxX-1 のセル幅
        const dataPixelWidth  = Math.max(1, maxX) * paddingRatio;

        // Y方向は minY..maxY の範囲を収める
        const baseScaleY = 1;
        const dataPixelHeight = Math.max(1, (maxY - minY + 1) * baseScaleY) * paddingRatio;

        // 必要スケール
        const fitScaleX = plotWidth  / dataPixelWidth;
        const fitScaleY = plotHeight / dataPixelHeight;

        const SAFE_MIN = 1e-6;
        renderCtx.scaleXLog = Math.log(Math.max(fitScaleX, SAFE_MIN));
        renderCtx.scaleYLog = Math.log(Math.max(fitScaleY, SAFE_MIN));

        // 左下に minY が来るようにオフセット調整
        renderCtx.offsetX = 0;
        renderCtx.offsetY = minY * baseScaleY * Math.exp(renderCtx.scaleYLog);
        
    }
}

export {CanvasRenderer, RendererContext};
