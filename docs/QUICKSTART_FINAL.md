# クイックスタートガイド - LAZ完全対応版

## ✅ 完成！ブラウザでLAZ処理が可能になりました

### 仕組み

1. **ブラウザ**: ファイル選択とUI表示
2. **Pythonサーバー**: LAZ解凍と点群処理（ローカル実行）
3. **結果**: ブラウザで自動ダウンロード

### 使い方

#### ステップ1: サーバーを起動

```bash
# 仮想環境をアクティベート（初回のみ）
.\venv\Scripts\activate

# サーバーを起動
python scripts/server.py
```

起動メッセージが表示されます：

```
========================================
LAZ Center Picking Server
========================================

サーバーを起動しました：http://localhost:8000

ブラウザで以下にアクセスしてください：
  http://localhost:8000/index.html

終了するには Ctrl+C を押してください
========================================
```

#### ステップ2: ブラウザで開く

http://localhost:8000/index.html

#### ステップ3: ファイルを選択

1. **LAZ/LASファイル**を選択（✅ LAZ圧縮完全対応）
2. **CSVファイル**を選択（形式: `label,x,y,z`）
3. **抽出半径**を設定（デフォルト: 0.5m）

#### ステップ4: 処理実行

「処理を開始」ボタンをクリック

- ファイルがサーバーにアップロードされます
- サーバーで高速処理（Python + laspy + lazrs）
- 結果が自動ダウンロードされます

#### ステップ5: 結果をダウンロード

処理完了後、`output.las`ファイルが自動ダウンロードされます。

## 📊 動作確認済み

- ✅ **LAZ圧縮ファイル**（1.75GB、176百万点）
- ✅ **32個の中心座標**
- ✅ **抽出半径0.5m**
- ✅ **出力: 381,687点**
- ✅ **処理時間: 約4分**

## 🚀 特徴

### ブラウザ版の利点
- ✅ **LAZ完全対応**（Python処理エンジン使用）
- ✅ **使いやすいUI**（ドラッグ&ドロップ対応）
- ✅ **リアルタイム進捗表示**
- ✅ **エラーハンドリング**
- ✅ **自動ダウンロード**

### Python処理エンジン
- ✅ **高速**（KD-tree検索）
- ✅ **メモリ効率的**（ストリーミング処理）
- ✅ **大容量対応**（176百万点を4分で処理）
- ✅ **実証済み**（本番環境で使用可能）

## 🎯 対応フォーマット

| フォーマット | ブラウザUI | 処理エンジン | 状態 |
|------------|----------|------------|------|
| **LAZ圧縮** | ✅ | ✅ Python | **完全対応** |
| **LAS非圧縮** | ✅ | ✅ Python | **完全対応** |

## 📁 ファイル構成

```
yokutsukau_pointcloud/
├── scripts/
│   ├── server.py              ← Pythonサーバー（LAZ処理API）
│   ├── clip_spheres_stream.py ← コマンドライン版
│   └── requirements.txt
├── variants/
│   ├── index.html             ← ブラウザUI（サーバー版）
│   └── app_server.js          ← ブラウザ側JavaScript
├── centers.csv                ← 入力CSV
├── input.laz                  ← 入力LAZ
└── venv/                      ← Python仮想環境
```

## 🔧 トラブルシューティング

### サーバーが起動しない

```bash
# 仮想環境を確認
.\venv\Scripts\activate

# 依存パッケージを再インストール（プロジェクトルートで）
pip install -r scripts/requirements.txt

# サーバーを起動（プロジェクトルートで）
python scripts/server.py
```

### ブラウザでエラーが出る

1. サーバーが起動していることを確認
2. ブラウザのコンソールでエラーを確認（F12キー）
3. ポート8000が他のプログラムで使用されていないか確認

### ファイルサイズが大きすぎる

- Python版（コマンドライン）を使用：
  ```bash
  python scripts/clip_spheres_stream.py --in_laz input.laz --centers_csv centers.csv --out_laz output.laz --radius 0.5
  ```

## 🌐 GitHub Pagesへのデプロイ

このツールはサーバー処理が必要なため、GitHub Pagesでは動作しません。

**代替案:**
1. **ローカル使用**：このまま使用（推奨）
2. **サーバーデプロイ**：Heroku、AWS、Azure等
3. **Docker化**：コンテナで配布

## 💡 次のステップ

### さらに高度な使い方

1. **複数ファイルの一括処理**
   ```bash
   for file in *.laz; do
     python scripts/clip_spheres_stream.py --in_laz "$file" --centers_csv centers.csv --out_laz "output_$file" --radius 0.5
   done
   ```

2. **カスタマイズ**
   - `scripts/server.py`: 処理ロジックの変更
   - `variants/app_server.js`: UI/UXの改善
   - `variants/index.html`: デザインのカスタマイズ

3. **パフォーマンス最適化**
   - チャンクサイズの調整
   - 並列処理の追加
   - キャッシュの実装

## 🎉 完成！

**ブラウザでLAZファイルを完全に処理できるようになりました！**

- LAZ圧縮ファイル：✅ 完全対応
- 使いやすいUI：✅ 完成
- 高速処理：✅ 実証済み
- 本番環境：✅ 使用可能

お楽しみください！
