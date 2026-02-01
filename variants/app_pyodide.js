// Pyodide版 - PythonをブラウザでF実行してLAZ処理

let pyodide = null;
let lazFile = null;
let csvFile = null;

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

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Pyodideの初期化
async function initPyodide() {
    try {
        statusDiv.textContent = '⏳ Pythonランタイムを初期化しています...（初回は数分かかります）';
        statusDiv.className = 'status';
        
        addLog('Pyodideを読み込んでいます...');
        pyodide = await loadPyodide({
            indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/'
        });
        
        updateProgress(20, 'ランタイム初期化完了');
        addLog('必要なパッケージをインストールしています...');
        
        // 必要なパッケージをインストール
        await pyodide.loadPackage(['numpy', 'micropip']);
        updateProgress(40, 'numpy読込完了');
        
        addLog('laspyをインストールしています...');
        await pyodide.runPythonAsync(`
            import micropip
            await micropip.install('laspy')
        `);
        updateProgress(60, 'laspy読込完了');
        
        addLog('scipyをインストールしています...');
        await pyodide.runPythonAsync(`
            await micropip.install('scipy')
        `);
        updateProgress(80, 'scipy読込完了');
        
        // 処理スクリプトを準備
        await pyodide.runPythonAsync(`
import numpy as np
import laspy
from scipy.spatial import cKDTree
from io import BytesIO
import js

def process_laz(laz_data, csv_text, radius):
    """LAZ/LASファイルを処理してフィルタリング"""
    
    # CSVを解析
    lines = csv_text.strip().split('\\n')
    centers = []
    for line in lines[1:]:  # ヘッダーをスキップ
        if not line.strip():
            continue
        parts = line.split(',')
        if len(parts) >= 4:
            try:
                x = float(parts[1])
                y = float(parts[2])
                z = float(parts[3])
                centers.append([x, y, z])
            except:
                pass
    
    centers = np.array(centers)
    js.console.log(f"中心座標: {len(centers)}件")
    
    # LAZ/LASファイルを読み込み
    laz_buffer = BytesIO(laz_data.to_py())
    las = laspy.read(laz_buffer)
    
    js.console.log(f"総点数: {len(las.points)}")
    
    # KD-treeを構築
    tree = cKDTree(centers)
    
    # 点群座標を取得
    points_xyz = np.vstack([las.x, las.y, las.z]).T
    
    # 範囲内の点を検索
    indices = tree.query_ball_point(points_xyz, radius)
    
    # フィルタリング
    mask = np.array([len(idx) > 0 for idx in indices])
    filtered_points = las.points[mask]
    
    js.console.log(f"抽出点数: {len(filtered_points)}")
    
    # 新しいLASファイルを作成
    header = laspy.LasHeader(point_format=las.header.point_format, version=las.header.version)
    header.offsets = las.header.offsets
    header.scales = las.header.scales
    
    output_las = laspy.LasData(header)
    output_las.points = filtered_points
    
    # バイトデータとして出力
    output_buffer = BytesIO()
    output_las.write(output_buffer)
    
    return {
        'input_points': len(las.points),
        'output_points': len(filtered_points),
        'data': output_buffer.getvalue()
    }
        `);
        
        updateProgress(100, '初期化完了');
        statusDiv.textContent = '✅ 準備完了！LAZ/LASファイルを処理できます';
        statusDiv.className = 'status success';
        addLog('✅ 初期化完了！');
        
        processBtn.disabled = false;
        checkFiles();
        
    } catch (err) {
        console.error('Pyodide initialization failed:', err);
        statusDiv.textContent = '❌ 初期化に失敗しました';
        statusDiv.className = 'status error';
        addLog(`❌ エラー: ${err.message}`);
    }
}

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
    if (pyodide) {
        processBtn.disabled = !(lazFile && csvFile);
    }
}

async function processFiles() {
    try {
        processBtn.disabled = true;
        progressSection.classList.add('active');
        resultSection.classList.remove('active');
        logDiv.innerHTML = '';
        
        updateProgress(0, '初期化中');
        addLog('処理を開始します...');
        
        const radius = parseFloat(radiusInput.value);
        addLog(`設定: 半径=${radius}m`);
        
        // ファイルを読み込み
        addLog('LAZ/LASファイルを読み込んでいます...');
        const lazArrayBuffer = await lazFile.arrayBuffer();
        const lazUint8Array = new Uint8Array(lazArrayBuffer);
        
        updateProgress(10, 'LAZ読込完了');
        
        addLog('CSVファイルを読み込んでいます...');
        const csvText = await csvFile.text();
        
        updateProgress(20, 'CSV読込完了');
        
        // Pythonに渡す
        addLog('点群を解析しています...');
        addLog('大きなファイルの場合、数分かかることがあります...');
        
        pyodide.globals.set('laz_data', lazUint8Array);
        pyodide.globals.set('csv_text', csvText);
        pyodide.globals.set('radius', radius);
        
        updateProgress(30, '処理中...');
        
        // Python処理を実行
        const result = await pyodide.runPythonAsync(`
import js
result = process_laz(laz_data, csv_text, radius)
result
        `);
        
        updateProgress(90, '出力ファイル生成中');
        
        // 結果を取得
        const inputPoints = result.get('input_points');
        const outputPoints = result.get('output_points');
        const outputData = result.get('data');
        
        addLog(`入力点数: ${inputPoints.toLocaleString()}点`);
        addLog(`出力点数: ${outputPoints.toLocaleString()}点`);
        
        if (outputPoints === 0) {
            throw new Error('指定された範囲内に点が見つかりませんでした');
        }
        
        // ダウンロード用のBlobを作成
        const outputArray = outputData.toJs();
        const blob = new Blob([outputArray], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        
        downloadBtn.href = url;
        downloadBtn.download = 'output.las';
        
        updateProgress(100, '完了');
        
        resultSection.classList.add('active');
        resultText.innerHTML = `
            入力点数: ${inputPoints.toLocaleString()}点<br>
            出力点数: ${outputPoints.toLocaleString()}点<br>
            ファイルサイズ: ${formatFileSize(outputArray.length)}
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

// ページ読み込み時に初期化
initPyodide();
