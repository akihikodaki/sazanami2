import React, { useRef, useEffect, useState } from "react";
import Store, { ACTION, CHANGE } from "./store";


import {Nav, Navbar, NavDropdown, Form, FormControl} from "react-bootstrap";
import { Modal } from "react-bootstrap";

// react-icons 経由でアイコンをインポートすると，webpack でのビルド時に必要なアイコンのみがバンドルされる
import { BsList } from 'react-icons/bs';


const ToolBar = (props: {store: Store;}) => {
    let store = props.store;

    const openFile = async () => {
        if (typeof (window as any).showOpenFilePicker !== 'function') {
            console.log("showOpenFilePicker is not supported");
            return;
        }
        
         try {
            // ファイルを読み込む
            const [fileHandle]: [FileSystemFileHandle] = await (window as any).showOpenFilePicker();
            const file = await fileHandle.getFile();
            store.trigger(ACTION.FILE_LOAD, file);
         }
         catch (error) {
            console.error("Error opening file:", error);
         }
        // console.log(contents); // ファイル内容を表示
    };

    // メニューアイテムの選択時の処理
    const dispatch = (selectedKey: string|null, event: React.SyntheticEvent<unknown>) => {
        event.preventDefault();    // ページ遷移を防ぐ
        switch (selectedKey) {
        case "menu_version":  store.trigger(ACTION.DIALOG_VERSION_OPEN); break;
        case "menu_load": openFile(); break;
        case "menu_keyboard_shortcuts": store.trigger(ACTION.DIALOG_HELP_OPEN); break;
        // case "set-dark": store.trigger(ACTION.CHANGE_UI_THEME, "dark"); break;
        // case "set-light": store.trigger(ACTION.CHANGE_UI_THEME, "light"); break;
        }
        setSelectedKey(0);
    };
    const [selectedKey, setSelectedKey] = useState(0);

    const [theme, setTheme] = useState(store.uiTheme); // 現在のテーマを管理
    useEffect(() => { // マウント時
        store.on(CHANGE.CHANGE_UI_THEME, () => {
            setTheme(store.uiTheme);
        });
    }, []);

    return (
        <Navbar expand={true} 
            variant="dark" // ここは dark のままの方がいいかも
            style={{ backgroundColor: theme == "dark" ? "#272a31": "#3E455E"}}
        >
            <Navbar.Toggle aria-controls="responsive-navbar-nav" />
            <Navbar.Collapse id="responsive-navbar-nav">
            <Nav onSelect={dispatch} activeKey={selectedKey}>
                <NavDropdown menuVariant={theme} title={<BsList size={20}/>} id="collapsible-nav-dropdown">
                    <NavDropdown.Item eventKey="menu_load">
                        Load file
                    </NavDropdown.Item>
                    {/* <NavDropdown.Divider />
                    <NavDropdown.Item eventKey="set-dark" active={theme === "dark"}>
                        {theme === "dark" && <i className="bi bi-check"></i>} Dark
                    </NavDropdown.Item>
                    <NavDropdown.Item eventKey="set-light" active={theme === "light"}>
                        {theme === "light" && <i className="bi bi-check"></i>} Light
                    </NavDropdown.Item> */}
                    <NavDropdown.Item eventKey="menu_keyboard_shortcuts">
                        Keyboard shortcuts
                    </NavDropdown.Item>
                    <NavDropdown.Divider />
                    <NavDropdown.Item eventKey="menu_version">
                        Version information
                    </NavDropdown.Item>
                </NavDropdown>
            </Nav>
            <Nav onSelect={dispatch} activeKey={selectedKey}
                style={{ color: theme == "dark" ? "#C9CACB" : "#ffffff" }} className="me-auto" // このクラスでリンクが左側に配置される
            >
                {/* <Nav.Link className="nav-link tool-bar-link" eventKey="zoom-in">
                    <i className="bi bi-zoom-in"></i> Zoom In                
                </Nav.Link>
                <Nav.Link className="nav-link tool-bar-link" eventKey="zoom-out">
                    <i className="bi bi-zoom-out"></i> Zoom Out                
                </Nav.Link> */}
            </Nav>
            </Navbar.Collapse>
        </Navbar>
    );
};

const StatusBar = (props: {store: Store;}) => {
    let store = props.store;
    const [statusBarMessage, setStatusBarMessage] = useState("");
    const [theme, setTheme] = useState(store.uiTheme); // 現在のテーマを管理

    useEffect(() => { // マウント時
        store.on(CHANGE.CHANGE_UI_THEME, () => {
            setTheme(store.uiTheme);
        });
        store.on(CHANGE.MOUSE_MOVE, (message: string) => {
            setStatusBarMessage(message);
        });
    }, []);

    return (
        // {/* <div style={{ height: "40px", backgroundColor: "#eee", padding: "10px", textAlign: "left", borderTop: "1px solid #ccc" }}>
        //     <span>{statusBarMessage}</span> */}
        <div style={{ height: "30px", minHeight: "30px", 
            backgroundColor: theme == "dark" ? "#272a31": "#FAFAFA", 
            paddingLeft: "10px", 
            textAlign: "left", borderTop: "0.5px solid " + theme == "dark" ? "#383B41" : "#C6C6C6" }}
        >
            <span style={{ color: theme == "dark" ? "#C9CACB" : "#191919", fontSize: "15px" }}>{statusBarMessage}</span>
        </div>
    );
};

const VersionDialog = (props: {store: Store;}) => {
    const [show, setShow] = useState(false);
    const handleClose = () => {setShow(false)};
    
    useEffect(() => { // マウント時
        props.store.on(CHANGE.DIALOG_VERSION_OPEN, () => {setShow(true)});
    }, []);
    
    return (
        <Modal show={show} onHide={handleClose}>
        <Modal.Header closeButton>
            <Modal.Title>Version Information</Modal.Title>
        </Modal.Header>  
        <Modal.Body>Sazanami2 Version 0.0.1</Modal.Body>             
        </Modal>
    );
};

const HelpDialog = (props: { store: Store }) => {
    const [show, setShow] = useState(false);
    const handleClose = () => setShow(false);

    useEffect(() => {
        const openListener = () => setShow(true);
        props.store.on(CHANGE.DIALOG_HELP_OPEN, openListener);
        return () => {
            props.store.off(CHANGE.DIALOG_HELP_OPEN, openListener);
        };
    }, [props.store]);

    return (
        <Modal show={show} onHide={handleClose}>
            <Modal.Header closeButton>
                <Modal.Title>Help</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                {(() => {
                    const liStyle = { display: "flex", gap: "1rem", marginBottom: "0.5rem" };
                    const kbdStyle = { minWidth: "160px" };
                    return (
                        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                            <li style={liStyle}><kbd style={kbdStyle}>shift + mouse wheel</kbd><span>zoom in and out.</span></li>
                            <li style={liStyle}><kbd style={kbdStyle}>ctrl + mouse wheel</kbd><span>zoom horizontal only.</span></li>
                            <li style={liStyle}><kbd style={kbdStyle}>ctrl + up/down</kbd><span>zoom in and out.</span></li>
                            <li style={liStyle}><kbd style={kbdStyle}>ctrl + left/right</kbd><span>zoom horizontal only.</span></li>
                        </ul>
                    );
                })()}
            </Modal.Body>
        </Modal>
    );
};

export {ToolBar, StatusBar, VersionDialog, HelpDialog};
