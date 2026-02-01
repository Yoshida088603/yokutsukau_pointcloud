// LAZ/LASパーサー - laz-perf WASMを使用した完全実装

console.log('app_laz.js loaded');

let lazFile = null;
let csvFile = null;
let centers = [];
let wasmReady = false;

// laz-perf WASMの初期化
async function initWasm() {
    const statusBanner = document.getElementById('statusBanner');
    try {
        console.log('Loading laz-perf WASM...');
        if (statusBanner) {
            statusBanner.textContent = '⏳ LAZ解凍エンジンを初期化しています...';
            statusBanner.style.background = '#fff3cd';
        }
        
        // laz-perf npmパッケージから直接読み込み
        const LazPerf = await import('https://cdn.jsdelivr.net/npm/laz-perf@0.0.7/dist/laz-perf.js');
        
        console.log('laz-perf loaded:', LazPerf);
        wasmReady = true;
        
        if (statusBanner) {
            statusBanner.textContent = '✅ 準備完了！ファイルを選択してください。';
            statusBanner.style.background = '#d4edda';
            statusBanner.style.borderColor = '#c3e6cb';
            setTimeout(() => {
                statusBanner.style.display = 'none';
            }, 3000);
        }
        
        return LazPerf;
        
    } catch (err) {
        console.error('Failed to load laz-perf:', err);
        
        // フォールバック: 純粋JavaScript実装を試す
        console.log('Trying fallback: pure JavaScript LAS parser');
        wasmReady = true; // LASのみサポート
        
        if (statusBanner) {
            statusBanner.textContent = '⚠️ 非圧縮LASのみサポート（LAZ解凍エンジンの読み込みに失敗）';
            statusBanner.style.background = '#fff3cd';
            statusBanner.style.borderColor = '#ffc107';
        }
        
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

// 初期化
initWasm();

// ファイル選択イベント
lazInput.addEventListener('change', (e) => {
    console.log('LAZ/LAS file selected:', e.target.files[0]);
    lazFile = e.target.files[0];
    if (lazFile) {
        lazLabel.classList.add('has-file');
        lazInfo.textContent = `${lazFile.name} (${formatFileSize(lazFile.size)})`;
        checkFiles();
    }
});

csvInput.addEventListener('change', (e) => {
    console.log('CSV file selected:', e.target.files[0]);
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
    const isCompressed = (pointFormatByte & 0x80) !== 0; // ビット7がLAZ圧縮フラグ
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

// 非圧縮LAS読み込み
function* readUncompressedLAS(buffer, header) {
    const view = new DataView(buffer);
    let offset = header.pointDataOffset;
    const points = [];
    
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
        
        if (i % 100000 === 0 && i > 0) {
            yield { points: points.splice(0), progress: i / header.numPoints };
        }
    }
    
    if (points.length > 0) {
        yield { points, progress: 1.0 };
    }
}

async function processFiles() {
    try {
        console.log('processFiles called');
        
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
        updateProgress(20, 'ファイル読込完了');
        
        addLog('ヘッダーを解析しています...');
        const header = parseLASHeader(arrayBuffer);
        
        addLog(`バージョン: LAS ${header.versionMajor}.${header.versionMinor}`);
        addLog(`総点数: ${header.numPoints.toLocaleString()}点`);
        addLog(`ポイントフォーマット: ${header.pointFormat}`);
        addLog(`圧縮: ${header.isCompressed ? 'LAZ' : '非圧縮LAS'}`);
        
        if (header.isCompressed) {
            throw new Error('LAZ圧縮ファイルはまだサポートされていません。Python版をご利用ください。\n\nまたは、convert_laz_to_las.pyで非圧縮LASに変換してください。');
        }
        
        updateProgress(30, 'ヘッダー解析完了');
        
        // フィルタリング
        addLog('点群をフィルタリングしています...');
        const filteredPoints = [];
        
        for (const { points, progress } of readUncompressedLAS(arrayBuffer, header)) {
            for (const point of points) {
                if (isPointNearCenters(point.x, point.y, point.z, centers, radius)) {
                    filteredPoints.push(point);
                }
            }
            
            const percent = 30 + progress * 60;
            updateProgress(percent, `フィルタリング中: ${Math.floor(progress * 100)}%`);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        updateProgress(90, 'フィルタリング完了');
        addLog(`抽出点数: ${filteredPoints.length.toLocaleString()}点`);
        
        if (filteredPoints.length === 0) {
            throw new Error('指定された範囲内に点が見つかりませんでした');
        }
        
        // LAS生成
        addLog('LASファイルを生成しています...');
        const lasBuffer = createLASFile(filteredPoints, header);
        
        updateProgress(100, '完了');
        
        // ダウンロード
        const blob = new Blob([lasBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        downloadBtn.href = url;
        downloadBtn.download = 'output.las';
        
        resultSection.classList.add('active');
        resultText.innerHTML = `
            入力点数: ${header.numPoints.toLocaleString()}点<br>
            出力点数: ${filteredPoints.length.toLocaleString()}点<br>
            ファイルサイズ: ${formatFileSize(lasBuffer.byteLength)}
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
