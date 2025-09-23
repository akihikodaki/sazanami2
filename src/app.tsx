// src/app.tsx
import React, { useRef, useEffect } from "react";
import Store, { ACTION } from "./store";

import {StatusBar, ToolBar, LoadingBar, VersionDialog, HelpDialog, SettingsPanel, SplitContainer, LogOverlay} from "./ui_parts";
import MainCanvas from "./main_canvas";

const App = () => {
    const storeRef = useRef(new Store());
    const divRef = useRef<HTMLDivElement>(null);
    useEffect(() => { // マウント時
    }, []);

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        divRef.current!.style.cursor = "default";
        const file = e.dataTransfer.files[0];
        if (file) {
            storeRef.current.trigger(ACTION.FILE_LOAD, file);
        }
    };
    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault();

    return (
        <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            ref={divRef}
        >
            {/* // flexDirection: "column" と flexGrow: 1 を使うことで，Canvas が画面いっぱいに広がるようにしている */}
            <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
                <ToolBar store={storeRef.current} />
                <LoadingBar store={storeRef.current} />
                <SplitContainer store={storeRef.current}
                    leftPanel={<MainCanvas store={storeRef.current} />}
                    rightPanel={<SettingsPanel store={storeRef.current} />}
                />
                <LogOverlay store={storeRef.current} />
                <StatusBar store={storeRef.current} />
            </div>
            <VersionDialog store={storeRef.current} />
            <HelpDialog store={storeRef.current} />
        </div>
    );
};

export default App;
