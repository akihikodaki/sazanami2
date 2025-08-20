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
    scaleXLog = 0;                     // horizontal zoom scale (log)
    scaleYLog = 0;                     // vertical zoom scale (log)

    get scaleX() { return Math.exp(this.scaleXLog); }
    get scaleY() { return Math.exp(this.scaleYLog); }

    numRows = 0;                       // number of rows in the data

    dataView: DataViewIF|null = null;

    // 描画されたピクセルのインデックスを保持
    // マウスオーバー時に使用
    drawnIndex: Int32Array | null = null; 
}



class CanvasRenderer {
    MARGIN_LEFT_ = 50;
    MARGIN_BOTTOM_ = 20;
    BASE_SCALE_X_ = 20;
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

    getColorForState_(stateVal: number): string {
        const idx = stateVal;
        const hue = (idx * 137.508) % 360;
        const color = `hsl(${hue},60%,60%)`;
        return color;
    };

    // 背景クリア
    clear(canvasCtx: CanvasRenderingContext2D, renderCtx: RendererContext) {
        if (!canvasCtx) return;
        const { width, height } = renderCtx;
        canvasCtx.fillStyle = '#1c1e23';
        canvasCtx.fillRect(0, 0, width, height);
    }


    draw(canvasCtx: CanvasRenderingContext2D, renderCtx: RendererContext) {
        if (!canvasCtx) return;

        const { width, height, dataView, offsetX, offsetY } = renderCtx;
        const scaleX = renderCtx.scaleX;
        const scaleY = renderCtx.scaleY;

        this.clear(canvasCtx, renderCtx);

        if (!dataView) return;
        const plotHeight = height - this.MARGIN_BOTTOM_;
        const plotWidth = width - this.MARGIN_LEFT_;
        // const baseScaleY = plotHeight / (dataView.getMaxY() + 1);
        const baseScaleY = 1;//plotHeight / (this.BASE_HEIGHT_ + 1);

        // 表示セル数
        const visibleCols = Math.ceil((width - this.MARGIN_LEFT_) / (this.BASE_SCALE_X_ * scaleX));
        const visibleRows = Math.ceil(plotHeight / (baseScaleY * scaleY));

        // グリッドの上限を設定
        const MAX_RES = 128;
        const gridCols = Math.min(visibleCols, MAX_RES);
        const gridRows = Math.min(visibleRows, MAX_RES);

        // 1ピクセルに描画される論理高さ
        const ratioY = 1 / (baseScaleY * scaleY); 

        // データ描画用ピクセルサイズ
        const pxW = Math.max(this.BASE_SCALE_X_ * scaleX, ratioY > 32 ? 0.5 : 1);
        const pxH = Math.max(baseScaleY * scaleY, ratioY > 32 ? 0.5 : 1);

        // 描画セルの start/end インデックス
        const xStart = Math.floor((offsetX - this.MARGIN_LEFT_) / (this.BASE_SCALE_X_ * scaleX));
        const yStart = Math.floor(offsetY / (baseScaleY * scaleY));
        const startIdx = dataView.getStartIdx(yStart);
        const endIdx   = dataView.getEndIdx(yStart + visibleRows - 1);

        // drawnIndex を gridCols × gridRows で初期化
        renderCtx.drawnIndex = new Int32Array(gridCols * gridRows).fill(-1);

        // 描画まびき
        const step = Math.max(1, Math.floor(ratioY / 32));
        if (ratioY >= 32) {
            canvasCtx.fillStyle = "hsl(0,0%,70%)";
        }

        // データ描画＆インデックス記録
        for (let i = startIdx; i < endIdx; i += step) {
            const yVal = dataView.getY(i);
            if (yVal == 0) {
                continue;
            }
            const xVal = dataView.getX(i);
            const x = this.MARGIN_LEFT_ + xVal * this.BASE_SCALE_X_ * scaleX - offsetX;
            const y = yVal * baseScaleY * scaleY - offsetY;
            if (ratioY < 32) {
                canvasCtx.fillStyle = this.getColorForState_(dataView.getState(i));
            }
            canvasCtx.fillRect(x, y, pxW, pxH);

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
        const rawDataSpacingY = pixelMinSpacingY / (baseScaleY * scaleY);
        let tickSpacingY = this.niceNum_(rawDataSpacingY);
        tickSpacingY = tickSpacingY < 1 ? 1 : tickSpacingY; // 最小値を 1 に設定
        for (let val = 0; val <= dataView.getMaxY(); val += tickSpacingY) {
            const y = val * baseScaleY * scaleY - offsetY;
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
        const rawDataSpacingX = pixelMinSpacingX / (this.BASE_SCALE_X_ * scaleX);
        let tickSpacingX = this.niceNum_(rawDataSpacingX);
        tickSpacingX = tickSpacingX < 1 ? 1 : tickSpacingX; // 最小値を 1 に設定
        for (let i = 0; i < dataView.getMaxX(); i += tickSpacingX) {
            const val = i;
            const x = this.MARGIN_LEFT_ + val * this.BASE_SCALE_X_ * scaleX + (this.BASE_SCALE_X_ * scaleX) / 2 - offsetX;
            if (x < 0) continue;
            if (x > plotWidth) break;
            canvasCtx.fillText(val.toString(), x, plotHeight + 3);
        }
    };

    // マウス位置（CSSピクセル）に対応するデータの文字列を取得
    getText(mouseX: number, mouseY: number, renderCtx: RendererContext, loader: Loader): string {

        if (!renderCtx.dataView || !renderCtx.drawnIndex) {
            return "";
        }

        // 共通パラメータ
        const plotHeight = renderCtx.height - this.MARGIN_BOTTOM_;
        const maxY = renderCtx.dataView.getMaxY();
        const baseScaleY = plotHeight / (maxY + 1);

        // 可視セル数（カラム数・行数）
        const visibleCols = Math.ceil((renderCtx.width - this.MARGIN_LEFT_) / (this.BASE_SCALE_X_ * renderCtx.scaleX));
        const visibleRows = Math.ceil(plotHeight         / (baseScaleY * renderCtx.scaleY));

        // 最大解像度制限
        const MAX_RES = 128;
        const gridCols = Math.min(visibleCols, MAX_RES);
        const gridRows = Math.min(visibleRows, MAX_RES);

        const xStart = Math.floor((renderCtx.offsetX - this.MARGIN_LEFT_) / (this.BASE_SCALE_X_ * renderCtx.scaleX));
        const yStart = Math.floor(renderCtx.offsetY / (baseScaleY * renderCtx.scaleY));

        const xVal = Math.floor((mouseX - this.MARGIN_LEFT_ + renderCtx.offsetX) / (this.BASE_SCALE_X_ * renderCtx.scaleX));
        const yVal = Math.floor((mouseY + renderCtx.offsetY) / (baseScaleY * renderCtx.scaleY));
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
        const dataPixelWidth  = Math.max(1, maxX * this.BASE_SCALE_X_) * paddingRatio;

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
