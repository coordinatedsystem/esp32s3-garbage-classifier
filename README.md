# ESP32-S3 智能垃圾分类系统

基于 ESP32-S3 + OV3660 + CLIP/YOLO 的智能垃圾分类识别系统。硬件端拍照上传，后端 AI 识别，前端 Web 仪表板实时监控。

## 硬件

| 组件 | 型号 |
|------|------|
| MCU | ESP32-S3-WROOM-1-N16R8 |
| 摄像头 | OV3660 (3MP, FPC 接口) |
| 屏幕 | ST7735S 1.8" 128×160 RGB-TFT |

### 屏幕接线 (软件 SPI)

| 屏幕 | ESP32 |
|------|-------|
| GND  | GND   |
| VDD  | 3.3V  |
| SCL  | GPIO 14 |
| SDA  | GPIO 38 |
| RST  | GPIO 1  |
| DC   | GPIO 39 |
| CS   | GPIO 40 |
| BLK  | GPIO 41 |

### 操作方式

- **短按 BOOT 键** (GPIO 0)：拍照并识别

## 项目结构

```
├── firmware/esp32s3_garbage_classifier/
│   └── esp32s3_garbage_classifier.ino   # ESP32-S3 固件
├── backend/
│   ├── server.py                        # FastAPI 后端 (CLIP + YOLO)
│   ├── requirements.txt                 # Python 依赖
│   └── clip_model/                      # CLIP 模型 (~580MB, 需自行下载)
├── frontend/
│   ├── src/
│   │   ├── App.jsx                      # 主布局
│   │   ├── api.js                       # API 聚合层
│   │   ├── hooks/usePolling.js          # 轮询 Hook
│   │   └── components/
│   │       ├── HardwarePanel.jsx        # 硬件状态面板
│   │       ├── ModelSelector.jsx        # 模型选择器 (CLIP/YOLO)
│   │       ├── UploadPanel.jsx          # 本地上传面板
│   │       ├── ResultsDisplay.jsx       # 识别结果 + 置信度分析
│   │       ├── ConfidenceGauge.jsx      # 置信度动画仪表
│   │       ├── HistoryList.jsx          # 历史记录列表
│   │       └── StatusBar.jsx            # 系统状态栏
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── .gitignore
```

## 快速开始

### 1. 后端

```bash
cd backend
pip install -r requirements.txt
python server.py    # 启动在 0.0.0.0:8085
```

首次运行自动下载 CLIP 模型到 `backend/clip_model/`（约 580MB）。YOLO 模型 `exp-22.pt` 需放置在 `backend/` 目录下。

### 2. 前端

```bash
cd frontend
npm install
npm run dev         # 开发服务器 localhost:5173, 代理 API 到 8085
npm run build       # 生产构建到 dist/
```

构建后，后端可直接以静态文件模式提供服务（访问 `http://<host>:8085/app`）。

### 3. ESP32 固件

1. 复制 `firmware/esp32s3_garbage_classifier/wifi_config.h.example` 为 `wifi_config.h`，填入配置：
```cpp
const char* WIFI_SSID     = "your_ssid";
const char* WIFI_PASS     = "your_password";
const char* SERVER_HOST   = "192.168.x.x";   // 后端 IP
const int   SERVER_PORT   = 8085;
```

2. Arduino IDE 库依赖：
   - **esp32** by Espressif (≥ 2.0.14)
   - **Adafruit GFX Library**
   - **Adafruit ST7735 and ST7789 Library**
   - **ArduinoJson** by Benoit Blanchon

3. 开发板设置：
   - Board: `ESP32S3 Dev Module`
   - USB CDC On Boot: `Enabled`
   - PSRAM: `OPI PSRAM`
   - Flash Size: `16MB (128Mb)`
   - Partition Scheme: `Huge APP (3MB No OTA/1MB SPIFFS)`

4. 编译上传

## 架构

```
┌──────────────┐     WiFi/HTTP      ┌──────────────┐     REST API     ┌──────────────┐
│   ESP32-S3   │ ──── classify ────▶│   FastAPI    │◀──── /health ───│   React SPA  │
│  OV3660      │                    │   CLIP/YOLO  │                 │   Dashboard  │
│  ST7735      │◀─── JSON result ── │   :8085      │─── /history ──▶│   :5173      │
└──────────────┘                    └──────────────┘                 └──────────────┘
     │                                      │                              │
     │ 硬件采集 POST /hardware/capture       │ 共享状态 (threading.Lock)     │ usePolling 每 6s
     └──────────────────────────────────────┘                              │ 轮询 /health
                                                                          │ /hardware/status
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/classify` | CLIP 零样本分类，返回 Top3 + 垃圾分类 |
| POST | `/detect` | YOLO 目标检测，返回检测框列表 |
| GET  | `/health` | 健康检查 (运行时间/硬件在线/标签数) |
| GET  | `/models` | 可用模型信息 (CLIP + YOLO) |
| GET  | `/history?page=1&limit=20` | 服务端历史记录 (分页) |
| DELETE | `/history` | 清空历史记录 |
| POST | `/hardware/capture` | ESP32 上传采集图片 |
| GET  | `/hardware/image` | 获取最新硬件采集图片 (image/jpeg) |
| GET  | `/hardware/status` | 硬件状态 (在线/IP/采集次数/固件版本) |

`/classify` 支持 `?source=esp32&ip=<ip>` 查询参数，自动标记硬件在线状态。

## 前端功能模块

| 模块 | 说明 |
|------|------|
| **StatusBar** | 服务在线状态 + 延迟 / 硬件连接 / 运行时间 / 标签总数 |
| **HardwarePanel** | 硬件四维度状态卡片 + 最新采集图像 16:9 预览 |
| **ModelSelector** | CLIP/YOLO 双模型状态卡片 + 模式切换 |
| **UploadPanel** | 拖拽/点击上传本地图片测试模型 |
| **ResultsDisplay** | 结果判定 + 置信度仪表 + 垃圾分类说明 |
| **ConfidenceGauge** | SVG 动画环形置信度仪表 (≥80%绿 ≥50%黄 <50%红) |
| **HistoryList** | 服务端历史记录，按模式筛选 (全部/CLIP/YOLO/硬件) |

## 垃圾分类

| 类别 | 包含物品 |
|------|----------|
| 可回收物 | 纸张、塑料瓶、玻璃瓶、金属罐、衣物、电子产品等 |
| 厨余垃圾 | 食物残渣、果皮、骨头、茶叶渣、面包等 |
| 有害垃圾 | 电池、过期药品、荧光灯、指甲油瓶等 |
| 其他垃圾 | 餐盒、卫生纸、陶瓷、一次性用品、口罩等 |

## 技术栈

| 层 | 技术 |
|----|------|
| 固件 | Arduino (C++), esp32-camera, Adafruit ST7735 |
| 后端 | Python 3.9+, FastAPI, PyTorch, Transformers (CLIP ViT-B/32), Ultralytics YOLO |
| 前端 | React 18, Vite 6, Tailwind CSS 3, Framer Motion, Phosphor Icons |
| 通信 | HTTP multipart/form-data, JSON, WiFi STA |

## 变更日志

### v2.0.1
- 分阶段计时显示（转换/上传+推理/总耗时），便于诊断瓶颈
- HTTPClient 替代原始 WiFiClient，可靠管理 socket 生命周期
- 结果页 3 秒冷却期，防止快速连拍导致 WiFi socket 耗尽
- 结果页 12 秒自动返回就绪画面
- 单帧缓冲 (fb_count=1) 减轻 PSRAM 碎片化
- JPEG 质量下调至 60，加快传输速度
- 移除冗余 `/hardware/capture` 请求，后端由 `/classify?source=esp32` 一并处理

### v2.0.0
- OV3660 摄像头使用 YUV422 原生格式，解决 RGB565 颜色错误
- 新增 React 前端仪表板（7 个功能模块，中文界面）
- 后端新增 `/models`、`/history`、`/hardware/*` 共 5 个 API 端点
- 线程安全共享状态（threading.Lock）
- 硬件状态实时监控 + 服务端历史记录
- 固件添加硬件采集端点上报 + 固件版本追踪

### v1.0.0
- ESP32-S3 基础固件（WiFi + 摄像头 + 屏幕）
- FastAPI 后端（CLIP 分类 + YOLO 检测）
- ST7735 屏幕显示识别结果
