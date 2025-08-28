import React, { useRef, useEffect, createContext, useContext } from "react";
import Store, { ACTION, CHANGE } from "./store";
import { CanvasRenderer, RendererContext } from "./canvas_renderer";

const MainCanvas: React.FC<{ store: Store }> = ({ store }) => {
    const rendererRef = useRef<CanvasRenderer>(new CanvasRenderer());
    const contextRef = useRef<RendererContext>(new RendererContext());
    const divRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // ズーム用アニメーションの RA フレームID
    const zoomRafIdRef = useRef<number | null>(null);

    // 一回の操作あたりのアニメーション時間（一定時間で終わる）
    const ZOOM_DURATION_MS = 50;      // 120〜220ms 程度に調整可
    const ZOOM_DIVISIONS_WHEEL = 10;   // ホイール時の分割数（見え方の滑らかさ用）
    const ZOOM_DIVISIONS_KEY = 20;     // キー操作時の分割数

    useEffect(() => {
        const renderer = rendererRef.current;
        const renderCtx = contextRef.current;
        const canvas = canvasRef.current!;
        const div = divRef.current!;

        const cancelZoomAnimation = () => {
            if (zoomRafIdRef.current != null) {
                cancelAnimationFrame(zoomRafIdRef.current);
                zoomRafIdRef.current = null;
            }
        };

        /**
         * 時間基準のズームアニメーション。
         * totalDivisions: ズーム1回分を何分割するか（合計は必ず1ステップ分）
         * stepper(divisions): 1刻みだけズームを進める関数（内部で base/divisions を進める）
         */
        const animateZoomByTime = (
            durationMs: number,
            totalDivisions: number,
            stepper: (divisions: number) => void
        ) => {
            cancelZoomAnimation();

            const divisions = Math.max(1, Math.floor(totalDivisions));
            const start = performance.now();
            let applied = 0; // 既に適用した刻み数

            // easing（加速→減速）
            const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

            const tick = (now: number) => {
                const t = Math.min(1, (now - start) / durationMs);
                const eased = easeOutCubic(t);

                // 目標刻み数（0..divisions）を時間から算出
                const target = Math.floor(eased * divisions);
                // 未適用分だけ進める（フレームレートに依らず最終合計は divisions になる）
                for (let i = applied; i < target; i++) {
                    stepper(divisions);
                }
                if (target > applied) {
                    renderer.draw(canvas, renderCtx);
                    applied = target;
                }

                if (t < 1) {
                    zoomRafIdRef.current = requestAnimationFrame(tick);
                } else {
                    // 念のため取りこぼしがあれば最終反映
                    for (let i = applied; i < divisions; i++) {
                        stepper(divisions);
                    }
                    renderer.draw(canvas, renderCtx);
                    zoomRafIdRef.current = null;
                }
            };

            zoomRafIdRef.current = requestAnimationFrame(tick);
        };

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

            renderer.draw(canvas, renderCtx);
        };

        // Wheel handler
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // 一回の操作で進むズーム量は常に「1ステップ」固定
            // 所要時間は常に ZOOM_DURATION_MS で一定
            const zoomIn = e.deltaY < 0;

            if (e.shiftKey) {
                // 一様ズーム
                animateZoomByTime(ZOOM_DURATION_MS, ZOOM_DIVISIONS_WHEEL, (divs) => {
                    renderer.zoomUniform(renderCtx, mouseX, mouseY, zoomIn, divs);
                });
            } else if (e.ctrlKey) {
                // 水平ズーム
                animateZoomByTime(ZOOM_DURATION_MS, ZOOM_DIVISIONS_WHEEL, (divs) => {
                    renderer.zoomHorizontal(renderCtx, mouseX, mouseY, zoomIn, divs);
                });
            } else {
                renderCtx.offsetY += e.deltaY; // 縦スクロール
                renderer.draw(canvas, renderCtx);
            }
        };

        // キーボード操作
        const handleKeyDown = (e: KeyboardEvent) => {
            let used = false;

            const zoomX = renderCtx.width / 2;
            const zoomY = renderCtx.height / 2;

            if (e.ctrlKey) {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    // Ctrl + ArrowLeft/Right → zoomHorizontal
                    const zoomIn = e.key === "ArrowRight"; // →でズームイン
                    animateZoomByTime(ZOOM_DURATION_MS, ZOOM_DIVISIONS_KEY, (divs) => {
                        renderer.zoomHorizontal(renderCtx, zoomX, zoomY, zoomIn, divs);
                    });
                    used = true;
                } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    // Ctrl + ArrowUp/Down → zoomUniform
                    const zoomIn = e.key === "ArrowUp"; // ↑でズームイン
                    animateZoomByTime(ZOOM_DURATION_MS, ZOOM_DIVISIONS_KEY, (divs) => {
                        renderer.zoomUniform(renderCtx, zoomX, zoomY, zoomIn, divs);
                    });
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
                if (used) {
                    renderer.draw(canvas, renderCtx);
                }
            }

            if (used) {
                e.preventDefault(); // ページスクロールなどを抑止
            }
        };

        // Drag handlers for panning
        let isDragging = false;
        let lastX = 0;
        let lastY = 0;
        const handleMouseDown = (e: MouseEvent) => {
            // パン開始時にズームアニメーションが走っていれば止める（競合防止）
            cancelZoomAnimation();

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
                renderer.draw(canvas, renderCtx);
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
        const onFileLoadStarted = () => {
            renderCtx.dataView = null; // データビューをクリア
            renderCtx.numRows = 0;
            handleResize();
            const canvasCtx = canvas.getContext("2d")!;
            renderer.clear(canvasCtx, renderCtx);
        };
        const onContentUpdated = () => {
            let firstTime = !renderCtx.dataView;
            renderCtx.dataView = store.loader.GetDataView();
            renderCtx.numRows = store.loader.numRows;
            // 初回表示で範囲外だったらリセット
            if (firstTime) {
                if (renderCtx.offsetY + renderCtx.height < renderCtx.dataView.getMinY()) {
                    renderCtx.offsetY = renderCtx.dataView.getMinY();
                }
                if (renderCtx.offsetY > renderCtx.dataView.getMaxY()) {
                    renderCtx.offsetY = renderCtx.dataView.getMaxY() - renderCtx.height;
                }
            }

            renderer.draw(canvas, renderCtx);
        };
        store.on(CHANGE.FILE_LOADED, onContentUpdated);
        store.on(CHANGE.FILE_LOADING_START, onFileLoadStarted);
        store.on(CHANGE.CONTENT_UPDATED, onContentUpdated);
        store.on(CHANGE.CANVAS_FIT, () => {
            renderer.fitScaleToData(renderCtx, 1.0);
            renderer.draw(canvas, renderCtx);
        });

        // Cleanup
        return () => {
            cancelZoomAnimation();
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
        canvasRef.current!.style.cursor = "default";

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
