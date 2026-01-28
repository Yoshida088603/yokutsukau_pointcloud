# LAZ Center Picking

## 🌐 ライブデモ（GitHub Pages）

**👉 [https://yoshida088603.github.io/csv_center_picking/](https://yoshida088603.github.io/csv_center_picking/)**

サーバー不要でブラウザ上で直接LAZ/LASファイルを処理できます。1GB以上のファイルも対応可能です。

![LAZ Center Picking UI](assets/ui-screenshot.png)

---

## 🎯 検証主題

**サーバーレスで完結するLAS/LAZ処理 Webアプリケーション**

このプロジェクトでは、以下の技術的課題の実現可能性を検証しています：

- ✅ **LAZ圧縮ファイル対応**（laz-perf WASM使用）
- ✅ **サーバーレス**（完全ブラウザ処理）
- ✅ **静的ホスティングのみ**（GitHub Pagesで動作）

**ユニークな点**: laz-perf WASMを統合し、静的ホスティング（GitHub Pages）で動作する完全サーバーレスなLAZ処理アプリケーションを実現しました。

**実装例**: この技術を応用し、CSVに記載された座標周辺の点群（LAZ/LAS）を抽出するツールとして実装しています。

## 🎯 機能

- LAZ圧縮ファイル対応
- 非圧縮LASファイル対応
- 複数の中心座標から指定半径内の点を一括抽出
- KD-treeによる高速検索
- ストリーミング処理による大容量ファイル対応

## 📦 実装バージョン

### 1. ブラウザ版 - GitHub Pages対応版（メインの検証主題）

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
- **1GB以上のファイルも処理可能**（ストリーミング処理）
- リアルタイム進捗表示
- 自動ダウンロード
- **チャンクサイズ調整可能**（100-1000MB、推奨: 500-1000MB）

**パフォーマンス:**
- チャンクサイズを大きく（500-1000MB）すると処理速度が大幅に向上
- ストリーミング処理により、メモリ効率的に大容量ファイルを処理

詳細: [GITHUB_PAGES.md](GITHUB_PAGES.md)

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

### 3. WebAssembly版（開発中）

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

### 4. Python版（参考実装）

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

## 🔬 今後の検証テーマ

- [ ] **LAStools.jsとのパフォーマンス比較**
  - laz-perfとLAStools.jsの処理速度を比較検証
  - 同じファイルでベンチマークを実施
  - メモリ使用量、処理時間、ブラウザ互換性を評価

## 📚 技術詳細

### LAZ圧縮について
LAZ（LASzip）は、LAS点群データの可逆圧縮形式です。
通常、5-10倍の圧縮率を実現します。

### ブラウザでのLAZ処理の課題
1. **WebAssembly要件**: LAZ解凍には高速な圧縮アルゴリズムが必要
2. **メモリ制限**: ブラウザのメモリ制限（通常2-4GB）
3. **依存関係**: laz-perfやLASzipのWASMビルドが必要

### 解決策
- **アプローチ1**: laz-perf WASM（軽量、高速）← **採用**
- **アプローチ2**: LASzip WASM（完全機能）
- **アプローチ3**: Pyodide（Python互換性）

### laz-perfを選択した理由

**laz-perf WASMを採用した理由**:
- ✅ **ビルド不要**: npmパッケージとして利用可能、CDNから直接読み込み可能
- ✅ **セットアップが簡単**: `import`で読み込むだけで使用可能
- ✅ **静的ホスティングに適している**: GitHub Pagesで簡単にデプロイ可能
- ✅ **実績**: Potreeで使用されている実績あり
- ✅ **軽量**: ~1.2MB
- ✅ **パフォーマンス**: LASzipよりも高速に実行される（開発目的）

**LAStools.jsを採用しなかった理由**:
- ⚠️ ビルドが必要（CMake + Emscripten）
- ⚠️ npmパッケージやCDNでの配布が確認できなかった
- ⚠️ セットアップが複雑（ビルド環境が必要）

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
