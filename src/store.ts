import {Loader} from "./loader";
import {CanvasRenderer} from "./canvas_renderer";
import { FileLineReader } from "./file_line_reader";

enum ACTION {
    FILE_LOAD,
    DIALOG_VERSION_OPEN,
    DIALOG_HELP_OPEN,
    MOUSE_MOVE,
    ACTION_END, // 末尾
};

enum CHANGE {
    FILE_LOADED = ACTION.ACTION_END+1,
    DIALOG_VERSION_OPEN,
    DIALOG_HELP_OPEN,
    MOUSE_MOVE,
    CHANGE_UI_THEME,
};

class Store {
    handlers_: { [key: number]: Array<(...args: any[]) => void> } = {};

    loader: Loader;
    treeMapRenderer_: CanvasRenderer;

    uiTheme: "dark" | "light" = "dark"; // 現在のUIテーマ

    constructor() {
        this.treeMapRenderer_ = new CanvasRenderer();
        this.loader = new Loader();

        this.on(ACTION.FILE_LOAD, (file: File) => {
            const reader = new FileLineReader(file);
            this.loader.load(
                reader, 
                () => {
                    this.trigger(CHANGE.FILE_LOADED);
                },   // finishCallback
                () => {},   // progressCallback
                (err) => {
                    console.error(`Error loading file: ${err}`);
                }    // errorCallback
            );
        });

        this.on(ACTION.DIALOG_VERSION_OPEN, () => { this.trigger(CHANGE.DIALOG_VERSION_OPEN); });
        this.on(ACTION.DIALOG_HELP_OPEN, () => { this.trigger(CHANGE.DIALOG_HELP_OPEN); });
        this.on(ACTION.MOUSE_MOVE, (str) => { this.trigger(CHANGE.MOUSE_MOVE, str); });
    }


    on(event: CHANGE|ACTION, handler: (...args: any[]) => void): void {
        if (!(event in CHANGE || event in ACTION)) {
            console.log(`Unknown event ${event}`);
        }
        if (!(event in this.handlers_ )) {
            this.handlers_[event] = [];
        }
        this.handlers_[event].push(handler);
        // console.log(`on() is called {event: ${event}, handler: ${handler}}`);
    }

    off(event: CHANGE|ACTION, handler?: (...args: any[]) => void): void {
        if (!(event in CHANGE || event in ACTION)) {
            console.warn(`Unknown event ${event}`);
            return;
        }
        const list = this.handlers_[event];
        if (!list || list.length === 0) {
            return;
        }
        if (handler) {
            this.handlers_[event] = list.filter(h => h !== handler);
        } else {
            delete this.handlers_[event];
        }
    }

    trigger(event: CHANGE|ACTION, ...args: any[]) {
        if (!(event in CHANGE || event in ACTION)) {
            console.log(`Unknown event ${event}`);
        }
        if (event in this.handlers_) {
            let handlers = this.handlers_[event];
            for (let h of handlers) {
                h.apply(null, args);
            }
        }
    }
};

export default Store;
export { ACTION, CHANGE };
