# ESP32-S3 智能垃圾分类系统

基于 ESP32-S3 + OV3660 + CLIP/Vision LLM 的智能垃圾分类识别系统。硬件端拍照上传，后端 AI 识别（CLIP + 豆包/千问/自定义视觉大模型），前端 Web 仪表板实时监控。

## 硬件

| 组件 | 型号 |
|------|------|
| MCU | ESP32-S3-WROOM-1-N16R8 |
| 摄像头 | OV3660 (3MP, FPC 接口) |
| 屏幕 | ST7735S 1.8" 128×160 RGB-TFT |
| 激光测距 | TOF200C VL53L0X (I2C, 最大 2m) |

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

### TOF200C 接线 (I2C)

| TOF200C | ESP32 |
|---------|-------|
| VIN     | 3.3V  |
| GND     | GND   |
| SDA     | GPIO 47 |
| SCL     | GPIO 21 |
| INT     | GPIO 48 |
| SHUT    | GPIO 45 |

### 操作方式

- **按键触发**：短按 BOOT 键 (GPIO 0) 拍照并识别
- **距离触发**：TOF 检测到物体在设定距离范围内稳定超过缓冲时间后自动触发（前端可配置）

## 项目结构

```
├── firmware/esp32s3_garbage_classifier/
│   ├── esp32s3_garbage_classifier.ino   # ESP32-S3 固件
│   └── test_tof200c/                    # TOF200C 激光测距模块测试
├── backend/
│   ├── server.py                        # FastAPI 后端 (CLIP + Vision LLM + YOLO)
│   ├── requirements.txt                 # Python 依赖
│   └── clip_model/                      # CLIP 模型 (~580MB, 需自行下载)
├── frontend/
│   ├── src/
│   │   ├── App.jsx                      # 主布局 (侧栏导航 + 系统状态 + 面板路由)
│   │   ├── api.js                       # API 聚合层
│   │   ├── hooks/usePolling.js          # 轮询 Hook
│   │   └── components/
│   │       ├── HardwarePanel.jsx        # 硬件状态 + 触发配置 + 采集预览
│   │       ├── ModelSelector.jsx        # 5 模型选择器 + API Key 配置
│   │       ├── UploadPanel.jsx          # 图片拖拽/上传
│   │       ├── ResultsDisplay.jsx       # 分类/检测结果 + 置信度
│   │       ├── ConfidenceGauge.jsx      # SVG 环形置信度仪表
│   │       └── HistoryList.jsx          # 历史记录 (分类筛选 + 触发来源)
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
   - **Adafruit VL53L0X Library**
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
│  VL53L0X     │                    │   YOLO       │                 │              │
└──────────────┘                    │   :8085      │                 └──────────────┘
     │                                      │                              │
     │ POST /classify?source=esp32          │ 共享状态 (threading.Lock)     │ 左侧 220px 导航栏
     │ GET  /hardware/heartbeat             │ 多模型路由 + 自动回退        │  └ 系统状态卡片
     │ GET  /trigger/config (每 30s)        │ SSE /events 实时推送         │ EventSource /events
     └──────────────────────────────────────┘                              │ 实时接收 new_capture
```

**模型路由**：前端设置激活模型 → ESP32 始终调用 `/classify` → 后端按激活模型路由（CLIP / 豆包 / 千问 / 自定义）。ESP32 无需刷写固件即可跟随前端模型切换。视觉模型未配置或调用失败时自动回退到 CLIP。

**硬件在线检测**：ESP32 每 30 秒调用 `/hardware/heartbeat` 上报心跳，并拉取 `/trigger/config` 同步触发参数。服务端记录 `last_seen` 时间戳，超过 60 秒无心跳则判定离线。

**实时推送**：后端通过 SSE（Server-Sent Events）在 ESP32 拍照后即时推送 `new_capture` 事件到前端，前端无需等待轮询即可立即刷新采集图像。

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
| DELETE | `/history/item?id=xxx` | 删除单条历史记录 |
| POST | `/hardware/capture` | ESP32 上传采集图片 |
| GET  | `/hardware/image` | 获取最新硬件采集图片 (image/jpeg) |
| GET  | `/hardware/status` | 硬件状态 (在线/IP/采集次数/固件版本) |
| GET  | `/hardware/heartbeat` | 硬件心跳上报 (`device_id/firmware_version/ip_address`) |
| GET  | `/trigger/config` | 获取触发配置 |
| POST | `/trigger/config` | 设置触发配置 |
| GET  | `/events` | SSE 实时推送 (客户端订阅 new_capture 事件) |
| GET  | `/metrics/runtime` | 运行时指标 (QPS/队列深度/推理统计)

## 前端功能模块

| 模块 | 说明 |
|------|------|
| **App (侧栏)** | 左侧 220px 导航栏集成系统状态（服务/硬件在线、当前模型、触发模式），10 秒轮询刷新 |
| **HardwarePanel** | 硬件四维度卡片（连接/采集/活动/固件）+ 触发配置（模式/距离/间隔）+ 实时采集预览 |
| **ModelSelector** | 5 模型标签栏（CLIP/豆包/千问/自定义/YOLO），两步确认切换，独立 API Key 配置 |
| **UploadPanel** | 拖拽/点击上传本地图片，自动路由到当前激活模型 |
| **ResultsDisplay** | 分类结果 + 置信度仪表 + 垃圾类别说明 + 模型名称 |
| **ConfidenceGauge** | SVG 动画环形置信度仪表（≥80% 绿 / ≥50% 黄 / <50% 红） |
| **HistoryList** | 服务端历史记录，按分类筛选，显示触发来源标签（按键/距离触发） |

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

### v5.0.0
- **SSE 实时推送**：后端新增 `/events` 端点（Server-Sent Events），ESP32 拍照后立即推送 `new_capture` 事件到前端，HardwarePanel 通过 `EventSource` 订阅，图片刷新零延迟
- **摄像头旧帧修复**：固件 `captureAndClassify()` 在正式拍照前丢弃传感器缓冲区内的旧帧（`esp_camera_fb_get` + `esp_camera_fb_return`），确保每次 BOOT 键按下提交的是当前画面而非上一张
- **线程安全增强**：`last_capture_image` 全局变量所有读写路径统一使用 `state_lock` 保护（`/classify`、`/hardware/capture`、`/hardware/image`）
- **自适应轮询**：`usePolling` Hook 在请求失败时自动切换到 2 秒快速重试，成功后恢复标准间隔，解决网络恢复后长时间等待问题
- **React 18 StrictMode 修复**：`usePolling` 的 `mountedRef` 在 mount effect 中重置为 `true`，修复严格模式双挂载导致的状态永不更新 bug
- **单条历史记录删除**：新增 `DELETE /history/item?id=xxx` 端点，前端 HistoryList 悬浮显示删除按钮
- **状态提升**：硬件状态轮询从 HardwarePanel 提升至 App 层，侧栏与硬件面板共享同一数据源，消除状态不一致
- **触发配置反馈**：HardwarePanel 保存触发参数后显示实时反馈（保存中 → 已同步），清晰的状态提示
- **健康检查心跳去耦**：新增 `/hardware/heartbeat` 专用端点，硬件在线检测与触发配置请求分离
- **可观测性中间件**：请求计数、延迟统计、错误率追踪，新增 `/metrics/runtime` 运行时指标端点

### v4.1.0
- **侧栏重新设计**：左侧导航栏扩展至 220px，集成系统状态卡片（服务在线、硬件心跳、当前模型、触发模式），实时轮播刷新
- **硬件心跳检测**：ESP32 每 30 秒调用 `/hardware/heartbeat`，服务端超时 60 秒自动判定离线
- **移除顶部状态栏**：StatusBar 组件废弃，系统状态信息整合至侧栏
- **面板保持挂载**：标签页切换改为 `hidden` 显隐，不再卸载重载，消除切换延迟
- **代码整理**：`hardware_capture` 去重调用 `_add_history`、修复 `trigger_config` 竞态条件、setTimeout 清理、API Key 表单隔离、字体统一
- **触发来源显示**：历史记录显示按键触发 / 距离触发标签

### v4.0.1
- **可配置触发间隔**：新增最小触发间隔参数（1–60s，默认 10s），防止 TOF 距离触发过于频繁导致屏幕闪烁
- **TFT 屏幕反馈优化**：前端保存配置后设备显示 "Updating..." → "Config OK"；距离模式显示物品检测倒计时
- **历史记录触发来源**：每条记录显示触发方式标签（按键触发 / 距离触发）
- **性能优化**：上传缓冲区改用 PSRAM 分配；配置解析改用 StaticJsonDocument（栈分配）；移除死代码
- **UI 修复**：移除标签页 AnimatePresence 动画（修复模型切换后硬件页面内容消失）；玻璃卡片改为扁平白色
- **字体统一**：所有小字体统一为 `text-xs`，移除 hardcoded pixel 尺寸

### v4.0.0
- **TOF200C VL53L0X 激光测距模块**：新增 TOF 距离传感器支持，实现自动触发拍照
- **双触发模式**：BOOT 按键触发 + TOF 距离感应自动触发，前端可随时切换
- **触发参数配置**：距离范围（最小/最大触发距离 mm）+ 缓冲时间（ms），前端滑块与数值输入双控
- **响应时间显示**：每次识别显示服务端响应耗时（ms），结果与历史记录均可查看
- **前端布局重构**：左侧窄导航栏 + 右侧主内容区，微软雅黑字体，专业扁平化风格
- **双输入交互**：所有参数同时支持滑块拖拽与手动数字输入
- **触发配置 API**：新增 `GET/POST /trigger/config` 端点，固件定期拉取同步
- **test_tof200c 测试固件**：独立 TOF 模块功能验证，I2C 扫描 + 连续测距

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
