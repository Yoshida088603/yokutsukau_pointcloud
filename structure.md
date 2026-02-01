# プロジェクト構造の定義

本プロジェクトは **ブラウザ内で完結するオフライン処理** の検証が本質です。以下はその前提で定めるディレクトリ・ファイルの役割です。

---

## 1. 公開用（GitHub Pages / 静的ホスティング）

ユーザーがアクセスするために必要な最小構成。

```
ルート/
├── index.html                … GitHub Pages のエントリ（app_github_pages.js を読み込む）
├── index_github_pages.html   … 同上の別名（同じ内容）
├── app_github_pages.js       … アプリ本体（LAZ/LAS ブラウザ処理）
├── assets/
│   └── ui-screenshot.png     … README 等で参照する画像
└── centers.csv               … 入力例（中心座標 CSV。任意）
```

- **エントリ**: `index.html` がルートにあり、GitHub Pages のトップでブラウザ完結版が開く。`/variants/index.html` はサーバー版用のため静的ホスティングでは使わない。
- **アプリ**: `app_github_pages.js` のみ。laz-perf は CDN から読み込むため、WASM をリポジトリに含めない。
- **処理**: すべてクライアント側。データは外部に送信しない。

---

## 2. ドキュメント

| 場所 | ファイル | 役割 |
|------|----------|------|
| ルート | `README.md` | 概要・検証主題・使い方・入力形式・技術詳細 |
| ルート | `structure.md` | 本構造の定義（このファイル） |
| ルート | `LICENSE` | ライセンス（MIT） |
| `docs/` | `GITHUB_PAGES.md` | ローカル起動・GitHub Pages 公開の手順 |
| `docs/` | `WASM_INTEGRATION.md` | laz-perf 統合などの技術メモ |
| `docs/` | `QUICKSTART.md`, `QUICKSTART_FINAL.md` | クイックスタート |

---

## 3. 開発・検証用（参照のみ）

本番のブラウザアプリには不要。開発・検証・別方式の試行用。

| ディレクトリ | 内容 | 役割 |
|--------------|------|------|
| `variants/` | `index.html`, `index_pyodide.html`, `app.js`, `app_*.js` など | サーバー版・Pyodide 版など別構成の試行 |
| `scripts/` | `server.py`, `clip_spheres_stream.py`, `convert_laz_to_las.py`, `requirements.txt` | ローカルサーバー・ストリーム処理・変換スクリプト |
| `wasm/` | ビルド用スクリプト・ソース | laz-perf を CDN に頼らずビルドする場合（本番は CDN 利用を想定） |
| ルート | `.gitignore`, `*.code-workspace` | リポジトリ運用 |

---

## 4. アーキテクチャ（処理の流れ）

| 役割 | 実体 | 備考 |
|------|------|------|
| エントリ | `index_github_pages.html` | 静的 HTML。`app_github_pages.js` を読み込む |
| UI・制御 | `app_github_pages.js` | ファイル選択・進捗・ダウンロード |
| LAZ 解凍 | laz-perf WASM | CDN 経由。ブラウザ内で解凍 |
| 処理 | 同上（クライアント内） | データは外部に送信されない |

---

## 5. ローカルで試すとき

1. ルートで `python -m http.server 8000` を実行する。
2. ブラウザで `http://localhost:8000/index_github_pages.html` を開く。

アプリの操作（ファイル選択→実行→ダウンロード）は README のライブデモと同じ。
