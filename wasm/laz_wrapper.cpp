// LAZ解凍のためのシンプルなC++ラッパー
// EmscriptenでWASMにコンパイルします

#include <emscripten/emscripten.h>
#include <emscripten/bind.h>
#include <vector>
#include <cstdint>
#include <cstring>

// LASヘッダー構造（簡易版）
struct LASHeader {
    char signature[4];          // "LASF"
    uint16_t file_source_id;
    uint16_t global_encoding;
    uint32_t guid_data_1;
    uint16_t guid_data_2;
    uint16_t guid_data_3;
    uint8_t guid_data_4[8];
    uint8_t version_major;
    uint8_t version_minor;
    char system_identifier[32];
    char generating_software[32];
    uint16_t file_creation_day;
    uint16_t file_creation_year;
    uint16_t header_size;
    uint32_t offset_to_point_data;
    uint32_t number_of_variable_length_records;
    uint8_t point_data_format;
    uint16_t point_data_record_length;
    uint32_t number_of_point_records;
    uint32_t number_of_points_by_return[5];
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

// ポイントデータ構造（フォーマット0）
struct LASPoint {
    int32_t x;
    int32_t y;
    int32_t z;
    uint16_t intensity;
    uint8_t return_number : 3;
    uint8_t number_of_returns : 3;
    uint8_t scan_direction : 1;
    uint8_t edge_of_flight_line : 1;
    uint8_t classification;
    int8_t scan_angle_rank;
    uint8_t user_data;
    uint16_t point_source_id;
};

class LAZDecoder {
private:
    std::vector<uint8_t> buffer;
    LASHeader header;
    size_t current_point;
    
public:
    LAZDecoder() : current_point(0) {}
    
    // ファイルデータを読み込み
    bool loadData(const std::vector<uint8_t>& data) {
        buffer = data;
        if (buffer.size() < sizeof(LASHeader)) {
            return false;
        }
        
        // ヘッダーを読み込み
        memcpy(&header, buffer.data(), sizeof(LASHeader));
        
        // シグネチャチェック
        if (strncmp(header.signature, "LASF", 4) != 0) {
            return false;
        }
        
        current_point = 0;
        return true;
    }
    
    // ヘッダー情報を取得
    int getVersionMajor() const { return header.version_major; }
    int getVersionMinor() const { return header.version_minor; }
    int getPointFormat() const { return header.point_data_format; }
    int getPointCount() const { return header.number_of_point_records; }
    double getXScale() const { return header.x_scale_factor; }
    double getYScale() const { return header.y_scale_factor; }
    double getZScale() const { return header.z_scale_factor; }
    double getXOffset() const { return header.x_offset; }
    double getYOffset() const { return header.y_offset; }
    double getZOffset() const { return header.z_offset; }
    
    // 次のポイントを読み込み（非圧縮LASの場合）
    bool readNextPoint(LASPoint& point) {
        if (current_point >= header.number_of_point_records) {
            return false;
        }
        
        size_t offset = header.offset_to_point_data + 
                       current_point * header.point_data_record_length;
        
        if (offset + sizeof(LASPoint) > buffer.size()) {
            return false;
        }
        
        memcpy(&point, buffer.data() + offset, sizeof(LASPoint));
        current_point++;
        return true;
    }
    
    // 実座標に変換
    double getWorldX(int32_t x) const {
        return x * header.x_scale_factor + header.x_offset;
    }
    
    double getWorldY(int32_t y) const {
        return y * header.y_scale_factor + header.y_offset;
    }
    
    double getWorldZ(int32_t z) const {
        return z * header.z_scale_factor + header.z_offset;
    }
};

// Emscriptenバインディング
EMSCRIPTEN_BINDINGS(laz_decoder_module) {
    emscripten::class_<LAZDecoder>("LAZDecoder")
        .constructor<>()
        .function("loadData", &LAZDecoder::loadData)
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
        .function("getWorldX", &LAZDecoder::getWorldX)
        .function("getWorldY", &LAZDecoder::getWorldY)
        .function("getWorldZ", &LAZDecoder::getWorldZ);
    
    emscripten::value_object<LASPoint>("LASPoint")
        .field("x", &LASPoint::x)
        .field("y", &LASPoint::y)
        .field("z", &LASPoint::z)
        .field("intensity", &LASPoint::intensity)
        .field("classification", &LASPoint::classification);
    
    emscripten::register_vector<uint8_t>("VectorUint8");
}
