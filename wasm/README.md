# LAZ解凍 WebAssemblyモジュール

LASzipライブラリをEmscriptenでWebAssemblyにコンパイルしてブラウザでLAZ解凍を実現します。

## 必要なツール

1. **Emscripten SDK**
   - WebAssembly/asm.jsへのコンパイラ
   - https://emscripten.org/docs/getting_started/downloads.html

2. **LASzip**
   - LAZ圧縮/解凍の標準ライブラリ
   - https://github.com/LASzip/LASzip

## ビルド手順

### 1. Emscriptenのインストール

```bash
# Emscripten SDKのダウンロード
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk

# 最新版のインストール
emsdk install latest
emsdk activate latest

# 環境変数の設定（Windowsの場合）
emsdk_env.bat
```

### 2. LASzipのダウンロード

```bash
cd ..
git clone https://github.com/LASzip/LASzip.git
cd LASzip
```

### 3. WebAssemblyモジュールのビルド

```bash
# CMakeでビルド設定
emcmake cmake . -DCMAKE_BUILD_TYPE=Release

# ビルド実行
emmake make

# JavaScriptバインディング付きでコンパイル
emcc src/laszip.cpp src/laszip_api.c \
  -I./src \
  -o laz_decoder.js \
  -s WASM=1 \
  -s EXPORTED_FUNCTIONS='["_laszip_create","_laszip_open_reader","_laszip_read_point","_laszip_close_reader","_laszip_destroy"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='LazDecoder' \
  -O3
```

## 使い方

ビルドが完了すると `laz_decoder.js` と `laz_decoder.wasm` が生成されます。

これらをブラウザアプリから読み込んで使用します。
