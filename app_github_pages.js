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

/**
 * 点レコード内のRGB先頭バイトオフセット（ASPRS LAS仕様）
 * Format 2: 20, Format 3/7: 28 (20+GPS 8), Format 5/8: 30 (20+GPS 8+Wave 2), Format 10: 30
 * @param {number} pointFormat - Point Format ID (0-10)
 * @returns {number} RGBのRedが始まるオフセット。RGB無しなら -1
 */
function getRgbByteOffset(pointFormat) {
    switch (pointFormat) {
        case 2: return 20;
        case 3: case 7: return 28;
        case 5: case 8: case 10: return 30;
        default: return -1;
    }
}

// ポリゴン境界モード: Classification（内側・帯・外側）
const CLASS_INSIDE = 1;
const CLASS_BAND = 2;
const CLASS_OUTSIDE = 3;

// ============================================================================
// グローバル変数
// ============================================================================

let lazFile = null;
let csvFile = null;
let simFile = null;
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
        
        statusDiv.textContent = '✅ 準備完了！LAZ/LASファイルを選択してください';
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
const simInput = document.getElementById('simFile');
const simLabel = document.getElementById('simLabel');
const simInfo = document.getElementById('simInfo');

// ============================================================================
// イベントハンドラと初期化
// ============================================================================

// laz-perf WASMの初期化
initLazPerf();

// ファイル選択イベント（ファイルピッカーでもモードを自動選択）
lazInput.addEventListener('change', (e) => {
    lazFile = e.target.files[0];
    if (lazFile) {
        lazLabel.classList.add('has-file');
        lazInfo.textContent = `${lazFile.name} (${formatFileSize(lazFile.size)})`;
        updateModeFromFiles();
    }
});

csvInput.addEventListener('change', (e) => {
    csvFile = e.target.files[0];
    if (csvFile) {
        csvLabel.classList.add('has-file');
        csvInfo.textContent = `${csvFile.name} (${formatFileSize(csvFile.size)})`;
        updateModeFromFiles();
    }
});

if (simInput) {
    simInput.addEventListener('change', (e) => {
        simFile = e.target.files[0];
        if (simFile) {
            if (simLabel) simLabel.classList.add('has-file');
            if (simInfo) simInfo.textContent = `${simFile.name} (${formatFileSize(simFile.size)})`;
            updateModeFromFiles();
        }
        checkFiles();
    });
}

// ドラッグ＆ドロップ（ファイル種類に応じてラジオを自動選択）
const fileDropZone = document.getElementById('fileDropZone');
if (fileDropZone) {
    fileDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        fileDropZone.classList.add('drag-over');
    });
    fileDropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!fileDropZone.contains(e.relatedTarget)) fileDropZone.classList.remove('drag-over');
    });
    fileDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileDropZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files && files.length) applyFilesFromDrop(files);
    });
}

processBtn.addEventListener('click', () => {
    const mode = document.querySelector('input[name="processMode"]:checked')?.value || 'center';
    if (mode === 'boundary') return processBoundaryTransform();
    if (mode === 'section') return processSectionMode();
    if (mode === 'polygon') return processPolygonBoundary();
    if (mode === 'target') return processTargetCorners();
    if (mode === 'clipPolygon') return processBoundaryClipPolygon();
    if (mode === 'clipPolygonSim') return processBoundaryClipPolygonFromSim();
    return processFiles();
});

// 3DDB COPC: 入力方法切替・検索・ダウンロード・Potree表示
const copcSearchBtn = document.getElementById('copcSearchBtn');
const copcDownloadBtn = document.getElementById('copcDownloadBtn');
const copcPotreeBtn = document.getElementById('copcPotreeBtn');
const copcPointInputs = document.getElementById('copcPointInputs');
const copcSimInput = document.getElementById('copcSimInput');
const copcSimFile = document.getElementById('copcSimFile');
const copcSimInfo = document.getElementById('copcSimInfo');
document.querySelectorAll('input[name="copcInputMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
        const isPoint = document.querySelector('input[name="copcInputMode"]:checked')?.value === 'point';
        if (copcPointInputs) copcPointInputs.style.display = isPoint ? 'block' : 'none';
        if (copcSimInput) copcSimInput.style.display = isPoint ? 'none' : 'block';
    });
});
if (copcSimFile && copcSimInfo) {
    copcSimFile.addEventListener('change', () => {
        const f = copcSimFile.files?.[0];
        copcSimInfo.textContent = f ? `${f.name} (${formatFileSize(f.size)})` : '画地SIMAを選択すると、ポリゴン範囲内のCOPCを検索します';
    });
}
if (copcSearchBtn) {
    copcSearchBtn.addEventListener('click', async () => {
        const epsgEl = document.getElementById('copcEpsg');
        const xEl = document.getElementById('copcX');
        const yEl = document.getElementById('copcY');
        const baseEl = document.getElementById('copcApiBase');
        const epsg = epsgEl?.value || '6677';
        const baseUrl = baseEl?.value?.trim() || COPC_3DDB_DEFAULT_BASE;
        const messageEl = document.getElementById('copcMessage');
        const listEl = document.getElementById('copcCandidateList');
        const radiosEl = document.getElementById('copcCandidateRadios');
        const isPointMode = document.querySelector('input[name="copcInputMode"]:checked')?.value === 'point';
        if (messageEl) messageEl.style.display = 'none';
        if (listEl) listEl.style.display = 'none';

        let areaWkt = null;
        let limit = 50;
        if (isPointMode) {
            const x = parseFloat(xEl?.value);
            const y = parseFloat(yEl?.value);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                showCopcMessage('X・Yに数値を入力してください。', true);
                return;
            }
            const { lon, lat } = convertPlaneRectToLonLat(epsg, x, y);
            console.log('Converted lon, lat', { lon, lat });
            areaWkt = `POINT(${lon} ${lat})`;
        } else {
            const file = copcSimFile?.files?.[0];
            if (!file) {
                showCopcMessage('SIMA形式（.sim）ファイルを選択してください。', true);
                return;
            }
            const text = await file.text();
            const polygonXY = parseSim(text);
            if (!polygonXY || polygonXY.length < 3) {
                showCopcMessage('SIMAから有効なポリゴン（3頂点以上）を取得できませんでした。', true);
                return;
            }
            areaWkt = simaPolygonToWkt(polygonXY, epsg);
            limit = 200;
            console.log('SIMA ポリゴン:', polygonXY.length, '頂点 → WKT で検索');
        }

        copcSearchBtn.disabled = true;
        try {
            const useProxy = document.getElementById('copcUseProxy')?.checked === true;
            const candidates = await searchCopcArea(areaWkt, baseUrl, { useProxy }, limit);
            copcCandidates = candidates;
            if (candidates.length === 0) {
                showCopcMessage('該当COPCなし');
                if (copcDownloadBtn) copcDownloadBtn.disabled = true;
                if (copcPotreeBtn) copcPotreeBtn.disabled = true;
                return;
            }
            showCopcMessage(`候補 ${candidates.length} 件見つかりました。選択してLAZダウンロードを押してください。`);
            radiosEl.innerHTML = '';
            candidates.forEach((c, i) => {
                const label = document.createElement('label');
                label.style.display = 'block';
                label.style.marginBottom = '8px';
                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = 'copcCandidate';
                radio.value = String(i);
                if (i === 0) radio.checked = true;
                label.appendChild(radio);
                const titleText = (c.title || '').slice(0, 60) + ((c.title || '').length > 60 ? '...' : '');
                label.appendChild(document.createTextNode(` [${c.reg_id}] ${titleText}${c.isZip ? ' (ZIP)' : ''}`));
                radiosEl.appendChild(label);
            });
            listEl.style.display = 'block';
            if (copcDownloadBtn) copcDownloadBtn.disabled = false;
            if (copcPotreeBtn) copcPotreeBtn.disabled = false;
        } catch (err) {
            console.error('COPC search error', err);
            showCopcMessage(`エラー: ${err.message}`, true);
            if (copcDownloadBtn) copcDownloadBtn.disabled = true;
            if (copcPotreeBtn) copcPotreeBtn.disabled = true;
        } finally {
            copcSearchBtn.disabled = false;
        }
    });
}
if (copcDownloadBtn) {
    copcDownloadBtn.addEventListener('click', () => {
        const selected = document.querySelector('input[name="copcCandidate"]:checked');
        const idx = selected ? parseInt(selected.value, 10) : 0;
        const c = copcCandidates[idx];
        if (!c || !c.external_link) {
            showCopcMessage('候補を選択してからCOPC検索を実行してください。', true);
            return;
        }
        const filename = c.isZip ? `3ddb_${c.reg_id}.zip` : `3ddb_${c.reg_id}.laz`;
        try {
            triggerDownload(c.external_link, filename);
            showCopcMessage(`ダウンロードを開始しました: ${filename}`);
        } catch (err) {
            console.error('Download error', err);
            showCopcMessage(`ダウンロードに失敗しました: ${err.message}`, true);
        }
    });
}
if (copcPotreeBtn) {
    copcPotreeBtn.addEventListener('click', () => {
        const selected = document.querySelector('input[name="copcCandidate"]:checked');
        const idx = selected ? parseInt(selected.value, 10) : 0;
        const c = copcCandidates[idx];
        if (!c) {
            showCopcMessage('候補を選択してからPotreeで表示を実行してください。', true);
            return;
        }
        let directUrl;
        if (c.external_link && /\.(copc\.laz|laz)$/i.test(c.external_link)) {
            directUrl = c.external_link;
        } else {
            directUrl = `https://gsvrg.ipri.aist.go.jp/3ddb-pds/copc/${c.reg_id}.copc.laz`;
        }
        const useProxy = document.getElementById('copcUseProxy')?.checked === true;
        const rParam = useProxy
            ? (window.location.origin + '/api/3ddb_proxy?url=' + encodeURIComponent(directUrl))
            : directUrl;
        // プロキシ利用時は同一オリジンのビューアを開く（HTTPS→httpのMixed Contentを避ける）
        const viewerBase = useProxy
            ? (window.location.origin + '/potree-copc-viewer/')
            : POTREE_COPC_VIEWER_BASE;
        const url = viewerBase + '?r=' + encodeURIComponent(rParam);
        window.open(url, '_blank', 'noopener');
        showCopcMessage(useProxy
            ? 'Potreeビューアを別タブで開きました（同一オリジン・プロキシ経由でCOPC取得）。'
            : 'Potreeビューアを別タブで開きました。3ddb-pds の CORS で表示できない場合は、プロキシ経由で検索にチェックを入れてから再度お試しください。');
    });
}

// 処理モード切替でUI表示を更新
document.querySelectorAll('input[name="processMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
        const mode = document.querySelector('input[name="processMode"]:checked')?.value || 'center';
        const csvSection = document.getElementById('csvSection');
        const boundarySection = document.getElementById('boundarySection');
        const centerSettings = document.getElementById('centerSettings');
        const sectionSettings = document.getElementById('sectionSettings');
        const simSection = document.getElementById('simSection');
        const polygonSettings = document.getElementById('polygonSettings');
        const targetSettings = document.getElementById('targetSettings');
        const copcSection = document.getElementById('copcSection');
        const processBtn = document.getElementById('processBtn');
        const isCenter = mode === 'center';
        const isBoundaryLike = mode === 'boundary' || mode === 'section' || mode === 'clipPolygon';
        const isPolygon = mode === 'polygon';
        const isClipPolygonSim = mode === 'clipPolygonSim';
        const isTarget = mode === 'target';
        const isCopc = mode === 'copc';
        if (csvSection) csvSection.style.display = isCenter ? 'block' : 'none';
        if (boundarySection) boundarySection.style.display = isBoundaryLike ? 'block' : 'none';
        if (isBoundaryLike && typeof updateBoundaryMarkerUI === 'function') updateBoundaryMarkerUI();
        if (simSection) simSection.style.display = (isPolygon || isClipPolygonSim) ? 'block' : 'none';
        if (polygonSettings) polygonSettings.style.display = isPolygon ? 'block' : 'none';
        if (targetSettings) targetSettings.style.display = isTarget ? 'block' : 'none';
        if (copcSection) copcSection.style.display = isCopc ? 'block' : 'none';
        if (centerSettings) centerSettings.style.display = isCenter ? 'block' : 'none';
        if (sectionSettings) sectionSettings.style.display = mode === 'section' ? 'block' : 'none';
        if (processBtn) processBtn.style.display = isCopc ? 'none' : 'block';
        checkFiles();
    });
});

function updateBoundaryMarkerUI() {
    const wrap = document.getElementById('boundaryTargetSizeWrap');
    const useTarget = document.querySelector('input[name="boundaryMarker"]:checked')?.value === 'target';
    if (wrap) wrap.style.display = useTarget ? 'block' : 'none';
}
document.querySelectorAll('input[name="boundaryMarker"]').forEach((radio) => {
    radio.addEventListener('change', updateBoundaryMarkerUI);
});
document.addEventListener('DOMContentLoaded', updateBoundaryMarkerUI);

function checkFiles() {
    const mode = document.querySelector('input[name="processMode"]:checked')?.value || 'center';
    if (mode === 'clipPolygon') {
        processBtn.disabled = false;
    } else if (mode === 'clipPolygonSim') {
        processBtn.disabled = !(simFile && simFile.name);
    } else if (mode === 'boundary' || mode === 'section' || mode === 'target') {
        processBtn.disabled = !(lazFile && wasmReady);
    } else if (mode === 'polygon') {
        processBtn.disabled = !(lazFile && simFile && wasmReady);
    } else {
        processBtn.disabled = !(lazFile && csvFile && wasmReady);
    }
}

/**
 * 現在セットされているファイル（lazFile, csvFile, simFile）に応じて処理モードのラジオを動的に選択する。
 * 優先: 点群+SIM → ポリゴン境界, 点群+CSV → 中心抽出, 点群のみ → 立面図。最後に checkFiles() を呼ぶ。
 */
function updateModeFromFiles() {
    const radioCenter = document.getElementById('processModeCenter');
    const radioBoundary = document.getElementById('processModeBoundary');
    const radioPolygon = document.getElementById('processModePolygon');
    if (!radioCenter || !radioBoundary || !radioPolygon) return;
    if (lazFile && simFile) {
        radioPolygon.checked = true;
        radioPolygon.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (lazFile && csvFile) {
        radioCenter.checked = true;
        radioCenter.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (lazFile) {
        radioBoundary.checked = true;
        radioBoundary.dispatchEvent(new Event('change', { bubbles: true }));
    }
    checkFiles();
}

/**
 * ドロップされた FileList を種類ごとに振り分け、lazFile/csvFile/simFile とラベルを更新して updateModeFromFiles を呼ぶ。
 */
function applyFilesFromDrop(files) {
    if (!files || !files.length) return;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const name = (file.name || '').toLowerCase();
        const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
        if (ext === '.laz' || ext === '.las') {
            lazFile = file;
            lazLabel.classList.add('has-file');
            lazInfo.textContent = `${file.name} (${formatFileSize(file.size)})`;
        } else if (ext === '.csv') {
            csvFile = file;
            csvLabel.classList.add('has-file');
            csvInfo.textContent = `${file.name} (${formatFileSize(file.size)})`;
        } else if (ext === '.sim') {
            simFile = file;
            if (simLabel) simLabel.classList.add('has-file');
            if (simInfo) simInfo.textContent = `${file.name} (${formatFileSize(file.size)})`;
        }
    }
    updateModeFromFiles();
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ============================================================================
// 3DDB COPC取得（平面直角→経緯度→検索→LAZ丸ごとDL）
// ============================================================================

const COPC_3DDB_DEFAULT_BASE = 'https://gsvrg.ipri.aist.go.jp/3ddb_demo';
const POTREE_COPC_VIEWER_BASE = 'https://Yoshida088603.github.io/potree-copc-viewer/';
let copcCandidates = [];

/**
 * 平面直角座標（proj4 の x=Easting, y=Northing）を JGD2011 経緯度に変換（内部用）
 * @param {string|number} epsg - 系のEPSGコード（例: "6677"）
 * @param {number} x - Easting (m)
 * @param {number} y - Northing (m)
 * @returns {{ lon: number, lat: number }} 経度・緯度（度）
 */
function convertXYToLonLat(epsg, x, y) {
    const proj4 = globalThis.proj4 || window.proj4;
    if (!proj4) throw new Error('proj4 が読み込まれていません');
    const epsgStr = String(epsg).replace(/^EPSG:?/i, '');
    const src = `EPSG:${epsgStr}`;
    const dst = 'EPSG:6668'; // JGD2011 (geographic 2D)
    if (!proj4.defs(src)) {
        const defs = getPlaneRectangularDefs();
        if (!defs[epsgStr]) throw new Error(`未対応の系です: ${epsgStr}`);
        proj4.defs(src, defs[epsgStr]);
    }
    if (!proj4.defs(dst)) proj4.defs(dst, '+proj=longlat +ellps=GRS80 +datum=GRS80 +no_defs');
    const [lon, lat] = proj4(src, dst).forward([x, y]);
    return { lon, lat };
}

/**
 * 平面直角座標（測量系・手入力/SIMA共通）を JGD2011 経緯度に変換
 * 測量系では第1値・第2値の並びが proj4 の (Easting, Northing) と異なるため、
 * ここで XY を入れ替えてから convertXYToLonLat に渡す。
 * @param {string|number} epsg - 系のEPSGコード（例: "6677"）
 * @param {number} first - 入力の第1値（手入力のX欄 / SIMAの第1列）
 * @param {number} second - 入力の第2値（手入力のY欄 / SIMAの第2列）
 * @returns {{ lon: number, lat: number }} 経度・緯度（度）
 */
function convertPlaneRectToLonLat(epsg, first, second) {
    return convertXYToLonLat(epsg, second, first);
}

function getPlaneRectangularDefs() {
    const tail = '+k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs';
    const latLon = [
        [33, 129.5], [33, 131], [36, 132.166666667], [33, 133.5], [36, 134.333333333], [36, 136],
        [36, 137.166666667], [36, 138.5], [36, 139.833333333], [40, 140.833333333], [44, 140.25],
        [44, 142.25], [44, 144.25], [26, 142], [26, 127.5], [26, 124], [26, 131], [20, 136], [26, 154]
    ];
    const epsgList = ['6669', '6670', '6671', '6672', '6673', '6674', '6675', '6676', '6677', '6678', '6679', '6680', '6681', '6682', '6683', '6684', '6685', '6686', '6687'];
    const defs = {};
    epsgList.forEach((epsg, i) => {
        const [lat0, lon0] = latLon[i];
        defs[epsg] = `+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} ${tail}`;
    });
    return defs;
}

/**
 * 3DDB API で area WKT（POINT または POLYGON）により COPC 候補を検索
 * @param {string} areaWkt - WKT（例: "POINT(lon lat)" または "POLYGON((lon1 lat1, lon2 lat2, ...))"）
 * @param {string} baseUrl - APIベースURL
 * @param {{ useProxy?: boolean }} [opts] - useProxy: true で同一オリジンの /api/3ddb_proxy 経由で取得（CORS回避）
 * @param {number} [limit=50] - 取得上限
 * @returns {Promise<Array<{ reg_id: number, title: string, external_link: string, isZip?: boolean }>>}
 */
async function searchCopcArea(areaWkt, baseUrl, opts = {}, limit = 50) {
    const base = (baseUrl || COPC_3DDB_DEFAULT_BASE).replace(/\/$/, '');
    const apiPath = `/api/v1/services/ALL/features?area=${encodeURIComponent(areaWkt)}&limit=${limit}`;
    let url = base + apiPath;
    if (opts.useProxy && typeof location !== 'undefined' && location.origin) {
        url = location.origin + '/api/3ddb_proxy?url=' + encodeURIComponent(url);
    }
    const res = await fetch(url);
    if (!res.ok) {
        if (opts.useProxy && res.status === 404) {
            const isGitHubPages = typeof location !== 'undefined' && /github\.io$/i.test(location.origin || '');
            const msg = isGitHubPages
                ? 'GitHub Pages ではプロキシは使えません。「プロキシ経由で検索」のチェックを外してから再度検索してください。'
                : 'プロキシがありません。ターミナルで「python scripts/serve_with_3ddb_proxy.py」を実行してから、このページを http://localhost:8000 で開き直してください。';
            throw new Error(msg);
        }
        throw new Error(`APIエラー: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const features = data.features || [];

    // 1件目でプロパティのキー一覧を確認（external_link が別名の可能性）
    if (features.length > 0) {
        const p0 = features[0].properties || {};
        console.log('3DDB API 検索結果: 総 feature 数 =', features.length, '| 1件目の properties キー:', Object.keys(p0).join(', '));
    }

    const candidates = [];
    for (const f of features) {
        const p = f.properties || {};
        const regId = p.reg_id;
        const title = p.title || '';
        let link = p.external_link;
        const linkType = String(p.external_link_type || '').trim().toLowerCase();

        // API が external_link を返さない場合: zipdata（ZIP）をフォールバック。プロキシ経由のときは同じオリジンでプロキシを使う
        if (!link || typeof link !== 'string') {
            if (regId != null && p.downloadable !== false) {
                link = base + '/api/v1/zipdata/' + regId;
                if (opts.useProxy && typeof location !== 'undefined' && location.origin) {
                    link = location.origin + '/api/3ddb_proxy?url=' + encodeURIComponent(link);
                }
                candidates.push({
                    reg_id: regId,
                    title: title,
                    external_link: link,
                    description: p.description,
                    isZip: true
                });
            }
            continue;
        }

        // external_link がある場合: COPC/LAZ 候補として追加
        const isCopcType = linkType === 'copc';
        const looksLikeCopc = linkType === '' && (/\.laz$/i.test(link) || /copc|laz|pointcloud/i.test(link));
        if (!isCopcType && !looksLikeCopc) continue;
        candidates.push({
            reg_id: regId,
            title: title,
            external_link: link,
            description: p.description,
            isZip: false
        });
    }
    return candidates;
}

/**
 * 1点の経緯度で COPC 検索（searchCopcArea のラッパー）
 */
async function searchCopc(lon, lat, baseUrl, opts = {}) {
    const wkt = `POINT(${lon} ${lat})`;
    return searchCopcArea(wkt, baseUrl, opts, 50);
}

/**
 * SIMA ポリゴン（平面直角座標の頂点配列）を経緯度ポリゴンの WKT に変換
 * 手入力と同様に convertPlaneRectToLonLat で統一して経緯度変換する
 * @param {number[][]} polygonXY - [[第1列, 第2列], ...] parseSim の戻り値（測量座標系）
 * @param {string} epsg - 系の EPSG コード
 * @returns {string} POLYGON((lon1 lat1, lon2 lat2, ..., lon1 lat1))
 */
function simaPolygonToWkt(polygonXY, epsg) {
    if (!polygonXY || polygonXY.length < 3) throw new Error('ポリゴンは3頂点以上必要です');
    const ring = [];
    for (const [first, second] of polygonXY) {
        const { lon, lat } = convertPlaneRectToLonLat(epsg, first, second);
        ring.push(`${lon} ${lat}`);
    }
    ring.push(ring[0]); // 閉じる
    return `POLYGON((${ring.join(', ')}))`;
}

/**
 * 指定URLをファイル名でダウンロード（&lt;a download&gt;でブラウザ標準DL）
 * @param {string} url - ダウンロードURL
 * @param {string} filename - 保存ファイル名
 */
function triggerDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download.laz';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function showCopcMessage(text, isError = false) {
    const el = document.getElementById('copcMessage');
    if (!el) return;
    el.textContent = text;
    el.className = 'status' + (isError ? ' error' : ' success');
    el.style.display = 'block';
}

function safeFilenameFromTitle(title) {
    return (title || '')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 80) || '3ddb';
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
// SIMA・ポリゴン境界（参照元 dxf4segmentation をそのまま流用）
// ============================================================================

/** .sim テキストをパースし、ポリゴン座標列 [[x,y],...]（測量座標系）を返す。 */
function parseSim(text) {
    const points = {};
    const order = [];
    text.split(/\r?\n/).forEach(line => {
        const cols = line.split(',').map(s => s.trim());
        if (cols[0] === 'A01') {
            points[cols[2]] = [parseFloat(cols[3]), parseFloat(cols[4])];
        }
        if (cols[0] === 'B01') {
            order.push(cols[2]);
        }
    });
    return order.map(pt => points[pt]).filter(Boolean);
}

/** オフセット量は5mm=0.005m。Clipper.js は HTML で CDN 読み込み。 */
function offsetPolygon(polygon, offset_m) {
    const ClipperLib = globalThis.ClipperLib || window.ClipperLib;
    if (!ClipperLib) throw new Error('Clipper.js が読み込まれていません');
    const scale = 1000000;
    const subj = polygon.map(([x, y]) => ({ X: Math.round(x * scale), Y: Math.round(y * scale) }));
    const co = new ClipperLib.ClipperOffset();
    co.AddPath(subj, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const solution = [];
    co.Execute(solution, offset_m * scale);
    return solution.length > 0 ? solution[0].map(pt => [pt.X / scale, pt.Y / scale]) : [];
}

/** 測量座標系ポリゴンを数学座標系に変換。参照元の DXF 出力時 XY 反転と同じルール: [simaX, simaY] → [simaY, simaX]。 */
function simaToMathPolygon(polygon) {
    return polygon.map(([x, y]) => [y, x]);
}

/** 点 (px, py) が多角形の内側にあるか（ray casting）。 */
function pointInPolygon(px, py, polygon) {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

/** 多角形 [[x,y],...] の軸平行バウンディングボックスを返す。空の場合は null。 */
function getPolygonBBox(polygon) {
    if (!polygon || polygon.length < 3) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of polygon) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return { minX, maxX, minY, maxY };
}

/** 点オブジェクトに red/green/blue が無い場合に 0 をセットする（LAS出力用）。 */
function ensurePointRGB(p) {
    if (p.red === undefined) { p.red = 0; p.green = 0; p.blue = 0; }
}

/**
 * ポリゴン境界用: 1点を内側/帯/外側に分類し、p に classification と帯の色を設定する。
 * @param {{x,y,z,intensity?,red?,green?,blue?}} p - 点（破壊的に更新）
 * @param {number[][]} innerMath - 内側オフセットポリゴン（数学座標系）
 * @param {number[][]} outerMath - 外側オフセットポリゴン（数学座標系）
 * @param {{minX,maxX,minY,maxY}|null} [outerBBox] - 外側ポリゴンのAABB。渡すと外側の点を早期に除外して高速化
 * @returns {'inside'|'band'|'outside'}
 */
function classifyPointForPolygon(p, innerMath, outerMath, outerBBox = null) {
    ensurePointRGB(p);
    const px = p.x, py = p.y;
    if (outerBBox && (px < outerBBox.minX || px > outerBBox.maxX || py < outerBBox.minY || py > outerBBox.maxY)) {
        p.classification = CLASS_OUTSIDE;
        return 'outside';
    }
    const inInner = innerMath.length >= 3 && pointInPolygon(px, py, innerMath);
    const inOuter = outerMath.length >= 3 && pointInPolygon(px, py, outerMath);
    if (inInner) {
        p.classification = CLASS_INSIDE;
        return 'inside';
    }
    if (inOuter) {
        p.classification = CLASS_BAND;
        p.red = 65535;
        p.green = 0;
        p.blue = 65535;
        return 'band';
    }
    p.classification = CLASS_OUTSIDE;
    return 'outside';
}

// ============================================================================
// 立面図作成（境界基準の座標系変換：剛体回転＋平行移動、Z不変）
// ============================================================================

/**
 * 境界線 A-B から X'軸ベクトル u と Y'軸ベクトル v を計算
 * u = normalize(B-A) または normalize(A-B)（向き指定による）
 * v = w × u（右手系）, w=(0,0,1) → v = (-uy, ux, 0)
 * @param {number} xA - 点A X
 * @param {number} yA - 点A Y
 * @param {number} xB - 点B X
 * @param {number} yB - 点B Y
 * @param {boolean} aLeftBRight - true: Aを左・Bを右（X'はA→B）, false: Bを左・Aを右（X'はB→A）
 * @returns {{ ux: number, uy: number, vx: number, vy: number } | null} 同一点の場合は null
 */
function computeBoundaryAxes(xA, yA, xB, yB, aLeftBRight) {
    let dx = xB - xA;
    let dy = yB - yA;
    if (!aLeftBRight) {
        dx = -dx;
        dy = -dy;
    }
    const L = Math.sqrt(dx * dx + dy * dy);
    if (L < 1e-10) return null;
    const ux = dx / L;
    const uy = dy / L;
    // v = w × u, w=(0,0,1) → v = (-uy, ux, 0)
    const vx = -uy;
    const vy = ux;
    return { ux, uy, vx, vy };
}

/**
 * 立面図の範囲クロップ用ポリゴンを生成する（単独機能）。
 * AB を内側に含み、左右・下は marginM、上（視線方向＝v 正）は marginUpM で広げた四角形。
 * @param {number} xA - 点A X
 * @param {number} yA - 点A Y
 * @param {number} xB - 点B X
 * @param {number} yB - 点B Y
 * @param {{ ux: number, uy: number, vx: number, vy: number }} axes - computeBoundaryAxes の戻り値
 * @param {number} [marginM=1] - 左右・下の余裕 (m)
 * @param {number} [marginUpM=100] - 上方向の長さ (m)
 * @returns {number[][]} [[x,y], [x,y], [x,y], [x,y]] 閉路順 P0(下A側)→P1(下B側)→P2(上B側)→P3(上A側)
 */
function getBoundaryClipPolygon(xA, yA, xB, yB, axes, marginM = 1, marginUpM = 100) {
    const { ux, uy, vx, vy } = axes;
    const m = marginM;
    const mUp = marginUpM;
    const P0 = [xA - m * ux - m * vx, yA - m * uy - m * vy];
    const P1 = [xB + m * ux - m * vx, yB + m * uy - m * vy];
    const P2 = [xB + m * ux + mUp * vx, yB + m * uy + mUp * vy];
    const P3 = [xA - m * ux + mUp * vx, yA - m * uy + mUp * vy];
    return [P0, P1, P2, P3];
}

/**
 * 1点を境界基準座標系に変換し、立面を平面に投影（デフォルト動作）
 * 境界座標 (X', Y', Z') のうち 出力 (X''=X', Y''=Z, Z''=Y') でXY平面＝立面（境界方向×標高）
 */
function transformPointBoundary(x, y, z, xA, yA, ux, uy, vx, vy) {
    const rx = x - xA;
    const ry = y - yA;
    const xp = rx * ux + ry * uy;
    const yp = rx * vx + ry * vy;
    return { x: xp, y: z, z: yp };
}

/**
 * 座標変換後の点配列のY値のみを指定倍率でスケール（破壊的）
 */
function scaleYPoints(points, scaleY) {
    if (scaleY === 1 || !Number.isFinite(scaleY) || scaleY <= 0) return;
    for (let i = 0; i < points.length; i++) points[i].y *= scaleY;
}

/**
 * 点配列を破壊的に境界基準座標に変換（立面→平面投影、属性はそのまま）
 */
function transformPointsBoundary(points, xA, yA, ux, uy, vx, vy) {
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const t = transformPointBoundary(p.x, p.y, p.z, xA, yA, ux, uy, vx, vy);
        p.x = t.x;
        p.y = t.y;
        p.z = t.z;
    }
}

/**
 * AB直線（無限長）からの符号付き横方向距離（Y'）を計算
 * u: AB方向, v: uに直交（右手系, XY平面）
 * @returns {number} yp = dot((x-xA,y-yA), v)
 */
function signedDistanceToABLine(x, y, xA, yA, vx, vy) {
    const rx = x - xA;
    const ry = y - yA;
    return rx * vx + ry * vy;
}

/**
 * 1点を縦断図座標へ変換（XY平面=縦断図: X=境界方向, Y=標高, Z=奥行）しつつ、切抜幅で判定
 * @param {number} halfWidth - |Y'| <= halfWidth の点のみ採用
 * @returns {{x:number,y:number,z:number}|null}
 */
function clipAndTransformToProfile(x, y, z, xA, yA, ux, uy, vx, vy, halfWidth) {
    const rx = x - xA;
    const ry = y - yA;
    const xp = rx * ux + ry * uy;
    const yp = rx * vx + ry * vy;
    if (Math.abs(yp) > halfWidth) return null;
    return { x: xp, y: z, z: yp };
}

/** 黄金比（Fibonacci球面配置用） */
const FIBONACCI_GOLDEN = (1 + Math.sqrt(5)) / 2;

/**
 * 指定中心・半径でスフィア表面にほぼ均等に配置した点群を生成（オリジナル座標系）
 * @param {number} cx - 中心X
 * @param {number} cy - 中心Y
 * @param {number} cz - 中心Z
 * @param {number} radius - 半径（デフォルト0.01）
 * @param {number} numPoints - 点数（デフォルト50）
 * @param {boolean} withRGB -  trueのとき red, green, blue を付与（マゼンタ）
 * @returns {Object[]} { x, y, z, intensity, [red, green, blue] } の配列
 */
function generateSpherePointCloud(cx, cy, cz, radius = 0.01, numPoints = 50, withRGB = false) {
    const points = [];
    for (let i = 0; i < numPoints; i++) {
        const theta = 2 * Math.PI * i / FIBONACCI_GOLDEN;
        const phi = Math.acos(Math.max(-1, 1 - 2 * (i + 0.5) / numPoints));
        const x = Math.cos(theta) * Math.sin(phi);
        const y = Math.sin(theta) * Math.sin(phi);
        const z = Math.cos(phi);
        const p = {
            x: cx + radius * x,
            y: cy + radius * y,
            z: cz + radius * z,
            intensity: 0
        };
        if (withRGB) {
            // LASのRGBは16bit(0-65535)が基本。ビューアが8bit表示に落とす際に上位8bitを見る場合、
            // 255(0x00FF)は0に見えることがあるためフルレンジを使用する。
            p.red = 65535;
            p.green = 0;
            p.blue = 65535;
        }
        points.push(p);
    }
    return points;
}

/** 白黒ターゲットの点間ピッチ（m）。0.005 = 5mm。 */
const TARGET_PITCH = 0.005;

/**
 * 白黒チェッカーのターゲット点群を生成。Z=cz の平面に配置。点密度は TARGET_PITCH（0.005m）で固定。
 * 2×2 象限: 左上黒・右上白・左下白・右下黒。
 */
function generateCheckerboardTarget(cx, cy, cz, halfSize = 0.1) {
    const points = [];
    const side = 2 * halfSize;
    const gridN = Math.max(2, Math.round(side / TARGET_PITCH) + 1);
    const step = side / (gridN - 1);
    const x0 = cx - halfSize;
    const y0 = cy - halfSize;
    for (let i = 0; i < gridN; i++) {
        for (let j = 0; j < gridN; j++) {
            const x = x0 + i * step;
            const y = y0 + j * step;
            const isBlack = (x < cx && y >= cy) || (x >= cx && y < cy);
            const v = isBlack ? 0 : 65535;
            points.push({ x, y, z: cz, intensity: 0, red: v, green: v, blue: v });
        }
    }
    return points;
}

/**
 * 境界・縦断図用：座標変換後に正面を向く白黒ターゲットを生成。
 * 平面は境界に垂直な鉛直面（法線 = (vx, vy, 0)）に置き、変換後は X'Y' 平面（Z'=const）となり正面になる。
 * @param {number} cx - 中心X
 * @param {number} cy - 中心Y
 * @param {number} cz - 中心Z
 * @param {number} halfSize - 半幅（m）
 * @param {number} ux - 境界方向X（平面内の第1軸）
 * @param {number} uy - 境界方向Y
 * @param {number} vx - 境界に垂直な水平方向X（平面の法線の水平成分）
 * @param {number} vy - 境界に垂直な水平方向Y
 * @returns {Object[]} { x, y, z, intensity, red, green, blue } の配列
 */
function generateCheckerboardTargetFacingProfile(cx, cy, cz, halfSize, ux, uy, vx, vy) {
    const points = [];
    const side = 2 * halfSize;
    const gridN = Math.max(2, Math.round(side / TARGET_PITCH) + 1);
    const step = side / (gridN - 1);
    const u0 = -halfSize;
    const v0 = -halfSize;
    for (let i = 0; i < gridN; i++) {
        for (let j = 0; j < gridN; j++) {
            const u = u0 + i * step;
            const v = v0 + j * step;
            const x = cx + u * ux;
            const y = cy + u * uy;
            const z = cz + v;
            const isBlack = (u < 0 && v >= 0) || (u >= 0 && v < 0);
            const val = isBlack ? 0 : 65535;
            points.push({ x, y, z, intensity: 0, red: val, green: val, blue: val });
        }
    }
    return points;
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
    const rgbOff = getRgbByteOffset(header.pointFormat);
    if (rgbOff < 0 || offset + rgbOff + 6 > view.buffer.byteLength) {
        return null;
    }
    return {
        red: view.getUint16(offset + rgbOff, true),
        green: view.getUint16(offset + rgbOff + 2, true),
        blue: view.getUint16(offset + rgbOff + 4, true)
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
 * バッチフィルタリング（旧版）。未使用。filterPointsBatchFast を利用すること。
 * @deprecated 互換性のため残しているが呼び出しはない。将来削除可。
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
    
    let minX = 0, maxX = 0, minY = 0, maxY = 0, minZ = 0, maxZ = 0;
    if (buffer.byteLength >= 227) {
        maxX = view.getFloat64(179, true);
        minX = view.getFloat64(187, true);
        maxY = view.getFloat64(195, true);
        minY = view.getFloat64(203, true);
        maxZ = view.getFloat64(211, true);
        minZ = view.getFloat64(219, true);
    }
    
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
        offsetZ,
        minX,
        maxX,
        minY,
        maxY,
        minZ,
        maxZ
    };
}

/**
 * ファイルサイズとストリーミング用オプションを取得（共通化）
 * @param {File|Blob} lazFile - LAZ/LAS ファイル
 * @returns {{ fileSizeMB: number, useStreaming: boolean, chunkSizeMB: number }}
 */
function getStreamingOptions(lazFile) {
    const fileSizeMB = lazFile.size / (1024 * 1024);
    const useStreaming = fileSizeMB > STREAMING_THRESHOLD_MB;
    const chunkSizeMB = parseInt(chunkSizeInput?.value, 10) || DEFAULT_CHUNK_SIZE_MB;
    return { fileSizeMB, useStreaming, chunkSizeMB };
}

/**
 * File/Blob から LAS/LAZ ヘッダーを読み込む（共通化）
 * @param {File|Blob} lazFile - LAZ/LAS ファイル
 * @returns {Promise<Object>} parseLASHeader と同じ形式のヘッダー
 */
async function readLASHeaderFromFile(lazFile) {
    const headerBlob = lazFile.slice(0, Math.min(375, lazFile.size));
    const headerBuffer = await headerBlob.arrayBuffer();
    const header = parseLASHeader(headerBuffer);
    if (header.pointDataOffset > 375) {
        const fullHeaderBlob = lazFile.slice(0, header.pointDataOffset);
        Object.assign(header, parseLASHeader(await fullHeaderBlob.arrayBuffer()));
    }
    return header;
}

/** 点(px,py)からXY範囲ボックス（minX,maxX,minY,maxY）までの最短距離。内側なら0 */
function distanceFromPointToBox(px, py, minX, maxX, minY, maxY) {
    const nx = Math.max(minX, Math.min(maxX, px));
    const ny = Math.max(minY, Math.min(maxY, py));
    return Math.sqrt((px - nx) ** 2 + (py - ny) ** 2);
}

/** ヘッダーの点群範囲と入力点A・Bの距離をログ表示し、離れていれば警告（閾値m） */
function logAndWarnDistanceToExtent(header, xA, yA, xB, yB, warnThresholdM = 50) {
    if (header.minX == null || !Number.isFinite(header.minX)) return;
    const dA = distanceFromPointToBox(xA, yA, header.minX, header.maxX, header.minY, header.maxY);
    const dB = distanceFromPointToBox(xB, yB, header.minX, header.maxX, header.minY, header.maxY);
    addLog(`点群範囲との距離（ヘッダーより）: 点A ${dA.toFixed(2)}m, 点B ${dB.toFixed(2)}m`);
    if (dA > warnThresholdM || dB > warnThresholdM) {
        addLog(`⚠️ 警告: 入力点が点群範囲から${warnThresholdM}m以上離れています。座標の取り違いや、XYが反転している可能性がないか確認してください。`);
    }
}

/**
 * LAZを1点ずつ解凍し、各点を onPoint(point) に渡す共通ループ（メモリ効率的）
 * @param {ArrayBuffer} arrayBuffer - LAZ圧縮データ
 * @param {Object} header - parseLASHeader の戻り値
 * @param {(point: {x,y,z,intensity,red?,green?,blue?}, pointIndex: number) => void} onPoint - 解凍した1点ごとに呼ばれる（第2引数は0始まりの通し番号）
 * @param {{ onProgress?: (i: number, total: number) => void, progressInterval?: number }} [opts] - 進捗コールバックなど。progressInterval を渡すと yield/進捗の間隔（点）を上書き（ポリゴンなど大量点向けに大きくすると処理が速くなる）
 */
async function decompressLAZStreaming(arrayBuffer, header, onPoint, opts = {}) {
    const fileSize = arrayBuffer.byteLength;
    const filePtr = LazPerf._malloc(fileSize);
    const fileHeap = new Uint8Array(LazPerf.HEAPU8.buffer, filePtr, fileSize);
    fileHeap.set(new Uint8Array(arrayBuffer));

    const laszip = new LazPerf.LASZip();
    laszip.open(filePtr, fileSize);

    const pointCount = header.numPoints;
    const pointRecordLength = header.pointRecordLength;
    const pointPtr = LazPerf._malloc(pointRecordLength);
    const pointHeap = new Uint8Array(LazPerf.HEAPU8.buffer, pointPtr, pointRecordLength);
    const hasRGB = RGB_FORMATS.includes(header.pointFormat);
    const rgbOffset = getRgbByteOffset(header.pointFormat);
    const view = new DataView(pointHeap.buffer, pointHeap.byteOffset, pointRecordLength);
    const onProgress = opts.onProgress;
    const progressInterval = opts.progressInterval ?? PROGRESS_UPDATE_INTERVAL;

    const point = { x: 0, y: 0, z: 0, intensity: 0 };
    if (hasRGB) point.red = point.green = point.blue = 0;

    try {
        for (let i = 0; i < pointCount; i++) {
            laszip.getPoint(pointPtr);
            const rawX = view.getInt32(0, true);
            const rawY = view.getInt32(4, true);
            const rawZ = view.getInt32(8, true);
            point.x = rawX * header.scaleX + header.offsetX;
            point.y = rawY * header.scaleY + header.offsetY;
            point.z = rawZ * header.scaleZ + header.offsetZ;
            point.intensity = view.getUint16(12, true);
            if (hasRGB && rgbOffset >= 0 && pointRecordLength >= rgbOffset + 6) {
                point.red = view.getUint16(rgbOffset, true);
                point.green = view.getUint16(rgbOffset + 2, true);
                point.blue = view.getUint16(rgbOffset + 4, true);
            }
            onPoint(point, i);
            if (onProgress && i % progressInterval === 0 && i > 0) {
                onProgress(i, pointCount);
                if (i % (progressInterval * 2) === 0) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
        }
    } finally {
        laszip.delete();
        LazPerf._free(filePtr);
        LazPerf._free(pointPtr);
    }
}

/**
 * laz-perfを使ってLAZを解凍（ストリーミング処理対応・中心抽出用）
 * 共通の decompressLAZStreaming を利用し、フィルタに合う点だけ保持する
 */
async function decompressLAZWithLazPerfStreaming(arrayBuffer, header, centers, radius, useSphere = true, useHorizontal = false) {
    prepareFilteringCache(centers, radius, useSphere, useHorizontal);
    addLog('LAZ圧縮ファイルをストリーミング解凍しています...');
    updateProgress(25, 'LAZ解凍中');

    const filteredPoints = [];
    const perfStart = performance.now();
    try {
        await decompressLAZStreaming(arrayBuffer, header, (point) => {
            if (isPointNearCenters(point.x, point.y, point.z)) {
                filteredPoints.push({ x: point.x, y: point.y, z: point.z, intensity: point.intensity, red: point.red, green: point.green, blue: point.blue });
            }
        }, {
            onProgress(i, pointCount) {
                const progress = 25 + (i / pointCount) * 65;
                updateProgress(progress, `LAZ解凍+フィルタリング: ${Math.floor((i / pointCount) * 100)}%`);
                addLog(`処理済み: ${i.toLocaleString()}/${pointCount.toLocaleString()}点, 抽出: ${filteredPoints.length.toLocaleString()}点`);
            }
        });
    } catch (err) {
        console.error('LAZ decompression error:', err);
        throw new Error(`LAZ解凍エラー: ${err.message}`);
    }
    const totalTime = performance.now() - perfStart;
    const pointsPerSec = Math.floor(header.numPoints / (totalTime / 1000)).toLocaleString();
    addLog(`LAZ解凍完了: ${header.numPoints.toLocaleString()}点`);
    addLog(`抽出点数: ${filteredPoints.length.toLocaleString()}点`);
    addLog(`⚡ 処理速度: ${pointsPerSec}点/秒`);
    return filteredPoints;
}

/**
 * LAZをストリーミング解凍して全点を配列で返す（ポリゴン・ターゲット用、解凍バッファを保持しない）
 * @param {ArrayBuffer} arrayBuffer - LAZ圧縮データ
 * @param {Object} header - parseLASHeader の戻り値
 * @returns {Promise<Array>} 点の配列
 */
async function loadLAZAsPointsStreaming(arrayBuffer, header) {
    const points = [];
    addLog('LAZをストリーミング解凍して全点読み込み中...');
    updateProgress(25, 'LAZ解凍中');
    await decompressLAZStreaming(arrayBuffer, header, (point) => {
        points.push({ x: point.x, y: point.y, z: point.z, intensity: point.intensity, red: point.red, green: point.green, blue: point.blue });
    }, {
        onProgress(i, pointCount) {
            const progress = 25 + (i / pointCount) * 65;
            updateProgress(progress, `LAZ解凍: ${Math.floor((i / pointCount) * 100)}%`);
            if (i % LOG_UPDATE_INTERVAL === 0 || i === pointCount) {
                addLog(`読込: ${i.toLocaleString()}/${pointCount.toLocaleString()}点`);
            }
        }
    });
    addLog(`読込: ${points.length.toLocaleString()}点`);
    return points;
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
            
            // RGB情報がある場合（フォーマット別オフセット）
            const hasRGB = RGB_FORMATS.includes(header.pointFormat);
            const rgbOff = getRgbByteOffset(header.pointFormat);
            if (hasRGB && rgbOff >= 0 && chunkOffset + rgbOff + 6 <= chunkBuffer.byteLength) {
                point.red = view.getUint16(chunkOffset + rgbOff, true);
                point.green = view.getUint16(chunkOffset + rgbOff + 2, true);
                point.blue = view.getUint16(chunkOffset + rgbOff + 4, true);
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

/**
 * 非圧縮LASをストリーミングで全点読み込み（フィルタなし・座標系変換用）
 */
async function processLASStreamingAllPoints(file, header, chunkSizeMB = DEFAULT_CHUNK_SIZE_MB) {
    const allPoints = [];
    const pointRecordLength = header.pointRecordLength;
    const pointDataOffset = header.pointDataOffset;
    const numPoints = header.numPoints;
    const chunkSizeBytes = chunkSizeMB * 1024 * 1024;
    const pointsPerChunk = Math.floor(chunkSizeBytes / pointRecordLength);
    const hasRGB = RGB_FORMATS.includes(header.pointFormat);
    const rgbOff = getRgbByteOffset(header.pointFormat);
    let currentPointIndex = 0;
    let currentOffset = pointDataOffset;

    while (currentPointIndex < numPoints) {
        const remainingPoints = numPoints - currentPointIndex;
        const pointsInThisChunk = Math.min(pointsPerChunk, remainingPoints);
        const chunkSize = pointsInThisChunk * pointRecordLength;
        const chunkBlob = file.slice(currentOffset, currentOffset + chunkSize);
        const chunkBuffer = await chunkBlob.arrayBuffer();
        const view = new DataView(chunkBuffer);
        let chunkOffset = 0;

        for (let i = 0; i < pointsInThisChunk; i++) {
            if (chunkOffset + 20 > chunkBuffer.byteLength) break;
            const rawX = view.getInt32(chunkOffset, true);
            const rawY = view.getInt32(chunkOffset + 4, true);
            const rawZ = view.getInt32(chunkOffset + 8, true);
            const x = rawX * header.scaleX + header.offsetX;
            const y = rawY * header.scaleY + header.offsetY;
            const z = rawZ * header.scaleZ + header.offsetZ;
            const point = { x, y, z, intensity: view.getUint16(chunkOffset + 12, true) };
            if (hasRGB && rgbOff >= 0 && chunkOffset + rgbOff + 6 <= chunkBuffer.byteLength) {
                point.red = view.getUint16(chunkOffset + rgbOff, true);
                point.green = view.getUint16(chunkOffset + rgbOff + 2, true);
                point.blue = view.getUint16(chunkOffset + rgbOff + 4, true);
            }
            allPoints.push(point);
            chunkOffset += pointRecordLength;
            currentPointIndex++;
        }
        currentOffset += chunkSize;
        if (currentPointIndex % PROGRESS_UPDATE_INTERVAL === 0 || currentPointIndex === numPoints) {
            const progress = 20 + (currentPointIndex / numPoints) * 50;
            updateProgress(progress, `読込: ${currentPointIndex.toLocaleString()}/${numPoints.toLocaleString()}点`);
            addLog(`読込: ${currentPointIndex.toLocaleString()}点`);
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    return allPoints;
}

/**
 * 非圧縮LASをストリーミングで「切抜幅」適用しつつ縦断図座標へ変換
 * 返す点は既に (X=境界方向, Y=標高, Z=奥行) に変換済み
 */
async function processLASStreamingClipAndTransform(file, header, xA, yA, ux, uy, vx, vy, halfWidth, chunkSizeMB = DEFAULT_CHUNK_SIZE_MB) {
    const outPoints = [];
    const pointRecordLength = header.pointRecordLength;
    const pointDataOffset = header.pointDataOffset;
    const numPoints = header.numPoints;
    const chunkSizeBytes = chunkSizeMB * 1024 * 1024;
    const pointsPerChunk = Math.floor(chunkSizeBytes / pointRecordLength);
    const hasRGB = RGB_FORMATS.includes(header.pointFormat);
    const rgbOff = getRgbByteOffset(header.pointFormat);
    let currentPointIndex = 0;
    let currentOffset = pointDataOffset;

    while (currentPointIndex < numPoints) {
        const remainingPoints = numPoints - currentPointIndex;
        const pointsInThisChunk = Math.min(pointsPerChunk, remainingPoints);
        const chunkSize = pointsInThisChunk * pointRecordLength;
        const chunkBlob = file.slice(currentOffset, currentOffset + chunkSize);
        const chunkBuffer = await chunkBlob.arrayBuffer();
        const view = new DataView(chunkBuffer);
        let chunkOffset = 0;

        for (let i = 0; i < pointsInThisChunk; i++) {
            if (chunkOffset + 20 > chunkBuffer.byteLength) break;
            const rawX = view.getInt32(chunkOffset, true);
            const rawY = view.getInt32(chunkOffset + 4, true);
            const rawZ = view.getInt32(chunkOffset + 8, true);
            const x = rawX * header.scaleX + header.offsetX;
            const y = rawY * header.scaleY + header.offsetY;
            const z = rawZ * header.scaleZ + header.offsetZ;

            const t = clipAndTransformToProfile(x, y, z, xA, yA, ux, uy, vx, vy, halfWidth);
            if (t) {
                const p = { x: t.x, y: t.y, z: t.z, intensity: view.getUint16(chunkOffset + 12, true) };
                if (hasRGB && rgbOff >= 0 && chunkOffset + rgbOff + 6 <= chunkBuffer.byteLength) {
                    p.red = view.getUint16(chunkOffset + rgbOff, true);
                    p.green = view.getUint16(chunkOffset + rgbOff + 2, true);
                    p.blue = view.getUint16(chunkOffset + rgbOff + 4, true);
                }
                outPoints.push(p);
            }

            chunkOffset += pointRecordLength;
            currentPointIndex++;
        }

        currentOffset += chunkSize;
        if (currentPointIndex % PROGRESS_UPDATE_INTERVAL === 0 || currentPointIndex === numPoints) {
            const progress = 20 + (currentPointIndex / numPoints) * 50;
            updateProgress(progress, `切抜+変換: ${currentPointIndex.toLocaleString()}/${numPoints.toLocaleString()}点`);
            addLog(`処理済み: ${currentPointIndex.toLocaleString()}点, 出力: ${outPoints.length.toLocaleString()}点`);
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    return outPoints;
}

/**
 * LAZを解凍しつつ「切抜幅」適用し、縦断図座標へ変換（ポイント単位）
 */
async function decompressLAZClipAndTransform(arrayBuffer, header, xA, yA, ux, uy, vx, vy, halfWidth) {
    addLog('LAZを解凍し、切抜幅を適用して縦断図座標へ変換しています...');
    updateProgress(25, 'LAZ解凍+切抜+変換中');
    const outPoints = [];

    const fileSize = arrayBuffer.byteLength;
    const filePtr = LazPerf._malloc(fileSize);
    const fileHeap = new Uint8Array(LazPerf.HEAPU8.buffer, filePtr, fileSize);
    fileHeap.set(new Uint8Array(arrayBuffer));
    const laszip = new LazPerf.LASZip();
    laszip.open(filePtr, fileSize);

    const pointCount = header.numPoints;
    const pointRecordLength = header.pointRecordLength;
    const pointPtr = LazPerf._malloc(pointRecordLength);
    const pointHeap = new Uint8Array(LazPerf.HEAPU8.buffer, pointPtr, pointRecordLength);
    const pointCopy = new ArrayBuffer(pointRecordLength);
    const copyView = new Uint8Array(pointCopy);
    const view = new DataView(pointCopy);
    const hasRGB = RGB_FORMATS.includes(header.pointFormat);
    const rgbOffset = getRgbByteOffset(header.pointFormat);

    for (let i = 0; i < pointCount; i++) {
        laszip.getPoint(pointPtr);
        copyView.set(pointHeap);

        const rawX = view.getInt32(0, true);
        const rawY = view.getInt32(4, true);
        const rawZ = view.getInt32(8, true);
        const x = rawX * header.scaleX + header.offsetX;
        const y = rawY * header.scaleY + header.offsetY;
        const z = rawZ * header.scaleZ + header.offsetZ;

        const t = clipAndTransformToProfile(x, y, z, xA, yA, ux, uy, vx, vy, halfWidth);
        if (t) {
            const p = { x: t.x, y: t.y, z: t.z, intensity: view.getUint16(12, true) };
            if (hasRGB && rgbOffset >= 0 && pointRecordLength >= rgbOffset + 6) {
                p.red = view.getUint16(rgbOffset, true);
                p.green = view.getUint16(rgbOffset + 2, true);
                p.blue = view.getUint16(rgbOffset + 4, true);
            }
            outPoints.push(p);
        }

        if (i % PROGRESS_UPDATE_INTERVAL === 0 && i > 0) {
            const progress = 25 + (i / pointCount) * 65;
            updateProgress(progress, `LAZ解凍+切抜+変換: ${Math.floor((i / pointCount) * 100)}%`);
            addLog(`処理済み: ${i.toLocaleString()}/${pointCount.toLocaleString()}点, 出力: ${outPoints.length.toLocaleString()}点`);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    laszip.delete();
    LazPerf._free(filePtr);
    LazPerf._free(pointPtr);
    addLog(`LAZ解凍+切抜+変換完了: 出力${outPoints.length.toLocaleString()}点`);
    return outPoints;
}

// ============================================================================
// LASファイル処理関数
// ============================================================================

/**
 * 非圧縮LASから全点を読み込む（フィルタなし・座標系変換用）
 */
function readAllPointsFromLASBuffer(buffer, header) {
    const view = new DataView(buffer);
    let offset = header.pointDataOffset;
    const points = [];
    const hasRGB = RGB_FORMATS.includes(header.pointFormat);
    const rgbOff = getRgbByteOffset(header.pointFormat);
    const pointRecordLength = header.pointRecordLength;
    const numPoints = header.numPoints;

    for (let i = 0; i < numPoints; i++) {
        if (offset + pointRecordLength > buffer.byteLength) break;
        const rawX = view.getInt32(offset, true);
        const rawY = view.getInt32(offset + 4, true);
        const rawZ = view.getInt32(offset + 8, true);
        const x = rawX * header.scaleX + header.offsetX;
        const y = rawY * header.scaleY + header.offsetY;
        const z = rawZ * header.scaleZ + header.offsetZ;
        const point = { x, y, z, intensity: view.getUint16(offset + 12, true) };
        if (hasRGB && rgbOff >= 0 && offset + rgbOff + 6 <= buffer.byteLength) {
            point.red = view.getUint16(offset + rgbOff, true);
            point.green = view.getUint16(offset + rgbOff + 2, true);
            point.blue = view.getUint16(offset + rgbOff + 4, true);
        }
        points.push(point);
        offset += pointRecordLength;
    }
    return points;
}

/**
 * 非圧縮LAS読み込み（ジェネレータ）
 */
function* readUncompressedLAS(buffer, header) {
    const view = new DataView(buffer);
    let offset = header.pointDataOffset;
    const points = [];
    const batchSize = 100000;
    
    // RGB情報があるフォーマットかチェック（フォーマット別オフセット）
    const hasRGB = RGB_FORMATS.includes(header.pointFormat);
    const rgbOff = getRgbByteOffset(header.pointFormat);
    
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
        
        if (hasRGB && rgbOff >= 0 && offset + rgbOff + 6 <= buffer.byteLength) {
            point.red = view.getUint16(offset + rgbOff, true);
            point.green = view.getUint16(offset + rgbOff + 2, true);
            point.blue = view.getUint16(offset + rgbOff + 4, true);
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
const LAS_HEADER_SIZE = 227;
/** ポリゴンストリーミング出力の1チャンクサイズ（バイト）。ArrayBufferの2GB制限を避けるため、点データを分割して書き出す。26の倍数。 */
const POLYGON_STREAM_CHUNK_BYTES = 52 * 1024 * 1024; // 52MB ≒ 200万点/チャンク

/**
 * 1点をLAS点レコードとしてDataViewの指定オフセットに書き込む（ストリーミング出力用）
 * @param {DataView} view - 出力バッファのDataView
 * @param {number} offset - 書き込み開始バイト位置
 * @param {{x,y,z,intensity?,red?,green?,blue?,classification?}} point - 点データ
 * @param {number} pointRecordLength - 20 または 26
 * @param {boolean} hasRGB - Format 2 の場合 true
 * @param {number} originX - 座標差分の基準X
 * @param {number} originY - 座標差分の基準Y
 * @param {number} originZ - 座標差分の基準Z
 */
function writeSinglePointToLASView(view, offset, point, pointRecordLength, hasRGB, originX, originY, originZ) {
    const scale = 0.001;
    const x = Math.round((point.x - originX) / scale);
    const y = Math.round((point.y - originY) / scale);
    const z = Math.round((point.z - originZ) / scale);
    view.setInt32(offset, x, true);
    view.setInt32(offset + 4, y, true);
    view.setInt32(offset + 8, z, true);
    view.setUint16(offset + 12, point.intensity || 0, true);
    view.setUint8(offset + 14, 0);
    view.setUint8(offset + 15, (point.classification !== undefined && point.classification !== null) ? point.classification : 0);
    view.setInt8(offset + 16, 0);
    view.setUint8(offset + 17, 0);
    view.setUint16(offset + 18, 0, true);
    if (hasRGB) {
        view.setUint16(offset + 20, point.red || 0, true);
        view.setUint16(offset + 22, point.green || 0, true);
        view.setUint16(offset + 24, point.blue || 0, true);
    }
}

/**
 * ストリーミング出力用にLASヘッダー（227バイト）をviewの先頭に書き込む
 */
function buildLASHeaderForStreamedOutput(view, pointCount, pointFormat, pointRecordLength, firstPoint, minX, maxX, minY, maxY, minZ, maxZ) {
    const signature = new TextEncoder().encode('LASF');
    for (let i = 0; i < 4; i++) view.setUint8(i, signature[i]);
    view.setUint8(24, 1);
    view.setUint8(25, 2);
    view.setUint16(94, LAS_HEADER_SIZE, true);
    view.setUint32(96, LAS_HEADER_SIZE, true);
    view.setUint32(100, 0, true);
    view.setUint8(104, pointFormat);
    view.setUint16(105, pointRecordLength, true);
    view.setUint32(107, pointCount, true);
    view.setFloat64(131, 0.001, true);
    view.setFloat64(139, 0.001, true);
    view.setFloat64(147, 0.001, true);
    if (firstPoint) {
        view.setFloat64(155, firstPoint.x, true);
        view.setFloat64(163, firstPoint.y, true);
        view.setFloat64(171, firstPoint.z, true);
    }
    view.setFloat64(179, maxX, true);
    view.setFloat64(187, minX, true);
    view.setFloat64(195, maxY, true);
    view.setFloat64(203, minY, true);
    view.setFloat64(211, maxZ, true);
    view.setFloat64(219, minZ, true);
}

/**
 * LAZをストリーミング解凍し、1点ずつ onPoint で処理しながらチャンクに書き出し、LAS の Blob を返す。
 * ポリゴンSIMA・立面図のLAZ経路で共通利用。
 * @param {ArrayBuffer} arrayBuffer - LAZ圧縮データ
 * @param {Object} header - parseLASHeader の戻り値
 * @param {{ onPoint: (p: object, i: number) => void, onProgress?: (i: number, total: number) => void, progressInterval?: number, extraPoints?: Array<{x,y,z,intensity?,red?,green?,blue?,classification?}> }} options
 * @returns {Promise<Blob>}
 */
async function streamLAZToLASBlob(arrayBuffer, header, options) {
    const onPoint = options.onPoint;
    const onProgress = options.onProgress;
    const progressInterval = options.progressInterval ?? PROGRESS_UPDATE_INTERVAL;
    const extraPoints = options.extraPoints ?? [];

    const hasRGB = RGB_FORMATS.includes(header.pointFormat);
    const pointRecordLength = hasRGB ? 26 : 20;
    const pointFormat = hasRGB ? 2 : 0;
    const chunkBytes = Math.floor(POLYGON_STREAM_CHUNK_BYTES / pointRecordLength) * pointRecordLength;
    const pointChunks = [];
    let currentChunk = new ArrayBuffer(chunkBytes);
    let currentView = new DataView(currentChunk);
    let offsetInChunk = 0;
    let firstPoint = null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

    function writeOnePoint(p, originX, originY, originZ) {
        if (offsetInChunk + pointRecordLength > chunkBytes) {
            pointChunks.push(currentChunk);
            currentChunk = new ArrayBuffer(chunkBytes);
            currentView = new DataView(currentChunk);
            offsetInChunk = 0;
        }
        writeSinglePointToLASView(currentView, offsetInChunk, p, pointRecordLength, hasRGB, originX, originY, originZ);
        offsetInChunk += pointRecordLength;
    }

    function updateMinMax(p) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
    }

    await decompressLAZStreaming(arrayBuffer, header, (p, i) => {
        onPoint(p, i);
        if (i === 0) {
            firstPoint = { x: p.x, y: p.y, z: p.z };
            minX = maxX = p.x;
            minY = maxY = p.y;
            minZ = maxZ = p.z;
        } else {
            updateMinMax(p);
        }
        const originX = firstPoint.x;
        const originY = firstPoint.y;
        const originZ = firstPoint.z;
        writeOnePoint(p, originX, originY, originZ);
    }, { onProgress, progressInterval });

    for (const p of extraPoints) {
        if (!firstPoint) firstPoint = { x: p.x, y: p.y, z: p.z };
        updateMinMax(p);
        writeOnePoint(p, firstPoint.x, firstPoint.y, firstPoint.z);
    }

    if (offsetInChunk > 0) pointChunks.push(currentChunk.slice(0, offsetInChunk));

    const pointCount = header.numPoints + extraPoints.length;
    if (!Number.isFinite(minX)) {
        minX = Number.isFinite(header.minX) ? header.minX : 0;
        maxX = Number.isFinite(header.maxX) ? header.maxX : 0;
        minY = Number.isFinite(header.minY) ? header.minY : 0;
        maxY = Number.isFinite(header.maxY) ? header.maxY : 0;
        minZ = Number.isFinite(header.minZ) ? header.minZ : 0;
        maxZ = Number.isFinite(header.maxZ) ? header.maxZ : 0;
    }
    const headerBuf = new ArrayBuffer(LAS_HEADER_SIZE);
    const headerView = new DataView(headerBuf);
    buildLASHeaderForStreamedOutput(headerView, pointCount, pointFormat, pointRecordLength, firstPoint, minX, maxX, minY, maxY, minZ, maxZ);
    return new Blob([headerBuf, ...pointChunks], { type: 'application/octet-stream' });
}

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
        view.setUint8(offset + 15, (point.classification !== undefined && point.classification !== null) ? point.classification : 0);
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
// 境界基準座標系変換のメイン処理
// ============================================================================

/**
 * ポリゴン [[x,y],...] の重心（XY）を返す。
 */
function polygonCentroid(poly) {
    if (!poly || poly.length === 0) return [0, 0];
    let sx = 0, sy = 0;
    for (const [x, y] of poly) {
        sx += x;
        sy += y;
    }
    return [sx / poly.length, sy / poly.length];
}

/**
 * SIMAの全辺について範囲クロップポリゴンを生成（各辺で左右1m・下1m・上100m、上方向はポリゴン外側向き）。
 */
async function processBoundaryClipPolygonFromSim() {
    try {
        if (!simFile || !simFile.name) {
            throw new Error('SIMA形式（.sim）ファイルを選択してください。');
        }
        const text = await simFile.text();
        const poly = parseSim(text);
        if (!poly || poly.length < 3) {
            throw new Error('SIMAから有効なポリゴン（3頂点以上）を取得できませんでした。');
        }

        const centroid = polygonCentroid(poly);
        const marginM = 1;
        const marginUpM = 100;
        const allClipPolygons = [];
        const n = poly.length;

        for (let i = 0; i < n; i++) {
            const A = poly[i];
            const B = poly[(i + 1) % n];
            let xA = A[0], yA = A[1], xB = B[0], yB = B[1];
            let axes = computeBoundaryAxes(xA, yA, xB, yB, true);
            if (!axes) continue;
            const { vx, vy } = axes;
            const midX = (xA + xB) / 2, midY = (yA + yB) / 2;
            const dot = (centroid[0] - midX) * vx + (centroid[1] - midY) * vy;
            if (dot > 0) {
                axes = computeBoundaryAxes(xB, yB, xA, yA, true);
                if (!axes) continue;
                xA = B[0];
                yA = B[1];
                xB = A[0];
                yB = A[1];
            }
            const clipPoly = getBoundaryClipPolygon(xA, yA, xB, yB, axes, marginM, marginUpM);
            allClipPolygons.push({ edgeIndex: i, A: [...A], B: [...B], polygon: clipPoly });
        }

        processBtn.disabled = true;
        progressSection.classList.add('active');
        resultSection.classList.add('active');
        logDiv.innerHTML = '';
        addLog('範囲クロップポリゴン（SIMA全辺）');
        addLog(`頂点数: ${n}, 辺数: ${n}, 余裕: 左右・下 ${marginM}m, 上 ${marginUpM}m`);
        allClipPolygons.forEach(({ edgeIndex, A, B, polygon }) => {
            addLog(`辺${edgeIndex}: (${A[0]},${A[1]})→(${B[0]},${B[1]})`);
            polygon.forEach((pt, j) => addLog(`  P${j}: ${pt[0]}, ${pt[1]}`));
        });

        const edgeLabel = (i) => (i < 26 ? String.fromCharCode(65 + i) : `E${i - 25}`);
        const rows = [];
        let globalIndex = 1;
        for (const { edgeIndex, polygon } of allClipPolygons) {
            const labelBase = edgeLabel(edgeIndex);
            for (let j = 0; j < polygon.length; j++) {
                rows.push(`${globalIndex},${labelBase}${j + 1},${polygon[j][0]},${polygon[j][1]}`);
                globalIndex++;
            }
        }
        const coordsText = rows.join('\n');
        resultText.innerHTML = `
            範囲クロップポリゴン（SIMA全辺・${n}本）を生成しました。<br>
            <label style="display:block; margin-top:10px; font-weight:600;">出力（番号,ラベル,x,y）コピー用:</label>
            <textarea id="clipPolygonSimCoordsCopy" readonly rows="14" style="width:100%; margin-top:4px; font-family:monospace; font-size:13px; padding:8px; box-sizing:border-box;"></textarea>
        `;
        const ta = document.getElementById('clipPolygonSimCoordsCopy');
        if (ta) ta.value = coordsText;
        if (downloadBtn) downloadBtn.style.display = 'none';
        if (downloadCsvBtn) downloadCsvBtn.style.display = 'none';
        addLog('✅ 完了');
    } catch (err) {
        console.error(err);
        addLog(`❌ エラー: ${err.message}`);
        alert(`エラー: ${err.message}`);
    } finally {
        processBtn.disabled = false;
    }
}

/**
 * 範囲クロップポリゴン生成を実行（単独機能）。A・Bと向きから四角形ポリゴン座標を算出し表示する。
 */
function processBoundaryClipPolygon() {
    try {
        const xA = parseFloat(document.getElementById('pointAX').value);
        const yA = parseFloat(document.getElementById('pointAY').value);
        const xB = parseFloat(document.getElementById('pointBX').value);
        const yB = parseFloat(document.getElementById('pointBY').value);
        const aLeftBRight = (document.getElementById('boundaryDirection').value === 'aLeftBRight');
        if ([xA, yA, xB, yB].some(Number.isNaN)) {
            throw new Error('境界点A・BのXY座標を数値で入力してください。');
        }
        const axes = computeBoundaryAxes(xA, yA, xB, yB, aLeftBRight);
        if (!axes) {
            throw new Error('点Aと点Bが同一です。異なる2点を指定してください。');
        }
        const polygon = getBoundaryClipPolygon(xA, yA, xB, yB, axes);

        processBtn.disabled = true;
        progressSection.classList.add('active');
        resultSection.classList.add('active');
        logDiv.innerHTML = '';
        addLog('範囲クロップポリゴン生成');
        addLog(`A=(${xA}, ${yA}), B=(${xB}, ${yB}), 向き: ${aLeftBRight ? 'A→B' : 'B→A'}`);
        addLog(`余裕: 左右・下 1m, 上 100m`);
        addLog(`ポリゴン頂点（P0→P1→P2→P3）:`);
        polygon.forEach((pt, i) => addLog(`  P${i}: ${pt[0]}, ${pt[1]}`));

        const coordsText = polygon.map(pt => `${pt[0]}, ${pt[1]}`).join('\n');
        resultText.innerHTML = `
            範囲クロップポリゴン（4頂点）を生成しました。<br>
            <label style="display:block; margin-top:10px; font-weight:600;">ポリゴン座標（コピー用） [[x,y], ...] 形式:</label>
            <textarea id="clipPolygonCoordsCopy" readonly rows="6" style="width:100%; margin-top:4px; font-family:monospace; font-size:13px; padding:8px; box-sizing:border-box;"></textarea>
        `;
        const ta = document.getElementById('clipPolygonCoordsCopy');
        if (ta) ta.value = coordsText;
        if (downloadBtn) downloadBtn.style.display = 'none';
        if (downloadCsvBtn) downloadCsvBtn.style.display = 'none';
        addLog('✅ 完了');
    } catch (err) {
        console.error(err);
        addLog(`❌ エラー: ${err.message}`);
        alert(`エラー: ${err.message}`);
    } finally {
        processBtn.disabled = false;
    }
}

/**
 * 立面図作成を実行（境界の内側から外側を見通す座標系に変換・LAS出力）
 */
async function processBoundaryTransform() {
    try {
        if (!wasmReady || !LazPerf) {
            throw new Error('LAZ解凍エンジンが初期化されていません。ページをリロードしてください。');
        }
        const xA = parseFloat(document.getElementById('pointAX').value);
        const yA = parseFloat(document.getElementById('pointAY').value);
        const zA = parseFloat(document.getElementById('pointAZ').value) || 0;
        const xB = parseFloat(document.getElementById('pointBX').value);
        const yB = parseFloat(document.getElementById('pointBY').value);
        const zB = parseFloat(document.getElementById('pointBZ').value) || 0;
        const aLeftBRight = (document.getElementById('boundaryDirection').value === 'aLeftBRight');
        if ([xA, yA, xB, yB].some(Number.isNaN)) {
            throw new Error('境界点A・BのXY座標を数値で入力してください。Zは省略時0です。');
        }
        const axes = computeBoundaryAxes(xA, yA, xB, yB, aLeftBRight);
        if (!axes) {
            throw new Error('点Aと点Bが同一です。異なる2点を指定してください。');
        }
        const { ux, uy, vx, vy } = axes;

        processBtn.disabled = true;
        progressSection.classList.add('active');
        resultSection.classList.remove('active');
        logDiv.innerHTML = '';
        addLog('立面図作成を開始します...');
        updateProgress(0, '初期化中');

        const header = await readLASHeaderFromFile(lazFile);
        addLog(`総点数: ${header.numPoints.toLocaleString()}点`);
        addLog(`原点A=(${xA}, ${yA}, ${zA}), 境界B=(${xB}, ${yB}, ${zB}), 向き: ${aLeftBRight ? 'A→B（A左・B右）' : 'B→A（B左・A右）'}`);
        logAndWarnDistanceToExtent(header, xA, yA, xB, yB);
        updateProgress(10, 'ヘッダー解析完了');

        let points = [];
        let boundaryOutputBlob = null; // LAZ経路でストリーム出力した場合のBlob
        const { fileSizeMB, useStreaming, chunkSizeMB } = getStreamingOptions(lazFile);
        const SPHERE_RADIUS = 0.01;
        const SPHERE_POINTS = 50;
        const useTargetMarker = document.querySelector('input[name="boundaryMarker"]:checked')?.value === 'target';
        const targetHalf = (parseFloat(document.getElementById('boundaryTargetSize')?.value) || 0.1);
        let markerPointsA, markerPointsB;
        if (useTargetMarker) {
            markerPointsA = generateCheckerboardTargetFacingProfile(xA, yA, zA, targetHalf, ux, uy, vx, vy);
            markerPointsB = generateCheckerboardTargetFacingProfile(xB, yB, zB, targetHalf, ux, uy, vx, vy);
        } else {
            markerPointsA = generateSpherePointCloud(xA, yA, zA, SPHERE_RADIUS, SPHERE_POINTS, true);
            markerPointsB = generateSpherePointCloud(xB, yB, zB, SPHERE_RADIUS, SPHERE_POINTS, true);
        }
        const markerCount = markerPointsA.length + markerPointsB.length;

        if (header.isCompressed) {
            addLog('LAZをストリーミング解凍し、境界基準座標に変換してLASに書き出しています...');
            const arrayBuffer = await lazFile.arrayBuffer();
            const extraPoints = [];
            for (const p of [...markerPointsA, ...markerPointsB]) {
                const t = transformPointBoundary(p.x, p.y, p.z, xA, yA, ux, uy, vx, vy);
                extraPoints.push({ x: t.x, y: t.y, z: t.z, intensity: p.intensity ?? 0, red: p.red, green: p.green, blue: p.blue });
            }
            boundaryOutputBlob = await streamLAZToLASBlob(arrayBuffer, header, {
                onPoint(p, i) {
                    const t = transformPointBoundary(p.x, p.y, p.z, xA, yA, ux, uy, vx, vy);
                    p.x = t.x;
                    p.y = t.y;
                    p.z = t.z;
                },
                onProgress(i, pointCount) {
                    const progress = 25 + (i / pointCount) * 65;
                    updateProgress(progress, `解凍+変換: ${i.toLocaleString()}/${pointCount.toLocaleString()}点`);
                    if (i % LOG_UPDATE_INTERVAL === 0 || i === pointCount) {
                        addLog(`処理: ${i.toLocaleString()}/${pointCount.toLocaleString()}点`);
                    }
                },
                extraPoints
            });
            if (useTargetMarker) {
                addLog(`白黒ターゲットを追加: A・B各中心（半幅${targetHalf}m・正面向き）、合計+${extraPoints.length}点`);
            } else {
                addLog(`スフィア点群を追加: A・B各${SPHERE_POINTS}点（半径${SPHERE_RADIUS}m・マゼンタ）、合計+${extraPoints.length}点`);
            }
        } else if (useStreaming) {
            addLog('非圧縮LASをストリーミングで全点読み込み中...');
            points = await processLASStreamingAllPoints(lazFile, header, chunkSizeMB);
            points.push(...markerPointsA, ...markerPointsB);
            if (useTargetMarker) addLog(`白黒ターゲットを追加: A・B各中心（半幅${targetHalf}m）、座標変換前に追加`);
            else addLog(`スフィア点群を追加: A・B各${SPHERE_POINTS}点（半径${SPHERE_RADIUS}m・マゼンタ）、座標変換前に追加`);
            addLog('座標変換を適用しています...');
            updateProgress(75, '座標変換中');
            transformPointsBoundary(points, xA, yA, ux, uy, vx, vy);
        } else {
            addLog('LASファイルを読み込んでいます...');
            const arrayBuffer = await lazFile.arrayBuffer();
            updateProgress(20, '読込中');
            points = readAllPointsFromLASBuffer(arrayBuffer, header);
            addLog(`読込: ${points.length.toLocaleString()}点`);
            points.push(...markerPointsA, ...markerPointsB);
            if (useTargetMarker) addLog(`白黒ターゲットを追加: A・B各中心（半幅${targetHalf}m）、座標変換前に追加`);
            else addLog(`スフィア点群を追加: A・B各${SPHERE_POINTS}点（半径${SPHERE_RADIUS}m・マゼンタ）、座標変換前に追加`);
            addLog('座標変換を適用しています...');
            updateProgress(70, '座標変換中');
            transformPointsBoundary(points, xA, yA, ux, uy, vx, vy);
        }

        let blob;
        let totalPoints;
        if (boundaryOutputBlob) {
            updateProgress(95, 'LAS出力完了');
            blob = boundaryOutputBlob;
            totalPoints = header.numPoints + markerCount;
        } else {
            for (const p of points) ensurePointRGB(p);
            const scaleYInput = parseFloat(document.getElementById('scaleY')?.value);
            const scaleYVal = (Number.isFinite(scaleYInput) && scaleYInput > 0) ? scaleYInput : 1;
            if (scaleYVal !== 1) {
                scaleYPoints(points, scaleYVal);
                addLog(`標高の強調適用: ${scaleYVal}倍`);
            }
            updateProgress(95, 'LAS出力生成中');
            const outputLasBuffer = createLASFile(points, header);
            blob = new Blob([outputLasBuffer], { type: 'application/octet-stream' });
            totalPoints = points.length;
        }
        updateProgress(100, '完了');

        const url = URL.createObjectURL(blob);
        if (downloadBtn) {
            downloadBtn.style.display = '';
            downloadBtn.href = url;
            downloadBtn.download = 'output_boundary.las';
        }
        resultSection.classList.add('active');
        resultText.innerHTML = `
            立面図作成が完了しました。<br>
            出力点数: ${totalPoints.toLocaleString()}点（元点群＋A・Bマーカー${markerCount}点）<br>
            ファイルサイズ: ${formatFileSize(blob.size)}<br>
            <small>出力XY=立面（X=境界方向, Y=標高）, Z=奥行。XY平面表示で立面図になります。</small>
        `;
        if (downloadCsvBtn) downloadCsvBtn.style.display = 'none';
        addLog('✅ 立面図作成が完了しました。');
    } catch (err) {
        console.error(err);
        addLog(`❌ エラー: ${err.message}`);
        alert(`エラー: ${err.message}`);
    } finally {
        processBtn.disabled = false;
    }
}

// ============================================================================
// 縦断・横断図作成モード（切抜幅→座標変換）
// ============================================================================

/**
 * AB直線（無限長）に対して切抜幅（±）で点群を切り抜き、縦断図座標へ変換してLAS出力
 * - 切抜判定はオリジナル座標系で |Y'| <= width
 * - 出力はXY平面=縦断図（X=境界方向, Y=標高, Z=奥行）
 * - スフィア（A/B中心、半径0.01、各50点、マゼンタ16bit）を追加（同じく切抜後に残るものを出力）
 */
async function processSectionMode() {
    try {
        if (!wasmReady || !LazPerf) {
            throw new Error('LAZ解凍エンジンが初期化されていません。ページをリロードしてください。');
        }

        const xA = parseFloat(document.getElementById('pointAX').value);
        const yA = parseFloat(document.getElementById('pointAY').value);
        const zA = parseFloat(document.getElementById('pointAZ').value) || 0;
        const xB = parseFloat(document.getElementById('pointBX').value);
        const yB = parseFloat(document.getElementById('pointBY').value);
        const zB = parseFloat(document.getElementById('pointBZ').value) || 0;
        const aLeftBRight = (document.getElementById('boundaryDirection').value === 'aLeftBRight');
        const halfWidth = parseFloat(document.getElementById('clipWidth')?.value) || 0.01;

        if ([xA, yA, xB, yB].some(Number.isNaN)) {
            throw new Error('点A・BのXY座標を数値で入力してください。Zは省略時0です。');
        }
        if (!(halfWidth > 0)) {
            throw new Error('切抜幅は0より大きい数値を指定してください（例: 0.01）。');
        }

        const axes = computeBoundaryAxes(xA, yA, xB, yB, aLeftBRight);
        if (!axes) throw new Error('点Aと点Bが同一です。異なる2点を指定してください。');
        const { ux, uy, vx, vy } = axes;

        processBtn.disabled = true;
        progressSection.classList.add('active');
        resultSection.classList.remove('active');
        logDiv.innerHTML = '';
        addLog('縦断・横断図作成（切抜→変換）を開始します...');
        addLog(`A=(${xA}, ${yA}, ${zA}), B=(${xB}, ${yB}, ${zB}), 向き: ${aLeftBRight ? 'A→B' : 'B→A'}, 切抜幅: ±${halfWidth}m`);
        updateProgress(0, '初期化中');

        const header = await readLASHeaderFromFile(lazFile);
        addLog(`総点数: ${header.numPoints.toLocaleString()}点`);
        logAndWarnDistanceToExtent(header, xA, yA, xB, yB);
        updateProgress(10, 'ヘッダー解析完了');

        const { fileSizeMB, useStreaming, chunkSizeMB } = getStreamingOptions(lazFile);
        const SPHERE_RADIUS = 0.01;
        const SPHERE_POINTS = 50;
        const useTargetMarker = document.querySelector('input[name="boundaryMarker"]:checked')?.value === 'target';
        const targetHalf = (parseFloat(document.getElementById('boundaryTargetSize')?.value) || 0.1);
        let markerPointsA, markerPointsB;
        if (useTargetMarker) {
            markerPointsA = generateCheckerboardTargetFacingProfile(xA, yA, zA, targetHalf, ux, uy, vx, vy);
            markerPointsB = generateCheckerboardTargetFacingProfile(xB, yB, zB, targetHalf, ux, uy, vx, vy);
        } else {
            markerPointsA = generateSpherePointCloud(xA, yA, zA, SPHERE_RADIUS, SPHERE_POINTS, true);
            markerPointsB = generateSpherePointCloud(xB, yB, zB, SPHERE_RADIUS, SPHERE_POINTS, true);
        }

        let outPoints = [];

        if (header.isCompressed) {
            const arrayBuffer = await lazFile.arrayBuffer();
            outPoints = await decompressLAZClipAndTransform(arrayBuffer, header, xA, yA, ux, uy, vx, vy, halfWidth);
        } else if (useStreaming) {
            outPoints = await processLASStreamingClipAndTransform(lazFile, header, xA, yA, ux, uy, vx, vy, halfWidth, chunkSizeMB);
        } else {
            // 小さめ非圧縮LASは一括で「切抜+変換」
            const arrayBuffer = await lazFile.arrayBuffer();
            const view = new DataView(arrayBuffer);
            const hasRGB = RGB_FORMATS.includes(header.pointFormat);
            const rgbOff = getRgbByteOffset(header.pointFormat);
            const prl = header.pointRecordLength;
            let offset = header.pointDataOffset;
            for (let i = 0; i < header.numPoints; i++) {
                if (offset + prl > arrayBuffer.byteLength) break;
                const rawX = view.getInt32(offset, true);
                const rawY = view.getInt32(offset + 4, true);
                const rawZ = view.getInt32(offset + 8, true);
                const x = rawX * header.scaleX + header.offsetX;
                const y = rawY * header.scaleY + header.offsetY;
                const z = rawZ * header.scaleZ + header.offsetZ;
                const t = clipAndTransformToProfile(x, y, z, xA, yA, ux, uy, vx, vy, halfWidth);
                if (t) {
                    const p = { x: t.x, y: t.y, z: t.z, intensity: view.getUint16(offset + 12, true) };
                    if (hasRGB && rgbOff >= 0 && offset + rgbOff + 6 <= arrayBuffer.byteLength) {
                        p.red = view.getUint16(offset + rgbOff, true);
                        p.green = view.getUint16(offset + rgbOff + 2, true);
                        p.blue = view.getUint16(offset + rgbOff + 4, true);
                    }
                    outPoints.push(p);
                }
                offset += prl;
                if (i % LOG_UPDATE_INTERVAL === 0 && i > 0) {
                    const progress = 20 + (i / header.numPoints) * 50;
                    updateProgress(progress, `切抜+変換: ${Math.floor((i / header.numPoints) * 100)}%`);
                    addLog(`処理済み: ${i.toLocaleString()}/${header.numPoints.toLocaleString()}点, 出力: ${outPoints.length.toLocaleString()}点`);
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
        }

        // マーカー（スフィア or 白黒ターゲット）はオリジナル座標系で追加→同じ切抜判定→同じ変換で outPoints に追加
        let added = 0;
        for (const p of [...markerPointsA, ...markerPointsB]) {
            const t = clipAndTransformToProfile(p.x, p.y, p.z, xA, yA, ux, uy, vx, vy, halfWidth);
            if (!t) continue;
            outPoints.push({ x: t.x, y: t.y, z: t.z, intensity: p.intensity ?? 0, red: p.red, green: p.green, blue: p.blue });
            added++;
        }
        if (useTargetMarker) {
            addLog(`白黒ターゲットを追加（切抜後に残る分のみ）: 追加${added}点（半幅${targetHalf}m・正面向き）`);
        } else {
            addLog(`スフィア点群を追加（切抜後に残る分のみ）: 追加${added}点（半径${SPHERE_RADIUS}m・マゼンタ）`);
        }

        if (outPoints.length === 0) {
            throw new Error('切抜幅内に点が見つかりませんでした（スフィアも含めて0点）。幅を広げてください。');
        }

        // 出力はRGB付きに揃える（スフィアを確実に発色）
        for (const p of outPoints) ensurePointRGB(p);

        const scaleYInput = parseFloat(document.getElementById('scaleY')?.value);
        const scaleYVal = (Number.isFinite(scaleYInput) && scaleYInput > 0) ? scaleYInput : 1;
        if (scaleYVal !== 1) {
            scaleYPoints(outPoints, scaleYVal);
            addLog(`標高の強調適用: ${scaleYVal}倍`);
        }

        updateProgress(95, 'LAS出力生成中');
        const outputLasBuffer = createLASFile(outPoints, header);
        updateProgress(100, '完了');

        const blob = new Blob([outputLasBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        downloadBtn.href = url;
        downloadBtn.download = 'output_section.las';

        resultSection.classList.add('active');
        resultText.innerHTML = `
            縦断・横断図作成（切抜→変換）が完了しました。<br>
            出力点数: ${outPoints.length.toLocaleString()}点（切抜後＋スフィア）<br>
            ファイルサイズ: ${formatFileSize(outputLasBuffer.byteLength)}<br>
            <small>切抜条件: |Y'| ≤ ${halfWidth}m（AB直線に対する横方向距離）。出力XY=縦断図（X=境界方向, Y=標高）。</small>
        `;
        if (downloadCsvBtn) downloadCsvBtn.style.display = 'none';
        addLog('✅ 縦断・横断図作成（切抜→変換）が完了しました。');
    } catch (err) {
        console.error(err);
        addLog(`❌ エラー: ${err.message}`);
        alert(`エラー: ${err.message}`);
    } finally {
        processBtn.disabled = false;
    }
}

// ============================================================================
// ポリゴン境界（SIMA）で幅1cmライン描画
// ============================================================================

/**
 * 前段: 参照元そのまま（parseSim → offsetPolygon）。後段: 全点読み込み → 3領域分類 → 帯マゼンタ・Classification → LAS出力。
 */
async function processPolygonBoundary() {
    try {
        if (!wasmReady || !LazPerf) {
            throw new Error('LAZ解凍エンジンが初期化されていません。ページをリロードしてください。');
        }
        if (!simFile || !lazFile) {
            throw new Error('LAZ/LASファイルとSIMA形式(.sim)ファイルを選択してください。');
        }

        processBtn.disabled = true;
        progressSection.classList.add('active');
        resultSection.classList.remove('active');
        logDiv.innerHTML = '';
        addLog('ポリゴン境界（幅1cmライン描画）を開始します...');
        updateProgress(0, '初期化中');

        const simText = await simFile.text();
        const centerPoly = parseSim(simText);
        if (!centerPoly || centerPoly.length < 3) {
            throw new Error('SIMAファイルから有効なポリゴン（3頂点以上）を取得できませんでした。');
        }
        addLog(`前段: 中心ポリゴン ${centerPoly.length} 頂点`);

        const header = await readLASHeaderFromFile(lazFile);

        const lineWidthInput = document.getElementById('polygonLineWidth');
        const lineWidthM = (lineWidthInput && Number.isFinite(parseFloat(lineWidthInput.value)) && parseFloat(lineWidthInput.value) > 0)
            ? parseFloat(lineWidthInput.value) : 0.01;
        const halfWidth = lineWidthM / 2;
        addLog(`線幅: ${lineWidthM}m（内側・外側各 ${halfWidth}m オフセット）`);

        const innerPoly = offsetPolygon(centerPoly, -halfWidth);
        const outerPoly = offsetPolygon(centerPoly, halfWidth);
        if (innerPoly.length < 3) addLog('⚠️ 内側オフセットポリゴンが3頂点未満です');
        if (outerPoly.length < 3) addLog('⚠️ 外側オフセットポリゴンが3頂点未満です');
        addLog(`内側オフセット: ${innerPoly.length} 頂点, 外側オフセット: ${outerPoly.length} 頂点`);

        const innerMath = simaToMathPolygon(innerPoly);
        const outerMath = simaToMathPolygon(outerPoly);
        const outerBBox = getPolygonBBox(outerMath);
        updateProgress(5, '前段完了');

        addLog(`点群: ${header.numPoints.toLocaleString()}点`);
        const { useStreaming, chunkSizeMB } = getStreamingOptions(lazFile);
        let points = [];
        let countInside = 0, countBand = 0, countOutside = 0;
        let outputLasBuffer = null;

        if (header.isCompressed) {
            addLog('LAZをストリーミング解凍しつつ3領域分類し、その場でLASに書き出しています...');
            const arrayBuffer = await lazFile.arrayBuffer();
            outputLasBuffer = await streamLAZToLASBlob(arrayBuffer, header, {
                onPoint(p, i) {
                    const cls = classifyPointForPolygon(p, innerMath, outerMath, outerBBox);
                    if (cls === 'inside') countInside++;
                    else if (cls === 'band') countBand++;
                    else countOutside++;
                },
                onProgress(i, pointCount) {
                    const progress = 5 + (i / pointCount) * 90;
                    updateProgress(progress, `解凍・分類: ${i.toLocaleString()}/${pointCount.toLocaleString()}点`);
                    if (i % LOG_UPDATE_INTERVAL === 0 || i === pointCount) {
                        addLog(`処理: ${i.toLocaleString()}/${pointCount.toLocaleString()}点（内側: ${countInside.toLocaleString()}, 帯: ${countBand.toLocaleString()}, 外側: ${countOutside.toLocaleString()}）`);
                    }
                }
            });
            header.isCompressed = false;
            addLog(`読込: ${header.numPoints.toLocaleString()}点`);
            addLog(`内側: ${countInside.toLocaleString()}点, 帯: ${countBand.toLocaleString()}点, 外側: ${countOutside.toLocaleString()}点`);
        } else {
            if (useStreaming) {
                addLog('非圧縮LASをストリーミングで全点読み込み中...');
                points = await processLASStreamingAllPoints(lazFile, header, chunkSizeMB);
            } else {
                addLog('LASを全点読み込み中...');
                const arrayBuffer = await lazFile.arrayBuffer();
                points = readAllPointsFromLASBuffer(arrayBuffer, header);
            }
            addLog(`読込: ${points.length.toLocaleString()}点`);
            updateProgress(50, '3領域分類中');
            for (let i = 0; i < points.length; i++) {
                const p = points[i];
                const cls = classifyPointForPolygon(p, innerMath, outerMath, outerBBox);
                if (cls === 'inside') countInside++;
                else if (cls === 'band') countBand++;
                else countOutside++;
                if (i % PROGRESS_UPDATE_INTERVAL === 0 && i > 0) {
                    updateProgress(50 + (i / points.length) * 45, `分類: ${i.toLocaleString()}/${points.length.toLocaleString()}点`);
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            addLog(`内側: ${countInside.toLocaleString()}点, 帯: ${countBand.toLocaleString()}点, 外側: ${countOutside.toLocaleString()}点`);
        }

        updateProgress(95, 'LAS出力生成中');
        const outputPointCount = outputLasBuffer != null ? header.numPoints : points.length;
        const blob = outputLasBuffer != null && outputLasBuffer instanceof Blob
            ? outputLasBuffer
            : new Blob([createLASFile(points, header)], { type: 'application/octet-stream' });
        updateProgress(100, '完了');

        const url = URL.createObjectURL(blob);
        downloadBtn.href = url;
        downloadBtn.download = 'output_polygon.las';
        resultSection.classList.add('active');
        resultText.innerHTML = `
            ポリゴン境界（幅1cmライン描画）が完了しました。<br>
            出力点数: ${outputPointCount.toLocaleString()}点（内側: ${countInside.toLocaleString()}, 帯: ${countBand.toLocaleString()}, 外側: ${countOutside.toLocaleString()}）<br>
            Classification: 1=内側, 2=帯, 3=外側。帯の点はマゼンタで幅1cmの線として表示されます。<br>
            ファイルサイズ: ${formatFileSize(blob.size)}
        `;
        if (downloadCsvBtn) downloadCsvBtn.style.display = 'none';
        addLog('✅ ポリゴン境界（幅1cmライン描画）が完了しました。');
    } catch (err) {
        console.error(err);
        addLog(`❌ エラー: ${err.message}`);
        alert(`エラー: ${err.message}`);
    } finally {
        processBtn.disabled = false;
    }
}

// ============================================================================
// ターゲット配置（四隅）
// ============================================================================

/**
 * 入力点群の四隅に白黒ターゲットを配置し、ターゲット中心座標を点群タイトルとして出力する。
 */
async function processTargetCorners() {
    try {
        if (!wasmReady || !LazPerf) {
            throw new Error('LAZ解凍エンジンが初期化されていません。ページをリロードしてください。');
        }
        if (!lazFile) throw new Error('LAZ/LASファイルを選択してください。');

        processBtn.disabled = true;
        progressSection.classList.add('active');
        resultSection.classList.remove('active');
        logDiv.innerHTML = '';
        addLog('ターゲット配置（四隅）を開始します...');
        updateProgress(0, '初期化中');

        const header = await readLASHeaderFromFile(lazFile);
        const { minX, maxX, minY, maxY, minZ, maxZ } = header;
        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY) || !Number.isFinite(minZ)) {
            throw new Error('点群の範囲（min/max）がヘッダーから取得できません。');
        }
        addLog(`点群範囲: X[${minX}, ${maxX}] Y[${minY}, ${maxY}] Z[${minZ}, ${maxZ}]`);
        updateProgress(10, '点群読込中');

        const { fileSizeMB, useStreaming, chunkSizeMB } = getStreamingOptions(lazFile);
        let points = [];

        if (header.isCompressed) {
            addLog('LAZを解凍して全点読み込み中...');
            const arrayBuffer = await lazFile.arrayBuffer();
            const lasBuffer = await decompressLAZWithLazPerf(arrayBuffer, header);
            const newHeader = parseLASHeader(lasBuffer);
            Object.assign(header, newHeader);
            header.isCompressed = false;
            points = readAllPointsFromLASBuffer(lasBuffer, header);
            addLog(`読込: ${points.length.toLocaleString()}点`);
        } else if (useStreaming) {
            addLog('非圧縮LASをストリーミングで全点読み込み中...');
            points = await processLASStreamingAllPoints(lazFile, header, chunkSizeMB);
        } else {
            addLog('LASを全点読み込み中...');
            const arrayBuffer = await lazFile.arrayBuffer();
            points = readAllPointsFromLASBuffer(arrayBuffer, header);
            addLog(`読込: ${points.length.toLocaleString()}点`);
        }

        const sizeInput = document.getElementById('targetSize');
        const targetSizeM = (sizeInput && Number.isFinite(parseFloat(sizeInput.value)) && parseFloat(sizeInput.value) > 0)
            ? parseFloat(sizeInput.value) : 0.2;
        const useMaxZ = document.querySelector('input[name="targetZ"]:checked')?.value === 'maxZ';
        const targetZ = useMaxZ ? maxZ : minZ;
        if (!Number.isFinite(targetZ)) throw new Error('選択したZ（minZ/maxZ）が取得できません。');
        addLog(`ターゲット高さ: ${useMaxZ ? 'maxZ（上面）' : 'minZ（下面）'} = ${targetZ}`);
        const TARGET_HALF = targetSizeM / 2;
        const corners = [
            { x: minX, y: minY, z: targetZ },
            { x: maxX, y: minY, z: targetZ },
            { x: minX, y: maxY, z: targetZ },
            { x: maxX, y: maxY, z: targetZ }
        ];
        let totalTargetPoints = 0;
        for (const c of corners) {
            const t = generateCheckerboardTarget(c.x, c.y, c.z, TARGET_HALF);
            points.push(...t);
            totalTargetPoints += t.length;
        }
        addLog(`ターゲット追加: 四隅×${targetSizeM}m、合計+${totalTargetPoints}点`);

        for (const p of points) ensurePointRGB(p);

        updateProgress(95, 'LAS出力生成中');
        const outputLasBuffer = createLASFile(points, header);
        updateProgress(100, '完了');

        const coordsLines = corners.map(c => `${c.x}, ${c.y}, ${c.z}`);
        const coordsText = coordsLines.join('\n');
        const blob = new Blob([outputLasBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        downloadBtn.href = url;
        downloadBtn.download = 'output_target.las';
        resultSection.classList.add('active');
        resultText.innerHTML = `
            ターゲット配置（四隅）が完了しました。<br>
            出力点数: ${points.length.toLocaleString()}点、ターゲットサイズ: ${targetSizeM}m<br>
            ファイルサイズ: ${formatFileSize(outputLasBuffer.byteLength)}<br>
            <label style="display:block; margin-top:10px; font-weight:600;">点群タイトル（ターゲット中心座標）コピー用:</label>
            <textarea id="targetCoordsCopy" readonly rows="5" style="width:100%; margin-top:4px; font-family:monospace; font-size:13px; padding:8px; box-sizing:border-box;"></textarea>
        `;
        const ta = document.getElementById('targetCoordsCopy');
        if (ta) ta.value = coordsText;
        if (downloadCsvBtn) downloadCsvBtn.style.display = 'none';
        addLog('点群タイトル（ターゲット中心座標）:');
        coordsLines.forEach((line, i) => addLog(`  ${i + 1}: ${line}`));
        addLog('✅ ターゲット配置（四隅）が完了しました。');
    } catch (err) {
        console.error(err);
        addLog(`❌ エラー: ${err.message}`);
        alert(`エラー: ${err.message}`);
    } finally {
        processBtn.disabled = false;
    }
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
        const { fileSizeMB, useStreaming, chunkSizeMB } = getStreamingOptions(lazFile);
        const useSphere = filterSphereInput ? filterSphereInput.checked : false;
        const useHorizontal = filterHorizontalInput ? filterHorizontalInput.checked : true;
        if (!useSphere && !useHorizontal) {
            throw new Error('フィルタ種別を1つ以上選択してください（スフィアまたは水平投影）');
        }
        const filterLabels = [];
        if (useSphere) filterLabels.push('スフィア');
        if (useHorizontal) filterLabels.push('水平投影');
        addLog(`設定: 半径=${radius}m, チャンクサイズ=${chunkSizeMB}MB, フィルタ: ${filterLabels.join(' + ')}`);
        
        // フィルタリングキャッシュを準備（パフォーマンス向上）
        prepareFilteringCache(centers, radius, useSphere, useHorizontal);
        if (useStreaming) {
            addLog(`📦 ストリーミング処理モード: ${fileSizeMB.toFixed(1)}MBのファイルをチャンクごとに処理します`);
        } else {
            addLog('LAZ/LASファイルを読み込んでいます...');
        }
        
        addLog('ヘッダーを読み込んでいます...');
        const header = await readLASHeaderFromFile(lazFile);
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
