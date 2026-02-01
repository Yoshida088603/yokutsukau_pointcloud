console.log('app.js loaded');

let LASLoader, parse;
let lazFile = null;
let csvFile = null;
let centers = [];

// loaders.glのインポートを試みる
(async () => {
    const statusBanner = document.getElementById('statusBanner');
    try {
        console.log('Loading loaders.gl...');
        if (statusBanner) {
            statusBanner.textContent = '⏳ ライブラリを読み込んでいます...';
            statusBanner.style.background = '#fff3cd';
        }
        
        const lasModule = await import('https://esm.sh/@loaders.gl/las@4.2.0');
        const coreModule = await import('https://esm.sh/@loaders.gl/core@4.2.0');
        LASLoader = lasModule.LASLoader;
        parse = coreModule.parse;
        console.log('loaders.gl loaded successfully');
        
        if (statusBanner) {
            statusBanner.textContent = '✅ 準備完了！ファイルを選択してください。';
            statusBanner.style.background = '#d4edda';
            statusBanner.style.borderColor = '#c3e6cb';
            // 3秒後に非表示
            setTimeout(() => {
                statusBanner.style.display = 'none';
            }, 3000);
        }
    } catch (err) {
        console.error('Failed to load loaders.gl:', err);
        if (statusBanner) {
            statusBanner.textContent = '❌ ライブラリの読み込みに失敗しました。ページをリロードしてください。';
            statusBanner.style.background = '#f8d7da';
            statusBanner.style.borderColor = '#f5c6cb';
        }
        alert('ライブラリの読み込みに失敗しました。ページをリロードしてください。\nエラー: ' + err.message);
    }
})();

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
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');
const radiusInput = document.getElementById('radius');
const chunkSizeInput = document.getElementById('chunkSize');

console.log('UI elements initialized');

// ファイル選択イベント
lazInput.addEventListener('change', (e) => {
    console.log('LAZ file selected:', e.target.files[0]);
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

console.log('Event listeners attached');

function checkFiles() {
    processBtn.disabled = !(lazFile && csvFile);
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

function showError(message) {
    errorSection.classList.add('active');
    errorText.textContent = message;
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
                    // ヘッダー行をスキップ
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

// LAS/LAZフォーマットのヘッダーとポイントデータを作成
function createLASFile(points, header) {
    // 簡略化されたLASフォーマット（バージョン1.2）
    const buffer = new ArrayBuffer(227 + points.length * 20); // ヘッダー(227) + ポイント(20 bytes each)
    const view = new DataView(buffer);
    const encoder = new TextEncoder();
    
    // File Signature "LASF"
    const signature = encoder.encode('LASF');
    for (let i = 0; i < 4; i++) {
        view.setUint8(i, signature[i]);
    }
    
    // Header fields (simplified)
    view.setUint16(24, 1, true); // Version Major
    view.setUint16(25, 2, true); // Version Minor
    view.setUint16(94, 227, true); // Header Size
    view.setUint32(96, 227, true); // Offset to point data
    view.setUint32(100, 0, true); // Number of Variable Length Records
    view.setUint8(104, 0); // Point Data Format (Format 0)
    view.setUint16(105, 20, true); // Point Data Record Length
    view.setUint32(107, points.length, true); // Number of point records
    
    // Scale factors
    view.setFloat64(131, 0.001, true); // X scale
    view.setFloat64(139, 0.001, true); // Y scale
    view.setFloat64(147, 0.001, true); // Z scale
    
    // Offsets (using first point as reference)
    if (points.length > 0) {
        view.setFloat64(155, points[0].x, true); // X offset
        view.setFloat64(163, points[0].y, true); // Y offset
        view.setFloat64(171, points[0].z, true); // Z offset
    }
    
    // Min/Max values
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
    
    // Write point data
    let offset = 227;
    for (const point of points) {
        // X, Y, Z as scaled integers
        const x = Math.round((point.x - points[0].x) / 0.001);
        const y = Math.round((point.y - points[0].y) / 0.001);
        const z = Math.round((point.z - points[0].z) / 0.001);
        
        view.setInt32(offset, x, true);
        view.setInt32(offset + 4, y, true);
        view.setInt32(offset + 8, z, true);
        
        // Intensity (default 0)
        view.setUint16(offset + 12, point.intensity || 0, true);
        
        // Other fields (flags, classification, etc.)
        view.setUint8(offset + 14, 0);
        view.setInt8(offset + 15, 0);
        view.setUint8(offset + 16, 0);
        view.setInt16(offset + 17, 0, true);
        view.setUint16(offset + 19, 0, true);
        
        offset += 20;
    }
    
    return buffer;
}

// 古いパーサー関数は削除（loaders.glを使用）

async function processFiles() {
    try {
        console.log('processFiles called');
        
        // loaders.glが読み込まれているかチェック
        if (!LASLoader || !parse) {
            throw new Error('ライブラリがまだ読み込まれていません。数秒待ってから再度お試しください。');
        }
        
        // UI初期化
        processBtn.disabled = true;
        progressSection.classList.add('active');
        resultSection.classList.remove('active');
        errorSection.classList.remove('active');
        logDiv.innerHTML = '';
        
        addLog('処理を開始します...');
        updateProgress(0, '初期化中');
        
        // CSVファイルの読み込み
        addLog('CSVファイルを読み込んでいます...');
        centers = await readCSV();
        addLog(`中心座標を${centers.length}件読み込みました`);
        updateProgress(10, 'CSV読込完了');
        
        const radius = parseFloat(radiusInput.value);
        const chunkSize = parseInt(chunkSizeInput.value);
        
        addLog(`設定: 半径=${radius}m, チャンクサイズ=${chunkSize.toLocaleString()}点`);
        
        // LAZ/LASファイルの読み込み
        addLog('LAZ/LASファイルを読み込んでいます...');
        addLog('LAZ圧縮ファイルの場合、解凍に時間がかかります...');
        
        const arrayBuffer = await lazFile.arrayBuffer();
        updateProgress(20, 'ファイル読込完了');
        
        // loaders.glを使用してパース
        addLog('ファイルを解析しています...');
        console.log('Parsing with LASLoader...');
        const data = await parse(arrayBuffer, LASLoader, {
            las: {
                skip: 0,
                colorDepth: 8
            },
            worker: false
        });
        
        updateProgress(50, '解析完了');
        
        const header = data.loaderData.header;
        const attributes = data.attributes;
        
        // POSITIONSから座標を取得
        const positions = attributes.POSITION?.value;
        if (!positions || positions.length === 0) {
            throw new Error('点群データが見つかりませんでした');
        }
        
        const totalPoints = positions.length / 3;
        const intensities = attributes.intensity?.value || new Uint16Array(totalPoints);
        
        addLog(`バージョン: LAS ${header.version.major}.${header.version.minor}`);
        addLog(`総点数: ${totalPoints.toLocaleString()}点`);
        addLog(`ポイントフォーマット: ${header.pointFormat}`);
        addLog(`ファイルサイズ: ${formatFileSize(arrayBuffer.byteLength)}`);
        addLog(`範囲: X[${header.mins[0].toFixed(2)}, ${header.maxs[0].toFixed(2)}] Y[${header.mins[1].toFixed(2)}, ${header.maxs[1].toFixed(2)}] Z[${header.mins[2].toFixed(2)}, ${header.maxs[2].toFixed(2)}]`);
        
        // フィルタリング
        addLog('点群をフィルタリングしています...');
        const filteredPoints = [];
        
        for (let i = 0; i < totalPoints; i++) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];
            
            if (isPointNearCenters(x, y, z, centers, radius)) {
                filteredPoints.push({
                    x, y, z,
                    intensity: intensities[i] || 0
                });
            }
            
            // 進捗更新
            if (i % 100000 === 0) {
                const progress = 50 + (i / totalPoints) * 40;
                updateProgress(progress, `フィルタリング中: ${i.toLocaleString()}/${totalPoints.toLocaleString()}`);
                // UI更新のため少し待つ
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        updateProgress(90, 'フィルタリング完了');
        addLog(`抽出点数: ${filteredPoints.length.toLocaleString()}点`);
        
        if (filteredPoints.length === 0) {
            throw new Error('指定された範囲内に点が見つかりませんでした');
        }
        
        // LASファイル生成
        addLog('LASファイルを生成しています...');
        const lasBuffer = createLASFile(filteredPoints, header);
        
        updateProgress(100, '完了');
        
        // ダウンロードリンク作成
        const blob = new Blob([lasBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        downloadBtn.href = url;
        downloadBtn.download = 'output.las';
        
        // 結果表示
        resultSection.classList.add('active');
        resultText.innerHTML = `
            入力点数: ${totalPoints.toLocaleString()}点<br>
            出力点数: ${filteredPoints.length.toLocaleString()}点<br>
            ファイルサイズ: ${formatFileSize(lasBuffer.byteLength)}
        `;
        
        addLog('✅ 処理が完了しました！');
        
    } catch (err) {
        console.error(err);
        addLog(`❌ エラー: ${err.message}`);
        showError(err.message);
    } finally {
        processBtn.disabled = false;
    }
}
