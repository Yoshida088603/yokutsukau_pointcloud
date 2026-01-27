// サーバーAPI版 - LAZ完全対応

console.log('app_server.js loaded');

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

// 初期化完了
statusDiv.textContent = '✅ 準備完了！LAZ/LASファイルを選択してください';
statusDiv.className = 'status success';

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
    processBtn.disabled = !(lazFile && csvFile);
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
        
        const radius = parseFloat(radiusInput.value);
        addLog(`設定: 半径=${radius}m`);
        
        // FormDataを作成
        const formData = new FormData();
        formData.append('lazFile', lazFile);
        formData.append('csvFile', csvFile);
        formData.append('radius', radius.toString());
        
        addLog('サーバーにアップロードしています...');
        updateProgress(10, 'アップロード中');
        
        // サーバーに送信
        const response = await fetch('/api/process', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`サーバーエラー: ${errorText}`);
        }
        
        updateProgress(50, 'サーバーで処理中');
        addLog('サーバーで点群を処理しています...');
        addLog('大きなファイルの場合、数分かかることがあります...');
        
        // レスポンスヘッダーから結果情報を取得
        const inputPoints = response.headers.get('X-Input-Points');
        const outputPoints = response.headers.get('X-Output-Points');
        
        // 結果ファイルを取得
        const blob = await response.blob();
        
        updateProgress(90, 'ダウンロード準備中');
        addLog(`入力点数: ${parseInt(inputPoints).toLocaleString()}点`);
        addLog(`出力点数: ${parseInt(outputPoints).toLocaleString()}点`);
        
        if (parseInt(outputPoints) === 0) {
            throw new Error('指定された範囲内に点が見つかりませんでした');
        }
        
        // ダウンロードリンクを設定
        const url = URL.createObjectURL(blob);
        downloadBtn.href = url;
        downloadBtn.download = 'output.las';
        
        updateProgress(100, '完了');
        
        resultSection.classList.add('active');
        resultText.innerHTML = `
            入力点数: ${parseInt(inputPoints).toLocaleString()}点<br>
            出力点数: ${parseInt(outputPoints).toLocaleString()}点<br>
            ファイルサイズ: ${formatFileSize(blob.size)}
        `;
        
        addLog('✅ 処理が完了しました！');
        
    } catch (err) {
        console.error(err);
        addLog(`❌ エラー: ${err.message}`);
        alert(`エラー: ${err.message}\n\nサーバーが起動していることを確認してください。\n\n起動方法:\npython server.py`);
    } finally {
        processBtn.disabled = false;
    }
}
