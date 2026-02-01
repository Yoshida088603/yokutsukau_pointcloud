import argparse
import numpy as np
import laspy

def read_centers_csv(path: str) -> np.ndarray:
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        first = f.readline().strip()
        if first.lower().replace(" ", "").strip(",") != "label,x,y,z":
            parts = first.strip(",").split(",")
            if len(parts) >= 4:
                x = float(parts[1]); y = float(parts[2]); z = float(parts[3])
                rows.append((x, y, z))
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.strip(",").split(",")
            if len(parts) < 4:
                continue
            x = float(parts[1]); y = float(parts[2]); z = float(parts[3])
            rows.append((x, y, z))
    if not rows:
        raise ValueError("CSVから中心座標が読み取れませんでした。")
    return np.asarray(rows, dtype=np.float64)

def build_kdtree(centers_xyz: np.ndarray):
    try:
        from scipy.spatial import cKDTree
        return cKDTree(centers_xyz), True
    except Exception:
        return None, False

def keep_mask(points_xyz: np.ndarray, centers_xyz: np.ndarray, radius: float, tree=None) -> np.ndarray:
    r2 = radius * radius
    if tree is not None:
        d, _ = tree.query(points_xyz, k=1, workers=-1)
        return (d * d) <= r2
    diff = points_xyz[:, None, :] - centers_xyz[None, :, :]
    d2 = np.sum(diff * diff, axis=2)
    return np.min(d2, axis=1) <= r2

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in_laz", required=True)
    ap.add_argument("--centers_csv", required=True)
    ap.add_argument("--out_laz", required=True)
    ap.add_argument("--radius", type=float, default=0.5)
    ap.add_argument("--chunk_points", type=int, default=2_000_000, help="points per chunk")
    args = ap.parse_args()

    centers = read_centers_csv(args.centers_csv)
    tree, has_tree = build_kdtree(centers)
    mode = "kdtree" if has_tree else "bruteforce"
    print(f"[info] centers={len(centers)} mode={mode} radius={args.radius}m chunk={args.chunk_points}")

    total_in = 0
    total_out = 0

    with laspy.open(args.in_laz) as reader:
        hdr = reader.header
        with laspy.open(args.out_laz, mode="w", header=hdr) as writer:
            for points in reader.chunk_iterator(args.chunk_points):
                total_in += len(points)
                xyz = np.vstack((points.x, points.y, points.z)).T.astype(np.float64)
                m = keep_mask(xyz, centers, args.radius, tree=tree)
                kept = points[m]
                total_out += len(kept)
                if len(kept) > 0:
                    writer.write_points(kept)

                if total_in % (args.chunk_points * 5) == 0:
                    print(f"[progress] in={total_in:,} out={total_out:,}")

    print(f"[done] in={total_in:,} out={total_out:,} wrote={args.out_laz}")

if __name__ == "__main__":
    main()
