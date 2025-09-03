import React, { useRef, useEffect, createContext, useContext } from "react";
import Store, { ACTION, CHANGE } from "./store";
import { CanvasRenderer, RendererContext } from "./canvas_renderer";
import { inferViewSpec } from "./data_view";

const MainCanvas: React.FC<{ store: Store }> = ({ store }) => {
    const rendererRef = useRef<CanvasRenderer>(new CanvasRenderer());
    const contextRef = useRef<RendererContext>(new RendererContext());
    const divRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // ズーム用アニメーションの RA フレームID
    const zoomRafIdRef = useRef<number | null>(null);
    // パン（スクロール）用アニメーションの RA フレームID
    const panRafIdRef = useRef<number | null>(null);

    // 一回の操作あたりのアニメーション時間（一定時間で終わる）
    const ZOOM_DURATION_MS = 90;        // ズームの所要時間
    const PAN_DURATION_MS = 90;         // パンの所要時間
    const ZOOM_DIVISIONS_WHEEL = 10;    // ホイールズームの分割数
    const ZOOM_DIVISIONS_KEY = 10;      // キー操作ズームの分割数

    // タッチジェスチャー状態
    const touchRef = useRef<{
        inPinch: boolean;
        inSwipe: boolean;
        initialDistance: number;
        lastCenter: { x: number; y: number } | null;
        initialScaleXLog: number;
        initialScaleYLog: number;
        lastPos: { x: number; y: number } | null;
    }>({
        inPinch: false,
        inSwipe: false,
        initialDistance: 0,
        lastCenter: null,
        initialScaleXLog: 0,
        initialScaleYLog: 0,
        lastPos: null
    });

    useEffect(() => {
        const renderer = rendererRef.current;
        const renderCtx = contextRef.current;
        const canvas = canvasRef.current!;
        const div = divRef.current!;

        // ===== アニメーションユーティリティ =====
        const cancelZoomAnimation = () => {
            if (zoomRafIdRef.current != null) {
                cancelAnimationFrame(zoomRafIdRef.current);
                zoomRafIdRef.current = null;
            }
        };
        const cancelPanAnimation = () => {
            if (panRafIdRef.current != null) {
                cancelAnimationFrame(panRafIdRef.current);
                panRafIdRef.current = null;
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
                const t = Math.max(0, Math.min(1, (now - start) / durationMs));
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

        /**
         * 時間基準のパン（オフセット移動）アニメーション。
         * 絶対位置補間：開始位置から目的地までを直接補間することで逆ブレを防ぐ。
         * totalDx/totalDy: 最終的に移動したい量（従来の1操作ぶん）
         * 所要時間は durationMs で一定。Easing で見た目を自然に。
         */
        const animatePanByTime = (
            durationMs: number,
            totalDx: number,
            totalDy: number
        ) => {
            cancelPanAnimation();

            const start = performance.now();
            const fromX = renderCtx.offsetX;
            const fromY = renderCtx.offsetY;

            // easing（加速→減速）
            const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

            const tick = (now: number) => {
                const t = Math.max(0, Math.min(1, (now - start) / durationMs));
                const eased = easeOutCubic(t);

                // 絶対位置を補間して直接設定（差分適用しない）
                renderCtx.offsetX = fromX + totalDx * eased;
                renderCtx.offsetY = fromY + totalDy * eased;
                renderer.draw(canvas, renderCtx);

                if (t < 1) {
                    panRafIdRef.current = requestAnimationFrame(tick);
                } else {
                    // 最終位置にスナップ（浮動小数の誤差吸収）
                    renderCtx.offsetX = fromX + totalDx;
                    renderCtx.offsetY = fromY + totalDy;
                    renderer.draw(canvas, renderCtx);
                    panRafIdRef.current = null;
                }
            };

            panRafIdRef.current = requestAnimationFrame(tick);
        };
        // =======================================

        // 2つのタッチ間の距離を計算
        const getTouchDistance = (t1: Touch, t2: Touch): number => {
            const dx = t1.clientX - t2.clientX;
            const dy = t1.clientY - t2.clientY;
            return Math.hypot(dx, dy);
        };

        // 2つのタッチの中心点を取得（Canvas ローカル座標）
        const getTouchCenter = (t1: Touch, t2: Touch): { x: number; y: number } => {
            const rect = canvas.getBoundingClientRect();
            return {
                x: (t1.clientX + t2.clientX) / 2 - rect.left,
                y: (t1.clientY + t2.clientY) / 2 - rect.top
            };
        };

        // 単一タッチ位置（Canvas ローカル座標）
        const getSingleTouchPos = (t: Touch): { x: number; y: number } => {
            const rect = canvas.getBoundingClientRect();
            return { x: t.clientX - rect.left, y: t.clientY - rect.top };
        };

        // ピンチズームおよびタッチ移動対応用のタッチイベントハンドラ
        const handleTouchStart = (e: TouchEvent) => {
            // ジェスチャ開始時は既存アニメーションを止める（競合防止）
            cancelZoomAnimation();
            cancelPanAnimation();

            if (e.touches.length === 2) { // 2本指でのタッチ開始
                const d = getTouchDistance(e.touches[0], e.touches[1]);
                touchRef.current.initialDistance = d;
                touchRef.current.lastCenter = getTouchCenter(e.touches[0], e.touches[1]);
                touchRef.current.initialScaleXLog = renderCtx.scaleXLog;
                touchRef.current.initialScaleYLog = renderCtx.scaleYLog;
                touchRef.current.inPinch = true;
                touchRef.current.inSwipe = false;
            } else if (e.touches.length === 1) { // 1本指でのタッチ開始
                touchRef.current.lastPos = getSingleTouchPos(e.touches[0]);
                touchRef.current.inSwipe = true;
                touchRef.current.inPinch = false;
            }
        };

        const handleTouchMove = (e: TouchEvent) => {
            e.preventDefault(); // デフォルトのタッチスクロールを無効化

            // マージン（左側）を Renderer から取得（なければ 0）
            const marginLeft = (renderer as any).MARGIN_LEFT_ ?? 0;

            if (e.touches.length === 2 && touchRef.current.inPinch) {
                // ピンチ：倍率と中心を更新
                const newDistance = getTouchDistance(e.touches[0], e.touches[1]);
                const zoomFactor = newDistance / Math.max(1e-6, touchRef.current.initialDistance);

                // ピンチ操作に応じたズーム処理（対数スケール：自然対数を使用）
                const targetXLog = touchRef.current.initialScaleXLog + Math.log(zoomFactor);
                const targetYLog = touchRef.current.initialScaleYLog + Math.log(zoomFactor);

                const center = getTouchCenter(e.touches[0], e.touches[1]);
                const lastCenter = touchRef.current.lastCenter ?? center;

                // 直前スケール（prev）を保存
                const prevX = renderCtx.scaleX;
                const prevY = renderCtx.scaleY;

                // 新しいスケールを適用
                renderCtx.scaleXLog = targetXLog;
                renderCtx.scaleYLog = targetYLog;

                // 新しいスケール（new）
                const newX = renderCtx.scaleX;
                const newY = renderCtx.scaleY;

                // アンカー（中心）を固定するようにオフセットを更新（zoomUniform と同等）
                const relX = center.x - marginLeft + renderCtx.offsetX;
                const relY = center.y + renderCtx.offsetY;
                renderCtx.offsetX = relX * (newX / prevX) - (center.x - marginLeft);
                renderCtx.offsetY = relY * (newY / prevY) - center.y;

                // 中心の移動に合わせてパン（指に追従）
                const dx = center.x - lastCenter.x;
                const dy = center.y - lastCenter.y;
                renderCtx.offsetX -= dx;
                renderCtx.offsetY -= dy;

                // 中心を記録
                touchRef.current.lastCenter = center;

                renderer.draw(canvas, renderCtx);
            } else if (e.touches.length === 1 && touchRef.current.inSwipe) {
                // 1本指の移動操作（即時パン）
                const current = getSingleTouchPos(e.touches[0]);
                const last = touchRef.current.lastPos ?? current;

                const dx = current.x - last.x;
                const dy = current.y - last.y;

                renderCtx.offsetX -= dx;
                renderCtx.offsetY -= dy;

                touchRef.current.lastPos = current;
                renderer.draw(canvas, renderCtx);
            }
        };

        const handleTouchEnd = (e: TouchEvent) => {
            if (e.touches.length < 2) {  // 2本指での操作が終わったらリセット
                touchRef.current.inPinch = false;
                touchRef.current.lastCenter = null;
            }
            if (e.touches.length === 1) { // 1本指のタッチが残っている場合はスクロールに移行するために位置を更新
                touchRef.current.lastPos = getSingleTouchPos(e.touches[0]);
                touchRef.current.inSwipe = true;
            }
            if (e.touches.length < 1) { // 1本指のタッチが終了した場合もリセット
                touchRef.current.inSwipe = false;
                touchRef.current.lastPos = null;
            }
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
                // 縦スクロールもアニメーション
                // ホイールイベント 1 回ぶんの deltaY を一定時間で補間
                animatePanByTime(PAN_DURATION_MS, 0, e.deltaY);
            }
        };

        // キーボード操作
        const handleKeyDown = (e: KeyboardEvent) => {
            const zoomX = renderCtx.width / 2;
            const zoomY = renderCtx.height / 2;

            if (e.ctrlKey) {
                // ズーム系はここで既定動作を先に抑止（ページスクロール等の割り込み防止）
                e.preventDefault();

                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    // Ctrl + ArrowLeft/Right → zoomHorizontal
                    const zoomIn = e.key === "ArrowRight"; // →でズームイン
                    animateZoomByTime(ZOOM_DURATION_MS, ZOOM_DIVISIONS_KEY, (divs) => {
                        renderer.zoomHorizontal(renderCtx, zoomX, zoomY, zoomIn, divs);
                    });
                } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    // Ctrl + ArrowUp/Down → zoomUniform
                    const zoomIn = e.key === "ArrowUp"; // ↑でズームイン
                    animateZoomByTime(ZOOM_DURATION_MS, ZOOM_DIVISIONS_KEY, (divs) => {
                        renderer.zoomUniform(renderCtx, zoomX, zoomY, zoomIn, divs);
                    });
                }
                return;
            }

            // パン（視点移動）
            const PAN_STEP = 120;   // 矢印キー
            const PAGE_STEP = 480; // PageUp/Down

            switch (e.key) {
                case "ArrowLeft":
                    // 左へパン（Xマイナス方向）
                    e.preventDefault();                 // 既定動作を先に抑止
                    animatePanByTime(PAN_DURATION_MS, -PAN_STEP, 0);
                    break;
                case "ArrowRight":
                    // 右へパン（Xプラス方向）
                    e.preventDefault();
                    animatePanByTime(PAN_DURATION_MS, PAN_STEP, 0);
                    break;
                case "ArrowUp":
                    // 上へパン（Yマイナス方向）
                    e.preventDefault();
                    animatePanByTime(PAN_DURATION_MS, 0, -PAN_STEP);
                    break;
                case "ArrowDown":
                    // 下へパン（Yプラス方向）
                    e.preventDefault();
                    animatePanByTime(PAN_DURATION_MS, 0, PAN_STEP);
                    break;
                case "PageUp":
                    // 大きく上へパン
                    e.preventDefault();
                    animatePanByTime(PAN_DURATION_MS, 0, -PAGE_STEP);
                    break;
                case "PageDown":
                    // 大きく下へパン
                    e.preventDefault();
                    animatePanByTime(PAN_DURATION_MS, 0, PAGE_STEP);
                    break;
            }
        };

        // Drag handlers for panning
        let isDragging = false;
        let lastX = 0;
        let lastY = 0;
        const handleMouseDown = (e: MouseEvent) => {
            // パン開始時にズーム/パンのアニメーションが走っていれば止める（競合防止）
            cancelZoomAnimation();
            cancelPanAnimation();

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

        // タッチリスナー（passive:false で preventDefault を有効化）
        canvas.addEventListener("touchstart", handleTouchStart as any, { passive: false });
        canvas.addEventListener("touchmove", handleTouchMove as any, { passive: false });
        canvas.addEventListener("touchend", handleTouchEnd as any, { passive: false });
        canvas.addEventListener("touchcancel", handleTouchEnd as any, { passive: false });

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
            if (!store.viewSpec) {
                let viewSpec = inferViewSpec(store.loader);
                store.trigger(ACTION.SET_VIEW_SPEC, viewSpec);
            }
            renderCtx.dataView = store.loader.GetDataView(store.viewSpec);
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
            cancelPanAnimation();
            window.removeEventListener("resize", handleResize);
            div.removeEventListener("wheel", handleWheel);
            window.removeEventListener("keydown", handleKeyDown);
            canvas.removeEventListener("mousedown", handleMouseDown);
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);

            canvas.removeEventListener("touchstart", handleTouchStart as any);
            canvas.removeEventListener("touchmove", handleTouchMove as any);
            canvas.removeEventListener("touchend", handleTouchEnd as any);
            canvas.removeEventListener("touchcancel", handleTouchEnd as any);
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
