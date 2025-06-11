import React, { useRef, useEffect } from "react";
import Store, { ACTION, CHANGE } from "./store";
import { ParsedColumns } from "./loader";

/**
 * Context holding canvas rendering state and loaded data
 */
class TreeMapCanvasContext {
    ctx!: CanvasRenderingContext2D;
    width = 0;
    height = 0;
    offsetX = 0;                       // horizontal scroll/offset
    offsetY = 0;                       // vertical scroll offset
    scaleX = 1;                        // horizontal zoom scale
    scaleY = 1;                        // vertical zoom scale
    dataContext: {
        cycles: number[];
        cus: number[];
        wfs: number[];
        states: string[];
        maxCycle: number;
        maxX: number;
    } | null = null;
    stateColorMap: Map<string, string> = new Map();
}

const MainCanvas: React.FC<{ store: Store }> = ({ store }) => {
    const contextRef = useRef<TreeMapCanvasContext>(new TreeMapCanvasContext());
    const divRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const obj = contextRef.current;
        const canvas = canvasRef.current!;
        const div = divRef.current!;
        const ctx = canvas.getContext("2d")!;
        obj.ctx = ctx;

        // Resize handler
        const handleResize = () => {
            const dpr = window.devicePixelRatio || 1;
            const width = div.clientWidth;
            const height = div.clientHeight;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            ctx.resetTransform?.();
            ctx.scale(dpr, dpr);
            obj.width = width;
            obj.height = height;
            draw();
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
                const prevX = obj.scaleX;
                const prevY = obj.scaleY;
                const factor = e.deltaY < 0 ? 1.1 : 0.9;
                const newX = prevX * factor;
                const newY = prevY * factor;
                const relX = mouseX - marginLeft + obj.offsetX;
                const relY = mouseY + obj.offsetY;
                obj.offsetX = relX * (newX / prevX) - (mouseX - marginLeft);
                obj.offsetY = relY * (newY / prevY) - mouseY;
                obj.scaleX = newX;
                obj.scaleY = newY;
            } else if (e.ctrlKey) {
                // vertical-only zoom
                const prevY = obj.scaleY;
                const factor = e.deltaY < 0 ? 1.1 : 0.9;
                const newY = prevY * factor;
                const relY = mouseY + obj.offsetY;
                obj.offsetY = relY * (newY / prevY) - mouseY;
                obj.scaleY = newY;
            } else {
                // vertical scroll
                obj.offsetY += e.deltaY;
            }
            draw();
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
            if (!isDragging) return;
            const dx = e.clientX - lastX;
            const dy = e.clientY - lastY;
            obj.offsetX -= dx;
            obj.offsetY -= dy;
            lastX = e.clientX;
            lastY = e.clientY;
            draw();
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
        const handleChange = () => {
            const columns = store.loader.columns as ParsedColumns;
            setData(columns);
            obj.scaleX = 1;
            obj.scaleY = 1;
            obj.offsetX = 0;
            obj.offsetY = 0;
            draw();
        };
        store.on(CHANGE.FILE_LOADED, handleChange);

        // Cleanup
        return () => {
            window.removeEventListener("resize", handleResize);
            div.removeEventListener("wheel", handleWheel);
            canvas.removeEventListener("mousedown", handleMouseDown);
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [store]);

    const setData = (columns: ParsedColumns) => {
        const cycles = columns["cycle"].map((v) => parseFloat(v));
        const cus = columns["cu"].map((v) => parseFloat(v));
        const wfs = columns["wf"].map((v) => parseFloat(v));
        const states = columns["state"];
        const maxCycle = Math.max(...cycles);
        const maxCu = Math.max(...cus);
        const maxWf = Math.max(...wfs);
        const maxX = maxCu * 8 + maxWf + 1;
        contextRef.current.dataContext = { cycles, cus, wfs, states, maxCycle, maxX };
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

    const getColorForState = (stateVal: string): string => {
        const obj = contextRef.current;
        if (obj.stateColorMap.has(stateVal)) {
            return obj.stateColorMap.get(stateVal)!;
        }
        const idx = obj.stateColorMap.size;
        const hue = (idx * 137.508) % 360;
        const color = `hsl(${hue},70%,50%)`;
        obj.stateColorMap.set(stateVal, color);
        return color;
    };

    const draw = () => {
        const obj = contextRef.current;
        const { ctx, width, height, dataContext, offsetX, offsetY, scaleX, scaleY } = obj;
        if (!ctx) return;
        // always fill background
        ctx.fillStyle = '#1c1e23';
        ctx.fillRect(0, 0, width, height);
        if (!dataContext) return;
        
        const marginLeft = 50;
        const marginBottom = 20;
        const plotWidth = width - marginLeft;
        const plotHeight = height - marginBottom;

        // Background
        ctx.fillStyle = '#1c1e23';
        ctx.fillRect(0, 0, width, height);

        const { cycles, cus, wfs, states, maxCycle, maxX } = dataContext;
        const baseScaleX = plotWidth / maxX;
        const baseScaleY = plotHeight / (maxCycle + 1);
        const pxW = Math.max(baseScaleX * scaleX, 1);
        const pxH = Math.max(baseScaleY * scaleY, 1);

        // Draw data
        for (let i = 0; i < cycles.length; i++) {
            const xVal = cus[i] * 8 + wfs[i];
            const yVal = cycles[i];
            const x = marginLeft + xVal * baseScaleX * scaleX - offsetX;
            const y = yVal * baseScaleY * scaleY - offsetY;
            ctx.fillStyle = getColorForState(states[i]);
            ctx.fillRect(x, y, pxW, pxH);
        }

        // Axes
        ctx.strokeStyle = '#eee';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(marginLeft, 0);
        ctx.lineTo(marginLeft, plotHeight);
        ctx.moveTo(marginLeft, plotHeight);
        ctx.lineTo(width, plotHeight);
        ctx.stroke();

        // Y-axis ticks and grid
        ctx.fillStyle = '#eee';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const pixelMinSpacing = 40;
        const rawDataSpacing = pixelMinSpacing / (baseScaleY * scaleY);
        const tickSpacing = niceNum(rawDataSpacing);
        for (let val = 0; val <= maxCycle; val += tickSpacing) {
            const y = val * baseScaleY * scaleY - offsetY;
            if (y < 0 || y > plotHeight) continue;
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(marginLeft, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            ctx.fillText(val.toString(), marginLeft - 5, y);
        }

        // X-axis ticks
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const xLabels = 10;
        for (let i = 0; i <= xLabels; i++) {
            const val = Math.round(maxX * (i / xLabels));
            const x = marginLeft + val * baseScaleX * scaleX + (baseScaleX * scaleX) / 2 - offsetX;
            ctx.fillText(val.toString(), x, plotHeight + 3);
        }
    };

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