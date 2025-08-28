/// <reference lib="dom" />
// 上記がないと，なぜか worker と解釈されてしまう

class RectRendererWebGL {

    // DOM/CSS 次元
    private imageHeightDOM_: number = 0;
    private imageWidthDOM_: number = 0;
    private imageHeightCSS_: number = 0;
    private imageWidthCSS_: number = 0;

    // 2D は合成にのみ使用
    private ctx2d_: CanvasRenderingContext2D | null = null;

    // CSS→DOM 変換用スケール
    private imageWidthScale_: number = 0;
    private imageHeightScale_: number = 0;

    // 直近状態（2D の状態変更を最小化）
    private fillStylePrev: string = "";
    private fillHuePrev: number = -1;

    // WebGL2 用オフスクリーン（DOM ピクセルサイズ）
    private overlayCanvas_: HTMLCanvasElement | null = null;
    private gl_: WebGL2RenderingContext | null = null;

    // GL リソース
    private program_: WebGLProgram | null = null;
    private attrib_a_unit_: number = 0;  // layout(location=0)
    private attrib_a_pos_: number = 1;   // layout(location=1)
    private attrib_a_size_: number = 2;  // layout(location=2)
    private attrib_a_color_: number = 3; // layout(location=3)
    private uniform_u_resolution_: WebGLUniformLocation | null = null;
    private bufUnit_: WebGLBuffer | null = null;  // 単位クアッド（6頂点）
    private bufPos_: WebGLBuffer | null = null;   // インスタンス左上 (x,y)
    private bufSize_: WebGLBuffer | null = null;  // インスタンス幅高 (w,h)
    private bufColor_: WebGLBuffer | null = null; // インスタンス色 (rgba u8)

    // バッチ用ワーク
    private rawMode_: boolean = false;
    private cap_: number = 0;
    private count_: number = 0;
    private pos_: Float32Array = new Float32Array(0);
    private size_: Float32Array = new Float32Array(0);
    private color_: Uint8Array = new Uint8Array(0); // RGBA（各 0..255）

    // hue(0..255) -> RGBA(32bit) キャッシュ（-1 は未計算）
    private rgbCache_: Int32Array = new Int32Array(256);

    constructor() {
        // キャッシュは -1 で初期化
        this.rgbCache_.fill(-1);
    }

    init() {
        this.overlayCanvas_ = document.createElement("canvas");
        const gl = this.overlayCanvas_.getContext("webgl2", {
            alpha: true,
            antialias: false,
            preserveDrawingBuffer: true
        }) as WebGL2RenderingContext | null;
        if (!gl) {
            return false;
        }
        this.gl_ = gl;
        this.initGL_();
        return true;
    }

    // 公開 API（clientWidth/Height は 2D が初期化済みの時のみ有効）
    get clientWidth(): number { return this.ctx2d_?.canvas.clientWidth ?? 0; }
    get clientHeight(): number { return this.ctx2d_?.canvas.clientHeight ?? 0; }

    // beginRawMode でキャンバスを受け取り、必要なら WebGL2 を初期化
    beginRawMode(canvas: HTMLCanvasElement, scale: number): void {
        // 2D を確保
        const ctx2d = canvas.getContext("2d");
        if (!ctx2d) throw new Error("2D rendering context could not be obtained.");
        this.ctx2d_ = ctx2d;

        // DOM/CSS サイズ・スケール更新
        this.imageHeightDOM_ = canvas.height;
        this.imageWidthDOM_ = canvas.width;
        this.imageHeightCSS_ = canvas.clientHeight;
        this.imageWidthCSS_ = canvas.clientWidth;
        this.imageWidthScale_ = canvas.width / Math.max(1, canvas.clientWidth);
        this.imageHeightScale_ = canvas.height / Math.max(1, canvas.clientHeight);

        // オフスクリーンと WebGL2 準備（初回のみ作成）
        if (!this.overlayCanvas_) {
            throw new Error("Overlay canvas has not been created.");
        }

        // オーバーレイのサイズを 2D キャンバスと一致させる
        this.overlayCanvas_.width = canvas.width;
        this.overlayCanvas_.height = canvas.height;

        // バッチ状態リセット
        this.rawMode_ = true;
        this.count_ = 0;

        // ビューポート／クリア
        const gl = this.gl_!;
        gl.viewport(0, 0, this.overlayCanvas_.width, this.overlayCanvas_.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program_);
        if (this.uniform_u_resolution_) {
            gl.uniform2f(this.uniform_u_resolution_, this.overlayCanvas_.width, this.overlayCanvas_.height);
        }
    }

    endRawMode(): void {
        if (!this.rawMode_) return;
        this.flush_();

        // メイン 2D へピクセル等倍で合成
        const ctx2d = this.ctx2d_!;
        ctx2d.save();
        ctx2d.resetTransform();
        ctx2d.globalCompositeOperation = "source-over";
        ctx2d.imageSmoothingEnabled = false;
        ctx2d.drawImage(this.overlayCanvas_!, 0, 0);
        ctx2d.restore();

        this.rawMode_ = false;
    }

    // 多数呼ばれる：raw 中は GPU バッチに積む。非 raw は 2D 即時描画。
    fillRect(cssLeft: number, cssTop: number, cssWidth: number, cssHeight: number, hue: number): void {
        if (this.rawMode_) {
            // hue(0..1) -> 0..255 に量子化し、キャッシュ参照
            const ih = Math.max(0, Math.min(255, Math.floor(hue * 255)));
            let packed = this.rgbCache_[ih];
            if (packed === -1) {
                const rgba = this.hslToRGBA8_(ih / 255);
                // packed を RGBA の順で 8bit 連結（R<<24|G<<16|B<<8|A）
                packed = ((rgba[0] & 255) << 24) | ((rgba[1] & 255) << 16) | ((rgba[2] & 255) << 8) | (rgba[3] & 255);
                this.rgbCache_[ih] = packed;
            }
            this.queueRectPacked_(cssLeft, cssTop, cssWidth, cssHeight, packed);
            return;
        }
        // 非 raw は 2D で即時
        if (this.fillHuePrev !== hue) {
            this.fillHuePrev = hue;
            this.fillStylePrev = "";
            this.ctx2d_!.fillStyle = this.toStyle_(hue);
        }
        this.ctx2d_!.fillRect(cssLeft, cssTop, cssWidth, cssHeight);
    }

    // 内部処理
    private toStyle_(stateVal: number): string {
        const hue = stateVal * 360;
        return `hsl(${hue},60%,60%)`;
    }

    private hslToRGBA8_(h: number): [number, number, number, number] {
        // s=0.6, l=0.6 固定（元コードと同一）。戻りは RGBA（0..255）
        const s:number = 0.6, l:number = 0.6;
        let r: number, g: number, b: number;
        if (s == 0) {
            r = g = b = l;
        } else {
            const q = (l < 0.5) ? (l * (1 + s)) : (l + s - l * s);
            const p = 2 * l - q;
            const hue2rgb = (p: number, q: number, t: number) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return [Math.floor(r*255), Math.floor(g*255), Math.floor(b*255), 255];
    }

    private queueRectPacked_(cssLeft: number, cssTop: number, cssWidth: number, cssHeight: number, packedRGBA: number): void {
        // CSS→DOM 変換とクランプ（元ロジックと統一）
        const sx = this.imageWidthScale_;
        const sy = this.imageHeightScale_;
        const wCSS = this.imageWidthCSS_;
        const hCSS = this.imageHeightCSS_;
        const wDOM = this.imageWidthDOM_;
        const hDOM = this.imageHeightDOM_;

        let left   = cssLeft * sx;
        let top    = cssTop * sy;
        let right  = Math.min(cssLeft + cssWidth,  wCSS) * sx;
        let bottom = Math.min(cssTop  + cssHeight, hCSS) * sy;

        left   = Math.max(0, left);
        top    = Math.max(0, top);
        right  = Math.max(left,  Math.min(right,  wDOM));
        bottom = Math.max(top,   Math.min(bottom, hDOM));

        const x0 = Math.floor(left + 0.5);
        const y0 = Math.floor(top  + 0.5);
        const x1 = Math.floor(right  - 0.5);
        const y1 = Math.floor(bottom - 0.5);
        if (x1 < x0 || y1 < y0) return;

        const w = (x1 - x0 + 1);
        const h = (y1 - y0 + 1);

        if (this.count_ >= this.cap_) this.grow_();
        const i2 = this.count_ * 2;
        this.pos_[i2 + 0] = x0;
        this.pos_[i2 + 1] = y0;
        this.size_[i2 + 0] = w;
        this.size_[i2 + 1] = h;

        // packed を RGBA 順の 4byte に分解して color_ に詰める
        const c4 = this.count_ * 4;
        this.color_[c4 + 0] = (packedRGBA >>> 24) & 255; // R
        this.color_[c4 + 1] = (packedRGBA >>> 16) & 255; // G
        this.color_[c4 + 2] = (packedRGBA >>> 8)  & 255; // B
        this.color_[c4 + 3] = (packedRGBA)        & 255; // A

        this.count_++;
    }

    private grow_(): void {
        const newCap = Math.max(2048, this.cap_ * 2 || 0);
        const pos = new Float32Array(newCap * 2);
        const siz = new Float32Array(newCap * 2);
        const col = new Uint8Array(newCap * 4);
        if (this.cap_ > 0) {
            pos.set(this.pos_.subarray(0, this.cap_ * 2));
            siz.set(this.size_.subarray(0, this.cap_ * 2));
            col.set(this.color_.subarray(0, this.cap_ * 4));
        }
        this.pos_ = pos;
        this.size_ = siz;
        this.color_ = col;
        this.cap_ = newCap;
    }

    private flush_(): void {
        if (this.count_ === 0) return;
        const gl = this.gl_!;

        // インスタンス属性をアップロード
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos_);
        gl.bufferData(gl.ARRAY_BUFFER, this.pos_.subarray(0, this.count_ * 2), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.attrib_a_pos_);
        gl.vertexAttribPointer(this.attrib_a_pos_, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(this.attrib_a_pos_, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufSize_);
        gl.bufferData(gl.ARRAY_BUFFER, this.size_.subarray(0, this.count_ * 2), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.attrib_a_size_);
        gl.vertexAttribPointer(this.attrib_a_size_, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(this.attrib_a_size_, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufColor_);
        gl.bufferData(gl.ARRAY_BUFFER, this.color_.subarray(0, this.count_ * 4), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.attrib_a_color_);
        gl.vertexAttribPointer(this.attrib_a_color_, 4, gl.UNSIGNED_BYTE, true, 0, 0);
        gl.vertexAttribDivisor(this.attrib_a_color_, 1);

        // 単位クアッド（6頂点）
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufUnit_);
        gl.enableVertexAttribArray(this.attrib_a_unit_);
        gl.vertexAttribPointer(this.attrib_a_unit_, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(this.attrib_a_unit_, 0);

        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count_);
        this.count_ = 0;
    }

    private initGL_(): void {
        const gl = this.gl_!;

        // 最小限のシェーダ：位置変換＋色の受け渡しのみ（HSL→RGB は CPU キャッシュ）
        const vs = `#version 300 es\n
            layout(location=0) in vec2 a_unit;   // 頂点ごとの単位クアッド (0..1)
            layout(location=1) in vec2 a_pos;    // インスタンス左上（px）
            layout(location=2) in vec2 a_size;   // インスタンス幅高（px）
            layout(location=3) in vec4 a_color;  // インスタンス色（0..1）
            uniform vec2 u_resolution;           // 画面サイズ（px）
            out vec4 v_color;
            void main(){
                vec2 pos = a_pos + a_unit * a_size;
                vec2 zeroToOne = pos / u_resolution;
                vec2 clip = zeroToOne * 2.0 - 1.0;
                gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0); // Y 反転
                v_color = a_color;
            }
        `;

        const fs = `#version 300 es\n
            precision mediump float;
            in vec4 v_color;
            out vec4 outColor;
            void main(){ outColor = v_color; }
        `;

        const program = this.linkProgram_(vs, fs);
        this.program_ = program;
        this.uniform_u_resolution_ = gl.getUniformLocation(program, "u_resolution");

        // バッファ作成
        this.bufUnit_ = gl.createBuffer();
        this.bufPos_  = gl.createBuffer();
        this.bufSize_ = gl.createBuffer();
        this.bufColor_= gl.createBuffer();

        // 単位クアッド（2 三角形 × 3 頂点）
        const quad = new Float32Array([
            0,0,  1,0,  0,1,
            0,1,  1,0,  1,1,
        ]);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bufUnit_);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    }

    private compileShader_(type: number, src: string): WebGLShader {
        const gl = this.gl_!;
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(sh) ?? "";
            gl.deleteShader(sh);
            throw new Error("Shader compile failed: " + log);
        }
        return sh;
    }

    private linkProgram_(vsSrc: string, fsSrc: string): WebGLProgram {
        const gl = this.gl_!;
        const vs = this.compileShader_(gl.VERTEX_SHADER, vsSrc);
        const fs = this.compileShader_(gl.FRAGMENT_SHADER, fsSrc);
        const prog = gl.createProgram()!;
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(prog) ?? "";
            gl.deleteProgram(prog);
            throw new Error("Program link failed: " + log);
        }
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        return prog;
    }
}


// 細かい FillRect を行う際に，ImageData を直接操作してソフト描画を行い高速化するためのクラス
class RectRendererSoft {
    // DOM/CSS 次元（読み取り専用）
    imageHeightDOM_: number = 0;
    imageWidthDOM_: number = 0;
    imageHeightCSS_: number = 0;
    imageWidthCSS_: number = 0;

    private ctx_: CanvasRenderingContext2D | null = null;
    private imageDataHandle_: ImageData | null = null;
    private imageDataUint32Ptr_: Uint32Array | null = null;
    private imageWidthScale_: number = 0;
    private imageHeightScale_: number = 0;

    private fillHuePrev_: number = -1;
    private fillStylePrev_: string = "";
    private rgbCache_ = new Int32Array(256);    // 0-255 に整数化した hue 値から RGBA 値をキャッシュ

    // オーバーレイ（raw描画）用のオフスクリーンキャンバス
    private overlayCanvas_: HTMLCanvasElement | null = null;
    private overlayCtx_: CanvasRenderingContext2D | null = null;

    constructor() {
        // rgbCache を -1 で初期化
        this.rgbCache_.fill(-1);
        this.ctx_ = null;
        this.overlayCanvas_ = null;
        this.overlayCtx_ = null;
    }

    init() {
        // オーバーレイの用意（同サイズ）
        if (!this.overlayCanvas_) {
            this.overlayCanvas_ = document.createElement("canvas");
        }
        return true;
    }

    beginRawMode(canvas: HTMLCanvasElement, scale: number): void {
        // 画像サイズ（DOM/CSS）
        this.imageHeightDOM_ = canvas.height;
        this.imageWidthDOM_  = canvas.width;
        this.imageHeightCSS_ = canvas.clientHeight;
        this.imageWidthCSS_  = canvas.clientWidth;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error("2D rendering context could not be obtained.");
        }
        this.ctx_ = ctx;

        this.imageWidthScale_  = canvas.width  / Math.max(1, canvas.clientWidth);
        this.imageHeightScale_ = canvas.height / Math.max(1, canvas.clientHeight);

        if (!this.overlayCanvas_) {
            return;
        }
        this.overlayCanvas_.width = this.imageWidthDOM_;
        this.overlayCanvas_.height = this.imageHeightDOM_;
        const overlayCtx_ = this.overlayCanvas_.getContext("2d");
        if (!overlayCtx_) {
            throw new Error("Overlay 2D context could not be obtained.");
        }
        this.overlayCtx_ = overlayCtx_;
        
        // 通常の fillRect を使う
        if (scale > 1) {
            return;
        }

        // キャンバス全体の ImageData を取得．全てゼロでクリアされる
        this.imageDataHandle_   = this.overlayCtx_.createImageData(this.imageWidthDOM_, this.imageHeightDOM_);
        this.imageDataUint32Ptr_ = new Uint32Array(this.imageDataHandle_.data.buffer);
    }

    endRawMode(): void {
        if (!this.overlayCtx_ || !this.ctx_ || !this.overlayCanvas_) {
            return;
        }
        if (this.imageDataHandle_) {
            // overlay にピクセルを反映
            this.overlayCtx_.putImageData(this.imageDataHandle_, 0, 0);

            
            this.ctx_.save();
            // drawImage は現在の transform の影響を受けるため、
            // CSS↔DOM のスケーリングや translate を無視してピクセル等倍で描く
            this.ctx_.resetTransform(); // モダン環境

            // 合成モードを変更（デフォルトは 'source-over'）
            this.ctx_.globalCompositeOperation = 'source-over';

            // 画像スムージングを無効化（ピクセルずれ時のにじみ防止）
            this.ctx_.imageSmoothingEnabled = false;

            // DOM ピクセル座標でそのまま重ねる
            this.ctx_.drawImage(this.overlayCanvas_, 0, 0);
            this.ctx_.restore();
        }
        this.imageDataHandle_ = null;
        this.imageDataUint32Ptr_ = null;
    }


    private fillRectRaw_(
        cssLeft: number,
        cssTop: number,
        cssWidth: number,
        cssHeight: number,
        rgb: number
    ): void {
        if (!this.imageDataUint32Ptr_) return; // raw mode でなければ何もしない

        // left や top などの座標系は CSS 座標で与えられるが，
        // imageData は DOM 座標系で与えられるのでスケールする
        const sx = this.imageWidthScale_;
        const sy = this.imageHeightScale_;
        const wCSS = this.imageWidthCSS_;
        const hCSS = this.imageHeightCSS_;
        const wDOM = this.imageWidthDOM_;
        const hDOM = Math.floor(hCSS * sy);

        // CSS→DOM 変換
        let left   = cssLeft * sx;
        let top    = cssTop * sy;
        let right  = Math.min(cssLeft + cssWidth,  wCSS) * sx;
        let bottom = Math.min(cssTop  + cssHeight, hCSS) * sy;

        // 左・上もクランプ
        left   = Math.max(0, left);
        top    = Math.max(0, top);
        right  = Math.max(left,  Math.min(right,  wDOM));
        bottom = Math.max(top,   Math.min(bottom, hDOM));

        // width や height は小数になっている可能性があるので，
        // ループ回数の判定は小数のまま行う
        // 小数の空間で +1 づつサンプリングしていることになる
        // +0.5 は四捨五入のため
        const x0 = Math.floor(left + 0.5);
        const y0 = Math.floor(top  + 0.5);
        const x1 = Math.floor(right  - 0.5);
        const y1 = Math.floor(bottom - 0.5);

        const imageData = this.imageDataUint32Ptr_;

        let rowStart = y0 * wDOM;
        for (let y = y0; y <= y1; y++) {
            let p = rowStart + x0;
            const pEnd = rowStart + x1;
            for (; p <= pEnd; p++) {
                imageData[p] = rgb; // α を含む RGBA 値（下記メモ参照）
            }
            rowStart += wDOM;
        }
    }

    toStyle_(stateVal: number): string {
        const hue = stateVal * 360;
        const color = `hsl(${hue},60%,60%)`;
        return color;
    };

    hsl2rgb(h: number){
        let s = 0.6, l = 0.6;
        let r, g, b;
    
        if(s == 0){
            r = g = b = l;
        }else{
            let hue2rgb = (p:number, q:number, t:number) => {
                if(t < 0) t += 1;
                if(t > 1) t -= 1;
                if(t < 1/6) return p + (q - p) * 6 * t;
                if(t < 1/2) return q;
                if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
    
            let q = (l < 0.5) ? 
                (l * (1 + s)) : (l+s - l*s);
            let p = 2*l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        return 0xff000000 | (Math.floor(b*255)<<16) | (Math.floor(g*255)<<8) | Math.floor(r*255);
    }

    fillRect(cssLeft: number, cssTop: number, cssWidth: number, cssHeight: number, hue: number): void {
        if (!this.ctx_)
            return;

        if (this.imageDataUint32Ptr_)  {
            let intHue = Math.floor(hue * 255);
            let rgb = this.rgbCache_[intHue];
            if (rgb == -1) {
                rgb = this.hsl2rgb(hue);
                this.rgbCache_[intHue] = rgb;
            }
            this.fillRectRaw_(cssLeft, cssTop, cssWidth, cssHeight, rgb);
        }
        else {
            if (this.fillHuePrev_ !== hue) {
                this.fillHuePrev_ = hue;
                this.fillStylePrev_ = "";
                let style = this.toStyle_(hue);
                this.ctx_.fillStyle = style;
            }
            this.ctx_.fillRect(cssLeft, cssTop, cssWidth, cssHeight);
        }
    }
}

export { RectRendererSoft, RectRendererWebGL };