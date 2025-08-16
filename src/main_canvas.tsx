import React, { useRef, useEffect } from "react";
import Store, { ACTION, CHANGE } from "./store";
import {CanvasRenderer, RendererContext} from "./canvas_renderer";


const MainCanvas: React.FC<{ store: Store }> = ({ store }) => {
    const rendererRef = useRef<CanvasRenderer>(new CanvasRenderer());
    const contextRef = useRef<RendererContext>(new RendererContext());
    const divRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const renderer = rendererRef.current;
        const renderCtx = contextRef.current;
        const canvas = canvasRef.current!;
        const div = divRef.current!;
        // renderCtx.canvasCtx = canvas.getContext("2d")!;

        // Resize handler
        const handleResize = () => {
            const dpr = window.devicePixelRatio || 1;
            const width = div.clientWidth;
            const height = div.clientHeight;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            const canvasCtx = canvas.getContext("2d")!;

            canvasCtx.resetTransform?.();
            canvasCtx.scale(dpr, dpr);

            renderCtx.width = width;
            renderCtx.height = height;
            renderer.draw(canvasCtx, renderCtx);
        };

        // Wheel handler: scroll, uniform zoom, or vertical-only zoom
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            if (e.shiftKey) {   // uniform zoom
                renderer.zoomUniform(renderCtx, mouseX, mouseY, e.deltaY < 0);
            } else if (e.ctrlKey) { // horizontal-only zoom
                renderer.zoomHorizontal(renderCtx, mouseX, mouseY, e.deltaY < 0);
            } else {
                renderCtx.offsetY += e.deltaY;  // vertical scroll
            }
            const canvasCtx = canvas.getContext("2d")!;
            renderer.draw(canvasCtx, renderCtx);
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
                lastX = e.clientX;
                lastY = e.clientY;
                const canvasCtx = canvas.getContext("2d")!;
                renderer.draw(canvasCtx, renderCtx);
                return;
            }

            if (!renderCtx.dataContext || !renderCtx.drawnIndex) {
                store.trigger(ACTION.MOUSE_MOVE, "");
                return;
            }

            // マウス位置（CSSピクセル）のテキストを得る
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const payload = renderer.getText(mouseX, mouseY, renderCtx, store.loader);
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
            renderer.initRendererContext(renderCtx, store.loader);
            const canvasCtx = canvas.getContext("2d")!;
            renderer.draw(canvasCtx, renderCtx);
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
