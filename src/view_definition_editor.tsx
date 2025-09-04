// view_definition_editor.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import Store, { ACTION, CHANGE } from "./store";
import { ViewDefinition, DataView, inferViewDefinition } from "./data_view";
import { ColumnType } from "./loader";
import { Modal, Dropdown } from "react-bootstrap";
import {
    BsPlus,
    BsTrash,
    BsUpload,
    BsDownload,
    BsX,
    BsPencil,
    BsGripVertical,
    BsThreeDots
} from "react-icons/bs";


// 定数（幅・配色）


// Axes 上のチップ幅に合わせるため、Columns 側も同じ固定幅にする
const CHIP_WIDTH = 220;

// ダークUI向けのアクセント色（カテゴリ別）
const PALETTE = {
    index: "#5A8FFF", // 青
    int:   "#49C2B0", // ティール
    code:  "#E0AE5B", // アンバー
    exp:   "#CA8AFF", // バイオレット
};


// 型定義


// Columns パレットの1アイテム（実列 / 派生列 / __index__）
type PaletteItem = {
    name: string;
    kind: "real" | "derived" | "index";
    type: ColumnType | "DERIVED" | "INDEX";
};

// Axis スロット（将来的に増やす前提で配列化）
type AxisSlot = {
    key: "axisXField" | "axisYField" | "stateField" | string;
    label: string;
    acceptNumeric: boolean; // 数値のみ受け入れ
};


// スタイル（ダークUI）


const card: React.CSSProperties = { background: "#1f2229", border: "1px solid #383B41", borderRadius: 8, padding: 12 };
const header: React.CSSProperties = { fontWeight: 600, color: "#C9CACB", marginBottom: 8 };
const subheader: React.CSSProperties = { color: "#AEB0B3", fontSize: 12 };
const input: React.CSSProperties = { width: "100%", background: "#242830", color: "#E7E8E9", border: "1px solid #383B41", borderRadius: 6, padding: "6px 8px" };
const textareaMono: React.CSSProperties = { ...input, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" };
const btnBase: React.CSSProperties = { borderRadius: 6, padding: "6px 10px", cursor: "pointer", border: "1px solid #41454f" };
const smallBtn: React.CSSProperties = { ...btnBase, background: "#2a2e36", color: "#C9CACB" };
const primaryBtn: React.CSSProperties = { ...btnBase, background: "#365175", borderColor: "#4a6a97", color: "#e8eef9" };
const iconBtn: React.CSSProperties = { ...smallBtn, display: "inline-flex", alignItems: "center", gap: 6 };
const badge: React.CSSProperties = { display: "inline-flex", alignItems: "center", background: "#2d323c", color: "#AEB0B3", border: "1px solid #40444d", fontSize: 11, padding: "2px 6px", borderRadius: 999 };
const errorText: React.CSSProperties = { color: "#ff7a7a", fontSize: 12, marginTop: 6, whiteSpace: "pre-wrap" };

// Columns のリストは固定幅チップを横方向に折り返すため Flex を使用
const listWrap: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: 8
    // justifyContent: "flex-end"
};

// チップ（共通）：少し明るめのトーンでドラッガブル感
const chipBase: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    borderRadius: 8,
    background: "#262c36",
    border: "1px solid #454b57",
    minWidth: 0
};

// 1) 共通のボタン基底（高さ/パディング/整列を完全一致）
const controlBtnBase: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    boxSizing: "border-box",
    height: 36,                // ここで高さを固定（Reset と同じに）
    padding: "6px 12px",       // パディングも共通化
    borderRadius: 6,
    border: "1px solid #41454f",
    fontSize: 14,
    lineHeight: "20px",
    cursor: "pointer"
};

// 2) 見た目違い（塗り/ゴースト）はここで分岐
const controlBtnPrimary: React.CSSProperties = {
    ...controlBtnBase,
    background: "#365175",
    borderColor: "#4a6a97",
    color: "#e8eef9"
};

const controlBtnGhost: React.CSSProperties = {
    ...controlBtnBase,
    background: "#2a2e36",
    color: "#C9CACB"
};



// ユーティリティ（式の軽量バリデーション）
//   * 厳密検証は DataView.validateColumnSpec → init で実施

const isSafeExpression = (expr: string): boolean => /^[0-9\s+\-*/%().A-Za-z_]+$/.test(expr);
const extractVariables = (expr: string): string[] => {
    const idRegex = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
    const disallow = new Set([
        "return","var","let","const","function","new","this","if","else","for","while","do","switch","case",
        "break","continue","try","catch","finally","throw","class","extends","super","import","export","default",
        "delete","in","instanceof","typeof","void","yield","await","with","debugger",
        "Math","Number","String","Boolean","Array","Object","Date","JSON","RegExp","Infinity","NaN","undefined","null"
    ]);
    const vars = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = idRegex.exec(expr)) !== null) {
        const id = m[0];
        if (disallow.has(id)) continue;
        vars.add(id);
    }
    return Array.from(vars);
};


// 色カテゴリとバッジ

type ColorCat = "index" | "int" | "code" | "exp";
function colorCategory(name: string, type: ColumnType | "DERIVED" | "INDEX"): ColorCat {
    if (name === "__index__" || type === "INDEX") return "index";
    if (type === "DERIVED") return "exp";
    switch (type) {
        case ColumnType.INTEGER:
        case ColumnType.HEX:
            return "int";
        case ColumnType.STRING_CODE:
        default:
            return "code";
    }
}

const typeBadgeText = (t: ColumnType | "DERIVED" | "INDEX") => {
    if (t === "DERIVED") return "expr";
    if (t === "INDEX") return "index";
    switch (t) {
        case ColumnType.INTEGER: return "int";
        case ColumnType.HEX: return "hex";
        case ColumnType.STRING_CODE: return "code";
        default: return "col";
    }
};


// Columns パレット（RAW_STRING は候補から除外）

const buildPalette = (store: Store, current: ViewDefinition | null, search: string): PaletteItem[] => {
    const headers: string[] = store.loader?.headers ?? [];
    const typesMap: { [name: string]: ColumnType } = store.loader?.types ?? {};

    // 実列：RAW_STRING は除外（数値化不可）
    const real: PaletteItem[] = headers
        .filter(h => typesMap[h] !== ColumnType.RAW_STRING)
        .map(h => ({ name: h, kind: "real", type: typesMap[h] }));

    // __index__ と派生列（現在の定義から）
    const indexItem: PaletteItem = { name: "__index__", kind: "index", type: "INDEX" };
    const derivedList = Object.entries(current?.columns ?? {}).map(([name]) => name).sort();
    const derived: PaletteItem[] = derivedList.map(n => ({ name: n, kind: "derived", type: "DERIVED" }));

    // 表示順：index → 実列（int/code） → 派生（exp）／名前昇順
    const numericReals = real.sort((a, b) => a.name.localeCompare(b.name));
    let items = [indexItem, ...numericReals, ...derived];

    // 検索（部分一致・ケース無視）
    const q = search.trim().toLowerCase();
    if (q.length > 0) items = items.filter(i => i.name.toLowerCase().includes(q));

    return items;
};


// ColumnChip（Columns / Axes 共通）
//  * 左端2pxアクセント（カテゴリ色）
//  * derived は exp バッジを非表示（見切れ対策）

const ColumnChip: React.FC<{
    name: string;
    type: ColumnType | "DERIVED" | "INDEX";
    draggable?: boolean;
    onDragStart?: (e: React.DragEvent) => void;
    // Columns 側：編集・削除
    onEdit?: () => void;
    onDelete?: () => void;
    // Axes 側：割当解除
    onClear?: () => void;
}> = ({ name, type, draggable, onDragStart, onEdit, onDelete, onClear }) => {
    const cat = colorCategory(name, type);
    const accent = PALETTE[cat];
    const showBadge = type !== "DERIVED"; // 派生列は exp バッジを出さない

    return (
        <div
            style={{ ...chipBase, cursor: draggable ? "grab" : "default" }}
            draggable={draggable}
            onDragStart={onDragStart}
            title={name}
        >
            {/* 左端2pxアクセント（カテゴリ色） */}
            <div style={{ width: 2, alignSelf: "stretch", borderRadius: 2, background: accent }} />
            {/* ドラッグハンドル（見た目） */}
            {draggable && <BsGripVertical aria-hidden size={16} style={{ color: "#8b8e94", flex: "0 0 auto" }} />}
            {/* 列名 */}
            <div
                style={{ color: "#E7E8E9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
            >
                {name}
            </div>
            {/* 型バッジ（derived は省略） */}
            {showBadge && <span style={badge}>{typeBadgeText(type)}</span>}
            {/* アクション */}
            {onEdit && <button style={iconBtn} onClick={onEdit} title="Edit"><BsPencil /></button>}
            {onDelete && <button style={iconBtn} onClick={onDelete} title="Delete"><BsTrash /></button>}
            {onClear && <button style={iconBtn} onClick={onClear} title="Clear"><BsX /></button>}
        </div>
    );
};


// AxisCard（DnD 受け入れ）— Axes のチップは固定幅（CHIP_WIDTH）

const AxisCard: React.FC<{
    label: string;
    assignedName: string | null;
    assignedType: ColumnType | "DERIVED" | "INDEX" | null;
    acceptNumeric: boolean;
    onDropName: (name: string, colType: ColumnType | "DERIVED" | "INDEX") => void;
    onClear: () => void;
    onReject: (msg: string) => void; // 型不一致等の通知
}> = ({ label, assignedName, assignedType, acceptNumeric, onDropName, onClear, onReject }) => {
    const [hover, setHover] = useState(false);
    const [shineOn, setShineOn] = useState(false);

    const setShine = () => {
        setShineOn(true);
        setTimeout(() => setShineOn(false), 250);
    };

    const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setHover(true); };
    const onDragLeave = () => setHover(false);
    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setHover(false);
        try {
            const raw = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
            const data = JSON.parse(raw) as { name: string; type: ColumnType | "DERIVED" | "INDEX" };
            // 数値のみ受け入れ（RAW_STRING は Columns に出ないが念のためチェック）
            const isNumeric = data.type === "DERIVED" || data.type === "INDEX" || data.type !== ColumnType.RAW_STRING;
            if (acceptNumeric && !isNumeric) {
                setShine();
                onReject("Type mismatch: this axis expects a numeric column.");
                return;
            }
            onDropName(data.name, data.type);
        } catch {
            setShine();
            onReject("Drop failed: invalid payload.");
        }
    };

    return (
        <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            style={{
                ...card,
                padding: 10,
                borderStyle: "dashed",
                background: hover ? "#242832" : card.background,
                borderColor: shineOn ? "#ff7a7a" : hover ? "#4a4f59" : "#383B41",
                transition: "background 80ms ease, border-color 80ms ease",
                minHeight: 64,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8
            }}
        >
            <div style={{ color: "#C9CACB", fontWeight: 600 }}>{label}</div>
            {assignedName ? (
                // 幅一定のラッパー
                <div style={{ width: CHIP_WIDTH }}>
                    <ColumnChip
                        name={assignedName}
                        type={assignedType ?? "INDEX"}
                        draggable={false}
                        onClear={onClear}
                    />
                </div>
            ) : (
                <div style={{ color: "#AEB0B3", fontSize: 13 }}>Drop a column here</div>
            )}
        </div>
    );
};


// モーダル（新規追加 / 再編集）— ダークテーマ（CSS を一度注入）

type EditModalProps = {
    show: boolean;
    mode: "create" | "edit";
    initialName?: string;
    initialExpr?: string;
    onCancel: () => void;
    onSave: (name: string, expr: string) => void;
    errors: string[];
    setErrors: (e: string[]) => void;
};

const injectDarkModalCSSOnce = (() => {
    // 一度だけ <style> を注入するためのクロージャ
    let injected = false;
    return () => {
        if (injected) return;
        injected = true;
        const css = `
.modal-dark .modal-dialog { color-scheme: dark; }
.modal-dark-content.modal-content {
    background-color: #1f2229;
    color: #E7E8E9;
    border: 1px solid #383B41;
}
.modal-dark-content .modal-header,
.modal-dark-content .modal-footer { border-color: #383B41; }
.modal-dark-content .btn-close { filter: invert(1) grayscale(100%); opacity: .8; }
.modal-dark-content .btn-close:hover { opacity: 1; }
.modal-dark-content input,
.modal-dark-content textarea,
.modal-dark-content select {
    background-color: #242830;
    color: #E7E8E9;
    border: 1px solid #383B41;
}
.modal-dark-content input:focus,
.modal-dark-content textarea:focus,
.modal-dark-content select:focus {
    border-color: #6ea8fe;
    box-shadow: 0 0 0 0.2rem rgba(110,168,254,.25);
    outline: none;
}
.modal-dark-backdrop.show { opacity: 0.6; }
        `.trim();
        const el = document.createElement("style");
        el.setAttribute("data-vde-dark-modal", "true");
        el.textContent = css;
        document.head.appendChild(el);
    };
})();

const EditColumnModal: React.FC<EditModalProps> = ({
    show, mode, initialName = "", initialExpr = "", onCancel, onSave, errors, setErrors
}) => {
    const [name, setName] = useState(initialName);
    const [expr, setExpr] = useState(initialExpr);

    useEffect(() => { injectDarkModalCSSOnce(); }, []);
    useEffect(() => {
        setName(initialName);
        setExpr(initialExpr);
        setErrors([]);
    }, [initialName, initialExpr, show]); // eslint-disable-line

    return (
        <Modal
            show={show}
            onHide={onCancel}
            size="lg"
            centered
            dialogClassName="modal-dark"
            contentClassName="modal-dark-content"
            backdropClassName="modal-dark-backdrop"
            scrollable
        >
            <Modal.Header closeButton>
                <Modal.Title>{mode === "create" ? "New derived column" : "Edit derived column"}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                    <div>
                        <div style={{ ...subheader, marginBottom: 4 }}>Name</div>
                        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" style={input} />
                    </div>
                    <div>
                        <div style={{ ...subheader, marginBottom: 4 }}>Expression</div>
                        <textarea
                            value={expr}
                            onChange={(e) => setExpr(e.target.value)}
                            placeholder="e.g., cu * 8 + wf"
                            rows={4}
                            style={textareaMono}
                        />
                        <div style={{ ...subheader, marginTop: 6 }}>
                            Allowed: digits, whitespace, <code>+ - * / % ( )</code>, and identifiers. Up to 2 variables. Referencing other derived columns is not allowed. <code>__index__</code> is allowed.
                        </div>
                    </div>
                </div>
                {errors.length > 0 && <div style={errorText} role="alert">{errors.join("\n")}</div>}
            </Modal.Body>
            <Modal.Footer>
                <button style={smallBtn} onClick={onCancel}>Cancel</button>
                <button style={primaryBtn} onClick={() => onSave(name, expr)}>{mode === "create" ? "Save" : "Save changes"}</button>
            </Modal.Footer>
        </Modal>
    );
};


// 厳密検証＋即時反映（コミット）
//   * 成功：store.viewDef を更新し、CHANGE.CONTENT_UPDATED を通知
//   * 失敗：前状態を維持し、エラーを返す
const strictApply = (store: Store, testDef: ViewDefinition): { ok: boolean; errors: string[] } => {
    try {
        const dv = new DataView();
        const v = dv.validateColumnSpec(store.loader, testDef.columns ?? {});
        if (!v.ok) return { ok: false, errors: v.errors };
        dv.init(store.loader, testDef);
        // ここまで到達したら安全：即時反映
        store.trigger(ACTION.VIEW_DEF_APPLY, testDef);
        store.trigger(ACTION.SHOW_MESSAGE_IN_STATUS_BAR, "View updated");
        return { ok: true, errors: [] };
    } catch (e: any) {
        return { ok: false, errors: [String(e?.message ?? e)] };
    }
};

// メイン：ViewDefinitionEditor（常時即時反映・Draft不要）
export const ViewDefinitionEditor: React.FC<{ store: Store }> = ({ store }) => {
    // 現行定義（store.viewDef）を参照
    const [current, setCurrent] = useState<ViewDefinition | null>(() => {
        return (store.viewDef ?? null) as ViewDefinition | null;
    });

    // Store の変化で再読込（FILE_LOADED / CONTENT_UPDATED など）
    useEffect(() => {
        const reload = () => setCurrent((store.viewDef ?? null) as ViewDefinition | null);
        store.on(CHANGE.FILE_LOADED, reload);
        store.on(CHANGE.CONTENT_UPDATED, reload);
        return () => {
            store.off(CHANGE.FILE_LOADED, reload);
            store.off(CHANGE.CONTENT_UPDATED, reload);
        };
    }, [store]);

    // Columns：検索のみ
    const [query, setQuery] = useState("");
    const palette = useMemo(() => buildPalette(store, current, query), [store, current, query]);

    // 派生列モーダル（追加・再編集）
    const [modalOpen, setModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<"create" | "edit">("create");
    const [editTargetName, setEditTargetName] = useState<string | null>(null);
    const [modalErrors, setModalErrors] = useState<string[]>([]);

    // 軽量チェック（入力中）
    const lightweightCheck = (name: string, expr: string, selfOldName?: string): string[] => {
        const headers: string[] = store.loader?.headers ?? [];
        const currentCols = Object.keys(current?.columns ?? {});
        const taken = new Set<string>([...headers, ...currentCols.filter(n => n !== selfOldName)]);
        const errs: string[] = [];
        const nm = (name ?? "").trim();
        const ex = (expr ?? "").trim();
        if (!nm) errs.push("Name is required.");
        if (taken.has(nm)) errs.push(`Name already exists: '${nm}'.`);
        if (!ex) errs.push("Expression is required.");
        else if (!isSafeExpression(ex)) errs.push("Expression contains disallowed tokens.");
        const vars = extractVariables(ex);
        if (vars.length > 2) errs.push(`Expression references more than 2 variables (${vars.length}).`);
        for (const v of vars) {
            if (v === "__index__") continue;
            if ((current?.columns ?? {})[v]) errs.push(`Cannot reference another derived column: '${v}'.`);
            if (!headers.includes(v)) errs.push(`Unknown column referenced: '${v}'.`);
        }
        return errs;
    };

    // 追加（モーダル Save）— 即時反映
    const handleCreate = (name: string, expr: string) => {
        const light = lightweightCheck(name, expr);
        if (light.length > 0) { setModalErrors(light); return; }

        const next: ViewDefinition = {
            view: { ...(current?.view ?? { axisXField: "__index__", axisYField: "__index__", stateField: null }) },
            columns: { ...(current?.columns ?? {}), [name.trim()]: expr.trim() }
        };
        const result = strictApply(store, next);
        if (!result.ok) { setModalErrors(result.errors); return; }
        setModalOpen(false);
        setModalErrors([]);
    };

    // 再編集（モーダル Save）— 即時反映（リネームは axis にも伝播）
    const handleEdit = (name: string, expr: string) => {
        if (!editTargetName || !current) return;

        const light = lightweightCheck(name, expr, editTargetName);
        if (light.length > 0) { setModalErrors(light); return; }

        const nextCols = { ...current.columns };
        delete nextCols[editTargetName]; // 旧名を消す
        nextCols[name.trim()] = expr.trim();

        const v = { ...current.view };
        if (v.axisXField === editTargetName) v.axisXField = name.trim();
        if (v.axisYField === editTargetName) v.axisYField = name.trim();
        if (v.stateField === editTargetName) v.stateField = name.trim();

        const next: ViewDefinition = { view: v, columns: nextCols };
        const result = strictApply(store, next);
        if (!result.ok) { setModalErrors(result.errors); return; }
        setModalOpen(false);
        setModalErrors([]);
    };

    // DnD で Axis をセット — 即時反映
    const trySetAxis = (key: AxisSlot["key"], name: string) => {
        const base: ViewDefinition = current ?? {
            view: { axisXField: "__index__", axisYField: "__index__", stateField: null },
            columns: {}
        };
        const next: ViewDefinition = { view: { ...base.view, [key]: name } as any, columns: { ...base.columns } };
        const result = strictApply(store, next);
        if (!result.ok) {
            store.trigger(ACTION.SHOW_MESSAGE_IN_STATUS_BAR, "Failed to set axis: " + (result.errors[0] ?? "validation error"));
        }
    };

    // Axis 解除 — 即時反映
    const clearAxis = (key: AxisSlot["key"]) => {
        if (!current) return;
        const next: ViewDefinition = { view: { ...current.view, [key]: null } as any, columns: { ...current.columns } };
        const result = strictApply(store, next);
        if (!result.ok) {
            store.trigger(ACTION.SHOW_MESSAGE_IN_STATUS_BAR, "Failed to clear axis: " + (result.errors[0] ?? "validation error"));
        }
    };

    // Columns 行でのドラッグ開始
    const onChipDragStart = (p: PaletteItem) => (e: React.DragEvent) => {
        e.dataTransfer.setData("application/json", JSON.stringify({ name: p.name, type: p.type }));
        e.dataTransfer.effectAllowed = "copy";
    };

    // 派生列の削除（割当中なら解除して即時反映）
    const deleteDerived = (name: string) => {
        if (!current) return;
        const assigned = [current.view.axisXField, current.view.axisYField, current.view.stateField].includes(name);
        if (assigned) {
            if (!confirm("This column is assigned to an axis. Remove anyway?")) return;
        }
        const nextCols = { ...current.columns };
        delete nextCols[name];
        const v = { ...current.view };
        if (v.axisXField === name) v.axisXField = null as any;
        if (v.axisYField === name) v.axisYField = null as any;
        if (v.stateField === name) v.stateField = null as any;
        const next: ViewDefinition = { view: v, columns: nextCols };
        const result = strictApply(store, next);
        if (!result.ok) {
            store.trigger(ACTION.SHOW_MESSAGE_IN_STATUS_BAR, "Delete failed: " + (result.errors[0] ?? "validation error"));
        }
    };

    // Reset（inferViewDefinition(loader) に即時反映）
    const handleReset = () => {
        try {
            const def = inferViewDefinition(store.loader);
            const result = strictApply(store, def);
            if (!result.ok) {
                store.trigger(ACTION.SHOW_MESSAGE_IN_STATUS_BAR, "Reset failed: " + (result.errors[0] ?? "validation error"));
            }
        } catch (e: any) {
            store.trigger(ACTION.SHOW_MESSAGE_IN_STATUS_BAR, "Reset failed: " + String(e?.message ?? e));
        }
    };

    // Import / Export（ハンバーガーメニュー）
    const importRef = useRef<HTMLInputElement>(null);
    const [importKey, setImportKey] = useState(0);
    const handleExport = () => {
        const def = store.viewDef ?? current ?? {
            view: { axisXField: "__index__", axisYField: "__index__", stateField: null },
            columns: {}
        };
        const blob = new Blob([JSON.stringify(def, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "view_definition.json";
        a.click();
        URL.revokeObjectURL(url);
    };
    const handleImportClick = () => importRef.current?.click();
    const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const def = JSON.parse(text) as ViewDefinition;
            const result = strictApply(store, def);
            if (!result.ok) {
                alert("Failed to import: validation error.");
                return;
            }
        } catch {
            alert("Failed to import. Please provide a JSON ViewDefinition.");
        } finally {
            setImportKey(k => k + 1);
        }
    };

    // 軸スロット（将来拡張可）
    const axisSlots: AxisSlot[] = [
        { key: "axisXField", label: "X", acceptNumeric: true },
        { key: "axisYField", label: "Y", acceptNumeric: true },
        { key: "stateField", label: "Color", acceptNumeric: true },
    ];

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Columns（上段） */}
            <div style={card}>
                <div style={{ ...header, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>Columns</span>
                    <button style={iconBtn} onClick={() => { setEditTargetName(null); setModalMode("create"); setModalOpen(true); }}>
                        <BsPlus /> New column
                    </button>
                </div>

                <div style={{ marginBottom: 8 }}>
                    <input
                        placeholder="Search columns..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        style={input}
                    />
                </div>

                {/* 固定幅（CHIP_WIDTH）のチップを横に並べる */}
                <div style={listWrap}>
                    {palette.map(p => (
                        <div key={`${p.kind}:${p.name}`} style={{ width: CHIP_WIDTH }}>
                            <ColumnChip
                                name={p.name}
                                type={p.type}
                                draggable
                                onDragStart={onChipDragStart(p)}
                                onEdit={p.kind === "derived" ? () => {
                                    setEditTargetName(p.name);
                                    setModalMode("edit");
                                    setModalOpen(true);
                                } : undefined}
                                onDelete={p.kind === "derived" ? () => deleteDerived(p.name) : undefined}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Axes（中段） */}
            <div style={card}>
                <div style={header}>Axes</div>
                <div style={{ display: "grid", gap: 10 }}>
                    {axisSlots.map(ax => (
                        <AxisCard
                            key={ax.key}
                            label={ax.label}
                            assignedName={(current?.view as any)?.[ax.key] ?? null}
                            assignedType={resolveTypeOfName(store, current, (current?.view as any)?.[ax.key] ?? null)}
                            acceptNumeric={ax.acceptNumeric}
                            onDropName={(name) => trySetAxis(ax.key, name)}
                            onClear={() => clearAxis(ax.key)}
                            onReject={(msg) => store.trigger(ACTION.SHOW_MESSAGE_IN_STATUS_BAR, msg)}
                        />
                    ))}
                </div>
            </div>

            {/* 右下 sticky ユーティリティ（Reset と同サイズ感のメニュー） */}
            <div
                style={{
                    position: "sticky",
                    bottom: 8,
                    zIndex: 1,
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                    paddingTop: 4
                }}
            >
                <Dropdown align="end">
                    <Dropdown.Toggle as={CustomToggleButton} id="vde-util-menu" />
                    <Dropdown.Menu align="end" variant="dark">
                        <Dropdown.Item onClick={handleExport}>
                            <BsDownload style={{ marginRight: 6 }} />
                            Export JSON
                        </Dropdown.Item>
                        <Dropdown.Item onClick={handleImportClick}>
                            <BsUpload style={{ marginRight: 6 }} />
                            Import JSON
                        </Dropdown.Item>
                    </Dropdown.Menu>
                </Dropdown>
                <input
                    key={importKey}
                    ref={importRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportFile}
                    style={{ display: "none" }}
                />
                <button style={controlBtnPrimary} onClick={handleReset} title="Reset to inferred">Reset</button>
            </div>

            {/* モーダル（新規／再編集） */}
            <EditColumnModal
                show={modalOpen}
                mode={modalMode}
                initialName={modalMode === "edit" ? (editTargetName ?? "") : ""}
                initialExpr={modalMode === "edit" ? ((current?.columns ?? {})[editTargetName ?? ""] ?? "") : ""}
                errors={modalErrors}
                setErrors={setModalErrors}
                onCancel={() => { setModalOpen(false); setModalErrors([]); }}
                onSave={(name, expr) => {
                    if (modalMode === "create") handleCreate(name, expr);
                    else handleEdit(name, expr);
                }}
            />
        </div>
    );
};

// Dropdown.Toggle のカスタム：Reset と同じ高さ/パディングのボタン化（中身は三点）
// 既存の CustomToggleButton を差し替え
const CustomToggleButton = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<"button">>(
    ({ onClick }, ref) => (
        <button
            ref={ref}
            // Reset と同じ“サイズ”を保証（色はゴースト）
            style={controlBtnGhost}
            onClick={(e) => { e.preventDefault(); onClick?.(e as any); }}
            title="More"
            aria-label="More"
        >
            <BsThreeDots />
        </button>
    )
);


// 名前から型を推定（Axes 表示用）
function resolveTypeOfName(
    store: Store,
    current: ViewDefinition | null,
    name: string | null
): ColumnType | "DERIVED" | "INDEX" | null {
    if (!name) return null;
    if (name === "__index__") return "INDEX";
    const headers: string[] = store.loader?.headers ?? [];
    const typesMap: { [name: string]: ColumnType } = store.loader?.types ?? {};
    if (headers.includes(name)) return typesMap[name] ?? ColumnType.INTEGER; // 既定は数値扱い
    if ((current?.columns ?? {})[name]) return "DERIVED";
    return null;
}

export default ViewDefinitionEditor;
