# ポリゴンSIMA処理 途中クラッシュの原因と対応

## 事象

- **単点CSV（中心抽出）**: LAZ解凍＋フィルタリングは最後まで完走する。
- **ポリゴンSIMA**: LAZ解凍＋3領域分類は、約3,000万点付近で「Render process gone」となりタブがクラッシュする（2.7億点規模のLAZで再現）。

## 原因

| 処理 | メモリに保持するデータ | 結果 |
|------|------------------------|------|
| 単点CSV | フィルタに**通った点だけ**を配列に push | 点数が少なくメモリは小さい |
| ポリゴンSIMA（対応前） | **全点**を `points.push(p)` で配列に保持 | 2.7億個のJSオブジェクト → 数GB〜数十GBでOOM |

ポリゴンSIMAでは「全点に内側/帯/外側の分類を付けてLASで出力」するため、従来は解凍した全点を `points` 配列に蓄えていた。点数が億単位になると、オブジェクト数とプロパティ分のメモリが膨大になり、レンダラがクラッシュしていた。

## 対応内容

ポリゴンSIMAのLAZ経路のみ、**点の配列を一切持たず**「解凍ストリームの各点をその場でLAS用バッファに書き込み、チャンク単位でBlobにまとめる」方式に変更した。

### 1. ストリーミング解凍＋その場書き込み

- 解凍は `decompressLAZStreaming` で1点ずつ取得。
- 各点で内側/帯/外側を判定し、Classification と帯のマゼンタ色を設定。
- その点を**配列に push せず**、現在の出力チャンク（52MB の ArrayBuffer）の該当オフセットに直接書き込む。チャンクが満杯になったら次のチャンクを確保し、配列 `pointChunks` に push。

### 2. チャンク＋Blob による出力（ArrayBuffer 2GB 制限の回避）

- 2.7億点×26バイト ≈ 6.5GB の **1本の ArrayBuffer** はブラウザの上限（多くは約2GB）を超えるため、採用していない。
- 定数 `POLYGON_STREAM_CHUNK_BYTES = 52 * 1024 * 1024`（52MB、点レコード長の倍数）。1チャンクあたり約200万点。
- ストリーム終了後: ヘッダー用 227 バイトの ArrayBuffer を確保し、`buildLASHeaderForStreamedOutput` で書き込み。`outputLasBuffer = new Blob([headerBuf, ...pointChunks], ...)` でダウンロード用 Blob を生成。
- ダウンロード・結果表示では `outputLasBuffer`（Blob）をそのまま `URL.createObjectURL` と `blob.size` で使用。

### 3. 追加した関数・定数

- `LAS_HEADER_SIZE = 227`
- `POLYGON_STREAM_CHUNK_BYTES` … ポリゴンストリーミング出力の1チャンクサイズ（52MB）。
- `writeSinglePointToLASView(view, offset, point, pointRecordLength, hasRGB, originX, originY, originZ)` … 1点をLAS点レコードとして DataView に書き込む。
- `buildLASHeaderForStreamedOutput(view, pointCount, pointFormat, pointRecordLength, firstPoint, minX, maxX, ...)` … ストリーム完了後にLASヘッダー（227バイト）を書き込む。

### 4. decompressLAZStreaming の変更

- コールバックを `onPoint(point, pointIndex)` に拡張（第2引数に通し番号を渡す）。既存の中心抽出などは `(point) => ...` のまま利用可能。

### 5. メモリ

- 解凍中: 圧縮入力バッファ ＋ laz-perf の作業用のみ。
- 出力: 点の配列は持たず、**同時に保持するのは「現在の1チャンク（52MB）＋ヘッダー用227バイト＋完了済みチャンク配列」**。最終成果物は Blob で 1 つの LAS としてダウンロード可能。

これにより、2.7億点規模でも「2.7億個のオブジェクト配列」も「6.5GBの単一 ArrayBuffer」も経由せず、単点CSVと同様にメモリを抑えて完走し、1つの LAS ファイルとしてダウンロードできる。

## 補足

- 非圧縮LASのポリゴン経路（ストリーミング／一括読込）は従来どおり「全点を配列に読んでから分類」のまま。
- エラー履歴: 当初は「全点配列」を廃止して「1本の ArrayBuffer に直接書き込み」にしたが、処理開始直後に `RangeError: Array buffer allocation failed` が発生。上記のチャンク＋Blob 方式に変更して解消。

## 変更ファイル

- `app_github_pages.js` … ストリーミング書き込みロジック・ヘルパー・ポリゴンLAZ経路のチャンク＋Blob 出力への差し替え。
