"""
LAS ファイルのヘッダーをダンプして CloudCompare の「null bounding-box」原因を調べる。
laspy 不要。使い方: python scripts/inspect_las_header.py sample_laz/trouble.las
"""
import struct
import sys
from pathlib import Path


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "sample_laz/trouble.las"
    path = Path(path)
    if not path.exists():
        print("File not found:", path, file=sys.stderr)
        sys.exit(1)

    size_gb = path.stat().st_size / (1024**3)
    print("File:", path)
    print("Size: {:.2f} GB".format(size_gb))
    print()

    with open(path, "rb") as f:
        head = f.read(227)
        point_data_offset = struct.unpack("<I", head[96:100])[0]
        point_format = head[104]
        point_record_length = struct.unpack("<H", head[105:107])[0]
        f.seek(point_data_offset)
        first_rec = f.read(point_record_length)

    if len(head) < 227:
        print("Header too short")
        sys.exit(1)

    sig = head[0:4].decode("ascii", errors="replace")
    print("Signature:", repr(sig))
    version = (head[24], head[25])
    print("Version: {}.{}".format(version[0], version[1]))
    print("Point data offset:", point_data_offset)
    print("Point format id:", point_format)
    print("Point record length:", point_record_length)
    num_points = struct.unpack("<I", head[107:111])[0]
    print("Point count (legacy):", num_points)
    print()

    scale_x = struct.unpack("<d", head[131:139])[0]
    scale_y = struct.unpack("<d", head[139:147])[0]
    scale_z = struct.unpack("<d", head[147:155])[0]
    print("Scale X,Y,Z:", scale_x, scale_y, scale_z)
    offset_x = struct.unpack("<d", head[155:163])[0]
    offset_y = struct.unpack("<d", head[163:171])[0]
    offset_z = struct.unpack("<d", head[171:179])[0]
    print("Offset (first point) X,Y,Z:", offset_x, offset_y, offset_z)
    print()

    # LAS 1.2: 179-226 = Max X, Min X, Max Y, Min Y, Max Z, Min Z (each 8 bytes)
    max_x = struct.unpack("<d", head[179:187])[0]
    min_x = struct.unpack("<d", head[187:195])[0]
    max_y = struct.unpack("<d", head[195:203])[0]
    min_y = struct.unpack("<d", head[203:211])[0]
    max_z = struct.unpack("<d", head[211:219])[0]
    min_z = struct.unpack("<d", head[219:227])[0]
    print("Min X,Y,Z (header bytes 187-226):", min_x, min_y, min_z)
    print("Max X,Y,Z (header bytes 179-218):", max_x, max_y, max_z)
    print("  Valid (finite): min_x={}, max_x={}, min_y={}, max_y={}, min_z={}, max_z={}".format(
        bool(__import__("math").isfinite(min_x)), bool(__import__("math").isfinite(max_x)),
        bool(__import__("math").isfinite(min_y)), bool(__import__("math").isfinite(max_y)),
        bool(__import__("math").isfinite(min_z)), bool(__import__("math").isfinite(max_z))))
    if min_x > max_x or min_y > max_y or min_z > max_z:
        print("  *** INVALID: min > max for some axis ***")
    print()

    # First point record (raw) - already read above
    if len(first_rec) >= 12:
        raw_x = struct.unpack("<i", first_rec[0:4])[0]
        raw_y = struct.unpack("<i", first_rec[4:8])[0]
        raw_z = struct.unpack("<i", first_rec[8:12])[0]
        world_x = raw_x * scale_x + offset_x
        world_y = raw_y * scale_y + offset_y
        world_z = raw_z * scale_z + offset_z
        print("First point raw (int32):", raw_x, raw_y, raw_z)
        print("First point world (scale*raw+offset):", world_x, world_y, world_z)


if __name__ == "__main__":
    main()
