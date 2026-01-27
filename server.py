#!/usr/bin/env python3
"""
LAZ Center Picking Web Server
ブラウザからLAZ/LASファイルをアップロードして処理するサーバー
"""

import http.server
import socketserver
import json
import os
import tempfile
import shutil
from urllib.parse import parse_qs
import sys

# 既存の処理関数をインポート
import numpy as np
import laspy
from scipy.spatial import cKDTree


def process_laz_file(laz_path, csv_text, radius):
    """LAZ/LASファイルを処理"""
    # CSVを解析
    centers = []
    for line in csv_text.strip().split('\n'):
        line = line.strip()
        if not line or 'label' in line.lower():
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
    
    if not centers:
        raise ValueError('CSVから有効な座標が読み取れませんでした')
    
    centers = np.array(centers)
    print(f'中心座標: {len(centers)}件', file=sys.stderr)
    
    # LAZ/LASファイルを読み込み
    las = laspy.read(laz_path)
    print(f'総点数: {len(las.points)}', file=sys.stderr)
    
    # KD-treeを構築
    tree = cKDTree(centers)
    
    # 点群座標を取得
    points_xyz = np.vstack([las.x, las.y, las.z]).T
    
    # 範囲内の点を検索
    indices = tree.query_ball_point(points_xyz, radius)
    
    # フィルタリング
    mask = np.array([len(idx) > 0 for idx in indices])
    filtered_points = las.points[mask]
    
    print(f'抽出点数: {len(filtered_points)}', file=sys.stderr)
    
    # 新しいLASファイルを作成
    header = laspy.LasHeader(point_format=las.header.point_format, version=las.header.version)
    header.offsets = las.header.offsets
    header.scales = las.header.scales
    
    output_las = laspy.LasData(header)
    output_las.points = filtered_points
    
    return output_las, len(las.points), len(filtered_points)


class LAZHandler(http.server.SimpleHTTPRequestHandler):
    """LAZ処理を行うHTTPハンドラー"""
    
    def do_POST(self):
        """POSTリクエスト処理"""
        if self.path == '/api/process':
            self.process_laz()
        else:
            self.send_error(404)
    
    def process_laz(self):
        """LAZ処理API"""
        try:
            # Content-Lengthを取得
            content_length = int(self.headers['Content-Length'])
            
            # マルチパートデータをcgiモジュールで解析
            import cgi
            from io import BytesIO
            
            # 環境変数を設定してcgiモジュールを使用
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    'REQUEST_METHOD': 'POST',
                    'CONTENT_TYPE': self.headers['Content-Type'],
                    'CONTENT_LENGTH': content_length
                }
            )
            
            # ファイルとパラメータを取得
            if 'lazFile' not in form or 'csvFile' not in form:
                self.send_error(400, 'Missing LAZ or CSV file')
                return
            
            laz_file = form['lazFile']
            csv_file = form['csvFile']
            
            if not laz_file.file or not csv_file.file:
                self.send_error(400, 'Invalid file upload')
                return
            
            # ファイルデータを読み込み
            laz_data = laz_file.file.read()
            csv_text = csv_file.file.read().decode('utf-8')
            
            # 半径を取得
            radius = 0.5
            if 'radius' in form:
                try:
                    radius = float(form['radius'].value)
                except:
                    radius = 0.5
            
            # 一時ファイルに保存
            with tempfile.NamedTemporaryFile(suffix='.laz', delete=False) as laz_temp:
                laz_temp.write(laz_data)
                laz_temp_path = laz_temp.name
            
            with tempfile.NamedTemporaryFile(suffix='.las', delete=False) as output_temp:
                output_temp_path = output_temp.name
            
            try:
                # 処理実行
                output_las, input_points, output_points = process_laz_file(
                    laz_temp_path, csv_text, radius
                )
                
                # 出力ファイルに書き込み
                output_las.write(output_temp_path)
                
                # 結果ファイルを読み込み
                with open(output_temp_path, 'rb') as f:
                    result_data = f.read()
                
                # レスポンスを返す
                self.send_response(200)
                self.send_header('Content-Type', 'application/octet-stream')
                self.send_header('Content-Disposition', 'attachment; filename="output.las"')
                self.send_header('Content-Length', str(len(result_data)))
                self.send_header('X-Input-Points', str(input_points))
                self.send_header('X-Output-Points', str(output_points))
                self.end_headers()
                self.wfile.write(result_data)
                
            finally:
                # 一時ファイルを削除
                try:
                    os.unlink(laz_temp_path)
                    os.unlink(output_temp_path)
                except:
                    pass
        
        except Exception as e:
            print(f'Error: {e}', file=sys.stderr)
            import traceback
            traceback.print_exc()
            
            self.send_error(500, f'Processing error: {str(e)}')
    
    def end_headers(self):
        # CORSヘッダーを追加
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Expose-Headers', 'X-Input-Points, X-Output-Points')
        super().end_headers()
    
    def do_OPTIONS(self):
        """OPTIONSリクエスト（CORS preflight）"""
        self.send_response(200)
        self.end_headers()


def main():
    PORT = 8000
    
    print(f"""
========================================
LAZ Center Picking Server
========================================

サーバーを起動しました：http://localhost:{PORT}

ブラウザで以下にアクセスしてください：
  http://localhost:{PORT}/index.html

終了するには Ctrl+C を押してください
========================================
    """)
    
    with socketserver.TCPServer(("", PORT), LAZHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\nサーバーを停止しました")


if __name__ == '__main__':
    main()
