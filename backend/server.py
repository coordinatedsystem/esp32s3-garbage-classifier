import os
import asyncio
import logging
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

# 本地加载（模型已下载到 backend/clip_model/）
# 首次运行需注释下面两行以下载模型
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
# 加速：CPU性能优化
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["OMP_NUM_THREADS"] = "4"
os.environ["MKL_NUM_THREADS"] = "4"

from PIL import Image
import torch
import io
import numpy as np
import traceback
import threading
import time
import base64
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from transformers import CLIPProcessor, CLIPModel
from ultralytics import YOLO

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s"
)
logger = logging.getLogger("garbage-classifier")

# ===================== 标签映射（完全保留） =====================
LABEL_MAP = {
    "a common stationery pen": "笔", "a book for study": "书本", "an eraser for writing": "橡皮",
    "a sheet of white paper": "纸张", "a student notebook": "笔记本", "a pencil": "铅笔",
    "a ruler for measuring length": "尺子", "a stapler": "订书机", "a folder": "文件夹",
    "a envelope": "信封", "a printer paper": "打印纸", "a correction tape": "修正带",
    "an apple": "苹果", "a banana": "香蕉", "an orange": "橙子", "a watermelon": "西瓜",
    "a grape": "葡萄", "a strawberry": "草莓", "a tomato": "西红柿", "a cucumber": "黄瓜",
    "a carrot": "胡萝卜", "a potato": "土豆", "a cabbage": "白菜", "a spinach": "菠菜",
    "a leftover rice": "剩饭", "a leftover dish": "剩菜", "a bone": "骨头", "a egg shell": "蛋壳",
    "a tea leaf": "茶叶渣", "a coffee grounds": "咖啡渣", "a bread": "面包", "a noodle": "面条",
    "a biscuit": "饼干", "a potato chip": "薯片", "a chocolate": "巧克力", "a candy": "糖果",
    "a instant noodle": "方便面", "a jelly": "果冻", "a nut": "坚果", "a lollipop": "棒棒糖",
    "a chewing gum": "口香糖", "a t-shirt": "T恤", "a pants": "裤子", "a coat": "外套",
    "a sweater": "毛衣", "a dress": "连衣裙", "a sock": "袜子", "a underwear": "内衣",
    "a shoe": "鞋子", "a hat": "帽子", "a scarf": "围巾", "a glove": "手套", "a towel": "毛巾",
    "a bedsheet": "床单", "a quilt": "被子", "a pillow": "枕头", "a toothbrush": "牙刷",
    "a toothpaste": "牙膏", "a shampoo bottle": "洗发水瓶", "a shower gel bottle": "沐浴露瓶",
    "a facial cleanser": "洗面奶", "a laundry detergent bottle": "洗衣液瓶", "a soap": "肥皂",
    "a toilet paper": "卫生纸", "a tissue box": "纸巾盒", "a mask": "口罩", "a plastic comb": "塑料梳子",
    "a mirror": "镜子", "a laundry basket": "洗衣篮", "a plastic beverage bottle": "塑料瓶",
    "a plastic bowl": "塑料碗", "a plastic box": "塑料盒", "a plastic bag": "塑料袋",
    "a plastic bucket": "塑料桶", "a plastic hanger": "塑料衣架", "a plastic straw": "吸管",
    "a plastic fork": "塑料叉子", "a plastic spoon": "塑料勺子", "a small cardboard box": "纸盒子",
    "a cardboard box": "纸箱", "a newspaper": "报纸", "a magazine": "杂志", "a paper bag": "纸袋",
    "a wrapping paper": "包装纸", "a paper cup": "纸杯", "a paper bowl": "纸碗", "a express box": "快递盒",
    "a glass bottle": "玻璃瓶", "a glass cup": "玻璃杯", "a glass jar": "玻璃罐",
    "a glass ceramic cup": "陶瓷杯", "a ceramic bowl": "陶瓷碗", "a ceramic plate": "陶瓷盘",
    "a can": "易拉罐", "a iron nail": "铁钉", "a metal pot": "金属锅", "a aluminum foil": "铝箔纸",
    "a metal key": "钥匙", "a stainless steel cup": "不锈钢杯", "a mobile phone": "手机",
    "a computer mouse": "鼠标", "a keyboard": "键盘", "a charger": "充电器", "a data cable": "数据线",
    "a earphone": "耳机", "a remote control": "遥控器", "a desk lamp": "台灯", "a fan": "电风扇",
    "a power bank": "充电宝", "a battery": "电池", "a plug": "插头", "a plastic toy": "塑料玩具",
    "a doll": "玩偶", "a lego brick": "乐高积木", "a ball": "球", "a badminton racket": "羽毛球拍",
    "a basketball": "篮球", "a football": "足球", "a skipping rope": "跳绳", "a puzzle": "拼图",
    "a toy car": "玩具车", "a cooking pot": "炒锅", "a chopsticks": "筷子", "a dish": "盘子",
    "a spatula": "锅铲", "a bowl": "碗", "a kettle": "水壶", "a mop": "拖把", "a broom": "扫帚",
    "a dustpan": "簸箕", "a expired medicine": "过期药品", "a cosmetic bottle": "化妆品瓶",
    "a nail polish bottle": "指甲油瓶", "a fluorescent lamp": "荧光灯", "a thermometer": "温度计",
    "a disposable lunch box": "一次性餐盒", "a disposable cup": "一次性杯子",
    "a disposable chopsticks": "一次性筷子", "a wet wipe": "湿巾", "a plastic wrap": "保鲜膜",
}

TEXT_PROMPTS = list(LABEL_MAP.keys())
MODEL_NAME = "openai/clip-vit-base-patch32"
MODEL_DIR = os.path.join(os.path.dirname(__file__), "clip_model")

# 仅用于CLIP识别结果的垃圾分类映射，未覆盖项默认归为其他垃圾
WASTE_CATEGORY_MAP = {
    "厨余垃圾": {
        "苹果", "香蕉", "橙子", "西瓜", "葡萄", "草莓", "西红柿", "黄瓜", "胡萝卜", "土豆", "白菜", "菠菜",
        "剩饭", "剩菜", "骨头", "蛋壳", "茶叶渣", "咖啡渣", "面包", "面条", "饼干", "薯片", "巧克力", "糖果",
        "方便面", "果冻", "坚果"
    },
    "可回收物": {
        "笔", "书本", "橡皮", "纸张", "笔记本", "铅笔", "尺子", "订书机", "文件夹", "信封", "打印纸", "修正带",
        "T恤", "裤子", "外套", "毛衣", "连衣裙", "袜子", "内衣", "鞋子", "帽子", "围巾", "手套", "毛巾", "床单", "被子", "枕头",
        "洗发水瓶", "沐浴露瓶", "洗衣液瓶", "塑料瓶", "塑料碗", "塑料盒", "塑料袋", "塑料桶", "塑料衣架", "吸管", "塑料叉子", "塑料勺子",
        "纸盒子", "纸箱", "报纸", "杂志", "纸袋", "包装纸", "纸杯", "纸碗", "快递盒",
        "玻璃瓶", "玻璃杯", "玻璃罐", "易拉罐", "铁钉", "金属锅", "铝箔纸", "钥匙", "不锈钢杯",
        "手机", "鼠标", "键盘", "充电器", "数据线", "耳机", "遥控器", "台灯", "电风扇", "充电宝", "插头",
        "塑料玩具", "玩偶", "乐高积木", "球", "羽毛球拍", "篮球", "足球", "跳绳", "拼图", "玩具车",
        "炒锅", "筷子", "盘子", "锅铲", "碗", "水壶", "拖把", "扫帚", "簸箕", "塑料梳子"
    },
    "有害垃圾": {
        "过期药品", "化妆品瓶", "指甲油瓶", "荧光灯", "温度计", "电池"
    },
    "其他垃圾": {
        "口香糖", "牙刷", "牙膏", "洗面奶", "肥皂", "卫生纸", "纸巾盒", "口罩", "镜子", "洗衣篮",
        "陶瓷杯", "陶瓷碗", "陶瓷盘", "一次性餐盒", "一次性杯子", "一次性筷子", "湿巾", "保鲜膜", "棒棒糖"
    }
}


def 获取垃圾分类(item_label_zh: str):
    if item_label_zh in WASTE_CATEGORY_MAP["厨余垃圾"]:
        return "kitchen", "厨余垃圾"
    if item_label_zh in WASTE_CATEGORY_MAP["可回收物"]:
        return "recyclable", "可回收物"
    if item_label_zh in WASTE_CATEGORY_MAP["有害垃圾"]:
        return "hazardous", "有害垃圾"
    return "other", "其他垃圾"


# ===================== 识图大模型配置 =====================
VISION_PROVIDERS = {
    "doubao": {
        "name": "豆包 Vision",
        "api_base": "https://ark.cn-beijing.volces.com/api/v3",
        "model": "doubao-vision-pro-32k",
        "api_key": ""
    },
    "qwen": {
        "name": "千问 Vision",
        "api_base": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-vl-max",
        "api_key": ""
    },
    "custom": {
        "name": "自定义 Vision",
        "api_base": "",
        "model": "",
        "api_key": ""
    }
}

def _match_vision_label(en_name: str):
    """将视觉大模型返回的物品英文名匹配到 LABEL_MAP"""
    en_lower = en_name.lower().strip().rstrip('.')
    # 精确匹配
    for en_key, zh_name in LABEL_MAP.items():
        if en_lower == en_key.lower():
            return en_key, zh_name
    # 包含匹配
    for en_key, zh_name in LABEL_MAP.items():
        if en_lower in en_key.lower() or en_key.lower() in en_lower:
            return en_key, zh_name
    # 单词匹配
    words = set(en_lower.split())
    for en_key, zh_name in LABEL_MAP.items():
        key_words = set(en_key.lower().split())
        if words & key_words:
            return en_key, zh_name
    return en_name, en_name

def _call_vision_llm(image_data: bytes, provider_id: str) -> tuple:
    """调用 OpenAI 兼容视觉大模型 API。返回 (item_label_en, confidence)"""
    cfg = VISION_PROVIDERS.get(provider_id)
    if not cfg or not cfg["api_key"]:
        raise HTTPException(status_code=400, detail=f"Provider '{provider_id}' not configured")

    img_b64 = base64.b64encode(image_data).decode()
    print(f"[Vision/{provider_id}] 调用 {cfg['name']} 模型: {cfg['model']}")
    print(f"[Vision/{provider_id}] API: {cfg['api_base']}/chat/completions")
    print(f"[Vision/{provider_id}] 图片大小: {len(image_data)} bytes (base64: {len(img_b64)} chars)")

    payload = {
        "model": cfg["model"],
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}},
                {"type": "text", "text": "Identify the main object in this image. Return only the English name of the object, nothing else. Be specific but concise. Example: 'apple', 'plastic bottle', 'book'."}
            ]
        }],
        "max_tokens": 50,
        "temperature": 0.1
    }

    url = f"{cfg['api_base']}/chat/completions"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg['api_key']}"
        }
    )

    t_start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            result = json.loads(raw)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if hasattr(e, 'read') else ""
        print(f"[Vision/{provider_id}] HTTP {e.code}: {e.reason} | body: {body[:300]}")
        raise HTTPException(status_code=502, detail=f"Vision API HTTP {e.code}: {e.reason}")
    except Exception as e:
        print(f"[Vision/{provider_id}] 调用失败: {str(e)}")
        raise HTTPException(status_code=502, detail=f"Vision API call failed: {str(e)}")

    elapsed = (time.time() - t_start) * 1000
    print(f"[Vision/{provider_id}] 响应耗时: {elapsed:.0f}ms")
    print(f"[Vision/{provider_id}] 原始响应: {json.dumps(result, ensure_ascii=False)[:500]}")

    item_en = result["choices"][0]["message"]["content"].strip()
    print(f"[Vision/{provider_id}] 识别结果: {item_en}")
    return item_en, 0.90


# ===================== 共享状态 (线程安全) =====================
state_lock = threading.Lock()
server_start_time = time.time()

hardware_state = {
    "online": False,
    "last_seen": None,
    "last_capture": None,
    "ip_address": None,
    "capture_count": 0,
    "device_id": "ESP32-S3",
    "firmware_version": None
}
last_capture_image = None  # raw JPEG bytes
server_history = []
HISTORY_MAX = 50
active_classify_model = "clip"  # 当前分类模型: clip / doubao / qwen / custom
INFERENCE_WORKERS = max(2, min(4, (os.cpu_count() or 4)))
inference_executor = ThreadPoolExecutor(max_workers=INFERENCE_WORKERS, thread_name_prefix="inference")
runtime_metrics = {
    "requests_total": 0,
    "requests_failed": 0,
    "inflight": 0,
    "paths": defaultdict(lambda: {"count": 0, "errors": 0, "latency_ms_total": 0.0}),
    "inference": {"classify_count": 0, "detect_count": 0, "fallback_count": 0, "vision_count": 0}
}

trigger_config = {
    "mode": "button",           # "button" | "distance"
    "distance_min": 30,         # mm, 最小触发距离
    "distance_max": 300,        # mm, 最大触发距离
    "cooldown_ms": 2000,        # ms, 触发缓冲时间 (物体需稳定在范围内的时间)
    "trigger_interval_ms": 10000  # ms, 两次触发最小间隔
}

# SSE fan-out — all operations happen within the async event loop (single-threaded cooperative),
# so no additional locking is needed for _sse_queues.
_sse_queues = []

async def _sse_notify(event_type, data):
    for q in _sse_queues:
        try:
            q.put_nowait({"event": event_type, "data": data})
        except asyncio.QueueFull:
            pass


def _make_thumbnail(image_data: bytes, max_edge: int = 320) -> str:
    """将图片转为缩略图 base64 data URL"""
    try:
        img = Image.open(io.BytesIO(image_data)).convert("RGB")
        img = 缩放到最大边(img, max_edge)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=60)
        b64 = base64.b64encode(buf.getvalue()).decode()
        return f"data:image/jpeg;base64,{b64}"
    except Exception:
        return None


def _add_history(mode: str, data: dict, image_data: bytes, trigger_mode: str = ""):
    """线程安全地添加历史记录"""
    thumb = _make_thumbnail(image_data)
    entry = {
        "id": str(int(time.time() * 1000)),
        "mode": mode,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
        "imageUrl": thumb,
        "trigger_mode": trigger_mode
    }
    with state_lock:
        server_history.insert(0, entry)
        if len(server_history) > HISTORY_MAX:
            server_history[:] = server_history[:HISTORY_MAX]


def _mark_hardware_online(ip_address: str = "", device_id: str = "ESP32-S3", firmware_version: str = "", capture_event: bool = False):
    with state_lock:
        hardware_state["online"] = True
        hardware_state["last_seen"] = time.time()
        if ip_address:
            hardware_state["ip_address"] = ip_address
        if device_id:
            hardware_state["device_id"] = device_id
        if firmware_version:
            hardware_state["firmware_version"] = firmware_version
        if capture_event:
            hardware_state["capture_count"] += 1
            hardware_state["last_capture"] = datetime.now(timezone.utc).isoformat()


async def _run_blocking(fn, *args):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(inference_executor, lambda: fn(*args))


# ===================== FastAPI 初始化 =====================
app = FastAPI(title="物品识别API", version="5.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def request_observability(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    path = request.url.path
    method = request.method
    start = time.perf_counter()
    response = None
    status_code = 500

    with state_lock:
        runtime_metrics["requests_total"] += 1
        runtime_metrics["inflight"] += 1
        paths_dict = runtime_metrics["paths"]
        is_new = path not in paths_dict
        paths_dict[path]["count"] += 1
        if is_new and len(paths_dict) > 100:
            # evict the least-requested path to prevent unbounded growth
            worst = min((p for p in paths_dict if p != path), key=lambda p: paths_dict[p]["count"], default=None)
            if worst:
                del paths_dict[worst]

    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        with state_lock:
            p = runtime_metrics["paths"][path]
            p["latency_ms_total"] += elapsed_ms
            if status_code >= 400:
                runtime_metrics["requests_failed"] += 1
                p["errors"] += 1
            runtime_metrics["inflight"] = max(0, runtime_metrics["inflight"] - 1)
        if response is not None:
            response.headers["X-Request-Id"] = request_id
        logger.info(f"[req] id={request_id} {method} {path} status={status_code} latency_ms={elapsed_ms:.1f}")

# ===================== 核心加速（无编译，100%兼容Windows） =====================
device = "cpu"
torch.set_num_threads(4)
torch.set_num_interop_threads(1)
torch.set_grad_enabled(False)

# 下载/加载模型（纯CPU，无编译）
print("正在加载CLIP模型...")
if os.path.exists(os.path.join(MODEL_DIR, "config.json")):
    model = CLIPModel.from_pretrained(MODEL_DIR).to(device).eval()
    processor = CLIPProcessor.from_pretrained(MODEL_DIR, use_fast=False)
else:
    print("  首次运行，正在下载CLIP模型 (~1.2GB)...")
    model = CLIPModel.from_pretrained(MODEL_NAME).to(device).eval()
    processor = CLIPProcessor.from_pretrained(MODEL_NAME, use_fast=False)
    model.save_pretrained(MODEL_DIR)
    processor.save_pretrained(MODEL_DIR)
    print("  模型已保存到", MODEL_DIR)

# 🔥 最大提速：文本预编码（只处理一次，永久缓存）
print("正在预编码文本标签...")
text_inputs = processor(
    text=TEXT_PROMPTS, return_tensors="pt", padding=True, truncation=True
).to(device)

print("✅ 本地CLIP模型加载成功！")

# YOLO 模型加载（exp-22.pt）
YOLO_MODEL_PATH = os.path.join(os.path.dirname(__file__), "exp-22.pt")
print("正在加载YOLO模型...")
yolo_model = YOLO(YOLO_MODEL_PATH)
print("✅ 本地YOLO模型加载成功！")


def 缩放到最大边(image: Image.Image, max_edge: int = 1280) -> Image.Image:
    width, height = image.size
    longest = max(width, height)
    if longest <= max_edge:
        return image
    scale = max_edge / float(longest)
    new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
    return image.resize(new_size, Image.Resampling.BILINEAR)


def _prep_image(image_data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(image_data)).convert("RGB")
    return 缩放到最大边(image, 1280)


# ===================== CLIP 分类逻辑（提取为独立函数） =====================
def _classify_clip(image_data: bytes):
    image = _prep_image(image_data)

    pixel_values = processor(images=image, return_tensors="pt").pixel_values.to(device)

    with torch.inference_mode():
        outputs = model(pixel_values=pixel_values, **text_inputs)

    torch.cpu.synchronize()  # 确保所有线程完成，防止后续请求阻塞
    probs = outputs.logits_per_image.softmax(dim=1).squeeze().cpu().numpy()
    sorted_idx = np.argsort(probs)[::-1]

    top3_list = [
        {
            "item_label": TEXT_PROMPTS[i],
            "item_label_zh": LABEL_MAP[TEXT_PROMPTS[i]],
            "waste_category": 获取垃圾分类(LABEL_MAP[TEXT_PROMPTS[i]])[0],
            "waste_category_zh": 获取垃圾分类(LABEL_MAP[TEXT_PROMPTS[i]])[1],
            "confidence": float(probs[i])
        } for i in sorted_idx[:3]
    ]

    best_idx = sorted_idx[0]
    best_item_zh = LABEL_MAP[TEXT_PROMPTS[best_idx]]
    waste_category, waste_category_zh = 获取垃圾分类(best_item_zh)
    return {
        "waste_category": waste_category,
        "waste_category_zh": waste_category_zh,
        "item_label": TEXT_PROMPTS[best_idx],
        "item_label_zh": best_item_zh,
        "confidence": float(probs[best_idx]),
        "tip": "请将垃圾投放到对应类别的收集容器中",
        "top3": top3_list,
        "model_used": "clip"
    }


def _detect_yolo(image_data: bytes):
    image = _prep_image(image_data)
    image_np = np.array(image)
    return yolo_model.predict(
        source=image_np,
        verbose=False,
        device="cpu",
        imgsz=512,
        conf=0.25,
        iou=0.45
    )


# ===================== 识别接口 =====================
@app.post("/classify")
async def classify_image(
    file: UploadFile = File(...),
    source: str = Query("web"),
    ip: str = Query(""),
    model: str = Query(""),   # 可选：覆盖当前激活的分类模型
    trigger_mode: str = Query(""),
    background_tasks: BackgroundTasks = None
):
    t_start = time.time()
    try:
        image_data = await file.read()
        classify_model = model if model else active_classify_model
        logger.info(f"[classify] source={source}, ip={ip}, model={classify_model}, image_size={len(image_data)}")

        # ESP32 硬件上线标记
        if source == "esp32":
            global last_capture_image
            with state_lock:
                last_capture_image = image_data
            _mark_hardware_online(
                ip_address=ip or hardware_state.get("ip_address", ""),
                device_id="ESP32-S3",
                firmware_version=hardware_state.get("firmware_version") or "5.0.0",
                capture_event=True
            )
            await _sse_notify("new_capture", {"source": "esp32"})

        # 按模型路由
        t_infer_start = time.time()
        if classify_model == "clip":
            result_data = await _run_blocking(_classify_clip, image_data)
            with state_lock:
                runtime_metrics["inference"]["classify_count"] += 1
        elif classify_model in VISION_PROVIDERS:
            if not VISION_PROVIDERS[classify_model]["api_key"]:
                logger.warning(f"[classify] {classify_model} 未配置 API Key，回退到 CLIP")
                result_data = await _run_blocking(_classify_clip, image_data)
                result_data["model_used"] = "clip (fallback)"
                with state_lock:
                    runtime_metrics["inference"]["classify_count"] += 1
                    runtime_metrics["inference"]["fallback_count"] += 1
            else:
                try:
                    item_en, conf = await _run_blocking(_call_vision_llm, image_data, classify_model)
                except Exception as e:
                    logger.warning(f"[classify] Vision API 调用失败: {e}, 回退到 CLIP")
                    if source != "esp32":
                        raise  # web 用户看到错误
                    result_data = await _run_blocking(_classify_clip, image_data)
                    result_data["model_used"] = "clip (fallback)"
                    with state_lock:
                        runtime_metrics["inference"]["classify_count"] += 1
                        runtime_metrics["inference"]["fallback_count"] += 1
                else:
                    en_key, item_zh = _match_vision_label(item_en)
                    waste_category, waste_category_zh = 获取垃圾分类(item_zh)
                    top3_entry = {
                        "item_label": en_key,
                        "item_label_zh": item_zh,
                        "waste_category": waste_category,
                        "waste_category_zh": waste_category_zh,
                        "confidence": conf
                    }
                    result_data = {
                        "waste_category": waste_category,
                        "waste_category_zh": waste_category_zh,
                        "item_label": en_key,
                        "item_label_zh": item_zh,
                        "confidence": conf,
                        "tip": "请将垃圾投放到对应类别的收集容器中",
                        "top3": [top3_entry],
                        "model_used": classify_model
                    }
                    with state_lock:
                        runtime_metrics["inference"]["vision_count"] += 1
        else:
            raise HTTPException(status_code=400, detail=f"Unknown model: {classify_model}")

        inference_time_ms = int((time.time() - t_infer_start) * 1000)
        response_time_ms = int((time.time() - t_start) * 1000)
        result_data["inference_time_ms"] = inference_time_ms
        result_data["response_time_ms"] = response_time_ms

        with state_lock:
            tm = trigger_mode or trigger_config["mode"]
        if background_tasks:
            background_tasks.add_task(_add_history, "classify", result_data, image_data, tm)
        else:
            _add_history("classify", result_data, image_data, tm)

        return {
            "success": True,
            "result": result_data,
            "inference_time_ms": inference_time_ms,
            "response_time_ms": response_time_ms,
            "message": f"识别结果：{result_data['item_label_zh']} 置信度：{result_data['confidence'] * 100:.1f}%"
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[错误] {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"识别失败：{str(e)}")


@app.get("/health")
async def health():
    uptime = time.time() - server_start_time
    now = time.time()
    with state_lock:
        hw_online = hardware_state["online"]
        last_seen = hardware_state["last_seen"]
        capture_count = hardware_state["capture_count"]
    # 60 秒无心跳视为离线
    if hw_online and last_seen and (now - last_seen > 60):
        hw_online = False
    elif not last_seen:
        hw_online = False
    with state_lock:
        tc = dict(trigger_config)
    return {
        "status": "healthy",
        "uptime_seconds": round(uptime, 1),
        "models_loaded": True,
        "hardware_online": hw_online,
        "hardware_captures": capture_count,
        "device": device,
        "clip_labels": len(TEXT_PROMPTS),
        "active_model": active_classify_model,
        "trigger_config": tc
    }


# ===================== 模型管理接口 =====================
@app.get("/model/active")
async def get_active_model():
    """获取当前激活的分类模型及可用 provider 列表"""
    providers = []
    for pid, cfg in VISION_PROVIDERS.items():
        providers.append({
            "id": pid,
            "name": cfg["name"],
            "configured": bool(cfg["api_key"]),
            "model": cfg["model"] or "(not set)"
        })
    return {
        "active": active_classify_model,
        "providers": providers
    }


class ModelConfigBody(BaseModel):
    provider: str
    api_key: str = ""
    api_base: str = ""
    model: str = ""


@app.post("/model/config")
async def configure_provider(body: ModelConfigBody):
    """配置识图大模型 API 参数"""
    if body.provider not in VISION_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {body.provider}")
    cfg = VISION_PROVIDERS[body.provider]
    if body.api_key:
        cfg["api_key"] = body.api_key
    if body.api_base:
        cfg["api_base"] = body.api_base
    if body.model:
        cfg["model"] = body.model
    return {
        "success": True,
        "provider": body.provider,
        "configured": bool(cfg["api_key"]),
        "message": f"Provider '{body.provider}' configured"
    }


@app.post("/model/active")
async def set_active_model(model: str = Query(...)):
    """设置当前分类模型"""
    global active_classify_model
    valid = ["clip"] + list(VISION_PROVIDERS.keys())
    if model not in valid:
        raise HTTPException(status_code=400, detail=f"Unknown model: {model}. Valid: {valid}")
    active_classify_model = model
    return {"active": active_classify_model, "message": f"Active model set to '{model}'"}


# ===================== 触发配置接口 =====================

class TriggerConfigBody(BaseModel):
    mode: str = "button"              # "button" | "distance"
    distance_min: int = 30            # mm
    distance_max: int = 300           # mm
    cooldown_ms: int = 2000           # ms
    trigger_interval_ms: int = 10000  # ms


@app.get("/trigger/config")
async def get_trigger_config():
    with state_lock:
        return dict(trigger_config)


@app.post("/trigger/config")
async def set_trigger_config(body: TriggerConfigBody):
    if body.mode not in ("button", "distance"):
        raise HTTPException(status_code=400, detail="mode must be 'button' or 'distance'")
    if body.distance_min < 0 or body.distance_max > 2000:
        raise HTTPException(status_code=400, detail="distance range must be 0-2000 mm")
    if body.distance_min >= body.distance_max:
        raise HTTPException(status_code=400, detail="distance_min must be < distance_max")
    if body.cooldown_ms < 0 or body.cooldown_ms > 30000:
        raise HTTPException(status_code=400, detail="cooldown_ms must be 0-30000 ms")
    if body.trigger_interval_ms < 1000 or body.trigger_interval_ms > 60000:
        raise HTTPException(status_code=400, detail="trigger_interval_ms must be 1000-60000 ms")
    with state_lock:
        trigger_config["mode"] = body.mode
        trigger_config["distance_min"] = body.distance_min
        trigger_config["distance_max"] = body.distance_max
        trigger_config["cooldown_ms"] = body.cooldown_ms
        trigger_config["trigger_interval_ms"] = body.trigger_interval_ms
    print(f"[trigger] config updated: mode={body.mode} range={body.distance_min}-{body.distance_max}mm cooldown={body.cooldown_ms}ms interval={body.trigger_interval_ms}ms")
    return {"message": "Trigger config updated", "config": dict(trigger_config)}


# ===================== YOLO 检测接口 =====================


@app.post("/detect")
async def detect_image(file: UploadFile = File(...)):
    try:
        image_data = await file.read()
        results = await _run_blocking(_detect_yolo, image_data)
        with state_lock:
            runtime_metrics["inference"]["detect_count"] += 1
        if not results:
            return {
                "success": True,
                "result": {
                    "detected": False,
                    "count": 0,
                    "detections": []
                },
                "message": "未检测到目标"
            }

        r = results[0]
        boxes = r.boxes
        names = r.names
        detections = []

        if boxes is not None and len(boxes) > 0:
            xyxy = boxes.xyxy.cpu().numpy()
            conf = boxes.conf.cpu().numpy()
            cls = boxes.cls.cpu().numpy().astype(int)

            for i in range(len(cls)):
                cid = int(cls[i])
                cname = names.get(cid, str(cid)) if isinstance(names, dict) else str(cid)
                detections.append({
                    "class_id": cid,
                    "class_name": cname,
                    "confidence": float(conf[i]),
                    "bbox": {
                        "x1": float(xyxy[i][0]),
                        "y1": float(xyxy[i][1]),
                        "x2": float(xyxy[i][2]),
                        "y2": float(xyxy[i][3])
                    }
                })

        detections = sorted(detections, key=lambda x: x["confidence"], reverse=True)
        if not detections:
            return {
                "success": True,
                "result": {
                    "detected": False,
                    "count": 0,
                    "detections": []
                },
                "message": "未检测到目标"
            }

        top1 = detections[0]
        result_data = {
            "detected": True,
            "count": len(detections),
            "item_label": top1["class_name"],
            "confidence": top1["confidence"],
            "top1": top1,
            "detections": detections
        }

        # 写入历史
        _add_history("detect", result_data, image_data, "web")

        return {
            "success": True,
            "result": result_data,
            "message": f"检测到 {len(detections)} 个目标，最高置信度类别：{top1['class_name']}"
        }
    except Exception as e:
        print(f"[错误] {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"检测失败：{str(e)}")


# ===================== 模型信息接口 =====================
@app.get("/models")
async def get_models():
    yolo_names = yolo_model.names if yolo_model else {}
    yolo_labels = list(yolo_names.values()) if isinstance(yolo_names, dict) else [str(i) for i in range(len(yolo_names))]
    models_list = [
        {
            "id": "clip",
            "name": "CLIP ViT-B/32",
            "type": "classify",
            "description": "Zero-shot image classification — identifies objects and maps to waste categories.",
            "labels_count": len(TEXT_PROMPTS),
            "labels": TEXT_PROMPTS[:20]
        }
    ]
    # 添加已配置的识图大模型
    for pid, cfg in VISION_PROVIDERS.items():
        models_list.append({
            "id": pid,
            "name": cfg["name"],
            "type": "classify",
            "description": f"Vision LLM — cloud-based image recognition via {cfg['name']}.",
            "labels_count": 0,
            "labels": [],
            "configured": bool(cfg["api_key"]),
            "model": cfg["model"] or "(not set)"
        })
    models_list.append({
        "id": "detect",
        "name": "YOLO exp-22",
        "type": "detect",
        "description": "Custom-trained object detection — locates and identifies objects with bounding boxes.",
        "labels_count": len(yolo_labels),
        "labels": yolo_labels[:20]
    })
    return {"models": models_list}


# ===================== 历史记录接口 =====================
@app.get("/history")
async def get_history(page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100)):
    with state_lock:
        total = len(server_history)
        start = (page - 1) * limit
        end = start + limit
        items = server_history[start:end]
    return {
        "total": total,
        "page": page,
        "limit": limit,
        "items": items
    }


@app.delete("/history")
async def clear_history():
    with state_lock:
        server_history.clear()
    return {"success": True, "message": "History cleared"}


@app.delete("/history/item")
async def delete_history_item(id: str = Query(...)):
    with state_lock:
        for i, entry in enumerate(server_history):
            if entry.get("id") == id:
                server_history.pop(i)
                return {"success": True, "message": f"Deleted {id}"}
    raise HTTPException(status_code=404, detail="Entry not found")


# ===================== 硬件接口 =====================
@app.post("/hardware/capture")
async def hardware_capture(
    file: UploadFile = File(...),
    device_id: str = Query("ESP32-S3"),
    firmware_version: str = Query("5.0.0"),
    ip_address: str = Query("unknown")
):
    """ESP32-S3 上传采集图片"""
    global last_capture_image
    try:
        image_data = await file.read()

        _mark_hardware_online(
            ip_address=ip_address,
            device_id=device_id,
            firmware_version=firmware_version,
            capture_event=True
        )
        with state_lock:
            trig_mode = trigger_config["mode"]
            last_capture_image = image_data

        hw_data = {
            "source": "hardware",
            "device_id": device_id,
            "ip_address": ip_address
        }
        _add_history("hardware", hw_data, image_data, trig_mode)

        await _sse_notify("new_capture", {"source": "hardware"})

        return {"success": True, "message": "Image received"}
    except Exception as e:
        print(f"[硬件错误] {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"硬件上传失败：{str(e)}")


@app.get("/hardware/heartbeat")
async def hardware_heartbeat(
    device_id: str = Query("ESP32-S3"),
    firmware_version: str = Query(""),
    ip_address: str = Query("")
):
    _mark_hardware_online(
        ip_address=ip_address,
        device_id=device_id,
        firmware_version=firmware_version,
        capture_event=False
    )
    return {"success": True, "message": "heartbeat received"}


@app.get("/hardware/image")
async def hardware_image():
    """获取最后一次硬件采集的图片"""
    with state_lock:
        img = last_capture_image
    if img is None:
        raise HTTPException(status_code=404, detail="No hardware image available")
    return Response(content=img, media_type="image/jpeg")


@app.get("/hardware/status")
async def hardware_status():
    """获取硬件连接状态"""
    with state_lock:
        status = dict(hardware_state)
    return status


@app.get("/events")
async def sse_endpoint(request: Request):
    """Server-Sent Events — real-time push when ESP32 captures a photo"""
    queue = asyncio.Queue()
    _sse_queues.append(queue)

    async def event_generator():
        try:
            yield f"event: connected\ndata: {json.dumps({'status': 'connected'})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"event: {msg['event']}\ndata: {json.dumps(msg['data'])}\n\n"
                except asyncio.TimeoutError:
                    yield "event: ping\ndata: {}\n\n"
        finally:
            _sse_queues.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.get("/metrics/runtime")
async def runtime_metrics_view():
    now = time.time()
    with state_lock:
        paths = {}
        for path, stat in runtime_metrics["paths"].items():
            avg_latency = (stat["latency_ms_total"] / stat["count"]) if stat["count"] else 0.0
            paths[path] = {
                "count": stat["count"],
                "errors": stat["errors"],
                "avg_latency_ms": round(avg_latency, 2)
            }
        requests_total = runtime_metrics["requests_total"]
        requests_failed = runtime_metrics["requests_failed"]
        inflight = runtime_metrics["inflight"]
        inference = dict(runtime_metrics["inference"])
        hw_last_seen = hardware_state.get("last_seen")
    error_rate = (requests_failed / requests_total) if requests_total else 0.0
    queue_depth = max(0, inflight - INFERENCE_WORKERS)
    return {
        "requests_total": requests_total,
        "requests_failed": requests_failed,
        "error_rate": round(error_rate, 4),
        "inflight": inflight,
        "queue_depth": queue_depth,
        "inference_workers": INFERENCE_WORKERS,
        "inference": inference,
        "paths": paths,
        "hardware_last_seen_seconds": (round(now - hw_last_seen, 1) if hw_last_seen else None)
    }


# ===================== 前端静态文件 =====================
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
FRONTEND_DIR = os.path.abspath(FRONTEND_DIR)

if os.path.exists(FRONTEND_DIR):
    @app.get("/app/{full_path:path}")
    async def spa_fallback(full_path: str = ""):
        index_path = os.path.join(FRONTEND_DIR, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return {"error": "frontend not built — run: cd frontend && npm run build"}

    @app.get("/app")
    async def spa_root():
        index_path = os.path.join(FRONTEND_DIR, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return {"error": "frontend not built — run: cd frontend && npm run build"}

    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="assets")


# ===================== 启动服务 =====================
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8085)
