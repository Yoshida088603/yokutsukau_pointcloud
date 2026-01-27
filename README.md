# LAZ Center Picking

CSVに記載された座標周辺の点群（LAZ/LAS）を抽出するツール

## 🎯 機能

- LAZ圧縮ファイル対応
- 非圧縮LASファイル対応
- 複数の中心座標から指定半径内の点を一括抽出
- KD-treeによる高速検索
- ストリーミング処理による大容量ファイル対応

## 📦 実装バージョン

### 1. Python版（推奨 - 完全動作）

**特徴:**
- ✅ LAZ/LAS完全対応
- ✅ 176百万点を4分で処理
- ✅ 実証済み：381,687点を正常に抽出
- ✅ メモリ効率的なストリーミング処理

**使用方法:**

```bash
# 仮想環境のセットアップ
python -m venv venv
.\venv\Scripts\activate

# 依存パッケージのインストール
pip install -r requirements.txt

# 実行
python clip_spheres_stream.py --in_laz input.laz --centers_csv centers.csv --out_laz output.laz --radius 0.5
```

**引数:**
- `--in_laz`: 入力LAZ/LASファイル
- `--centers_csv`: 中心座標CSVファイル（形式: `label,x,y,z`）
- `--out_laz`: 出力LAZ/LASファイル
- `--radius`: 抽出半径（メートル）（デフォルト: 0.5）
- `--chunk_size`: チャンクサイズ（デフォルト: 500000）

### 2. ブラウザ版 - サーバー版（ローカル実行）

**対応状況:**
- ✅ **LAZ圧縮ファイル完全対応**
- ✅ **非圧縮LAS対応**
- ✅ **ローカルPythonサーバーで高速処理**
- ✅ **使いやすいWebUI**

**使用方法:**

```bash
# 仮想環境をアクティベート
.\venv\Scripts\activate

# サーバーを起動
python server.py

# ブラウザで開く
# http://localhost:8000/index.html
```

**アーキテクチャ:**
1. **ブラウザUI**: ファイル選択、進捗表示、ダウンロード
2. **Pythonサーバー**: LAZ解凍、点群フィルタリング（laspy + lazrs）
3. **ローカル実行**: データは外部に送信されません

**特徴:**
- Python版と同じ処理エンジン（高速・確実）
- ブラウザから簡単操作
- リアルタイム進捗表示
- 自動ダウンロード
- 動作確認済み：1.75GB LAZ（176百万点）を4分で処理

### 3. ブラウザ版 - GitHub Pages対応版（NEW! 🎉）

**対応状況:**
- ✅ **LAZ圧縮ファイル完全対応**（laz-perf WASM使用）
- ✅ **非圧縮LAS対応**
- ✅ **サーバー不要**（完全ブラウザ処理）
- ✅ **GitHub Pagesで動作**（静的ホスティングのみ）

**使用方法:**

```bash
# ローカルでテスト
python -m http.server 8000
# http://localhost:8000/index_github_pages.html
```

**GitHub Pagesで公開:**

1. `index_github_pages.html`を`index.html`にリネーム（またはGitHub Pagesの設定で指定）
2. `app_github_pages.js`をアップロード
3. GitHub Pagesを有効化
4. `https://<username>.github.io/csv_center_picking/`でアクセス

**アーキテクチャ:**
1. **ブラウザUI**: ファイル選択、進捗表示、ダウンロード
2. **laz-perf WASM**: ブラウザ内でLAZ解凍（CDN経由）
3. **完全クライアント処理**: サーバー不要、データは外部に送信されません

**特徴:**
- サーバー不要で完全動作
- GitHub Pagesで公開可能
- LAZ完全対応（laz-perf使用）
- リアルタイム進捗表示
- 自動ダウンロード

**注意**: ブラウザのメモリ制限により、非常に大きなファイル（4GB以上）は処理できない場合があります。その場合はサーバー版をご利用ください。

詳細: [GITHUB_PAGES.md](GITHUB_PAGES.md)

### 4. WebAssembly版（開発中）

**目標:**
- ブラウザでLAZ解凍を実現
- Python版と同等のパフォーマンス
- オフライン動作

**ビルド手順:**

```bash
cd wasm

# 1. 環境セットアップ（初回のみ）
setup.bat

# 2. WASMモジュールのビルド
build_full.bat

# 3. 生成されたファイル
# - dist/laz_decoder.js
# - dist/laz_decoder.wasm
```

**使用方法:**

```html
<script type="module">
  import LAZDecoder from './wasm/dist/laz_decoder.js';
  
  const decoder = await LAZDecoder();
  const lazDecoder = new decoder.LAZDecoder();
  
  // ファイルデータを読み込み
  const data = new Uint8Array(await file.arrayBuffer());
  const success = lazDecoder.loadData(data);
  
  if (success) {
    const numPoints = lazDecoder.getPointCount();
    console.log(`Points: ${numPoints}`);
    
    // フィルタリング
    const filtered = lazDecoder.filterPoints(
      center_x_array,
      center_y_array,
      center_z_array,
      radius
    );
  }
</script>
```

## 📊 入力ファイル形式

### centers.csv
```csv
label,x,y,z
T1,-4921.472,-42414.329,8.650
T2,-4922.123,-42415.456,8.720
```

**フォーマット:**
- 1行目: ヘッダー（`label,x,y,z` または `label,Y,X,Z`）
- 2行目以降: データ（ラベル,X座標,Y座標,Z座標）

## 🔧 必要な環境

### Python版
- Python 3.8以上
- numpy
- laspy
- scipy
- lazrs（LAZ圧縮バックエンド）

### ブラウザ版
- モダンブラウザ（Chrome, Firefox, Edge推奨）
- JavaScriptモジュール対応

### WASM版（ビルド時）
- Emscripten SDK
- Git
- CMake（オプション）

## 📈 パフォーマンス

**テスト環境:**
- ファイル: 1.75GB LAZ（176,117,176点）
- 中心座標: 32点
- 抽出半径: 0.5m

**結果:**
- 処理時間: 約4分
- 出力点数: 381,687点
- 出力ファイル: 7.3MB LAZ

## 🛠️ 開発ロードマップ

- [x] Python版実装
- [x] 非圧縮LASブラウザ対応
- [x] **LAZ完全対応（サーバー版完成）**
- [x] **GitHub Pages対応版完成（laz-perf使用）**
- [x] プログレス表示実装
- [ ] LASzip WASM版の完成（B案）
- [ ] パフォーマンス最適化（将来）
- [ ] Web Workerで並列処理

## 📚 技術詳細

### LAZ圧縮について
LAZ（LASzip）は、LAS点群データの可逆圧縮形式です。
通常、5-10倍の圧縮率を実現します。

### ブラウザでのLAZ処理の課題
1. **WebAssembly要件**: LAZ解凍には高速な圧縮アルゴリズムが必要
2. **メモリ制限**: ブラウザのメモリ制限（通常2-4GB）
3. **依存関係**: laz-perfやLASzipのWASMビルドが必要

### 解決策
- **アプローチ1**: laz-perf WASM（軽量、高速）
- **アプローチ2**: LASzip WASM（完全機能）
- **アプローチ3**: Pyodide（Python互換性）

詳細: [WASM_INTEGRATION.md](WASM_INTEGRATION.md)

## 🤝 貢献

バグ報告、機能要望、プルリクエストを歓迎します。

## 📝 ライセンス

MIT License

## 🔗 参考リンク

- [LASzip](https://laszip.org/) - LAZ圧縮仕様
- [laspy](https://github.com/laspy/laspy) - Python LAS/LAZライブラリ
- [laz-perf](https://github.com/hobu/laz-perf) - 高速LAZ解凍
- [Potree](https://github.com/potree/potree) - WebGL点群ビューワー
- [Emscripten](https://emscripten.org/) - C/C++ to WebAssembly
