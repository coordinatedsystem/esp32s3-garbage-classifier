# 代码审查报告 — ESP32-S3 垃圾分类系统

> 审查日期: 2026-06-09 | 版本: v5.0.0

---

## 后端 (Python/FastAPI) — `backend/server.py`

| 优先级 | 问题 | 位置 |
|--------|------|------|
| **P0** | `threading.Lock` 在异步事件循环线程中使用，锁竞争时会冻结整个服务 | `server.py:225` |
| **P0** | `inference_executor` 没有 shutdown 处理，进程退出时工作线程被直接杀死 | `server.py:261` |
| **P1** | SSE 队列使用无界 `asyncio.Queue()`，慢客户端可导致内存泄漏；`QueueFull` 是死代码 | `server.py:941`、`286` |
| **P1** | 离线环境变量 `HF_HUB_OFFLINE=1` 与首次运行下载路径冲突，需手动注释 | `server.py:10-11`、`403` |
| **P1** | CLIP 文本编码器每次请求都重新计算（应在启动时预计算 `text_features` 并缓存） | `server.py:448` |
| **P1** | `_add_history()` 同步调用 PIL 图像处理，阻塞事件循环（`/detect` 端点无 background_tasks） | `server.py:783` |
| **P2** | `_call_vision_llm` 响应体读取没有流级别超时，可能无限挂起 | `server.py:205` |
| **P2** | Vision API 失败回退到 CLIP 时缺少指标计数，运营无感知 | `server.py:538-546` |
| **P2** | 约 30 处 `print()` 应替换为结构化 `logger` 调用 | 多处 |
| **P2** | `POST /model/active` 用 Query 参数做状态变更，应用 JSON body | `server.py:665` |
| **P3** | 1033 行单文件应拆分为 `routes/`、`state.py`、`inference/` 模块 | 整体架构 |
| **P3** | YOLO 模型始终加载（~200-400MB），应懒加载 | `server.py:422` |

## 前端 (React/Vite) — `frontend/src/`

| 优先级 | 问题 | 位置 |
|--------|------|------|
| **P0** | 两个独立的 `EventSource('/events')` 连接 — `App.jsx` 和 `HardwarePanel` 各一个 | `App.jsx:45`、`HardwarePanel:62` |
| **P0** | `StatusBar.jsx` 是死代码，从未被引用，且会重复轮询 `/health` | 整个文件 |
| **P0** | SSE 部分更新覆盖全部 `hwStatus` 字段（只保留 `online`，丢弃 capture_count 等） | `App.jsx:49` |
| **P1** | 用 CSS `hidden` 保持所有面板挂载，导致隐藏面板仍然运行副作用（SSE、fetch、拖拽事件） | `App.jsx:218-226` |
| **P1** | `api.js` 不区分超时错误和网络错误，抛出浏览器内部英文消息给用户 | `api.js:3-8` |
| **P1** | `HistoryList` 获取失败静默吞错，显示"暂无记录"与实际空记录无法区分 | `HistoryList:26-27` |
| **P1** | 大量 `text-zinc-400`/`text-zinc-300` 文字对比度不通过 WCAG AA | 多个文件 |
| **P1** | 拖拽上传区无键盘可访问性（缺少 `onKeyDown`/`tabIndex`/`role`） | `UploadPanel:114` |
| **P1** | 表单 `<label>` 缺少 `htmlFor`/`id` 关联 | `ModelSelector`、`HardwarePanel` |
| **P1** | 删除按钮仅在 hover 时可见，无 `focus-visible` 支持，缺少 `aria-label` | `HistoryList:155-161` |
| **P2** | 无 `prefers-reduced-motion` 支持 | 全局 |
| **P3** | `LoadingSkeleton`/`ErrorState` 内联在 App.jsx 中 | `App.jsx:261-302` |

## 固件 (ESP32/Arduino) — `esp32s3_garbage_classifier.ino`

| 优先级 | 问题 | 位置 |
|--------|------|------|
| **P0** | `DynamicJsonDocument(4096)` 每次识别都从堆分配/释放，导致堆碎片化，最终必定崩溃 | `:562` |
| **P0** | `responseBody.reserve(512)` 太小，2-4KB JSON 响应触发多次重分配 + 按字符追加导致 O(n²) | `:435`、`456`、`472`、`478` |
| **P0** | WiFi 断线重连执行完整扫描（2-5秒阻塞）+ 30 秒连接循环，可能触发看门狗复位 | `:150-171`、`764` |
| **P1** | `readBytes(128)` 在 TCP 数据不足时会阻塞等待流超时（1-3秒），累积延迟大 | `:451-456` |
| **P1** | TOF `RangeStatus != 4` 同时接受硬件故障(5)和信号失败(2)为有效读数 | `:310` |
| **P1** | `captureAndClassify()` 阻塞主循环整个 HTTP 往返（最长30秒），期间设备无响应 | `:491-636` |
| **P1** | `wifi_config.h` 包含 WiFi 密码已提交到仓库 | 文件 |
| **P1** | `triggerMode` 字符串未校验，非法值直接走距离模式逻辑 | `:330`、`805` |
| **P1** | `presenceStart` 在模式从距离切换到按钮时不重置，切回距离模式可能立即误触发 | `:856` |

---

## 修复优先级建议

**立即修复 (本期)**：
1. 固件 — 将 `DynamicJsonDocument` 改为全局复用，修复 `String` 拼接方式
2. 前端 — 合并两个 SSE 连接到单个 context/hook
3. 后端 — 给 SSE 队列加 `maxsize`，添加 executor shutdown 钩子
4. 前端 — 修复 App.jsx 中 SSE 的 `hwStatus` 覆盖问题

**短期修复 (下期)**：
5. 后端 — 拆分 `server.py` 模块化
6. 前端 — 提升可访问性（键盘导航、颜色对比度、表单标签）
7. 固件 — 优化 WiFi 重连为非阻塞状态机
