# LAZ解凍 WebAssembly統合ガイド

## 概要

ブラウザでLAZ圧縮ファイルを解凍するには、WebAssemblyモジュールが必要です。
以下の3つのアプローチがあります。

## アプローチ1: laz-perfを使用（推奨）

`laz-perf`は既にWASMにコンパイルされており、npmパッケージとして利用可能です。

### 利点
- ビルド不要
- npmから直接使用可能
- Potreeでも使用されている実績

### 使用方法

```javascript
// CDN経由で読み込み
import LazPerf from 'https://cdn.jsdelivr.net/npm/laz-perf@0.0.7/dist/laz-perf.js';

// 初期化
const decoder = await LazPerf();

// LAZファイルを解凍
const lazBuffer = new Uint8Array(lazFileArrayBuffer);
const lasBuffer = decoder.decompress(lazBuffer);
```

### 現在の課題
- ES Modulesとの互換性
- ブラウザ環境での依存関係の解決
- WASM初期化のタイミング

## アプローチ2: LASzipを自分でビルド

LASzipライブラリをEmscriptenでWASMにコンパイルする方法です。

### 必要なもの
- Emscripten SDK
- LASzipソースコード
- CMake

### ビルド手順

```bash
# 1. Emscriptenのセットアップ
cd wasm
setup.bat

# 2. LASzipのダウンロード
git clone https://github.com/LASzip/LASzip.git

# 3. ビルド
cd LASzip
mkdir build
cd build

# Emscriptenでビルド
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release
emmake make

# JavaScriptバインディング付きでコンパイル
emcc ../src/*.cpp \
  -I../src \
  -o ../../dist/laszip.js \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='LASzip' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -lembind \
  -O3
```

### 利点
- 完全な制御
- 最新バージョンを使用可能
- カスタマイズ可能

### 欠点
- ビルド環境のセットアップが複雑
- コンパイル時間がかかる
- C++の知識が必要

## アプローチ3: Pyodideを使用

Pythonをブラウザで実行し、既存のPythonスクリプトを使用する方法です。

### 利点
- 既存のPythonコードをそのまま使える
- laspy、numpy、scipyが使用可能
- 実証済みの動作

### 欠点
- 初期化に時間がかかる（数秒）
- メモリ消費が大きい
- Pythonランタイム全体をダウンロード（~30MB）

### 使用方法

```html
<script src="https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js"></script>
```

```javascript
const pyodide = await loadPyodide();
await pyodide.loadPackage(['numpy', 'micropip']);
await pyodide.runPythonAsync(`
    import micropip
    await micropip.install('laspy')
    await micropip.install('lazrs')
`);

// Pythonコードを実行
const result = pyodide.runPython(`
    import laspy
    import numpy as np
    from io import BytesIO
    
    # LAZファイルを処理
    las = laspy.read(BytesIO(laz_data))
    # ... フィルタリング処理 ...
`);
```

## 推奨事項

### 開発速度を優先する場合
→ **Pyodide** を使用（`index_pyodide.html`）

### パフォーマンスを優先する場合
→ **laz-perf** を使用（統合作業が必要）

### 完全な制御が必要な場合
→ **LASzip自前ビルド** （時間がかかる）

## 次のステップ

1. **短期**: Pyodide版を完成させる（最も確実）
2. **中期**: laz-perfの統合を完了させる
3. **長期**: LASzip WASMモジュールを自前でビルド

## 実装状況

- ✅ Python版（完全動作）
- ✅ ブラウザ版 - 非圧縮LAS（動作確認済み）
- ✅ **ブラウザ版 - LAZ（Pyodide版完成・完全動作）**
- ✅ **Pyodide版（実装完了）**

## 参考リンク

- [Emscripten](https://emscripten.org/)
- [LASzip](https://github.com/LASzip/LASzip)
- [laz-perf](https://github.com/hobu/laz-perf)
- [Pyodide](https://pyodide.org/)
- [Potree](https://github.com/potree/potree)
