# LAZ Center Picking

CSVに記載された座標周辺の点群（LAZ/LAS）を抽出するツール。**ブラウザ内で完結するオフライン処理**の検証

---

## 🌐 ライブデモ（GitHub Pages）

**👉 [https://yoshida088603.github.io/csv_center_picking/](https://yoshida088603.github.io/csv_center_picking/)**

サーバー不要でブラウザ上でLAZ/LASを処理できます。1GB以上のファイルも対応可能

![LAZ Center Picking UI](assets/ui-screenshot.png)

---

## 🎯 検証主題

**ブラウザ内で完結するオフライン処理の検証**

- ✅ **LAZ圧縮対応**（laz-perf WASM）
- ✅ **オフライン処理**（データは外部に送信されず、処理中はネット不要）
- ✅ **静的ホスティングのみ**（GitHub Pagesで動作）
- ✅ **ストリーミング処理**　（1GBを超える大容量ファイルに対応

laz-perf WASMを統合し、LAZ/LAS処理がブラウザ内オフラインで完結することを検証・実現しています。

---

## 🎯 できること

- LAZ / 非圧縮LASの両対応
- 複数中心座標から指定半径内の点を一括抽出
- リアルタイム進捗表示・処理後のパフォーマンス表示

---

## 📦 ローカルでの起動と GitHub Pages での公開

※アプリの操作（ファイル選択→実行→ダウンロード）はライブデモでそのまま試せます。以下は開発・検証用の起動・公開手順です。

### ローカルで試す

```bash
python -m http.server 8000
# ブラウザで http://localhost:8000/index_github_pages.html
```

### GitHub Pagesで公開する

1. ルートに `index.html`（ブラウザ完結版）を配置済み。`app_github_pages.js` をアップロード
2. GitHub Pages を有効化
3. `https://<username>.github.io/csv_center_picking/` でアクセス

**⚠️ 注意**: 必ずルート（`/` または `index.html`）を開いてください。`/variants/index.html` はサーバー版用のため、GitHub Pages では API がなく `Failed to fetch` になります。

### アーキテクチャ

| 役割 | 内容 |
|------|------|
| ブラウザUI | ファイル選択・進捗表示・ダウンロード |
| laz-perf WASM | ブラウザ内でLAZ解凍（CDN経由） |
| 処理 | 完全クライアント側。データは外部に送信されません |

### パフォーマンスの目安

- LASはチャンクサイズを大きく（500–1000MB）すると処理が速くなりやすい
- LAZはポイント単位処理のため、チャンクサイズの効果は限定的（非圧縮LASでのみ効果あり？）

詳細は [docs/GITHUB_PAGES.md](docs/GITHUB_PAGES.md) を参照。

---

## 📊 入力ファイル形式（CSV）

中心座標のCSVは次の形式です。

```csv
label,x,y,z
T1,-4921.472,-42414.329,8.650
T2,-4922.123,-42415.456,8.720
```

- 1行目: ヘッダー（`label,x,y,z` または `label,Y,X,Z`）
- 2行目以降: ラベル, X, Y, Z

---

## 📚 技術詳細

### LAZについて

LAZ（LASzip）はLAS点群の可逆圧縮形式で、おおよそ5–10倍の圧縮率です。

### ブラウザでLAZを扱うときの課題

- LAZ解凍にはWASMなどによる高速実装が必要
- ブラウザのメモリ制限（おおよそ2–4GB）
- laz-perf などWASMビルドの利用が必要

### laz-perfを選んだ理由

- **ビルド不要**: npm/CDNから利用可能
- **セットアップが簡単**: `import` で利用
- **静的ホスティング向き**: GitHub Pagesでそのままデプロイ可能
- **実績**: Potreeで利用されている
- **軽量**: 約1.2MB

**LAStools.jsを採用しなかった理由**: ビルド（CMake + Emscripten）が必要で、npm/CDNでの配布が確認できなかったため。

詳細: [docs/WASM_INTEGRATION.md](docs/WASM_INTEGRATION.md)

---

## 🔬 今後の検証テーマ

- [ ] **LAStools.jsとのパフォーマンス比較**
  - 同一ファイルでの処理時間・メモリ・ブラウザ互換性の評価

---

## 📝 ライセンス

MIT License

---

## 🔗 参考リンク

- [LASzip](https://laszip.org/) - LAZ圧縮仕様
- [laspy](https://github.com/laspy/laspy) - Python LAS/LAZライブラリ
- [laz-perf](https://github.com/hobu/laz-perf) - 高速LAZ解凍
- [Potree](https://github.com/potree/potree) - WebGL点群ビューワー
- [Emscripten](https://emscripten.org/) - C/C++ to WebAssembly
