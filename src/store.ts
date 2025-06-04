import {Loader} from "./loader";
import CanvasRenderer from "./canvas_renderer";

enum ACTION {
    FILE_LOAD,
    ACTION_END, // 末尾
};

enum CHANGE {
    FILE_LOADED = ACTION.ACTION_END+1,
    DIALOG_VERSION_OPEN,
    CHANGE_UI_THEME,
};

class Store {
    handlers_: { [key: number]: Array<(...args: any[]) => void> } = {};

    loader_: Loader;
    treeMapRenderer_: CanvasRenderer;

    uiTheme: "dark" | "light" = "dark"; // 現在のUIテーマ

    constructor() {
        this.treeMapRenderer_ = new CanvasRenderer();
        this.loader_ = new Loader();

        this.on(ACTION.FILE_LOAD, (inputStr: string) => {
        });

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
