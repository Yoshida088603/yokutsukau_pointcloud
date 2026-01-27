@echo off
REM WebAssemblyビルド環境のセットアップスクリプト

echo ========================================
echo LAZ解凍WASM環境セットアップ
echo ========================================
echo.

REM 必要なツールの確認
echo [1/4] 必要なツールを確認しています...
echo.

where git >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [エラー] gitが見つかりません
    echo https://git-scm.com/ からインストールしてください
    pause
    exit /b 1
)
echo - Git: OK

where cmake >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [警告] CMakeが見つかりません
    echo https://cmake.org/download/ からインストールすることを推奨します
)

echo.
echo [2/4] Emscripten SDKをダウンロードしています...
echo.

if exist "emsdk" (
    echo Emscripten SDKは既にダウンロード済みです
) else (
    git clone https://github.com/emscripten-core/emsdk.git
    if %ERRORLEVEL% NEQ 0 (
        echo [エラー] Emscripten SDKのダウンロードに失敗しました
        pause
        exit /b 1
    )
)

cd emsdk

echo.
echo [3/4] Emscriptenをインストールしています...
echo.

call emsdk.bat install latest
if %ERRORLEVEL% NEQ 0 (
    echo [エラー] Emscriptenのインストールに失敗しました
    cd ..
    pause
    exit /b 1
)

call emsdk.bat activate latest
if %ERRORLEVEL% NEQ 0 (
    echo [エラー] Emscriptenのアクティベートに失敗しました
    cd ..
    pause
    exit /b 1
)

echo.
echo [4/4] 環境変数を設定しています...
echo.

call emsdk_env.bat
cd ..

echo.
echo ========================================
echo セットアップ完了！
echo ========================================
echo.
echo 次のステップ:
echo 1. 新しいコマンドプロンプトを開く
echo 2. このフォルダに移動
echo 3. build_full.bat を実行してWASMモジュールをビルド
echo.
pause
