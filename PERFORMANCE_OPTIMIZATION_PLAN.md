# 性能优化计划 — ESP32-S3 智能垃圾分类系统 v5.0.0

> 优化分支: `opt` | 日期: 2026-06-09 | 目标: 降低推理延迟、提升吞吐量、减少内存占用

---

## 一、后端推理优化 (AI Engineer)

### P0-1: CLIP 文本特征预计算 [高影响]
- **代码位置**: `server.py:423-426`, `server.py:459`
- **当前问题**: 每次请求都将全部 151 条 text prompts 送入 text encoder（12 层 transformer），文本编码器消耗 40-55% 推理时间
- **优化方案**: 启动时调用 `model.get_text_features()` 一次性计算 L2 归一化文本特征，推理时只跑 `get_image_features()` + 手动余弦相似度
- **预期收益**: CLIP 推理延迟 **-35~50%**（800-1200ms → 400-600ms），内存增加 300KB

### P1-2: 跳过 CLIP 路径的中间缩放
- **代码位置**: `server.py:447-449`, `server.py:456`
- **当前问题**: `_prep_image()` 缩放到 1280px，然后 CLIP processor 再缩放到 224px，双重缩放
- **优化方案**: `_prep_image` 增加 `max_edge` 参数，CLIP 分类传 `max_edge=None`
- **预期收益**: **-5~10%** CLIP 延迟

### P1-3: YOLO 推理包装 `torch.inference_mode()`
- **代码位置**: `server.py:489-499`
- **当前问题**: YOLO 没有 `inference_mode()`，缺少算子融合和内存优化
- **优化方案**: 将 `yolo_model.predict()` 包装在 `with torch.inference_mode()` 中
- **预期收益**: **-5~15%** YOLO 延迟

### P1-4: YOLO 直接传入 PIL Image
- **代码位置**: `server.py:491`
- **当前问题**: `np.array(image)` 创建 ~15MB 中间数组，YOLO 直接接受 PIL Image
- **优化方案**: 将 PIL Image 直接传给 `yolo_model.predict(source=image, ...)`
- **预期收益**: **-3~8%** YOLO 延迟，~15MB 峰值内存降低

### P2-5: 预计算分类结果映射
- **代码位置**: `server.py:464-477`
- **当前问题**: 热路径中重复调用 `获取垃圾分类` 和 `LABEL_MAP` 字典查找
- **优化方案**: 启动时预计算 `_CLASSIFY_RESULTS` 列表，按索引 O(1) 查询
- **预期收益**: ~1-2ms 节省

### P2-6: 线程池与 PyTorch 线程数调优
- **代码位置**: `server.py:263-264`, `server.py:405`
- **当前问题**: 4 个 worker × 4 个 PyTorch 线程 = 16 线程竞争，导致上下文切换
- **优化方案**: `torch.set_num_threads(2)` + `INFERENCE_WORKERS = os.cpu_count() or 4`
- **预期收益**: 并发负载下 **-10~25%** 吞吐量提升

### P3-7: YOLO 模型懒加载
- **代码位置**: `server.py:431-434`
- **当前问题**: YOLO 始终加载（~50-100MB），即使只使用 CLIP
- **优化方案**: 双重检查锁定的懒加载模式，`_get_yolo_model()` 访问器
- **预期收益**: 启动时 **-50~100MB** 内存

---

## 二、后端架构优化 (Backend Architect)

### P0-8: 模型加载移出模块作用域 + 并行加载
- **代码位置**: `server.py:403-434`
- **当前问题**: CLIP + YOLO 在 import 时串行加载，启动黑屏 6-14 秒
- **优化方案**: 模型设为 `None`，在 `lifespan` 中用 `run_in_executor` 并行加载 CLIP 和 YOLO
- **预期收益**: 启动时间减半（~10s → ~6s），uvicorn 立即接受连接

### P1-9: ThreadPoolExecutor 背压控制
- **代码位置**: `server.py:263-264`, `server.py:347-349`
- **当前问题**: 无限工作队列，高并发时内存无限增长
- **优化方案**: `asyncio.Semaphore(INFERENCE_WORKERS * 2)` 限制排队，超限返回 429
- **预期收益**: 防止内存耗尽，可预测的延迟

### P1-10: Vision API 连接池 (httpx)
- **代码位置**: `server.py:195-210`
- **当前问题**: 每次 Vision API 调用新建 TCP+TLS 连接（35-130ms 开销）
- **优化方案**: 替换 `urllib.request` 为 `httpx.AsyncClient` 连接池
- **预期收益**: 后续调用 **-35~130ms** TLS 握手开销

### P2-11: 中间件跳过静态资源和 SSE
- **代码位置**: `server.py:365-401`
- **当前问题**: 中间件在每个 `/assets/*` 和 `/events` 请求上都获取锁 + 计数
- **优化方案**: 在中间件顶部添加 `_SKIP_METRICS_PREFIXES` 跳过列表
- **预期收益**: 减少 ~80% 中间件调用，修复 SSE inflight 计数膨胀

### P2-12: 拆分为独立锁
- **代码位置**: `server.py:228`
- **当前问题**: 单一 `state_lock` 保护所有共享状态（硬件、历史、指标）
- **优化方案**: 为 `hardware_state`/`server_history`/`runtime_metrics` 分别设置锁
- **预期收益**: 减少锁竞争 ~50%

### P3-13: 历史记录改用 deque
- **代码位置**: `server.py:327-329`
- **当前问题**: `list.insert(0, ...)` O(n)，虽然有 HISTORY_MAX=50 影响很小
- **优化方案**: `collections.deque(maxlen=HISTORY_MAX)` O(1) appendleft
- **预期收益**: O(n) → O(1)，代码更简洁

---

## 三、前端性能优化 (Frontend Developer)

### P0-14: History 缩略图分离端点 [高影响]
- **代码位置**: `server.py:302-323`, `HistoryList.jsx:182-183`
- **当前问题**: Base64 缩略图嵌入 JSON，100 条记录 = 1-2 MB 载荷
- **优化方案**: 后端新增 `/history/thumb/{id}` 返回 `image/jpeg`，前端懒加载
- **预期收益**: 历史 API 响应 **-99%**（1.5MB → 10KB）

### P1-15: 消除 SSE 与轮询重叠
- **代码位置**: `App.jsx:41-42`, `App.jsx:47-57`
- **当前问题**: 硬件状态同时被 3s 轮询和 SSE 推送覆盖，存在竞态
- **优化方案**: SSE 推送完整 `hardware_state`，移除 3s 轮询或降低至 30s 兜底
- **预期收益**: 减少 20 次 HTTP 请求/分钟，消除竞态条件

### P1-16: 面板添加 React.memo
- **代码位置**: 全部 6 个组件文件
- **当前问题**: 所有面板每次 App 状态变更都重新渲染，即使 `visible=false`
- **优化方案**: `React.memo` 包装 `HardwarePanel`/`ModelSelector`/`UploadPanel`/`HistoryList`
- **预期收益**: 减少 40-60 次子树协调/分钟

### P2-17: 替换 `transition: all` 为显式属性
- **代码位置**: `index.css:32`
- **当前问题**: `transition: all` 导致非预期的布局动画和 CPU 重绘
- **优化方案**: 改为 `transition: background-color 0.2s, color 0.2s, opacity 0.2s, transform 0.15s`
- **预期收益**: 消除意外布局过渡，每次 hover 减少 ~5-10ms

### P2-18: 删除 StatusBar.jsx 死代码
- **代码位置**: `StatusBar.jsx` (整个文件, 101 行)
- **当前问题**: 未被引用，引入 `framer-motion`/`usePolling`/`checkHealth`
- **优化方案**: 删除文件
- **预期收益**: 移除 101 行死代码，防止未来意外引入双轮询

### P3-19: HistoryList 事件委托
- **代码位置**: `HistoryList.jsx:152-216`
- **当前问题**: 100 个条目创建 100 个内联箭头函数
- **优化方案**: 父容器事件委托 + `data-id` 属性
- **预期收益**: 函数分配 O(n) → O(1)

---

## 四、固件性能优化 (Embedded Firmware)

### P0-20: JPEG 质量 60→40 + TCP_NODELAY
- **代码位置**: `esp32s3_garbage_classifier.ino:534`, `:399-406`
- **当前问题**: JPEG 质量偏高导致上传大，Nagle 算法延迟发送小包
- **优化方案**: `fmt2jpg(..., 40, ...)` + `client.setNoDelay(true)`
- **预期收益**: 上传体积 -30~50%，延迟 -50~200ms

### P0-21: HTTP 热路径消除 String 拼接
- **代码位置**: `esp32s3_garbage_classifier.ino:393-414`, `:553`
- **当前问题**: URL/Header 构建创建 8-12 个临时 String 对象，堆碎片化
- **优化方案**: `client.printf()` 直接输出 + `snprintf` 构建 URL
- **预期收益**: 消除每次分类的堆碎片风险

### P1-22: 增量屏幕更新
- **代码位置**: `esp32s3_garbage_classifier.ino:669-722`
- **当前问题**: `drawReady()` 全屏重绘（70-140ms），配置变更只需部分刷新
- **优化方案**: 拆分 `drawReady()` 为 `drawReadyConfig()`/`drawReadyWiFi()` 子函数
- **预期收益**: 配置更新路径 **-55~110ms**

### P1-23: JSON 文档缩小 + 响应流式解析
- **代码位置**: `:104`, `:453-502`, `:582`
- **当前问题**: 4096 字节 classifyDoc + 响应体 String 多份拷贝
- **优化方案**: classifyDoc 缩至 1024 字节，responseBody 消除
- **预期收益**: 释放 3-5 KB 堆内存

### P2-24: 硬件看门狗
- **代码位置**: `loop()` 函数
- **当前问题**: 无看门狗，HTTP 卡死时设备需手动复位
- **优化方案**: 启用 ESP32 TWDT（30 秒超时），在 loop 中定期喂狗
- **预期收益**: 自动恢复锁死

### P3-25: 按钮模式省电优化
- **代码位置**: `:148`, `:296-308`, `:709`
- **当前问题**: 按钮模式下持续轮询 + TOF 常开 + WiFi 不休眠
- **优化方案**: GPIO 中断替代轮询 + TOF 断电 + WiFi modem sleep
- **预期收益**: **-70~80%** 功耗（130mA → 25-40mA）

---

## 实施优先级

| 批次 | 优化项 | 预计耗时 | 总收益 |
|------|--------|----------|--------|
| **第1批 (立即)** | P0-1, P0-8, P0-14, P0-20, P0-21 | 1-2h | 启动时间减半、推理 -35%、历史载荷 -99%、上传加速 |
| **第2批 (短期)** | P1-2~4, P1-9, P1-10, P1-15, P1-16, P0-22, P1-23 | 2-3h | 背压保护、连接复用、渲染优化、屏幕刷新加速 |
| **第3批 (迭代)** | P2-5~6, P2-11~12, P2-17~18, P2-24 | 1-2h | 锁拆分、中间件跳过、CSS 优化、看门狗 |
| **第4批 (可选)** | P3-7, P3-13, P3-19, P3-25 | 1-2h | YOLO 懒加载、省电、微优化 |
