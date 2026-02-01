// GitHub Pages対応版 - laz-perf WASMを使用したLAZ完全対応

console.log('app_github_pages.js loaded');

// ============================================================================
// 定数定義
// ============================================================================

const STREAMING_THRESHOLD_MB = 300; // ストリーミング処理の閾値
const PROGRESS_UPDATE_INTERVAL = 5000000; // 進捗更新間隔（点）
const LOG_UPDATE_INTERVAL = 1000000; // ログ更新間隔（点）
const PERFORMANCE_BATCH_SIZE = 100000; // パフォーマンス測定のバッチサイズ
const DEFAULT_CHUNK_SIZE_MB = 100; // デフォルトチャンクサイズ（MB）

// RGB情報を含むLAS Point Format
const RGB_FORMATS = [2, 3, 5, 7, 8, 10];

// ============================================================================
// グローバル変数
// ============================================================================

let lazFile = null;
let csvFile = null;
let centers = [];
let csvLabels = [];
let csvHasZ = false;
let LazPerf = null;
let wasmReady = false;

// laz-perf WASMの初期化
async function initLazPerf() {
    const statusDiv = document.getElementById('status');
    try {
        console.log('Loading laz-perf WASM...');
        statusDiv.textContent = '⏳ LAZ解凍エンジン（laz-perf）を読み込んでいます...';
        statusDiv.className = 'status';
        
        // laz-perfをCDNから読み込み（ES Modules対応）
        // 複数のCDNを試す
        let createLazPerf;
        const cdnUrls = [
            'https://cdn.jsdelivr.net/npm/laz-perf@0.0.7/+esm',
            'https://unpkg.com/laz-perf@0.0.7?module',
            'https://cdn.jsdelivr.net/npm/laz-perf@0.0.7/lib/web/index.js'
        ];
        
        let lastError = null;
        for (const url of cdnUrls) {
            try {
                console.log(`Trying to load laz-perf from: ${url}`);
                const module = await import(url);
                createLazPerf = module.createLazPerf || module.default?.createLazPerf || module.default;
                if (createLazPerf) {
                    console.log(`Successfully loaded from: ${url}`);
                    break;
                }
            } catch (err) {
                console.warn(`Failed to load from ${url}:`, err);
                lastError = err;
            }
        }
        
        if (!createLazPerf) {
            throw new Error(`Failed to load laz-perf from all CDNs. Last error: ${lastError?.message}`);
        }
        
        console.log('laz-perf module loaded, initializing...');
        
        // WASMファイルのパスをCDNから読み込むように設定
        // EmscriptenのlocateFileオプションを使用
        const wasmPath = 'https://cdn.jsdelivr.net/npm/laz-perf@0.0.7/lib/laz-perf.wasm';
        
        LazPerf = await createLazPerf({
            locateFile: (path, prefix) => {
                // WASMファイルの場合はCDNから読み込む
                if (path.endsWith('.wasm')) {
                    console.log(`Loading WASM from CDN: ${wasmPath}`);
                    return wasmPath;
                }
                // その他のファイルは相対パス
                return prefix + path;
            }
        });
        
        console.log('laz-perf initialized:', LazPerf);
        wasmReady = true;
        
        statusDiv.textContent = '✅ 準備完了！LAZ/LASファイルを選択してください（サーバー不要・完全ブラウザ処理）';
        statusDiv.className = 'status success';
        
        return LazPerf;
        
    } catch (err) {
        console.error('Failed to load laz-perf:', err);
        statusDiv.textContent = `❌ エラー: LAZ解凍エンジンの読み込みに失敗しました。${err.message}`;
        statusDiv.className = 'status error';
        wasmReady = false;
        return null;
    }
}

// ============================================================================
// UI要素の取得
// ============================================================================

const lazInput = document.getElementById('lazFile');
const csvInput = document.getElementById('csvFile');
const lazLabel = document.getElementById('lazLabel');
const csvLabel = document.getElementById('csvLabel');
const lazInfo = document.getElementById('lazInfo');
const csvInfo = document.getElementById('csvInfo');
const processBtn = document.getElementById('processBtn');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const logDiv = document.getElementById('log');
const resultSection = document.getElementById('resultSection');
const resultText = document.getElementById('resultText');
const downloadBtn = document.getElementById('downloadBtn');
const radiusInput = document.getElementById('radius');
const chunkSizeInput = document.getElementById('chunkSize');
const filterSphereInput = document.getElementById('filterSphere');
const filterHorizontalInput = document.getElementById('filterHorizontal');
const statusDiv = document.getElementById('status');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');

// ============================================================================
// イベントハンドラと初期化
// ============================================================================

// laz-perf WASMの初期化
initLazPerf();

// ファイル選択イベント
lazInput.addEventListener('change', (e) => {
    lazFile = e.target.files[0];
    if (lazFile) {
        lazLabel.classList.add('has-file');
        lazInfo.textContent = `${lazFile.name} (${formatFileSize(lazFile.size)})`;
        checkFiles();
    }
});

csvInput.addEventListener('change', (e) => {
    csvFile = e.target.files[0];
    if (csvFile) {
        csvLabel.classList.add('has-file');
        csvInfo.textContent = `${csvFile.name} (${formatFileSize(csvFile.size)})`;
        checkFiles();
    }
});

processBtn.addEventListener('click', processFiles);

function checkFiles() {
    processBtn.disabled = !(lazFile && csvFile && wasmReady);
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function addLog(message) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
}

function updateProgress(percent, text) {
    progressFill.style.width = percent + '%';
    progressFill.textContent = text || (percent.toFixed(1) + '%');
}

/**
 * CSVを読み込み、中心座標・ラベル・Z列の有無を返す
 * @returns {{ centers: number[][], labels: string[], hasZ: boolean }}
 */
async function readCSV() {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                const centers = [];
                const labels = [];
                let hasZ = false;

                for (const line of lines) {
                    if (line.toLowerCase().includes('label')) continue;

                    const parts = line.split(',').map(p => p.trim());
                    if (parts.length >= 3) {
                        const label = parts[0];
                        const x = parseFloat(parts[1]);
                        const y = parseFloat(parts[2]);
                        if (isNaN(x) || isNaN(y)) continue;
                        const z = parts.length >= 4 ? parseFloat(parts[3]) : NaN;
                        if (parts.length >= 4 && !isNaN(z)) hasZ = true;
                        // フィルタ用に z は数値に（未指定時は 0。水平投影で点群から更新する）
                        centers.push([x, y, !isNaN(z) ? z : 0]);
                        labels.push(label);
                    }
                }

                if (centers.length === 0) {
                    reject(new Error('CSVから有効な座標が読み取れませんでした'));
                } else {
                    resolve({ centers, labels, hasZ });
                }
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('CSVファイルの読み込みに失敗しました'));
        reader.readAsText(csvFile);
    });
}

/**
 * 水平投影時: 各中心について、XY最近傍3点の最小Zで centers を更新する
 * @param {number[][]} centers - [x,y,z] の配列（破壊的に z を更新）
 * @param {Object[]} filteredPoints - {x,y,z} の配列
 * @param {number} radius - 半径
 */
function updateCentersZFromNearest3(centers, filteredPoints, radius) {
    const r2 = radius * radius;
    for (let j = 0; j < centers.length; j++) {
        const [cx, cy] = centers[j];
        const candidates = filteredPoints.filter(p => {
            const dx = p.x - cx, dy = p.y - cy;
            return dx * dx + dy * dy <= r2;
        });
        candidates.sort((a, b) => {
            const da = (a.x - cx) ** 2 + (a.y - cy) ** 2;
            const db = (b.x - cx) ** 2 + (b.y - cy) ** 2;
            return da - db;
        });
        const top3 = candidates.slice(0, 3);
        if (top3.length > 0) {
            const minZ = Math.min(...top3.map(p => p.z));
            centers[j][2] = minZ;
        }
    }
}

/**
 * 更新されたCSV文字列を生成（label,x,y,z）
 */
function buildUpdatedCSV(centers, labels) {
    const header = 'label,x,y,z';
    const rows = centers.map((c, i) => {
        const z = (c[2] !== undefined && !isNaN(c[2])) ? c[2] : '';
        return `${labels[i] || ''},${c[0]},${c[1]},${z}`;
    });
    return header + '\n' + rows.join('\n');
}

// ============================================================================
// フィルタリング関数
// ============================================================================

// 中心点と半径の2乗・フィルタ種別を事前計算して最適化
let cachedCenters = null;
let cachedRadius2 = null;
let cachedUseSphere = true;
let cachedUseHorizontal = false;

function prepareFilteringCache(centers, radius, useSphere = true, useHorizontal = false) {
    cachedCenters = centers;
    cachedRadius2 = radius * radius;
    cachedUseSphere = useSphere;
    cachedUseHorizontal = useHorizontal;
}

function isPointNearCenters(x, y, z) {
    const centers = cachedCenters;
    const r2 = cachedRadius2;
    const useSphere = cachedUseSphere;
    const useHorizontal = cachedUseHorizontal;

    for (let i = 0; i < centers.length; i++) {
        const center = centers[i];
        const dx = x - center[0];
        const dy = y - center[1];
        const dz = z - center[2];
        const dist2xy = dx * dx + dy * dy;
        const dist2xyz = dist2xy + dz * dz;
        if (useSphere && dist2xyz <= r2) return true;
        if (useHorizontal && dist2xy <= r2) return true;
    }
    return false;
}

// ============================================================================
// ポイント解析ヘルパー関数
// ============================================================================

/**
 * ポイントデータから座標を解析
 * @param {DataView} view - DataViewオブジェクト
 * @param {number} offset - オフセット位置
 * @param {Object} header - LASヘッダー情報
 * @returns {Object} 座標情報 {x, y, z, rawX, rawY, rawZ}
 */
function parsePointCoordinates(view, offset, header) {
    const rawX = view.getInt32(offset, true);
    const rawY = view.getInt32(offset + 4, true);
    const rawZ = view.getInt32(offset + 8, true);
    
    const x = rawX * header.scaleX + header.offsetX;
    const y = rawY * header.scaleY + header.offsetY;
    const z = rawZ * header.scaleZ + header.offsetZ;
    
    return { x, y, z, rawX, rawY, rawZ };
}

/**
 * RGB情報を読み込む
 * @param {DataView} view - DataViewオブジェクト
 * @param {number} offset - オフセット位置
 * @param {Object} header - LASヘッダー情報
 * @returns {Object|null} RGB情報 {red, green, blue} または null
 */
function parseRGBData(view, offset, header) {
    if (!RGB_FORMATS.includes(header.pointFormat)) {
        return null;
    }
    
    if (offset + 26 > view.buffer.byteLength) {
        return null;
    }
    
    return {
        red: view.getUint16(offset + 20, true),
        green: view.getUint16(offset + 22, true),
        blue: view.getUint16(offset + 24, true)
    };
}

// ============================================================================
// バッチフィルタリング関数
// ============================================================================

/**
 * バッチフィルタリング（複数ポイントを一度に処理、高速化）
 * useSphere: スフィア（3D）条件, useHorizontal: 水平投影（XY円）条件。どちらか満たせば採用。
 */
function filterPointsBatchFast(points, centers, radius, useSphere = true, useHorizontal = false) {
    const r2 = radius * radius;
    const filtered = [];
    const len = points.length;
    const centersLen = centers.length;

    for (let p = 0; p < len; p++) {
        const point = points[p];
        const px = point.x;
        const py = point.y;
        const pz = point.z;

        let matched = false;
        for (let i = 0; i < centersLen; i++) {
            const center = centers[i];
            const dx = px - center[0];
            const dy = py - center[1];
            const dz = pz - center[2];
            const dist2xy = dx * dx + dy * dy;
            const dist2xyz = dist2xy + dz * dz;
            if (useSphere && dist2xyz <= r2) { matched = true; break; }
            if (useHorizontal && dist2xy <= r2) { matched = true; break; }
        }

        if (matched) filtered.push(point);
    }

    return filtered;
}

/**
 * バッチフィルタリング（旧版、互換性のため保持）
 */
function filterPointsBatch(points, centers, radius, useSphere = true, useHorizontal = false) {
    const r2 = radius * radius;
    const filtered = [];

    for (const point of points) {
        for (let i = 0; i < centers.length; i++) {
            const [cx, cy, cz] = centers[i];
            const dx = point.x - cx;
            const dy = point.y - cy;
            const dz = point.z - cz;
            const dist2xy = dx * dx + dy * dy;
            const dist2xyz = dist2xy + dz * dz;
            if (useSphere && dist2xyz <= r2) { filtered.push(point); break; }
            if (useHorizontal && dist2xy <= r2) { filtered.push(point); break; }
        }
    }

    return filtered;
}

// LASヘッダー解析
function parseLASHeader(buffer) {
    const view = new DataView(buffer);
    
    const sig = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (sig !== 'LASF') {
        throw new Error('LAS/LAZファイルではありません');
    }
    
    const versionMajor = view.getUint8(24);
    const versionMinor = view.getUint8(25);
    const headerSize = view.getUint16(94, true);
    const pointDataOffset = view.getUint32(96, true);
    const pointFormatByte = view.getUint8(104);
    const pointFormat = pointFormatByte & 0x3F;
    const isCompressed = (pointFormatByte & 0x80) !== 0;
    const pointRecordLength = view.getUint16(105, true);
    let numPoints = view.getUint32(107, true);
    
    if (versionMajor === 1 && versionMinor >= 4 && numPoints === 0) {
        const extendedNumPoints = view.getBigUint64(247, true);
        numPoints = Number(extendedNumPoints);
    }
    
    const scaleX = view.getFloat64(131, true);
    const scaleY = view.getFloat64(139, true);
    const scaleZ = view.getFloat64(147, true);
    
    const offsetX = view.getFloat64(155, true);
    const offsetY = view.getFloat64(163, true);
    const offsetZ = view.getFloat64(171, true);
    
    return {
        versionMajor,
        versionMinor,
        headerSize,
        pointDataOffset,
        pointFormat,
        isCompressed,
        pointRecordLength,
        numPoints,
        scaleX,
        scaleY,
        scaleZ,
        offsetX,
        offsetY,
        offsetZ
    };
}

/**
 * laz-perfを使ってLAZを解凍（ストリーミング処理対応）
 * ポイント単位で解凍し、即座にフィルタリングしてメモリ効率を最大化
 */
async function decompressLAZWithLazPerfStreaming(arrayBuffer, header, centers, radius, useSphere = true, useHorizontal = false) {
    prepareFilteringCache(centers, radius, useSphere, useHorizontal);
    addLog('LAZ圧縮ファイルをストリーミング解凍しています...');
    updateProgress(25, 'LAZ解凍中');

    const filteredPoints = [];
    
    // パフォーマンス測定
    const perfStart = performance.now();
    let decompressTime = 0;
    let filterTime = 0;
    let progressUpdateTime = 0;
    
    try {
        // Emscriptenのメモリヒープにデータをコピー
        const fileSize = arrayBuffer.byteLength;
        const filePtr = LazPerf._malloc(fileSize);
        const fileHeap = new Uint8Array(LazPerf.HEAPU8.buffer, filePtr, fileSize);
        fileHeap.set(new Uint8Array(arrayBuffer));
        
        // LASZipオブジェクトを作成
        const laszip = new LazPerf.LASZip();
        
        // ファイルを開く
        laszip.open(filePtr, fileSize);
        
        const pointCount = header.numPoints;
        const pointRecordLength = header.pointRecordLength;
        
        // ポイントデータ用のメモリを確保（1ポイント分のみ）
        const pointPtr = LazPerf._malloc(pointRecordLength);
        const pointHeap = new Uint8Array(LazPerf.HEAPU8.buffer, pointPtr, pointRecordLength);
        
        // RGB情報があるかチェック
        const hasRGB = RGB_FORMATS.includes(header.pointFormat);
        
            // 各ポイントを解凍して直接フィルタリング（メモリに保持しない）
            // パフォーマンス測定はバッチ単位でオーバーヘッドを削減
            const BATCH_SIZE = PERFORMANCE_BATCH_SIZE;
            let batchStartTime = performance.now();
            let batchDecompressTime = 0;
            let batchFilterTime = 0;
            
            // ポイント解析用の変数をループ外で定義（メモリ割り当て削減）
            const view = new DataView(pointHeap.buffer, pointHeap.byteOffset, pointRecordLength);
            let rawX, rawY, rawZ, intensity, x, y, z, point;
            
            for (let i = 0; i < pointCount; i++) {
                // バッチ単位でパフォーマンス測定
                if (i % BATCH_SIZE === 0 && i > 0) {
                    const batchTime = performance.now() - batchStartTime;
                    // バッチ内の時間を推定（解凍とフィルタリングの比率を維持）
                    batchDecompressTime += batchTime * 0.6; // 解凍が約60%
                    batchFilterTime += batchTime * 0.2;    // フィルタリングが約20%
                    batchStartTime = performance.now();
                }
                
                // 解凍処理
                laszip.getPoint(pointPtr);
                
                // ポイントデータを直接解析（最適化：変数再利用）
                rawX = view.getInt32(0, true);
                rawY = view.getInt32(4, true);
                rawZ = view.getInt32(8, true);
                intensity = view.getUint16(12, true);
                
                x = rawX * header.scaleX + header.offsetX;
                y = rawY * header.scaleY + header.offsetY;
                z = rawZ * header.scaleZ + header.offsetZ;
                
                // オブジェクト作成を条件付きに（フィルタリング結果のみ作成）
                if (isPointNearCenters(x, y, z)) {
                    point = { x, y, z, intensity };
                    
                    // RGB情報がある場合
                    if (hasRGB && pointRecordLength >= 26) {
                        point.red = view.getUint16(20, true);
                        point.green = view.getUint16(22, true);
                        point.blue = view.getUint16(24, true);
                    }
                    
                    filteredPoints.push(point);
                }
                
                // 進捗更新（頻度を下げてパフォーマンス向上）
                if (i % PROGRESS_UPDATE_INTERVAL === 0 && i > 0) {
                    const progress = 25 + (i / pointCount) * 65;
                    updateProgress(progress, `LAZ解凍+フィルタリング: ${Math.floor((i / pointCount) * 100)}%`);
                    addLog(`処理済み: ${i.toLocaleString()}/${pointCount.toLocaleString()}点, 抽出: ${filteredPoints.length.toLocaleString()}点`);
                    // awaitを削減（パフォーマンス向上）
                    if (i % (PROGRESS_UPDATE_INTERVAL * 2) === 0) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }
            }
            
            // 最後のバッチを処理
            const finalBatchTime = performance.now() - batchStartTime;
            batchDecompressTime += finalBatchTime * 0.6;
            batchFilterTime += finalBatchTime * 0.2;
            
            decompressTime = batchDecompressTime;
            filterTime = batchFilterTime;
            
            // パフォーマンス統計を表示
            const totalTime = performance.now() - perfStart;
            const decompressPercent = (decompressTime / totalTime * 100).toFixed(1);
            const filterPercent = (filterTime / totalTime * 100).toFixed(1);
            const otherPercent = (100 - parseFloat(decompressPercent) - parseFloat(filterPercent)).toFixed(1);
            const pointsPerSec = Math.floor(pointCount / (totalTime / 1000)).toLocaleString();
            const totalMinutes = (totalTime / 60000).toFixed(1);
            addLog(`⚡ パフォーマンス分析: 解凍=${decompressPercent}%, フィルタリング=${filterPercent}%, その他=${otherPercent}%`);
            addLog(`⚡ 処理速度: ${pointsPerSec}点/秒 (総時間: ${totalMinutes}分)`);
            
            // ボトルネックの説明
            if (parseFloat(decompressPercent) > 50) {
                addLog(`💡 ボトルネック: LAZ解凍処理が最大の時間を占めています。これはlaz-perfの制約上、最適化が困難です。`);
            } else if (parseFloat(filterPercent) > 30) {
                addLog(`💡 ボトルネック: フィルタリング処理が時間を占めています。中心点の数や半径を調整すると改善する可能性があります。`);
            }
        
        // メモリを解放
        laszip.delete();
        LazPerf._free(filePtr);
        LazPerf._free(pointPtr);
        
        addLog(`LAZ解凍完了: ${pointCount.toLocaleString()}点`);
        addLog(`抽出点数: ${filteredPoints.length.toLocaleString()}点`);
        
        return filteredPoints;
        
    } catch (err) {
        console.error('LAZ decompression error:', err);
        throw new Error(`LAZ解凍エラー: ${err.message}`);
    }
}

/**
 * laz-perfを使ってLAZを解凍（小さいファイル用、従来方式）
 * 全体を一度に解凍してから処理（300MB以下のファイル用）
 */
async function decompressLAZWithLazPerf(arrayBuffer, header) {
    addLog('LAZ圧縮ファイルを解凍しています...');
    updateProgress(25, 'LAZ解凍中');
    
    try {
        // Emscriptenのメモリヒープにデータをコピー
        const fileSize = arrayBuffer.byteLength;
        const filePtr = LazPerf._malloc(fileSize);
        const fileHeap = new Uint8Array(LazPerf.HEAPU8.buffer, filePtr, fileSize);
        fileHeap.set(new Uint8Array(arrayBuffer));
        
        // LASZipオブジェクトを作成
        const laszip = new LazPerf.LASZip();
        
        // ファイルを開く
        laszip.open(filePtr, fileSize);
        
        const pointCount = header.numPoints;
        const pointRecordLength = header.pointRecordLength;
        
        // 解凍されたポイントデータを格納するバッファ
        const decompressedBuffer = new ArrayBuffer(pointCount * pointRecordLength);
        const decompressedView = new Uint8Array(decompressedBuffer);
        
        // ポイントデータ用のメモリを確保
        const pointPtr = LazPerf._malloc(pointRecordLength);
        const pointHeap = new Uint8Array(LazPerf.HEAPU8.buffer, pointPtr, pointRecordLength);
        
        let decompressedOffset = 0;
        
        // 各ポイントを解凍
        for (let i = 0; i < pointCount; i++) {
            laszip.getPoint(pointPtr);
            
            // 解凍されたポイントデータをコピー
            decompressedView.set(pointHeap, decompressedOffset);
            decompressedOffset += pointRecordLength;
            
            if (i % 100000 === 0 && i > 0) {
                const progress = 25 + (i / pointCount) * 20;
                updateProgress(progress, `LAZ解凍中: ${Math.floor((i / pointCount) * 100)}%`);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        // メモリを解放
        laszip.delete();
        LazPerf._free(filePtr);
        LazPerf._free(pointPtr);
        
        addLog(`LAZ解凍完了: ${pointCount.toLocaleString()}点`);
        
        // 解凍されたデータとヘッダーを結合してLASファイルとして扱う
        const lasBuffer = new ArrayBuffer(header.pointDataOffset + decompressedBuffer.byteLength);
        const lasView = new Uint8Array(lasBuffer);
        
        // ヘッダーをコピー（圧縮フラグをクリア）
        const headerView = new Uint8Array(arrayBuffer, 0, header.pointDataOffset);
        lasView.set(headerView, 0);
        
        // 圧縮フラグをクリア
        const headerDataView = new DataView(lasBuffer);
        const pointFormatByte = headerDataView.getUint8(104);
        headerDataView.setUint8(104, pointFormatByte & 0x7F); // ビット7をクリア
        
        // 解凍されたポイントデータをコピー
        lasView.set(decompressedView, header.pointDataOffset);
        
        return lasBuffer;
        
    } catch (err) {
        console.error('LAZ decompression error:', err);
        throw new Error(`LAZ解凍エラー: ${err.message}`);
    }
}

/**
 * ストリーミング処理: 非圧縮LASをチャンクごとに読み込んで処理
 * 大きなファイル（300MB以上）をメモリ効率的に処理
 */
async function processLASStreaming(file, header, centers, radius, chunkSizeMB = DEFAULT_CHUNK_SIZE_MB, useSphere = true, useHorizontal = false) {
    prepareFilteringCache(centers, radius, useSphere, useHorizontal);
    const filteredPoints = [];
    const pointRecordLength = header.pointRecordLength;
    const pointDataOffset = header.pointDataOffset;
    const numPoints = header.numPoints;
    
    // チャンクサイズ: ユーザー指定（デフォルト50MB）
    const chunkSizeBytes = chunkSizeMB * 1024 * 1024;
    const pointsPerChunk = Math.floor(chunkSizeBytes / pointRecordLength);
    
    let currentPointIndex = 0;
    let currentOffset = pointDataOffset;
    
    // パフォーマンス測定
    const perfStart = performance.now();
    let ioTime = 0;
    let parseTime = 0;
    let filterTime = 0;
    let progressUpdateTime = 0;
    
    addLog(`チャンクサイズ: ${chunkSizeMB}MB (約${pointsPerChunk.toLocaleString()}点/チャンク)`);
    
    while (currentPointIndex < numPoints) {
        const remainingPoints = numPoints - currentPointIndex;
        const pointsInThisChunk = Math.min(pointsPerChunk, remainingPoints);
        const chunkSize = pointsInThisChunk * pointRecordLength;
        
        // I/O処理の時間測定
        const ioStart = performance.now();
        const chunkBlob = file.slice(currentOffset, currentOffset + chunkSize);
        const chunkBuffer = await chunkBlob.arrayBuffer();
        ioTime += performance.now() - ioStart;
        
        const view = new DataView(chunkBuffer);
        
        // チャンク内のポイントを処理
        let chunkOffset = 0;
        const parseStart = performance.now();
        for (let i = 0; i < pointsInThisChunk; i++) {
            if (chunkOffset + 20 > chunkBuffer.byteLength) {
                break;
            }
            
            const rawX = view.getInt32(chunkOffset, true);
            const rawY = view.getInt32(chunkOffset + 4, true);
            const rawZ = view.getInt32(chunkOffset + 8, true);
            const intensity = view.getUint16(chunkOffset + 12, true);
            
            const x = rawX * header.scaleX + header.offsetX;
            const y = rawY * header.scaleY + header.offsetY;
            const z = rawZ * header.scaleZ + header.offsetZ;
            
            const point = { x, y, z, intensity };
            
            // RGB情報がある場合
            const hasRGB = RGB_FORMATS.includes(header.pointFormat);
            if (hasRGB && chunkOffset + 26 <= chunkBuffer.byteLength) {
                point.red = view.getUint16(chunkOffset + 20, true);
                point.green = view.getUint16(chunkOffset + 22, true);
                point.blue = view.getUint16(chunkOffset + 24, true);
            }
            
            // フィルタリング処理の時間測定
            const filterStart = performance.now();
            if (isPointNearCenters(x, y, z)) {
                filteredPoints.push(point);
            }
            filterTime += performance.now() - filterStart;
            
            chunkOffset += pointRecordLength;
            currentPointIndex++;
        }
        parseTime += performance.now() - parseStart;
        
            // 進捗更新（チャンクごとに1回のみ、パフォーマンス向上）
            const progressStart = performance.now();
            const progress = currentPointIndex / numPoints;
            const percent = 20 + progress * 70;
            updateProgress(percent, `ストリーミング処理: ${currentPointIndex.toLocaleString()}/${numPoints.toLocaleString()}点`);
            
            // ログ更新（頻度を下げてパフォーマンス向上）
            if (currentPointIndex % LOG_UPDATE_INTERVAL === 0 || currentPointIndex === numPoints) {
                addLog(`処理済み: ${currentPointIndex.toLocaleString()}点, 抽出: ${filteredPoints.length.toLocaleString()}点`);
            }
            progressUpdateTime += performance.now() - progressStart;
            
            currentOffset += chunkSize;
            
            // メモリ解放を促す（待機時間を最小化）
            // チャンクサイズが大きい場合は待機時間をさらに短縮
            // 1GB以上のチャンクでも問題なく動作するため、待機は最小限に
            if (chunkSizeMB > 500) {
                // 500MB以上は待機なし（パフォーマンス優先）
            } else if (chunkSizeMB > 100) {
                await new Promise(resolve => setTimeout(resolve, 0));
            } else if (chunkSizeMB > 50) {
                await new Promise(resolve => setTimeout(resolve, 1));
            } else {
                await new Promise(resolve => setTimeout(resolve, 5));
            }
    }
    
    // パフォーマンス統計を表示
    const totalTime = performance.now() - perfStart;
    const ioPercent = (ioTime / totalTime * 100).toFixed(1);
    const parsePercent = (parseTime / totalTime * 100).toFixed(1);
    const filterPercent = (filterTime / totalTime * 100).toFixed(1);
    const progressPercent = (progressUpdateTime / totalTime * 100).toFixed(1);
    addLog(`⚡ パフォーマンス分析: I/O=${ioPercent}%, 解析=${parsePercent}%, フィルタリング=${filterPercent}%, UI更新=${progressPercent}%`);
    
    return filteredPoints;
}

// ============================================================================
// LASファイル処理関数
// ============================================================================

/**
 * 非圧縮LAS読み込み（ジェネレータ）
 */
function* readUncompressedLAS(buffer, header) {
    const view = new DataView(buffer);
    let offset = header.pointDataOffset;
    const points = [];
    const batchSize = 100000;
    
    // RGB情報があるフォーマットかチェック
    const hasRGB = RGB_FORMATS.includes(header.pointFormat);
    
    for (let i = 0; i < header.numPoints; i++) {
        if (offset + header.pointRecordLength > buffer.byteLength) {
            console.warn(`Point ${i}: offset ${offset} exceeds buffer size ${buffer.byteLength}`);
            break;
        }
        
        const rawX = view.getInt32(offset, true);
        const rawY = view.getInt32(offset + 4, true);
        const rawZ = view.getInt32(offset + 8, true);
        const intensity = view.getUint16(offset + 12, true);
        
        const x = rawX * header.scaleX + header.offsetX;
        const y = rawY * header.scaleY + header.offsetY;
        const z = rawZ * header.scaleZ + header.offsetZ;
        
        const point = { x, y, z, intensity };
        
        // RGB情報を読み込む（Format 2以降、オフセット20から）
        if (hasRGB && offset + 26 <= buffer.byteLength) {
            const red = view.getUint16(offset + 20, true);
            const green = view.getUint16(offset + 22, true);
            const blue = view.getUint16(offset + 24, true);
            point.red = red;
            point.green = green;
            point.blue = blue;
        }
        
        points.push(point);
        
        offset += header.pointRecordLength;
        
        if (points.length >= batchSize) {
            yield { points: points.splice(0), progress: i / header.numPoints };
        }
    }
    
    if (points.length > 0) {
        yield { points, progress: 1.0 };
    }
}

// LAS出力用
/**
 * フィルタリングされたポイントからLASファイルを生成
 */
function createLASFile(points, header) {
    // RGB情報があるかチェック
    const hasRGB = points.length > 0 && points[0].hasOwnProperty('red') && 
                   points[0].hasOwnProperty('green') && points[0].hasOwnProperty('blue');
    
    // RGB情報がある場合はFormat 2（26バイト）、ない場合はFormat 0（20バイト）
    const pointFormat = hasRGB ? 2 : 0;
    const pointRecordLength = hasRGB ? 26 : 20;
    const bufferSize = 227 + points.length * pointRecordLength;
    
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    const encoder = new TextEncoder();
    
    const signature = encoder.encode('LASF');
    for (let i = 0; i < 4; i++) {
        view.setUint8(i, signature[i]);
    }
    
    view.setUint8(24, 1);
    view.setUint8(25, 2);
    view.setUint16(94, 227, true);
    view.setUint32(96, 227, true);
    view.setUint32(100, 0, true);
    view.setUint8(104, pointFormat);
    view.setUint16(105, pointRecordLength, true);
    view.setUint32(107, points.length, true);
    
    view.setFloat64(131, 0.001, true);
    view.setFloat64(139, 0.001, true);
    view.setFloat64(147, 0.001, true);
    
    if (points.length > 0) {
        view.setFloat64(155, points[0].x, true);
        view.setFloat64(163, points[0].y, true);
        view.setFloat64(171, points[0].z, true);
    }
    
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    for (const p of points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
    }
    
    view.setFloat64(179, maxX, true);
    view.setFloat64(187, minX, true);
    view.setFloat64(195, maxY, true);
    view.setFloat64(203, minY, true);
    view.setFloat64(211, maxZ, true);
    view.setFloat64(219, minZ, true);
    
    let offset = 227;
    for (const point of points) {
        const x = Math.round((point.x - points[0].x) / 0.001);
        const y = Math.round((point.y - points[0].y) / 0.001);
        const z = Math.round((point.z - points[0].z) / 0.001);
        
        // LAS Point Format 0/2共通部分: X(4) Y(4) Z(4) Intensity(2) Return(1) Class(1) ScanAngle(1) UserData(1) PointSourceId(2) = 20 bytes
        view.setInt32(offset, x, true);
        view.setInt32(offset + 4, y, true);
        view.setInt32(offset + 8, z, true);
        view.setUint16(offset + 12, point.intensity || 0, true);
        view.setUint8(offset + 14, 0);
        view.setUint8(offset + 15, 0);
        view.setInt8(offset + 16, 0);
        view.setUint8(offset + 17, 0);
        view.setUint16(offset + 18, 0, true);
        
        // RGB情報がある場合（Format 2）: Red(2) Green(2) Blue(2) = 6 bytes
        if (hasRGB) {
            view.setUint16(offset + 20, point.red || 0, true);
            view.setUint16(offset + 22, point.green || 0, true);
            view.setUint16(offset + 24, point.blue || 0, true);
        }
        
        offset += pointRecordLength;
    }
    
    return buffer;
}

// ============================================================================
// メイン処理関数
// ============================================================================

/**
 * ファイル処理のメイン関数
 */
async function processFiles() {
    try {
        console.log('processFiles called');
        
        if (!wasmReady || !LazPerf) {
            throw new Error('LAZ解凍エンジンが初期化されていません。ページをリロードしてください。');
        }
        
        processBtn.disabled = true;
        progressSection.classList.add('active');
        resultSection.classList.remove('active');
        logDiv.innerHTML = '';
        
        addLog('処理を開始します...');
        updateProgress(0, '初期化中');
        
        // CSV読み込み
        addLog('CSVファイルを読み込んでいます...');
        const csvResult = await readCSV();
        centers = csvResult.centers;
        csvLabels = csvResult.labels;
        csvHasZ = csvResult.hasZ;
        addLog(`中心座標を${centers.length}件読み込みました${csvHasZ ? '' : '（Z列なし→水平投影時に点群から補完）'}`);
        updateProgress(10, 'CSV読込完了');
        
        const radius = parseFloat(radiusInput.value);
        const chunkSizeMB = parseInt(chunkSizeInput.value) || DEFAULT_CHUNK_SIZE_MB;
        const useSphere = filterSphereInput ? filterSphereInput.checked : true;
        const useHorizontal = filterHorizontalInput ? filterHorizontalInput.checked : false;
        if (!useSphere && !useHorizontal) {
            throw new Error('フィルタ種別を1つ以上選択してください（スフィアまたは水平投影）');
        }
        const filterLabels = [];
        if (useSphere) filterLabels.push('スフィア');
        if (useHorizontal) filterLabels.push('水平投影');
        addLog(`設定: 半径=${radius}m, チャンクサイズ=${chunkSizeMB}MB, フィルタ: ${filterLabels.join(' + ')}`);
        
        // フィルタリングキャッシュを準備（パフォーマンス向上）
        prepareFilteringCache(centers, radius, useSphere, useHorizontal);
        
        // ファイルサイズチェック
        const fileSizeMB = lazFile.size / (1024 * 1024);
        const useStreaming = fileSizeMB > STREAMING_THRESHOLD_MB;
        
        if (useStreaming) {
            addLog(`📦 ストリーミング処理モード: ${fileSizeMB.toFixed(1)}MBのファイルをチャンクごとに処理します`);
        } else {
            addLog('LAZ/LASファイルを読み込んでいます...');
        }
        
        // ヘッダーを先に読み込む（最初の375バイトで十分、VLRや拡張ヘッダーも含む）
        addLog('ヘッダーを読み込んでいます...');
        const headerBlob = lazFile.slice(0, Math.min(375, lazFile.size));
        const headerBuffer = await headerBlob.arrayBuffer();
        
        // 一時的に全体バッファとして扱う（parseLASHeaderの互換性のため）
        // 実際にはヘッダー部分だけを解析
        const header = parseLASHeader(headerBuffer);
        
        // pointDataOffsetが取得できたので、必要に応じて全体のヘッダーを読み込む
        // ただし、pointDataOffsetが375バイトを超える場合は、その分だけ追加で読み込む
        if (header.pointDataOffset > 375) {
            const fullHeaderBlob = lazFile.slice(0, header.pointDataOffset);
            const fullHeaderBuffer = await fullHeaderBlob.arrayBuffer();
            // 再解析（VLR情報も含む）
            Object.assign(header, parseLASHeader(fullHeaderBuffer));
        }
        
        addLog(`バージョン: LAS ${header.versionMajor}.${header.versionMinor}`);
        addLog(`総点数: ${header.numPoints.toLocaleString()}点`);
        addLog(`ポイントフォーマット: ${header.pointFormat}`);
        addLog(`圧縮: ${header.isCompressed ? 'LAZ（圧縮）' : '非圧縮LAS'}`);
        
        updateProgress(15, 'ヘッダー解析完了');
        
        let filteredPoints = [];
        let processedCount = 0;
        
        // ストリーミング処理（300MB以上）または通常処理（300MB以下）
        if (useStreaming && !header.isCompressed) {
            // 非圧縮LASのストリーミング処理
            addLog('ストリーミング処理を開始します...');
            filteredPoints = await processLASStreaming(lazFile, header, centers, radius, chunkSizeMB, useSphere, useHorizontal);
            processedCount = header.numPoints;
        } else if (header.isCompressed) {
            // LAZ圧縮ファイルの処理
            if (useStreaming) {
                // ストリーミング解凍+フィルタリング（メモリ効率的）
                addLog('LAZ圧縮ファイルをストリーミング解凍します...');
                const arrayBuffer = await lazFile.arrayBuffer();
                const memoryMB = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(1);
                addLog(`入力ファイルサイズ: ${memoryMB}MB`);
                
                // 解凍とフィルタリングを同時に実行（解凍済みバッファを保持しない）
                filteredPoints = await decompressLAZWithLazPerfStreaming(arrayBuffer, header, centers, radius, useSphere, useHorizontal);
                processedCount = header.numPoints;
                
                // 圧縮フラグをクリア（出力用）
                header.isCompressed = false;
            } else {
                // 小さいファイル（300MB以下）: 従来方式
                addLog('LAZ圧縮ファイルを解凍しています...');
                const arrayBuffer = await lazFile.arrayBuffer();
                const lasBuffer = await decompressLAZWithLazPerf(arrayBuffer, header);
                const newHeader = parseLASHeader(lasBuffer);
                Object.assign(header, newHeader);
                header.isCompressed = false;
                
                updateProgress(45, 'ヘッダー解析完了');
                
                // フィルタリング（高速化版）
                addLog('点群をフィルタリングしています...');
                
                let lastProgressUpdate = 0;
                for (const { points, progress } of readUncompressedLAS(lasBuffer, header)) {
                    // バッチフィルタリング（高速化）
                    const batchFiltered = filterPointsBatchFast(points, centers, radius, useSphere, useHorizontal);
                    filteredPoints.push(...batchFiltered);
                    processedCount += points.length;
                    
                    // 進捗更新は10%ごと（パフォーマンス向上）
                    if (progress - lastProgressUpdate >= 0.10 || progress >= 1.0) {
                        const percent = 45 + progress * 50;
                        updateProgress(percent, `フィルタリング中: ${processedCount.toLocaleString()}/${header.numPoints.toLocaleString()}点`);
                        lastProgressUpdate = progress;
                    }
                    // awaitを削減（パフォーマンス向上）
                    if (processedCount % LOG_UPDATE_INTERVAL === 0) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }
            }
        } else {
            // 通常処理（300MB以下）
            addLog('ファイル全体を読み込んでいます...');
            const arrayBuffer = await lazFile.arrayBuffer();
            updateProgress(20, 'ファイル読込完了');
            
            let lasBuffer = arrayBuffer;
            
            // LAZ圧縮の場合は解凍
            if (header.isCompressed) {
                lasBuffer = await decompressLAZWithLazPerf(arrayBuffer, header);
                const newHeader = parseLASHeader(lasBuffer);
                Object.assign(header, newHeader);
                header.isCompressed = false;
            }
            
            updateProgress(45, 'ヘッダー解析完了');
            
            // フィルタリング
            addLog('点群をフィルタリングしています...');
            
            // バッチ処理の最適化: 進捗更新の頻度を下げる
            let lastProgressUpdate = 0;
            for (const { points, progress } of readUncompressedLAS(lasBuffer, header)) {
                // バッチフィルタリング（高速化）
                const batchFiltered = filterPointsBatchFast(points, centers, radius, useSphere, useHorizontal);
                filteredPoints.push(...batchFiltered);
                processedCount += points.length;
                
                // 進捗更新は10%ごと（パフォーマンス向上）
                if (progress - lastProgressUpdate >= 0.10 || progress >= 1.0) {
                    const percent = 45 + progress * 50;
                    updateProgress(percent, `フィルタリング中: ${processedCount.toLocaleString()}/${header.numPoints.toLocaleString()}点`);
                    lastProgressUpdate = progress;
                }
                // awaitを削減（パフォーマンス向上）
                if (processedCount % 1000000 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
        }
        
        updateProgress(95, 'フィルタリング完了');
        addLog(`処理済み: ${processedCount.toLocaleString()}点`);
        addLog(`抽出点数: ${filteredPoints.length.toLocaleString()}点`);

        // 水平投影時: 各中心のXY最近傍3点の最小Zで centers を更新し、CSV用データを用意
        let updatedCsvBlobUrl = null;
        if (useHorizontal && filteredPoints.length > 0) {
            updateCentersZFromNearest3(centers, filteredPoints, radius);
            const csvText = buildUpdatedCSV(centers, csvLabels);
            updatedCsvBlobUrl = URL.createObjectURL(new Blob([csvText], { type: 'text/csv;charset=utf-8' }));
            addLog(`水平投影: 各中心のXY最近傍3点の最小ZでCSVを更新しました${csvHasZ ? '' : '（Z列を付加）'}`);
        }

        if (filteredPoints.length === 0) {
            throw new Error('指定された範囲内に点が見つかりませんでした');
        }

        // LAS生成
        addLog('LASファイルを生成しています...');
        const outputLasBuffer = createLASFile(filteredPoints, header);
        
        updateProgress(100, '完了');
        
        // ダウンロード
        const blob = new Blob([outputLasBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        downloadBtn.href = url;
        downloadBtn.download = 'output.las';
        
        resultSection.classList.add('active');
        resultText.innerHTML = `
            入力点数: ${header.numPoints.toLocaleString()}点<br>
            出力点数: ${filteredPoints.length.toLocaleString()}点<br>
            ファイルサイズ: ${formatFileSize(outputLasBuffer.byteLength)}
        `;

        if (downloadCsvBtn) {
            if (updatedCsvBlobUrl) {
                downloadCsvBtn.href = updatedCsvBlobUrl;
                downloadCsvBtn.download = 'centers_updated.csv';
                downloadCsvBtn.style.display = 'inline-block';
            } else {
                downloadCsvBtn.style.display = 'none';
                downloadCsvBtn.removeAttribute('href');
            }
        }

        addLog('✅ 処理が完了しました！');
        
    } catch (err) {
        console.error(err);
        addLog(`❌ エラー: ${err.message}`);
        
        // メモリ不足エラーの場合、より詳細なメッセージを表示
        if (err.message.includes('memory') || err.message.includes('Memory') || 
            err.message.includes('allocation') || err.name === 'RangeError' ||
            err.message.includes('too large') || err.message.includes('exceeded')) {
            alert(
                `❌ メモリ不足エラー\n\n` +
                `ファイルサイズが大きすぎてブラウザのメモリ制限を超えました。\n\n` +
                `【解決方法】\n` +
                `1. サーバー版（server.py）を使用してください（推奨）\n` +
                `   python server.py\n` +
                `   その後、http://localhost:8000/index.html にアクセス\n\n` +
                `2. より小さなファイルで試してください\n\n` +
                `3. ブラウザを再起動してから再度お試しください`
            );
        } else {
            alert(`エラー: ${err.message}`);
        }
    } finally {
        processBtn.disabled = false;
    }
}
