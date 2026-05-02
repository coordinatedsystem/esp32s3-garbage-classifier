# ESP32-S3 垃圾分类识别系统

基于 ESP32-S3 + OV2640 的智能垃圾分类识别设备，通过 WiFi 将图片发送到后端服务器，使用 CLIP / YOLO 模型进行物品识别与垃圾分类。

## 硬件

| 组件 | 型号 |
|------|------|
| MCU | ESP32-S3-WROOM-1-N16R8 |
| 摄像头 | OV2640 (板载 FPC 接口) |
| 屏幕 | ST7735S 1.8" 128x160 RGB-TFT |

### 屏幕接线

| 屏幕引脚 | ESP32 引脚 |
|----------|------------|
| GND  | GND |
| VDD  | 3.3V |
| SCL  | GPIO 14 |
| SDA  | GPIO 38 |
| RST  | GPIO 1  |
| DC   | GPIO 39 |
| CS   | GPIO 40 |
| BLK  | GPIO 41 |

### 操作方式

- **短按 BOOT 键**: 拍照并识别 (调用 `/classify`)
- **长按 BOOT 键 (>0.5s)**: 切换 分类/检测 模式

## 项目结构

```
├── esp32s3_garbage_classifier.ino   # ESP32-S3 固件
├── wifi_config.h.example            # WiFi 配置模板
├── backend/
│   ├── server.py                    # 后端服务 (FastAPI + CLIP + YOLO)
│   ├── clip_desktop.py              # 桌面版 CLIP 识别 (使用电脑摄像头)
│   ├── download_models.py           # 模型下载脚本
│   ├── requirements.txt             # Python 依赖
│   └── exp-22.pt                    # YOLO 模型权重 (5.2MB)
└── .gitignore
```

## 快速开始

### 1. 后端服务器

```bash
# 安装依赖
cd backend
pip install -r requirements.txt

# 下载模型 (约 1.2GB)
python download_models.py

# 启动服务 (端口 8085)
python server.py
```

### 2. ESP32 固件

1. 复制 `wifi_config.h.example` 为 `wifi_config.h`，填入你的 WiFi 信息：
```cpp
const char* WIFI_SSID = "your_wifi_ssid";
const char* WIFI_PASS = "your_wifi_password";
const char* SERVER_HOST = "192.168.x.x";  // 后端服务器 IP
```

2. Arduino IDE 安装依赖库：
   - esp32 by Espressif (>= 2.0.14)
   - Adafruit GFX Library
   - Adafruit ST7735 and ST7789 Library
   - ArduinoJson by Benoit Blanchon

3. 开发板设置 (Tools):
   - Board: `ESP32S3 Dev Module`
   - USB CDC On Boot: `Enabled`
   - PSRAM: `OPI PSRAM`
   - Flash Size: `16MB (128Mb)`
   - Partition Scheme: `Huge APP (3MB No OTA/1MB SPIFFS)`

4. 编译并上传到 ESP32-S3

## API 接口

### POST /classify
CLIP 零样本物品分类，返回 Top3 识别结果和垃圾分类类别。

### POST /detect
YOLO 目标检测，识别图片中的物品。

### GET /health
健康检查。

## 垃圾分类类别

系统将垃圾分为四类：
- 🟢 **可回收物** (Recyclable) - 纸张、塑料、玻璃、金属等
- 🟠 **厨余垃圾** (Kitchen waste) - 食物残渣、果皮等
- 🔴 **有害垃圾** (Hazardous) - 电池、药品、化学品等
- ⚪ **其他垃圾** (Other) - 餐盒、卫生纸、陶瓷等

## 依赖

- Python 3.9+
- PyTorch 2.0+
- Transformers 4.30+
- Ultralytics 8.0+
- FastAPI
