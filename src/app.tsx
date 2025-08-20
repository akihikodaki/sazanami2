import React, { useRef, useEffect, useState } from "react";
import Store, { ACTION, CHANGE } from "./store";

import {StatusBar, ToolBar, LoadingBar, VersionDialog, HelpDialog, SettingsPanel, SplitContainer} from "./ui_parts";
import MainCanvas from "./main_canvas";

import { Modal } from "react-bootstrap";

let store = new Store();

const App = () => {
    useEffect(() => { // マウント時
    }, []);

    return (
        <div >
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
