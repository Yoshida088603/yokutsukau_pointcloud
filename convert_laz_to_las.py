"""
LAZファイルを非圧縮LASファイルに変換するスクリプト
ブラウザ版のテスト用に使用
"""
import argparse
import laspy

def convert_laz_to_las(input_path, output_path):
    print(f"読み込み中: {input_path}")
    
    with laspy.open(input_path) as f:
        header = f.header
        print(f"点数: {header.point_count:,}")
        print(f"バージョン: {header.version.major}.{header.version.minor}")
        
        print(f"変換中: {output_path}")
        with laspy.open(output_path, mode="w", header=header, do_compress=False) as writer:
            for points in f.chunk_iterator(2_000_000):
                writer.write_points(points)
    
    print("✅ 変換完了")

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="LAZファイルをLASに変換")
    ap.add_argument("--input", required=True, help="入力LAZファイル")
    ap.add_argument("--output", required=True, help="出力LASファイル")
    args = ap.parse_args()
    
    convert_laz_to_las(args.input, args.output)
