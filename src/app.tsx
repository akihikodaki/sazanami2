import React, { useRef, useEffect, useState } from "react";
import Store, { ACTION, CHANGE } from "./store";

import {StatusBar, ToolBar, LoadingBar, VersionDialog, HelpDialog, SettingsPanel, SplitContainer} from "./ui_parts";
import MainCanvas from "./main_canvas";


let store = new Store();

const App = () => {
    const divRef = useRef<HTMLDivElement>(null);
    useEffect(() => { // マウント時
    }, []);

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        divRef.current!.style.cursor = "default";
        const file = e.dataTransfer.files[0];
        if (file) {
            store.trigger(ACTION.FILE_LOAD, file);
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
                <ToolBar store={store}/>
                <LoadingBar store={store} />
                <SplitContainer store={store}
                    leftPanel={<MainCanvas store={store} />}
                    rightPanel={<SettingsPanel store={store} />}
                />
                <StatusBar store={store}/>
            </div>
            <VersionDialog store={store}/>
            <HelpDialog store={store}/>
        </div>
    );
};

export default App;
