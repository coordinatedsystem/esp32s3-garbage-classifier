# ESP32-S3 智能垃圾分类系统

基于 ESP32-S3 + OV3660 + CLIP/Vision LLM 的智能垃圾分类识别系统。硬件端拍照上传，后端 AI 识别（CLIP + 豆包/千问/自定义视觉大模型），前端 Web 仪表板实时监控。

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
│   ├── server.py                        # FastAPI 后端 (CLIP + Vision LLM + YOLO)
│   ├── requirements.txt                 # Python 依赖
│   └── clip_model/                      # CLIP 模型 (~580MB, 需自行下载)
├── frontend/
│   ├── src/
│   │   ├── App.jsx                      # 主布局
│   │   ├── api.js                       # API 聚合层
│   │   ├── hooks/usePolling.js          # 轮询 Hook
│   │   └── components/
│   │       ├── HardwarePanel.jsx        # 硬件状态面板
│   │       ├── ModelSelector.jsx        # 5 模型统一选择器
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
│  OV3660      │                    │   CLIP /     │                 │   Dashboard  │
│  ST7735      │◀─── JSON result ── │   Vision LLM │─── /history ──▶│   :5173      │
└──────────────┘                    │   :8085      │                 └──────────────┘
     │                                      │                              │
     │ 硬件采集 POST /classify              │ 共享状态 (threading.Lock)     │ usePolling 每 6s
     │ ?source=esp32&ip=<ip>               │ 多模型路由 + 自动回退        │ 轮询 /health
     └──────────────────────────────────────┘                              │ /hardware/status
```

**模型路由**：前端 `POST /model/active` 设置服务端激活模型 → ESP32 始终调用 `/classify` → 后端按激活模型路由（CLIP / 豆包 / 千问 / 自定义）。ESP32 无需刷写固件即可跟随前端模型切换。视觉模型未配置或调用失败时自动回退到 CLIP。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/classify` | 图像分类（CLIP / Vision LLM 路由，支持 `?source=esp32`） |
| POST | `/detect` | YOLO 目标检测，返回检测框列表 |
| GET  | `/health` | 健康检查 (运行时间/硬件在线/标签数/激活模型) |
| GET  | `/models` | 可用模型信息 (含视觉模型配置状态) |
| GET  | `/model/active` | 获取当前激活的分类模型 |
| POST | `/model/active?model=xxx` | 切换激活模型 (clip/doubao/qwen/custom) |
| POST | `/model/config` | 配置视觉模型 API Key/Base URL/Model Name |
| GET  | `/history?page=1&limit=20` | 服务端历史记录 (含 model_used) |
| DELETE | `/history` | 清空历史记录 |
| POST | `/hardware/capture` | ESP32 上传采集图片 |
| GET  | `/hardware/image` | 获取最新硬件采集图片 (image/jpeg) |
| GET  | `/hardware/status` | 硬件状态 (在线/IP/采集次数/固件版本) |

## 前端功能模块

| 模块 | 说明 |
|------|------|
| **StatusBar** | 服务在线状态 + 延迟 / 硬件连接 / 运行时间 / 标签总数 / 激活模型 |
| **HardwarePanel** | 硬件四维度状态卡片 + 最新采集图像 16:9 预览 |
| **ModelSelector** | 5 模型统一标签栏 (CLIP/豆包/千问/自定义/YOLO)，两步确认切换，视觉模型 API Key 配置 |
| **UploadPanel** | 拖拽/点击上传本地图片，自动路由到当前激活模型 |
| **ResultsDisplay** | 结果判定 + 置信度仪表 + 垃圾分类说明 + 模型名称 |
| **ConfidenceGauge** | SVG 动画环形置信度仪表 (≥80%绿 ≥50%黄 <50%红) |
| **HistoryList** | 服务端历史记录，按模式筛选，显示实际使用的模型 |

## 识别模型

| 模型 | 类型 | 说明 |
|------|------|------|
| **CLIP ViT-B/32** | 本地分类 | 零样本图像分类，匹配 140+ 标签并映射垃圾类别。始终可用，无需联网。 |
| **豆包 Vision** | 云端分类 | 字节豆包视觉大模型。需配置火山引擎 API Key。 |
| **千问 Vision** | 云端分类 | 阿里通义千问视觉大模型。需配置 DashScope API Key。 |
| **自定义 Vision** | 云端分类 | 兼容 OpenAI 格式的任意视觉模型。自行配置 API 地址与模型名。 |
| **YOLO exp-22** | 本地检测 | 自定义目标检测模型。仅网页端使用，不影响 ESP32。 |

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
| 固件 | Arduino (C++), esp32-camera, Adafruit ST7735, ArduinoJson |
| 后端 | Python 3.9+, FastAPI, PyTorch, Transformers (CLIP ViT-B/32), Ultralytics YOLO |
| 前端 | React 18, Vite 6, Tailwind CSS 3, Framer Motion, Phosphor Icons |
| 通信 | HTTP multipart/form-data, JSON, WiFi STA |
| 视觉 API | OpenAI-compatible format (豆包/千问/自定义) |

## 变更日志

### v3.0.0
- **视觉大模型集成**：后端支持豆包 Vision、千问 Vision、自定义 OpenAI 兼容模型
- **5 模型统一选择器**：CLIP / 豆包 / 千问 / 自定义 / YOLO 单标签栏，两步确认防止误切换
- **前端模型切换 → ESP32 自动跟随**：前端 POST `/model/active` 设置服务端激活模型，ESP32 无需刷写固件
- **自动回退机制**：视觉模型未配置或 API 调用失败时自动回退到 CLIP（ESP32 透明，Web 端报错）
- **前端可视化 API Key 配置**：视觉模型 API Key / Base URL / Model Name 直接在模型选择器中填写
- **模型名称记录与展示**：后端日志 + 固件屏幕 + 历史记录均显示实际使用的模型（避免回退时误判）
- **固件 loop 简化**：移除状态机，改用简单轮询 loop，根除 socket 耗尽导致第二次上传超时
- **HTTP 错误处理优化**：不再重启 ESP32，显示错误码/服务器/RSSI 后自动返回就绪
- **WiFi 状态可视化**：drawReady 屏幕显示 WiFi RSSI 及信号强弱颜色
- **后端日志增强**：视觉模型调用打印 API URL、图片大小、响应耗时、原始响应、识别结果

### v2.0.1
- 分阶段计时显示（转换/上传+推理/总耗时），便于诊断瓶颈
- HTTPClient 替代原始 WiFiClient，可靠管理 socket 生命周期
- 结果页冷却期，防止快速连拍导致 WiFi socket 耗尽
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
