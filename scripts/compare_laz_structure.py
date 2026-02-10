r"""
2つのLAZファイルの構造（ヘッダー・点フォーマット・属性）を比較する。
原因究明用: 片方だけ処理が異常になる場合の差異確認。

使い方（プロジェクトルートで）:
  .venv\Scripts\activate
  python scripts/compare_laz_structure.py sample_laz/09LD0841.laz sample_laz/20260206HAKUSAN_maetate.laz
"""
import argparse
import sys
from pathlib import Path

try:
    import laspy
except ImportError:
    print("laspy がありません。pip install laspy または scripts/requirements.txt をインストールしてください。", file=sys.stderr)
    sys.exit(1)


def describe_header(header, label: str) -> dict:
    """laspy のヘッダーから比較用の情報を抽出"""
    info = {
        "label": label,
        "point_format_id": getattr(header.point_format, "id", header.point_format_id if hasattr(header, "point_format_id") else None),
        "point_format": str(header.point_format) if hasattr(header, "point_format") else "?",
        "version": f"{header.version.major}.{header.version.minor}",
        "point_count": header.point_count,
        "min": (float(header.min[0]), float(header.min[1]), float(header.min[2])),
        "max": (float(header.max[0]), float(header.max[1]), float(header.max[2])),
        "scale": (float(header.scale[0]), float(header.scale[1]), float(header.scale[2])),
        "offset": (float(header.offset[0]), float(header.offset[1]), float(header.offset[2])),
    }
    return info


def get_point_dimensions(path: str) -> tuple[list, list]:
    """
    先頭の点を少し読んで、存在する次元名の一覧とサンプル値を返す。
    (メモリ節約のため chunk_iterator で少しだけ読む)
    """
    dims = []
    sample = []
    with laspy.open(path) as f:
        header = f.header
        # ヘッダーから点フォーマットの次元一覧を取得（laspy 2.x）
        point_format = header.point_format
        dims = [d.name for d in point_format.dimensions]
        for chunk in f.chunk_iterator(1):
            if len(chunk) == 0:
                break
            # 1点目のみサンプル（各次元の存在確認用）
            pt = chunk[0]
            sample = {d: getattr(pt, d, None) for d in dims}
            break
    return dims, sample


def main():
    ap = argparse.ArgumentParser(description="2つのLAZファイルの構造を比較する")
    ap.add_argument("laz_a", help="1つ目のLAZ（正常に処理できる方）")
    ap.add_argument("laz_b", help="2つ目のLAZ（処理結果が異常な方）")
    ap.add_argument("--sample-points", type=int, default=3, help="サンプルとして表示する点数（0でなし）")
    args = ap.parse_args()

    paths = [args.laz_a, args.laz_b]
    labels = ["A (1つ目)", "B (2つ目)"]
    for i, p in enumerate(paths):
        name = Path(p).name.lower()
        if "good" in name:
            labels[i] = Path(p).name + " (表示できる)"
        elif "trouble" in name:
            labels[i] = Path(p).name + " (表示できない)"
        elif "09LD0841" in p:
            labels[i] = Path(p).name + " (異常・処理がおかしい)"
        elif "HAKUSAN" in p or "20260206" in p:
            labels[i] = Path(p).name + " (正常)"

    print("=" * 70)
    print("LAS/LAZ 構造比較")
    print("=" * 70)

    infos = []
    all_dims = []

    for path, label in zip(paths, labels):
        p = Path(path)
        if not p.exists():
            print(f"エラー: ファイルが存在しません: {path}", file=sys.stderr)
            sys.exit(1)
        print(f"\n【{label}】")
        print(f"  パス: {path}")

        with laspy.open(path) as f:
            header = f.header
            info = describe_header(header, label)
            infos.append(info)

            print(f"  Point Format ID: {info['point_format_id']} ({info['point_format']})")
            print(f"  LAS Version:     {info['version']}")
            print(f"  Point Count:     {info['point_count']:,}")
            print(f"  X range:         [{info['min'][0]:.4f}, {info['max'][0]:.4f}]")
            print(f"  Y range:         [{info['min'][1]:.4f}, {info['max'][1]:.4f}]")
            print(f"  Z range:         [{info['min'][2]:.4f}, {info['max'][2]:.4f}]")
            print(f"  Scale:           {info['scale']}")
            print(f"  Offset:          {info['offset']}")

            dims, sample = get_point_dimensions(path)
            all_dims.append((dims, sample))
            print(f"  次元（属性）一覧: {dims}")
            if sample:
                print(f"  1点目サンプル:    {sample}")

    # 差分サマリ
    print("\n" + "=" * 70)
    print("比較サマリ（差異がある項目）")
    print("=" * 70)

    a_info, b_info = infos[0], infos[1]
    a_dims, b_dims = all_dims[0][0], all_dims[1][0]

    diff = []
    if a_info["point_format_id"] != b_info["point_format_id"]:
        diff.append(f"Point Format ID: {a_info['point_format_id']} vs {b_info['point_format_id']}")
    if a_info["version"] != b_info["version"]:
        diff.append(f"LAS Version: {a_info['version']} vs {b_info['version']}")
    if set(a_dims) != set(b_dims):
        only_a = set(a_dims) - set(b_dims)
        only_b = set(b_dims) - set(a_dims)
        if only_a:
            diff.append(f"Aにのみある属性: {sorted(only_a)}")
        if only_b:
            diff.append(f"Bにのみある属性: {sorted(only_b)}")
    if a_info["scale"] != b_info["scale"]:
        diff.append(f"Scale: A{a_info['scale']} vs B{b_info['scale']}")
    if a_info["offset"] != b_info["offset"]:
        diff.append(f"Offset: A{a_info['offset']} vs B{b_info['offset']}")

    if diff:
        for d in diff:
            print(f"  - {d}")
        # Zオフセットの差は表示崩れ・座標ずれの原因になりやすい
        if a_info["offset"][2] != b_info["offset"][2]:
            print("\n  [注意] Z Offset が異なります。JS側で offset を正しく適用していないと、"
                  "片方のデータで標高や色がおかしくなることがあります。")
    else:
        print("  ヘッダー・属性名の明瞭な差異はありません（点フォーマット・スケール・オフセット・次元名は一致）")

    # サンプル点を数点表示（オプション）
    if args.sample_points > 0:
        print("\n" + "-" * 70)
        print(f"先頭 {args.sample_points} 点のサンプル（値の異常確認用）")
        print("-" * 70)
        for path, label in zip(paths, labels):
            print(f"\n【{label}】")
            with laspy.open(path) as f:
                n = 0
                for chunk in f.chunk_iterator(10_000):
                    for i in range(min(len(chunk), args.sample_points - n)):
                        pt = chunk[i]
                        x = getattr(pt, "X", None) or getattr(pt, "x", None)
                        y = getattr(pt, "Y", None) or getattr(pt, "y", None)
                        z = getattr(pt, "Z", None) or getattr(pt, "z", None)
                        # laspy 2 では通常大文字 X,Y,Z
                        if x is None:
                            x = pt.x if hasattr(pt, "x") else "?"
                        if y is None:
                            y = pt.y if hasattr(pt, "y") else "?"
                        if z is None:
                            z = pt.z if hasattr(pt, "z") else "?"
                        intensity = getattr(pt, "intensity", getattr(pt, "Intensity", "?"))
                        red = getattr(pt, "red", getattr(pt, "Red", None))
                        green = getattr(pt, "green", getattr(pt, "Green", None))
                        blue = getattr(pt, "blue", getattr(pt, "Blue", None))
                        rgb = f" R={red} G={green} B={blue}" if red is not None else ""
                        print(f"    [{n+1}] x={x}, y={y}, z={z}, intensity={intensity}{rgb}")
                        n += 1
                    if n >= args.sample_points:
                        break
                if n == 0:
                    print("    (点が読み取れませんでした)")

    print("\n" + "=" * 70)


if __name__ == "__main__":
    main()
