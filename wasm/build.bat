@echo off
REM LAZ解凍WASMモジュールのビルドスクリプト（Windows用）

echo ========================================
echo LAZ解凍 WebAssemblyモジュールのビルド
echo ========================================
echo.

REM Emscriptenの確認
where emcc >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [エラー] Emscriptenが見つかりません
    echo.
    echo Emscriptenのインストール手順:
    echo 1. https://emscripten.org/docs/getting_started/downloads.html
    echo 2. git clone https://github.com/emscripten-core/emsdk.git
    echo 3. cd emsdk
    echo 4. emsdk install latest
    echo 5. emsdk activate latest
    echo 6. emsdk_env.bat
    echo.
    pause
    exit /b 1
)

echo [1/3] Emscripten確認: OK
echo.

REM 出力ディレクトリの作成
if not exist "dist" mkdir dist

echo [2/3] C++コードをWASMにコンパイル中...
echo.

REM 基本的なLASパーサーをコンパイル
emcc laz_wrapper.cpp ^
    -o dist/laz_decoder.js ^
    -s WASM=1 ^
    -s MODULARIZE=1 ^
    -s EXPORT_NAME="LAZDecoder" ^
    -s ALLOW_MEMORY_GROWTH=1 ^
    -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap']" ^
    -lembind ^
    -O3 ^
    --bind

if %ERRORLEVEL% NEQ 0 (
    echo [エラー] コンパイルに失敗しました
    pause
    exit /b 1
)

echo.
echo [3/3] ビルド完了！
echo.
echo 生成されたファイル:
echo - dist\laz_decoder.js
echo - dist\laz_decoder.wasm
echo.
echo これらのファイルをブラウザアプリから読み込んで使用できます。
echo.
pause
