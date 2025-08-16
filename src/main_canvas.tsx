import React, { useRef, useEffect } from "react";
import Store, { ACTION, CHANGE } from "./store";
import { Loader, ParsedColumns } from "./loader";

/**
 * Context holding canvas rendering state and loaded data
 */
class RendererContext {
    canvasCtx!: CanvasRenderingContext2D;
    width = 0;
    height = 0;
    offsetX = 0;                       // horizontal scroll/offset
    offsetY = 0;                       // vertical scroll offset
    scaleX = 1;                        // horizontal zoom scale
    scaleY = 1;                        // vertical zoom scale
    numRows = 0;                       // number of rows in the data
    dataContext: {
        cycles: Int32Array;
        cus: Int32Array;
        wfs: Int32Array;
        states: Int32Array;
        maxCycle: number;
        maxWf: number;
        maxX: number;
    } | null = null;

    // 描画されたピクセルのインデックスを保持
    // マウスオーバー時に使用
    drawnIndex: Int32Array | null = null; 
}

const initRendererContext = (ctx: RendererContext, loader: Loader) => {
    const columns: ParsedColumns = loader.columns;
    const stats = loader.stats;

    const cycles = columns["cycle"] as Int32Array;
    const cus = columns["cu"] as Int32Array;
    const wfs = columns["wf"] as Int32Array;
    const states = columns["state"] as Int32Array;
    const maxCycle = stats["cycle"].max;
    const maxCu = stats["cu"].max;
    const maxWf = stats["wf"].max;
    const maxX = (maxCu + 1) * (maxWf + 1);
    // set data context and grid dimensions
    ctx.dataContext = { cycles, cus, wfs, states, maxCycle, maxWf, maxX };

    ctx.scaleX = 1;
    ctx.scaleY = 1;
    ctx.offsetX = 0;
    ctx.offsetY = 0;
    ctx.numRows = loader.numRows;
};


// Compute a "nice" number >= x
const niceNum = (x: number): number => {
    const exponent = Math.floor(Math.log10(x));
    const base = Math.pow(10, exponent);
    const fraction = x / base;
    let niceFraction: number;
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
    return niceFraction * base;
};

const getColorForState = (stateVal: number): string => {
    const idx = stateVal;
    const hue = (idx * 137.508) % 360;
    const color = `hsl(${hue},70%,50%)`;
    return color;
};

const draw = (renderCtx: RendererContext) => {
    const { canvasCtx, width, height, dataContext, offsetX, offsetY, scaleX, scaleY } = renderCtx;
    if (!canvasCtx) return;

    // 背景クリア
    canvasCtx.fillStyle = '#1c1e23';
    canvasCtx.fillRect(0, 0, width, height);

    if (!dataContext) return;
    const marginLeft = 50;
    const marginBottom = 20;
    const plotHeight = height - marginBottom;
    const { cycles, cus, wfs, states, maxCycle, maxWf, maxX } = dataContext;

    const baseScaleX = 20;
    const baseScaleY = plotHeight / (maxCycle + 1);

    // 表示セル数
    const visibleCols = Math.ceil((width - marginLeft) / (baseScaleX * scaleX));
    const visibleRows = Math.ceil(plotHeight / (baseScaleY * scaleY));

    // グリッドの上限を設定
    const MAX_RES = 128;
    const gridCols = Math.min(visibleCols, MAX_RES);
    const gridRows = Math.min(visibleRows, MAX_RES);

    // 1ピクセルに描画される論理高さ
    const ratioY = 1 / (baseScaleY * scaleY); 

    // データ描画用ピクセルサイズ
    const pxW = Math.max(baseScaleX * scaleX, ratioY > 32 ? 0.5 : 1);
    const pxH = Math.max(baseScaleY * scaleY, ratioY > 32 ? 0.5 : 1);

    // 描画セルの start/end インデックス
    const numRows = renderCtx.numRows;
    const lowerBound = (arr: Int32Array, length: number, target: number): number => {
        let lo = 0, hi = length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (arr[mid] < target) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    };
    const xStart = Math.floor((offsetX - marginLeft) / (baseScaleX * scaleX));
    const yStart = Math.floor(offsetY / (baseScaleY * scaleY));
    const startIdx = lowerBound(cycles, numRows, yStart);
    const endIdx   = Math.min(lowerBound(cycles, numRows, yStart + visibleRows - 1), numRows);

    // drawnIndex を gridCols × gridRows で初期化
    renderCtx.drawnIndex = new Int32Array(gridCols * gridRows).fill(-1);

    // 描画まびき
    const step = Math.max(1, Math.floor(ratioY / 32));
    if (ratioY >= 32) {
        canvasCtx.fillStyle = "hsl(0,0%,70%)";
    }

    // データ描画＆インデックス記録
    for (let i = startIdx; i < endIdx; i += step) {
        if (cycles[i] == 0) {
            continue;
        }

        const xVal = cus[i] * (maxWf + 1) + wfs[i];
        const yVal = cycles[i];
        const x = marginLeft + xVal * baseScaleX * scaleX - offsetX;
        const y = yVal * baseScaleY * scaleY - offsetY;
        if (ratioY < 32) {
            canvasCtx.fillStyle = getColorForState(states[i]);
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
    canvasCtx.moveTo(marginLeft, 0);
    canvasCtx.lineTo(marginLeft, plotHeight);
    canvasCtx.moveTo(marginLeft, plotHeight);
    canvasCtx.lineTo(width, plotHeight);
    canvasCtx.stroke();

    // 余白部分を塗りつぶして、プロット要素を隠す
    canvasCtx.fillStyle = 'rgb(35,38,45)';
    canvasCtx.fillRect(0, 0, marginLeft, height);
    canvasCtx.fillRect(0, plotHeight, width, marginBottom);

    // Y-axis ticks and grid
    canvasCtx.fillStyle = '#eee';
    canvasCtx.textAlign = 'right';
    canvasCtx.textBaseline = 'middle';
    const pixelMinSpacing = 40;
    const rawDataSpacing = pixelMinSpacing / (baseScaleY * scaleY);
    const tickSpacing = niceNum(rawDataSpacing);
    for (let val = 0; val <= maxCycle; val += tickSpacing) {
        const y = val * baseScaleY * scaleY - offsetY;
        if (y < 0 || y > plotHeight) continue;
        canvasCtx.strokeStyle = '#444';
        canvasCtx.lineWidth = 1;
        canvasCtx.beginPath();
        canvasCtx.moveTo(marginLeft, y);
        canvasCtx.lineTo(width, y);
        canvasCtx.stroke();
        canvasCtx.fillText(val.toString(), marginLeft - 5, y);
    }

    // X-axis ticks
    canvasCtx.textAlign = 'center';
    canvasCtx.textBaseline = 'top';
    for (let i = 0; i < maxX; i++) {
        const val = i;
        const x = marginLeft + val * baseScaleX * scaleX + (baseScaleX * scaleX) / 2 - offsetX;
        canvasCtx.fillText(val.toString(), x, plotHeight + 3);
    }
};

// マウス位置（CSSピクセル）に対応するデータの文字列を取得
const getText = (mouseX: number, mouseY: number, renderCtx: RendererContext, loader: Loader): string => {

    if (!renderCtx.dataContext || !renderCtx.drawnIndex) {
        return "";
    }

    // 共通パラメータ
    const marginLeft = 50;
    const marginBottom = 20;
    const plotHeight = renderCtx.height - marginBottom;
    const baseScaleX = 20;
    const maxCycle = renderCtx.dataContext.maxCycle;
    const baseScaleY = plotHeight / (maxCycle + 1);

    // 可視セル数（カラム数・行数）
    const visibleCols = Math.ceil((renderCtx.width - marginLeft) / (baseScaleX * renderCtx.scaleX));
    const visibleRows = Math.ceil(plotHeight         / (baseScaleY * renderCtx.scaleY));

    // 最大解像度制限
    const MAX_RES = 128;
    const gridCols = Math.min(visibleCols, MAX_RES);
    const gridRows = Math.min(visibleRows, MAX_RES);

    const xStart = Math.floor((renderCtx.offsetX - marginLeft) / (baseScaleX * renderCtx.scaleX));
    const yStart = Math.floor(renderCtx.offsetY / (baseScaleY * renderCtx.scaleY));

    const xVal = Math.floor((mouseX - marginLeft + renderCtx.offsetX) / (baseScaleX * renderCtx.scaleX));
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
        const cols = loader.columns;    // ParsedColumns 型
        const types = loader.types;     // 各列の型情報
        payload = Object.keys(cols).map((colName) => {
            const arr = cols[colName] as Int32Array;
            let value: string | number;
            if (types[colName] === "string") {
                // string 型列は、配列に格納されている整数値を渡す
                const codeValue = arr[recordIndex];
                value = loader.getOriginalString(colName, codeValue);
            } else {
                // 数値列は配列から直接
                value = arr[recordIndex];
            }
            return `${colName}: ${value}`;
        }).join(", ") + ", ";
    }

    return payload;
}


const MainCanvas: React.FC<{ store: Store }> = ({ store }) => {
    const contextRef = useRef<RendererContext>(new RendererContext());
    const divRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const renderCtx = contextRef.current;
        const canvas = canvasRef.current!;
        const div = divRef.current!;
        renderCtx.canvasCtx = canvas.getContext("2d")!;

        // Resize handler
        const handleResize = () => {
            const dpr = window.devicePixelRatio || 1;
            const width = div.clientWidth;
            const height = div.clientHeight;
            canvas.width = width * dpr;
            canvas.height = height * dpr;

            renderCtx.canvasCtx.resetTransform?.();
            renderCtx.canvasCtx.scale(dpr, dpr);

            renderCtx.width = width;
            renderCtx.height = height;
            draw(renderCtx);
        };

        // Wheel handler: scroll, uniform zoom, or vertical-only zoom
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const marginLeft = 50;

            if (e.shiftKey) {
                // uniform zoom
                const prevX = renderCtx.scaleX;
                const prevY = renderCtx.scaleY;
                const factor = e.deltaY < 0 ? 1.1 : 0.9;
                const newX = prevX * factor;
                const newY = prevY * factor;
                const relX = mouseX - marginLeft + renderCtx.offsetX;
                const relY = mouseY + renderCtx.offsetY;
                renderCtx.offsetX = relX * (newX / prevX) - (mouseX - marginLeft);
                renderCtx.offsetY = relY * (newY / prevY) - mouseY;
                renderCtx.scaleX = newX;
                renderCtx.scaleY = newY;

            } else if (e.ctrlKey) {
                // horizontal-only zoom
                const prevX = renderCtx.scaleX;
                const factor = e.deltaY < 0 ? 1.1 : 0.9;
                const newX = prevX * factor;
                const relX = mouseX - marginLeft + renderCtx.offsetX;
                renderCtx.offsetX = relX * (newX / prevX) - (mouseX - marginLeft);
                renderCtx.scaleX = newX;

            } else {
                // vertical scroll
                renderCtx.offsetY += e.deltaY;
            }

            draw(renderCtx);
        };

        // Drag handlers for panning
        let isDragging = false;
        let lastX = 0;
        let lastY = 0;
        const handleMouseDown = (e: MouseEvent) => {
            isDragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            canvas.style.cursor = 'grabbing';
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                // ドラッグ中はパン処理のみ
                const dx = e.clientX - lastX;
                const dy = e.clientY - lastY;
                renderCtx.offsetX -= dx;
                renderCtx.offsetY -= dy;
                renderCtx.numRows = store.loader.numRows;
                lastX = e.clientX;
                lastY = e.clientY;
                draw(renderCtx);
                return;
            }

            if (!renderCtx.dataContext || !renderCtx.drawnIndex) {
                store.trigger(ACTION.MOUSE_MOVE, "");
                return;
            }

            // マウス位置（CSSピクセル）
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const payload = getText(mouseX, mouseY, renderCtx, store.loader);
            store.trigger(ACTION.MOUSE_MOVE, payload);
        };

        const handleMouseUp = () => {
            isDragging = false;
            canvas.style.cursor = 'default';
        };

        window.addEventListener("resize", handleResize);
        div.addEventListener("wheel", handleWheel, { passive: false });
        canvas.addEventListener("mousedown", handleMouseDown);
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        handleResize();

        // Store change handler
        const onFileLoaded = () => {
            initRendererContext(renderCtx, store.loader);
            draw(renderCtx);
        };
        store.on(CHANGE.FILE_LOADED, onFileLoaded);

        // Cleanup
        return () => {
            window.removeEventListener("resize", handleResize);
            div.removeEventListener("wheel", handleWheel);
            canvas.removeEventListener("mousedown", handleMouseDown);
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [store]);

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) {
            store.trigger(ACTION.FILE_LOAD, file);
        }
    };
    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault();

    return (
        <div
            ref={divRef}
            style={{ width: "100%", height: "100%", overflow: "hidden" }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
        >
            <canvas
                ref={canvasRef}
                style={{ width: "100%", height: "100%", display: "block", cursor: "grab" }}
            />
        </div>
    );
};

export default MainCanvas;
