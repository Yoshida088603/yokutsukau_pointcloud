@echo off
REM LAZ解凍WASMモジュールの完全ビルドスクリプト

echo ========================================
echo LAZ解凍WASMモジュールビルド
echo ========================================
echo.

REM Emscriptenの環境設定
if exist "emsdk\emsdk_env.bat" (
    echo [1/6] Emscripten環境を設定しています...
    call emsdk\emsdk_env.bat
) else (
    echo [エラー] Emscripten SDKが見つかりません
    echo 先に setup.bat を実行してください
    pause
    exit /b 1
)

echo.
echo [2/6] LASzipをダウンロードしています...
echo.

if exist "LASzip" (
    echo LASzipは既にダウンロード済みです
) else (
    git clone --depth 1 https://github.com/LASzip/LASzip.git
    if %ERRORLEVEL% NEQ 0 (
        echo [エラー] LASzipのダウンロードに失敗しました
        pause
        exit /b 1
    )
)

echo.
echo [3/6] ビルドディレクトリを準備しています...
echo.

if not exist "dist" mkdir dist
if exist "build" rmdir /s /q build
mkdir build

echo.
echo [4/6] LASzipソースをコピーしています...
echo.

REM 必要なソースファイルをコピー
copy LASzip\src\*.cpp build\ >nul 2>&1
copy LASzip\src\*.hpp build\ >nul 2>&1

echo.
echo [5/6] WASMモジュールをコンパイルしています...
echo （これには数分かかる場合があります）
echo.

REM laz_wrapper.cppをbuildディレクトリにコピー
copy laz_wrapper.cpp build\ >nul 2>&1

cd build

REM Emscriptenでコンパイル
emcc laz_wrapper.cpp ^
    -o ../dist/laz_decoder.js ^
    -I. ^
    -s WASM=1 ^
    -s MODULARIZE=1 ^
    -s EXPORT_NAME="LAZDecoder" ^
    -s ALLOW_MEMORY_GROWTH=1 ^
    -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap']" ^
    -s ENVIRONMENT=web ^
    -lembind ^
    -O3 ^
    --bind

cd ..

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [エラー] コンパイルに失敗しました
    pause
    exit /b 1
)

echo.
echo [6/6] 完了確認...
echo.

if exist "dist\laz_decoder.js" (
    if exist "dist\laz_decoder.wasm" (
        echo ========================================
        echo ビルド成功！
        echo ========================================
        echo.
        echo 生成されたファイル:
        dir dist\laz_decoder.* /b
        echo.
        echo これらのファイルを ..\index.html から読み込んで使用できます
        echo.
    ) else (
        echo [警告] WASMファイルが生成されませんでした
    )
) else (
    echo [エラー] JavaScriptファイルが生成されませんでした
)

echo.
pause
