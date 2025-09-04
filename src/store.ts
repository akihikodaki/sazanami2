// store.ts
import { Loader } from "./loader";
import { ViewDefinition, DataView, inferViewDefinition } from "./data_view";

// ACTION は ACTION_END の直前に追加していく（CHANGE の開始値に影響するため）
enum ACTION {
    FILE_LOAD,
    DIALOG_VERSION_OPEN,
    DIALOG_HELP_OPEN,
    MOUSE_MOVE,
    SHOW_SETTINGS, // 設定パネルの表示
    SHOW_MESSAGE_IN_STATUS_BAR,
    CANVAS_FIT,
    SET_VIEW_SPEC, // 互換用（未使用なら残しておく）
    VIEW_DEF_APPLY,           // ビューから設定
    VIEW_DEF_INFER_REQUEST,   // データから推論（コミットに反映）

    ACTION_END, // 末尾
};

enum CHANGE {
    FILE_LOADED = ACTION.ACTION_END + 1,
    FILE_LOADING_START,
    FILE_FORMAT_DETECTED,
    FILE_LOAD_PROGRESS,
    FILE_LOADING_END,
    DIALOG_VERSION_OPEN,
    DIALOG_HELP_OPEN,
    MOUSE_MOVE,
    SHOW_SETTINGS, // 設定パネルの表示
    SHOW_MESSAGE_IN_STATUS_BAR,
    CHANGE_UI_THEME,
    CONTENT_UPDATED,
    CANVAS_FIT,

    HEADERS_CHANGED,          // ヘッダ一覧が利用可能になった／変わった
    VIEW_DEF_CHANGED,         // コミット済み ViewDefinition が変わった
    VIEW_DEF_PREVIEWED,       // プレビューが適用された（必要に応じて購読）
};

class Store {
    // イベントハンドラ登録
    handlers_: { [key: number]: Array<(...args: any[]) => void> } = {};

    // Loader（TSV 読み込み・列アクセス）
    loader: Loader;

    // 現在キャンバスに適用中の View
    viewDef_: ViewDefinition | null = null;
    get viewDef() { return this.viewDef_; }

    // Settings panel を表示するかどうか
    showSettings: boolean = true;

    constructor() {
        this.loader = new Loader();

        // ---------------- ファイルロード ----------------
        this.on(ACTION.FILE_LOAD, (file: File) => {
            // 新規ファイル読み込み時は ViewDefinition をリセット
            this.viewDef_ = null;
            this.trigger(CHANGE.FILE_LOADING_START);

            this.loader.load(
                file,
                () => {
                    // ロード完了
                    this.trigger(CHANGE.FILE_LOADING_END);
                    this.trigger(CHANGE.FILE_LOADED);

                    // ヘッダが揃ったことを通知（Editor の候補更新用）
                    this.trigger(CHANGE.HEADERS_CHANGED, this.loader.headers);

                    // メッセージ
                    this.trigger(CHANGE.SHOW_MESSAGE_IN_STATUS_BAR, "File loaded successfully");

                    // キャンバス再描画など
                    this.trigger(CHANGE.CONTENT_UPDATED);
                },
                () => {
                    // フォーマット検出完了
                    const inferred = inferViewDefinition(this.loader);
                    applyDefinition(inferred);
                    this.trigger(CHANGE.FILE_FORMAT_DETECTED);
                },
                (percent, _lineNum) => {
                    // 進捗
                    this.trigger(CHANGE.FILE_LOAD_PROGRESS, percent);
                    this.trigger(CHANGE.SHOW_MESSAGE_IN_STATUS_BAR, `${Math.floor(percent * 100)}% Loaded`);
                    this.trigger(CHANGE.CONTENT_UPDATED);
                },
                (err) => {
                    console.error(`Error loading file: ${err}`);
                    this.trigger(CHANGE.FILE_LOADING_END);
                    this.trigger(CHANGE.SHOW_MESSAGE_IN_STATUS_BAR, "Failed to load file");
                }
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
        this.on(ACTION.CANVAS_FIT, () => { this.trigger(CHANGE.CANVAS_FIT); });



        // data_view.ts のバリデーションを用いて厳密チェックし、初期化が通るかを確認する
        const validateAndTryInit_ = (def: ViewDefinition): boolean => {
            try {
                const dv = new DataView();

                // 仮想列の検証（式の安全性等）
                const validation = dv.validateColumnSpec(this.loader, def.columns ?? {});
                if (!validation.ok) {
                    console.warn("validateColumnSpec errors:", validation.errors);
                    return false;
                }

                // 実際に初期化（列解決・式コンパイルなど）
                dv.init(this.loader, def);

                // 初期化が通る＝レンダリング可能な定義
                return true;
            } catch (e) {
                console.error("DataView.init failed:", e);
                return false;
            }
        }

        // Apply: バリデーションのうえでコミット＆適用
        const applyDefinition = (def: ViewDefinition) => {
            const ok = validateAndTryInit_(def);
            this.viewDef_ = def;
            if (!ok) {
                this.trigger(CHANGE.SHOW_MESSAGE_IN_STATUS_BAR, "Apply failed: validation error");
                return;
            }
            this.trigger(CHANGE.VIEW_DEF_CHANGED, def);
        }

        this.on(ACTION.VIEW_DEF_APPLY, (def: ViewDefinition) => {
            applyDefinition(def);
            this.trigger(CHANGE.SHOW_MESSAGE_IN_STATUS_BAR, "View applied");
            this.trigger(CHANGE.CONTENT_UPDATED);
        });

        // Infer: データから推論 → コミット＆適用（ドラフト初期化のため CHANGE を飛ばす）
        this.on(ACTION.VIEW_DEF_INFER_REQUEST, () => {
            const inferred = inferViewDefinition(this.loader);
            applyDefinition(inferred);
            this.trigger(CHANGE.SHOW_MESSAGE_IN_STATUS_BAR, "View applied");
            this.trigger(CHANGE.CONTENT_UPDATED);
        });
    }

    on(event: CHANGE | ACTION, handler: (...args: any[]) => void): void {
        if (!(event in CHANGE || event in ACTION)) {
            console.log(`Unknown event ${event}`);
        }
        if (!(event in this.handlers_)) {
            this.handlers_[event] = [];
        }
        this.handlers_[event].push(handler);
    }

    off(event: CHANGE | ACTION, handler?: (...args: any[]) => void): void {
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

    trigger(event: CHANGE | ACTION, ...args: any[]) {
        if (!(event in CHANGE || event in ACTION)) {
            console.log(`Unknown event ${event}`);
        }
        if (event in this.handlers_) {
            const handlers = this.handlers_[event];
            for (const h of handlers) {
                h.apply(null, args);
            }
        }
    }

}

export default Store;
export { ACTION, CHANGE };
