import { Loader } from "./loader";
import { FileLineReader } from "./file_line_reader";

enum ACTION {
    FILE_LOAD,
    DIALOG_VERSION_OPEN,
    DIALOG_HELP_OPEN,
    MOUSE_MOVE,
    SHOW_SETTINGS, // 設定パネルの表示
    SHOW_MESSAGE_IN_STATUS_BAR,
    ACTION_END, // 末尾
};

enum CHANGE {
    FILE_LOADED = ACTION.ACTION_END+1,
    FILE_LOAD_STARTED,
    DIALOG_VERSION_OPEN,
    DIALOG_HELP_OPEN,
    MOUSE_MOVE,
    SHOW_SETTINGS, // 設定パネルの表示
    SHOW_MESSAGE_IN_STATUS_BAR,
    CHANGE_UI_THEME,
    CONTENT_UPDATED,
    PROGRESS_BAR_STARTED,
    PROGRESS_BAR_UPDATED,
    PROGRESS_BAR_FINISHED,
};

class Store {
    handlers_: { [key: number]: Array<(...args: any[]) => void> } = {};

    loader: Loader;

    // Settings panelを表示するかどうか
    showSettings: boolean = false;

    constructor() {
        this.loader = new Loader();

        this.on(ACTION.FILE_LOAD, (file: File) => {
            const reader = new FileLineReader(file);
            this.trigger(CHANGE.FILE_LOAD_STARTED);
            this.trigger(CHANGE.PROGRESS_BAR_STARTED);
            this.loader.load(
                reader, 
                () => {
                    this.trigger(CHANGE.FILE_LOADED);
                    this.trigger(CHANGE.PROGRESS_BAR_FINISHED);
                    this.trigger(CHANGE.SHOW_MESSAGE_IN_STATUS_BAR, "File loaded successfully");
                },   // finishCallback
                (percent, lineNum) => {
                    this.trigger(CHANGE.PROGRESS_BAR_UPDATED, percent);
                    this.trigger(CHANGE.SHOW_MESSAGE_IN_STATUS_BAR, `${Math.floor(percent * 100)}% Loaded`);
                    this.trigger(CHANGE.CONTENT_UPDATED);
                },   // progressCallback
                (err) => {
                    console.error(`Error loading file: ${err}`);
                    this.trigger(CHANGE.PROGRESS_BAR_FINISHED);
                }    // errorCallback
            );
        });

        this.on(ACTION.DIALOG_VERSION_OPEN, () => { this.trigger(CHANGE.DIALOG_VERSION_OPEN); });
        this.on(ACTION.DIALOG_HELP_OPEN, () => { this.trigger(CHANGE.DIALOG_HELP_OPEN); });
        this.on(ACTION.MOUSE_MOVE, (str) => { this.trigger(CHANGE.MOUSE_MOVE, str); });
        this.on(ACTION.SHOW_MESSAGE_IN_STATUS_BAR, (str) => { this.trigger(CHANGE.SHOW_MESSAGE_IN_STATUS_BAR, str); });
        this.on(ACTION.SHOW_SETTINGS, (show) => { 
            this.showSettings = show;
            this.trigger(CHANGE.SHOW_SETTINGS, show); 
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
