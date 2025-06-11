import React, { useRef, useEffect } from "react";
import Store, { ACTION, CHANGE } from "./store";

class TreeMapCanvasContext {}

const MainCanvas = (props: { store: Store }) => {
    const store = props.store;
    const contextRef = useRef(new TreeMapCanvasContext());
    const ctx = contextRef.current; // 再レンダリングのたびにクロージャーが作られるので，参照をここでとっても問題がない

    const divRef = useRef<HTMLDivElement>(null); // div の DOM
    const canvasRef = useRef<HTMLCanvasElement>(null); // canvas の DOM

    useEffect(() => {
        initialize(); // [] で依存なしで useEffect を使うとマウント時に呼ばれる
        return finalize; // useEffect は終了処理への参照を返すことになっている
    }, []);

    const initialize = () => { // マウント時
        const canvas = canvasRef.current!; // canvas の DOM

        canvas.ondblclick = handleMouseDoubleClick;
        canvas.addEventListener("wheel", handleMouseWheel);
        canvas.onmousemove = handleMouseMove;
        canvas.onmousedown = handleMouseDown;
        canvas.onmouseup = handleMouseUp;

        canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
        canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
        canvas.addEventListener("touchend", handleTouchEnd, { passive: false });

        document.onkeydown = handleKeydown;
    };

    // コンポーネントのアンマウント時にリスナーを削除
    const finalize = () => {
        // Remove listeners if needed
    };

    const handleMouseDoubleClick = (e: MouseEvent) => {};
    const handleMouseWheel = (e: WheelEvent) => {};
    const handleMouseMove = (e: MouseEvent) => {};
    const handleMouseDown = (e: MouseEvent) => {};
    const handleMouseUp = (e: MouseEvent) => {};
    // ピンチズームおよびタッチ移動対応用のタッチイベントハンドラ
    const handleTouchStart = (e: TouchEvent) => {};
    const handleTouchMove = (e: TouchEvent) => {};
    const handleTouchEnd = (e: TouchEvent) => {};
    const handleKeydown = (e: KeyboardEvent) => {};

    // Drag & drop handlers
    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            const file = files[0];
            store.trigger(ACTION.FILE_LOAD, file);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
    };

    const draw = () => {
        // Drawing logic
    };

    // 外側の要素に 100% で入るようにする
    // canvas をインライン要素ではなく block にしておかないと div との間に隙間ができる
    // canvas の高解像度対応時にサイズを決定するために div で囲む
    return (
        <div
            ref={divRef}
            style={{ width: "100%", height: "100%" }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
        >
            <canvas
                ref={canvasRef}
                style={{
                    width: "100%",
                    height: "100%",
                    display: "block",
                    margin: 0,
                    padding: 0,
                }}
            />
        </div>
    );
};

export default MainCanvas;
