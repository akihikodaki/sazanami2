import React, { useRef, useEffect, createContext, useContext } from "react";
import Store, { ACTION, CHANGE } from "./store";
import { CanvasRenderer, RendererContext } from "./canvas_renderer";

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

        // Wheel handler
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            if (e.shiftKey) {
                renderer.zoomUniform(renderCtx, mouseX, mouseY, e.deltaY < 0);
            } else if (e.ctrlKey) {
                renderer.zoomHorizontal(renderCtx, mouseX, mouseY, e.deltaY < 0);
            } else {
                renderCtx.offsetY += e.deltaY; // 縦スクロール
            }
            const canvasCtx = canvas.getContext("2d")!;
            renderer.draw(canvasCtx, renderCtx);
        };

        // キーボード操作
        const handleKeyDown = (e: KeyboardEvent) => {
            const canvasCtx = canvas.getContext("2d")!;
            let used = false;

            const zoomX = renderCtx.width / 2;
            const zoomY = renderCtx.height / 2;

            if (e.ctrlKey) {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    // Ctrl + ArrowLeft/Right → zoomHorizontal
                    const zoomIn = e.key === "ArrowRight"; // →でズームイン
                    renderer.zoomHorizontal(renderCtx, zoomX, zoomY, zoomIn);
                    used = true;
                } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    // Ctrl + ArrowUp/Down → zoomUniform
                    const zoomIn = e.key === "ArrowUp"; // ↑でズームイン
                    renderer.zoomUniform(renderCtx, zoomX, zoomY, zoomIn);
                    used = true;
                }
            } else {
                // パン（視点移動）
                const PAN_STEP = 40;   // 矢印キー
                const PAGE_STEP = 200; // PageUp/Down
                switch (e.key) {
                    case "ArrowLeft":
                        renderCtx.offsetX -= PAN_STEP;
                        used = true;
                        break;
                    case "ArrowRight":
                        renderCtx.offsetX += PAN_STEP;
                        used = true;
                        break;
                    case "ArrowUp":
                        renderCtx.offsetY -= PAN_STEP;
                        used = true;
                        break;
                    case "ArrowDown":
                        renderCtx.offsetY += PAN_STEP;
                        used = true;
                        break;
                    case "PageUp":
                        renderCtx.offsetY -= PAGE_STEP;
                        used = true;
                        break;
                    case "PageDown":
                        renderCtx.offsetY += PAGE_STEP;
                        used = true;
                        break;
                }
            }

            if (used) {
                e.preventDefault(); // ページスクロールなどを抑止
                renderer.draw(canvasCtx, renderCtx);
            }
        };

        // Drag handlers for panning
        let isDragging = false;
        let lastX = 0;
        let lastY = 0;
        const handleMouseDown = (e: MouseEvent) => {
            isDragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
            canvas.style.cursor = "grabbing";
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

            if (!renderCtx.dataView || !renderCtx.drawnIndex) {
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
            canvas.style.cursor = "default";
        };

        window.addEventListener("resize", handleResize);
        div.addEventListener("wheel", handleWheel, { passive: false });
        window.addEventListener("keydown", handleKeyDown);
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
        const onFileLoadStarted = () => {
            renderCtx.dataView = null; // データビューをクリア
        };
        store.on(CHANGE.FILE_LOADING_START, onFileLoadStarted);

        // Cleanup
        return () => {
            window.removeEventListener("resize", handleResize);
            div.removeEventListener("wheel", handleWheel);
            window.removeEventListener("keydown", handleKeyDown);
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
