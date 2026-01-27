// GitHub Pages対応版 - laz-perf WASMを使用したLAZ完全対応

console.log('app_github_pages.js loaded');

let lazFile = null;
let csvFile = null;
let centers = [];
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
        const { createLazPerf } = await import('https://cdn.jsdelivr.net/npm/laz-perf@0.0.7/dist/laz-perf.js');
        
        console.log('laz-perf module loaded, initializing...');
        LazPerf = await createLazPerf();
        
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

// UI要素
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
const statusDiv = document.getElementById('status');

// 初期化
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

async function readCSV() {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                const centers = [];
                
                for (const line of lines) {
                    if (line.toLowerCase().includes('label')) continue;
                    
                    const parts = line.split(',');
                    if (parts.length >= 4) {
                        const x = parseFloat(parts[1]);
                        const y = parseFloat(parts[2]);
                        const z = parseFloat(parts[3]);
                        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                            centers.push([x, y, z]);
                        }
                    }
                }
                
                if (centers.length === 0) {
                    reject(new Error('CSVから有効な座標が読み取れませんでした'));
                } else {
                    resolve(centers);
                }
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('CSVファイルの読み込みに失敗しました'));
        reader.readAsText(csvFile);
    });
}

function isPointNearCenters(x, y, z, centers, radius) {
    const r2 = radius * radius;
    for (const [cx, cy, cz] of centers) {
        const dx = x - cx;
        const dy = y - cy;
        const dz = z - cz;
        const dist2 = dx * dx + dy * dy + dz * dz;
        if (dist2 <= r2) {
            return true;
        }
    }
    return false;
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

// laz-perfを使ってLAZを解凍
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

// 非圧縮LAS読み込み
function* readUncompressedLAS(buffer, header) {
    const view = new DataView(buffer);
    let offset = header.pointDataOffset;
    const points = [];
    const batchSize = 100000;
    
    for (let i = 0; i < header.numPoints; i++) {
        if (offset + 20 > buffer.byteLength) {
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
        
        points.push({ x, y, z, intensity });
        
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
function createLASFile(points, header) {
    const buffer = new ArrayBuffer(227 + points.length * 20);
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
    view.setUint8(104, 0);
    view.setUint16(105, 20, true);
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
        
        view.setInt32(offset, x, true);
        view.setInt32(offset + 4, y, true);
        view.setInt32(offset + 8, z, true);
        view.setUint16(offset + 12, point.intensity || 0, true);
        view.setUint8(offset + 14, 0);
        view.setInt8(offset + 15, 0);
        view.setUint8(offset + 16, 0);
        view.setInt16(offset + 17, 0, true);
        view.setUint16(offset + 19, 0, true);
        
        offset += 20;
    }
    
    return buffer;
}

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
        centers = await readCSV();
        addLog(`中心座標を${centers.length}件読み込みました`);
        updateProgress(10, 'CSV読込完了');
        
        const radius = parseFloat(radiusInput.value);
        addLog(`設定: 半径=${radius}m`);
        
        // LAZ/LAS読み込み
        addLog('LAZ/LASファイルを読み込んでいます...');
        addLog('大きなファイルの場合、数分かかることがあります...');
        const arrayBuffer = await lazFile.arrayBuffer();
        updateProgress(15, 'ファイル読込完了');
        
        addLog('ヘッダーを解析しています...');
        const header = parseLASHeader(arrayBuffer);
        
        addLog(`バージョン: LAS ${header.versionMajor}.${header.versionMinor}`);
        addLog(`総点数: ${header.numPoints.toLocaleString()}点`);
        addLog(`ポイントフォーマット: ${header.pointFormat}`);
        addLog(`圧縮: ${header.isCompressed ? 'LAZ（圧縮）' : '非圧縮LAS'}`);
        
        let lasBuffer = arrayBuffer;
        
        // LAZ圧縮の場合は解凍
        if (header.isCompressed) {
            lasBuffer = await decompressLAZWithLazPerf(arrayBuffer, header);
            // ヘッダーを再解析（圧縮フラグがクリアされている）
            const newHeader = parseLASHeader(lasBuffer);
            Object.assign(header, newHeader);
            header.isCompressed = false;
        }
        
        updateProgress(45, 'ヘッダー解析完了');
        
        // フィルタリング
        addLog('点群をフィルタリングしています...');
        const filteredPoints = [];
        
        for (const { points, progress } of readUncompressedLAS(lasBuffer, header)) {
            for (const point of points) {
                if (isPointNearCenters(point.x, point.y, point.z, centers, radius)) {
                    filteredPoints.push(point);
                }
            }
            
            const percent = 45 + progress * 50;
            updateProgress(percent, `フィルタリング中: ${Math.floor(progress * 100)}%`);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        updateProgress(95, 'フィルタリング完了');
        addLog(`抽出点数: ${filteredPoints.length.toLocaleString()}点`);
        
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
        
        addLog('✅ 処理が完了しました！');
        
    } catch (err) {
        console.error(err);
        addLog(`❌ エラー: ${err.message}`);
        alert(`エラー: ${err.message}`);
    } finally {
        processBtn.disabled = false;
    }
}
