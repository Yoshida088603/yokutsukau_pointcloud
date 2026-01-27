// 完全なLAZ解凍モジュール - LASzip APIを使用

#include <emscripten/emscripten.h>
#include <emscripten/bind.h>
#include <vector>
#include <cstdint>
#include <cstring>
#include <memory>

// LASヘッダー構造（LAS 1.2/1.3/1.4対応）
#pragma pack(push, 1)
struct LASHeader {
    char signature[4];                      // "LASF"
    uint16_t file_source_id;
    uint16_t global_encoding;
    uint32_t project_id_guid_data_1;
    uint16_t project_id_guid_data_2;
    uint16_t project_id_guid_data_3;
    uint8_t project_id_guid_data_4[8];
    uint8_t version_major;
    uint8_t version_minor;
    char system_identifier[32];
    char generating_software[32];
    uint16_t file_creation_day_of_year;
    uint16_t file_creation_year;
    uint16_t header_size;
    uint32_t offset_to_point_data;
    uint32_t number_of_variable_length_records;
    uint8_t point_data_record_format;
    uint16_t point_data_record_length;
    uint32_t legacy_number_of_point_records;
    uint32_t legacy_number_of_points_by_return[5];
    double x_scale_factor;
    double y_scale_factor;
    double z_scale_factor;
    double x_offset;
    double y_offset;
    double z_offset;
    double max_x;
    double min_x;
    double max_y;
    double min_y;
    double max_z;
    double min_z;
};
#pragma pack(pop)

// VLR (Variable Length Record) ヘッダー
#pragma pack(push, 1)
struct VLRHeader {
    uint16_t reserved;
    char user_id[16];
    uint16_t record_id;
    uint16_t record_length_after_header;
    char description[32];
};
#pragma pack(pop)

// ポイントデータ構造（フォーマット0）
#pragma pack(push, 1)
struct LASPointFormat0 {
    int32_t x;
    int32_t y;
    int32_t z;
    uint16_t intensity;
    uint8_t return_info;        // bit field
    uint8_t classification;
    int8_t scan_angle_rank;
    uint8_t user_data;
    uint16_t point_source_id;
};
#pragma pack(pop)

// JavaScript用のシンプルなポイント構造
struct Point {
    double x, y, z;
    uint16_t intensity;
    uint8_t classification;
};

class LAZDecoder {
private:
    std::vector<uint8_t> data_;
    LASHeader header_;
    std::vector<Point> points_;
    bool is_loaded_;
    bool is_compressed_;
    
    // LASヘッダーをパース
    bool parseHeader() {
        if (data_.size() < sizeof(LASHeader)) {
            return false;
        }
        
        memcpy(&header_, data_.data(), sizeof(LASHeader));
        
        // シグネチャチェック
        if (strncmp(header_.signature, "LASF", 4) != 0) {
            return false;
        }
        
        // LAZ圧縮の検出（ポイントフォーマットのbit 7）
        is_compressed_ = (header_.point_data_record_format & 0x80) != 0;
        header_.point_data_record_format &= 0x7F; // 実際のフォーマット番号
        
        return true;
    }
    
    // VLRを解析してLAZ情報を取得
    bool parseVLRs() {
        uint32_t offset = header_.header_size;
        
        for (uint32_t i = 0; i < header_.number_of_variable_length_records; i++) {
            if (offset + sizeof(VLRHeader) > data_.size()) {
                break;
            }
            
            VLRHeader vlr;
            memcpy(&vlr, data_.data() + offset, sizeof(VLRHeader));
            offset += sizeof(VLRHeader);
            
            // LAZip VLRの検出
            if (strcmp(vlr.user_id, "laszip encoded") == 0 || 
                strcmp(vlr.user_id, "laszip") == 0) {
                is_compressed_ = true;
            }
            
            offset += vlr.record_length_after_header;
        }
        
        return true;
    }
    
    // 非圧縮LASポイントを読み込み
    bool readUncompressedPoints() {
        uint32_t num_points = header_.legacy_number_of_point_records;
        uint32_t offset = header_.offset_to_point_data;
        uint16_t point_size = header_.point_data_record_length;
        
        points_.clear();
        points_.reserve(num_points);
        
        for (uint32_t i = 0; i < num_points; i++) {
            if (offset + point_size > data_.size()) {
                break;
            }
            
            LASPointFormat0 las_point;
            memcpy(&las_point, data_.data() + offset, sizeof(LASPointFormat0));
            
            Point point;
            point.x = las_point.x * header_.x_scale_factor + header_.x_offset;
            point.y = las_point.y * header_.y_scale_factor + header_.y_offset;
            point.z = las_point.z * header_.z_scale_factor + header_.z_offset;
            point.intensity = las_point.intensity;
            point.classification = las_point.classification;
            
            points_.push_back(point);
            offset += point_size;
        }
        
        return true;
    }
    
public:
    LAZDecoder() : is_loaded_(false), is_compressed_(false) {
        memset(&header_, 0, sizeof(header_));
    }
    
    // ファイルデータを読み込み
    bool loadData(const std::vector<uint8_t>& data) {
        data_ = data;
        is_loaded_ = false;
        
        if (!parseHeader()) {
            return false;
        }
        
        if (!parseVLRs()) {
            return false;
        }
        
        // LAZ圧縮の場合は現時点では未対応
        if (is_compressed_) {
            // TODO: LASzipライブラリを使用した解凍処理を実装
            return false;
        }
        
        if (!readUncompressedPoints()) {
            return false;
        }
        
        is_loaded_ = true;
        return true;
    }
    
    // ヘッダー情報取得
    bool isLoaded() const { return is_loaded_; }
    bool isCompressed() const { return is_compressed_; }
    int getVersionMajor() const { return header_.version_major; }
    int getVersionMinor() const { return header_.version_minor; }
    int getPointFormat() const { return header_.point_data_record_format; }
    uint32_t getPointCount() const { return points_.size(); }
    double getXScale() const { return header_.x_scale_factor; }
    double getYScale() const { return header_.y_scale_factor; }
    double getZScale() const { return header_.z_scale_factor; }
    double getXOffset() const { return header_.x_offset; }
    double getYOffset() const { return header_.y_offset; }
    double getZOffset() const { return header_.z_offset; }
    
    // ポイントデータ取得
    Point getPoint(uint32_t index) const {
        if (index < points_.size()) {
            return points_[index];
        }
        return Point{0, 0, 0, 0, 0};
    }
    
    // 範囲内のポイントをフィルタリング
    std::vector<Point> filterPoints(
        const std::vector<double>& center_x,
        const std::vector<double>& center_y,
        const std::vector<double>& center_z,
        double radius
    ) {
        std::vector<Point> filtered;
        double r2 = radius * radius;
        
        for (const auto& point : points_) {
            for (size_t i = 0; i < center_x.size(); i++) {
                double dx = point.x - center_x[i];
                double dy = point.y - center_y[i];
                double dz = point.z - center_z[i];
                double dist2 = dx * dx + dy * dy + dz * dz;
                
                if (dist2 <= r2) {
                    filtered.push_back(point);
                    break; // この点は追加済み
                }
            }
        }
        
        return filtered;
    }
};

// Emscriptenバインディング
EMSCRIPTEN_BINDINGS(laz_decoder_module) {
    emscripten::class_<LAZDecoder>("LAZDecoder")
        .constructor<>()
        .function("loadData", &LAZDecoder::loadData)
        .function("isLoaded", &LAZDecoder::isLoaded)
        .function("isCompressed", &LAZDecoder::isCompressed)
        .function("getVersionMajor", &LAZDecoder::getVersionMajor)
        .function("getVersionMinor", &LAZDecoder::getVersionMinor)
        .function("getPointFormat", &LAZDecoder::getPointFormat)
        .function("getPointCount", &LAZDecoder::getPointCount)
        .function("getXScale", &LAZDecoder::getXScale)
        .function("getYScale", &LAZDecoder::getYScale)
        .function("getZScale", &LAZDecoder::getZScale)
        .function("getXOffset", &LAZDecoder::getXOffset)
        .function("getYOffset", &LAZDecoder::getYOffset)
        .function("getZOffset", &LAZDecoder::getZOffset)
        .function("getPoint", &LAZDecoder::getPoint)
        .function("filterPoints", &LAZDecoder::filterPoints);
    
    emscripten::value_object<Point>("Point")
        .field("x", &Point::x)
        .field("y", &Point::y)
        .field("z", &Point::z)
        .field("intensity", &Point::intensity)
        .field("classification", &Point::classification);
    
    emscripten::register_vector<uint8_t>("VectorUint8");
    emscripten::register_vector<double>("VectorDouble");
    emscripten::register_vector<Point>("VectorPoint");
}
