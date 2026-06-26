import os
import asyncio
import logging
from collections import deque
from concurrent.futures import ThreadPoolExecutor

# 加速：CPU性能优化
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["OMP_NUM_THREADS"] = "4"
os.environ["MKL_NUM_THREADS"] = "4"

from contextlib import asynccontextmanager
from PIL import Image
import torch
import io
import numpy as np
import traceback
import threading
import time
import base64
import json
import httpx
from datetime import datetime, timezone
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from transformers import SiglipModel, SiglipProcessor
from ultralytics import YOLO

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s %(levelname)s %(message)s"
)
logger = logging.getLogger("garbage-classifier")

# ===================== 标签映射（完全保留） =====================
LABEL_MAP = {
    # ===== 文具办公用品 =====
    "a photo of a pen or pencil, writing instrument": "笔",
    "a photo of a book with a cover": "书本",
    "a photo of an eraser": "橡皮",
    "a photo of a sheet of paper, blank": "纸张",
    "a photo of a notebook": "笔记本",
    "a photo of a ruler, measuring tool": "尺子",
    "a photo of a stapler": "订书机",
    "a photo of a folder for documents": "文件夹",
    "a photo of an envelope for letters": "信封",
    "a photo of correction tape": "修正带",
    "a photo of a pair of scissors": "剪刀",

    # ===== 水果蔬菜食物 =====
    "a photo of an apple fruit": "苹果",
    "a photo of a banana fruit": "香蕉",
    "a photo of an orange citrus fruit": "橙子",
    "a photo of a watermelon fruit": "西瓜",
    "a photo of a bunch of grapes": "葡萄",
    "a photo of a strawberry fruit": "草莓",
    "a photo of a red tomato": "西红柿",
    "a photo of a green cucumber": "黄瓜",
    "a photo of a carrot root vegetable": "胡萝卜",
    "a photo of a potato": "土豆",
    "a photo of a head of cabbage": "白菜",
    "a photo of spinach leaves": "菠菜",

    # ===== 厨余/剩饭类 =====
    "a photo of leftover cooked rice": "剩饭",
    "a photo of leftover food scraps on a plate": "剩菜",
    "a photo of bones with meat residue": "骨头",
    "a photo of broken eggshells": "蛋壳",
    "a photo of used wet tea leaves": "茶叶渣",
    "a photo of used wet coffee grounds": "咖啡渣",
    "a photo of bread or a loaf of bread": "面包",
    "a photo of noodles in a bowl": "面条",
    "a photo of a biscuit or cookie": "饼干",
    "a photo of crispy potato chips": "薯片",
    "a photo of a chocolate bar": "巧克力",
    "a photo of wrapped candy": "糖果",

    # ===== 零食/包装食品 =====
    "a photo of instant noodles in a cup": "方便面",
    "a photo of jelly dessert in a cup": "果冻",
    "a photo of assorted nuts": "坚果",
    "a photo of a lollipop on a stick": "棒棒糖",
    "a photo of a piece of chewing gum": "口香糖",

    # ===== 服装/纺织品 =====
    "a photo of a t-shirt, casual top": "T恤",
    "a photo of pants or trousers": "裤子",
    "a photo of a winter coat or jacket": "外套",
    "a photo of a sweater, knitted garment": "毛衣",
    "a photo of a dress, woman clothing": "连衣裙",
    "a photo of socks, pair of": "袜子",
    "a photo of underwear or boxer shorts": "内衣",
    "a photo of shoes or sneakers": "鞋子",
    "a photo of a hat or cap": "帽子",
    "a photo of a scarf": "围巾",
    "a photo of gloves, pair of": "手套",

    # ===== 日用品/卫浴 =====
    "a photo of a bath towel": "毛巾",
    "a photo of a bed sheet": "床单",
    "a photo of a quilt or comforter": "被子",
    "a photo of a pillow": "枕头",
    "a photo of a toothbrush": "牙刷",
    "a photo of a tube of toothpaste": "牙膏",
    "a photo of a facial cleanser tube": "洗面奶",
    "a photo of a bar of soap": "肥皂",
    "a photo of a roll of toilet paper": "卫生纸",
    "a photo of a tissue box": "纸巾盒",
    "a photo of a disposable face mask": "口罩",
    "a photo of a plastic comb": "塑料梳子",
    "a photo of a mirror": "镜子",
    "a photo of a plastic laundry basket": "洗衣篮",
    "a photo of a pair of eyeglasses or spectacles": "眼镜",

    # ===== 塑料制品（多条具体描述→同一中文标签） =====
    "a photo of a clear plastic or PET beverage bottle": "塑料瓶",
    "a photo of a plastic container, storage box or bin": "塑料瓶",
    "a photo of a thin plastic shopping bag": "塑料瓶",
    "a photo of a plastic bowl or cup, disposable tableware": "塑料瓶",
    "a photo of a plastic clothes hanger": "塑料瓶",
    "a photo of a plastic bucket or pail": "塑料瓶",
    "a photo of plastic cutlery, fork or spoon": "塑料瓶",
    "a photo of a drinking straw made of plastic": "塑料瓶",
    "a photo of a body wash or shower gel bottle": "塑料瓶",
    "a photo of a laundry detergent bottle or jug": "塑料瓶",
    "a photo of a plastic shampoo bottle": "塑料瓶",

    # ===== 纸制品 =====
    "a photo of a small cardboard box, shipping carton or parcel": "盒子",
    "a photo of a cardboard express delivery box with tape seals": "盒子",
    "a photo of a folded newspaper": "报纸",
    "a photo of a magazine with glossy cover": "杂志",
    "a photo of a paper shopping bag": "纸袋",
    "a photo of wrapping paper with pattern": "包装纸",
    "a photo of a disposable paper cup": "纸杯",
    "a photo of a paper bowl": "纸碗",

    # ===== 玻璃/陶瓷 =====
    "a photo of a glass bottle": "玻璃瓶",
    "a photo of a glass drinking cup": "玻璃杯",
    "a photo of a glass jar with lid": "玻璃罐",
    "a photo of a ceramic mug for tea or coffee": "陶瓷杯",
    "a photo of a ceramic bowl": "陶瓷碗",
    "a photo of a ceramic plate": "陶瓷盘",

    # ===== 金属制品 =====
    "a photo of an aluminum soda can": "易拉罐",
    "a photo of an iron nail": "铁钉",
    "a photo of a metal cooking pot": "金属锅",
    "a photo of aluminum foil sheet": "铝箔纸",
    "a photo of a metal key": "钥匙",
    "a photo of a stainless steel cup": "不锈钢杯",

    # ===== 电子产品（多条具体描述→同一中文标签） =====
    "a photo of a smartphone, mobile phone": "电子产品",
    "a photo of a computer mouse": "电子产品",
    "a photo of a computer keyboard": "电子产品",
    "a photo of a charger plug or power adapter": "电子产品",
    "a photo of a USB cable or charging cable": "电子产品",
    "a photo of earphones or headphones": "电子产品",
    "a photo of a remote control": "电子产品",
    "a photo of a desk lamp": "电子产品",
    "a photo of an electric fan": "电子产品",
    "a photo of a portable power bank": "电子产品",
    "a photo of a battery cell, AA or AAA": "电子产品",
    "a photo of an electrical plug with prongs": "电子产品",
    "a photo of a tablet or iPad": "电子产品",
    "a photo of a laptop computer": "电子产品",

    # ===== 玩具/运动用品 =====
    "a photo of a plastic toy": "塑料玩具",
    "a photo of a stuffed plush doll": "玩偶",
    "a photo of lego bricks": "乐高积木",
    "a photo of a sports ball": "球",
    "a photo of a badminton racket": "羽毛球拍",
    "a photo of a basketball": "篮球",
    "a photo of a soccer ball": "足球",
    "a photo of a jump rope": "跳绳",
    "a photo of a jigsaw puzzle": "拼图",
    "a photo of a toy car": "玩具车",

    # ===== 厨具/餐具 =====
    "a photo of a wok or frying pan": "炒锅",
    "a photo of chopsticks": "筷子",
    "a photo of a serving plate": "盘子",
    "a photo of a spatula or turner": "锅铲",
    "a photo of a rice bowl": "碗",
    "a photo of a kettle or water pot": "水壶",

    # ===== 清洁/家居 =====
    "a photo of a mop": "拖把",
    "a photo of a broom": "扫帚",
    "a photo of a dustpan": "簸箕",

    # ===== 有害垃圾 =====
    "a photo of expired medicine in packaging": "过期药品",
    "a photo of a cosmetic bottle or jar": "化妆品瓶",
    "a photo of a nail polish bottle": "指甲油瓶",
    "a photo of a fluorescent lamp tube": "荧光灯",
    "a photo of a glass thermometer": "温度计",

    # ===== 一次性用品/其他垃圾 =====
    "a photo of a takeout food container": "一次性餐盒",
    "a photo of a disposable plastic cup": "一次性杯子",
    "a photo of disposable wooden chopsticks": "一次性筷子",
    "a photo of a wet wipe, moist towelette": "湿巾",
    "a photo of plastic cling wrap": "保鲜膜",
}

TEXT_PROMPTS = list(LABEL_MAP.keys())
MODEL_NAME = "google/siglip-base-patch16-224"
MODEL_DIR = os.path.join(os.path.dirname(__file__), "clip_model")

# 本地加载（模型已下载到 backend/clip_model/）
# 首次运行需注释下面两行以下载模型
if os.path.exists(os.path.join(MODEL_DIR, "config.json")):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

# 仅用于CLIP识别结果的垃圾分类映射，未覆盖项默认归为其他垃圾
WASTE_CATEGORY_MAP = {
    "厨余垃圾": {
        "苹果", "香蕉", "橙子", "西瓜", "葡萄", "草莓", "西红柿", "黄瓜", "胡萝卜", "土豆", "白菜", "菠菜",
        "剩饭", "剩菜", "骨头", "蛋壳", "茶叶渣", "咖啡渣", "面包", "面条", "饼干", "薯片", "巧克力", "糖果",
        "方便面", "果冻", "坚果"
    },
    "可回收物": {
        "笔", "书本", "橡皮", "纸张", "笔记本", "尺子", "订书机", "文件夹", "信封", "修正带", "剪刀",
        "T恤", "裤子", "外套", "毛衣", "连衣裙", "袜子", "内衣", "鞋子", "帽子", "围巾", "手套", "毛巾", "床单", "被子", "枕头",
        "塑料瓶",
        "盒子", "报纸", "杂志", "纸袋", "包装纸", "纸杯", "纸碗",
        "玻璃瓶", "玻璃杯", "玻璃罐", "易拉罐", "铁钉", "金属锅", "铝箔纸", "钥匙", "不锈钢杯",
        "电子产品",
        "塑料玩具", "玩偶", "乐高积木", "球", "羽毛球拍", "篮球", "足球", "跳绳", "拼图", "玩具车",
        "炒锅", "筷子", "盘子", "锅铲", "碗", "水壶", "拖把", "扫帚", "簸箕", "塑料梳子",
        "眼镜",
    },
    "有害垃圾": {
        "过期药品", "化妆品瓶", "指甲油瓶", "荧光灯", "温度计", "电池"
    },
    "其他垃圾": {
        "口香糖", "牙刷", "牙膏", "洗面奶", "肥皂", "卫生纸", "纸巾盒", "口罩", "镜子", "洗衣篮",
        "陶瓷杯", "陶瓷碗", "陶瓷盘", "一次性餐盒", "一次性杯子", "一次性筷子", "湿巾", "保鲜膜", "棒棒糖"
    }
}


# 两阶段分类分组 —— 每组内物品互斥，组间独立计算
GROUP_MEMBERS = {
    "文具":     {"笔", "书本", "橡皮", "纸张", "笔记本", "尺子", "订书机", "文件夹", "信封", "修正带", "剪刀"},
    "果蔬":     {"苹果", "香蕉", "橙子", "西瓜", "葡萄", "草莓", "西红柿", "黄瓜", "胡萝卜", "土豆", "白菜", "菠菜"},
    "厨余":     {"剩饭", "剩菜", "骨头", "蛋壳", "茶叶渣", "咖啡渣", "面包", "面条", "饼干", "薯片", "巧克力", "糖果"},
    "零食":     {"方便面", "果冻", "坚果", "棒棒糖", "口香糖"},
    "衣物":     {"T恤", "裤子", "外套", "毛衣", "连衣裙", "袜子", "内衣", "鞋子", "帽子", "围巾", "手套"},
    "日用品":   {"毛巾", "床单", "被子", "枕头", "牙刷", "牙膏", "洗面奶", "肥皂", "卫生纸", "纸巾盒", "口罩", "塑料梳子", "镜子", "洗衣篮", "眼镜"},
    "塑料":     {"塑料瓶"},
    "纸制品":   {"盒子", "报纸", "杂志", "纸袋", "包装纸", "纸杯", "纸碗"},
    "玻璃陶瓷": {"玻璃瓶", "玻璃杯", "玻璃罐", "陶瓷杯", "陶瓷碗", "陶瓷盘"},
    "金属":     {"易拉罐", "铁钉", "金属锅", "铝箔纸", "钥匙", "不锈钢杯"},
    "电子":     {"电子产品"},
    "玩具运动": {"塑料玩具", "玩偶", "乐高积木", "球", "羽毛球拍", "篮球", "足球", "跳绳", "拼图", "玩具车"},
    "厨具":     {"炒锅", "筷子", "盘子", "锅铲", "碗", "水壶"},
    "清洁":     {"拖把", "扫帚", "簸箕"},
    "有害":     {"过期药品", "化妆品瓶", "指甲油瓶", "荧光灯", "温度计", "电池"},
    "一次性":   {"一次性餐盒", "一次性杯子", "一次性筷子", "湿巾", "保鲜膜"},
}

# Build reverse map: zh_label → group_id
_LABEL_TO_GROUP = {}
for gid, members in GROUP_MEMBERS.items():
    for lbl in members:
        _LABEL_TO_GROUP[lbl] = gid

GROUP_IDS = list(GROUP_MEMBERS.keys())


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
        "api_base": os.getenv("DOUBAO_API_BASE", "https://ark.cn-beijing.volces.com/api/v3"),
        "model": os.getenv("DOUBAO_MODEL", "doubao-seed-1-6-flash-250828"),
        "api_key": os.getenv("DOUBAO_API_KEY", "")
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

async def _call_vision_llm(image_data: bytes, provider_id: str) -> tuple:
    """调用 OpenAI 兼容视觉大模型 API（P1-10：使用 httpx 异步客户端）。返回 (item_label_en, confidence)"""
    cfg = VISION_PROVIDERS.get(provider_id)
    if not cfg or not cfg["api_key"]:
        raise HTTPException(status_code=400, detail=f"Provider '{provider_id}' not configured")

    img_b64 = base64.b64encode(image_data).decode()
    logger.info(f"[Vision/{provider_id}] calling {cfg['name']} {cfg['model']}, image={len(image_data)}B")

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

    client = _get_vision_client()
    url = f"{cfg['api_base']}/chat/completions"

    t_start = time.time()
    try:
        resp = await client.post(
            url,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {cfg['api_key']}"
            }
        )
        if resp.status_code != 200:
            logger.warning(f"[Vision/{provider_id}] HTTP {resp.status_code}: {resp.text[:300]}")
            raise HTTPException(status_code=502, detail=f"Vision API HTTP {resp.status_code}: {resp.text[:200]}")
        result = resp.json()
    except httpx.TimeoutException:
        logger.error(f"[Vision/{provider_id}] request timed out")
        raise HTTPException(status_code=502, detail="Vision API request timed out")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Vision/{provider_id}] call failed: {str(e)}")
        raise HTTPException(status_code=502, detail=f"Vision API call failed: {str(e)}")

    elapsed = (time.time() - t_start) * 1000
    logger.info(f"[Vision/{provider_id}] response latency: {elapsed:.0f}ms")
    logger.info(f"[Vision/{provider_id}] raw response: {json.dumps(result, ensure_ascii=False)[:500]}")

    item_en = result["choices"][0]["message"]["content"].strip()
    logger.info(f"[Vision/{provider_id}] recognized: {item_en}")
    return item_en, 0.90


# ===================== 共享状态 (线程安全) =====================
# P2-12: Separate locks for independent state to reduce contention
_hw_lock = threading.Lock()       # hardware_state, last_capture_image
_hist_lock = threading.Lock()     # server_history
_metrics_lock = threading.Lock()  # runtime_metrics
_trigger_lock = threading.Lock()  # trigger_config
HARDWARE_STALE_SECONDS = 60  # ESP32 每 30s 发心跳，超 60s 未收到视为离线（给予双倍容忍，应对偶尔的单次包丢失）

hardware_state = {
    "online": False,
    "last_seen": None,
    "last_capture": None,
    "ip_address": None,
    "capture_count": 0,
    "device_id": "ESP32-S3",
    "firmware_version": None
}
_hardware_was_online = False  # 跟踪状态变化，用于 SSE 推送

def _update_hardware_online():
    """根据 last_seen 更新时间戳，返回 (当前online, 是否变化)

    Thread-safe: _hardware_was_online is protected by _hw_lock.
    """
    global _hardware_was_online
    now = time.time()
    with _hw_lock:
        was_online = hardware_state["online"]
        last_seen = hardware_state["last_seen"]
        if was_online and last_seen and (now - last_seen > HARDWARE_STALE_SECONDS):
            hardware_state["online"] = False
        elif not was_online and last_seen and (now - last_seen <= HARDWARE_STALE_SECONDS):
            pass  # _mark_hardware_online 会设置 online=True
        is_online = hardware_state["online"]
        changed = (was_online != is_online) or (_hardware_was_online != is_online)
        _hardware_was_online = is_online
        return is_online, changed
last_capture_image = None  # raw JPEG bytes
HISTORY_MAX = 50
# P3-13: deque with fixed maxlen for auto-truncation, O(1) appendleft
server_history = deque(maxlen=HISTORY_MAX)
active_classify_model = "clip"  # 当前分类模型: clip / doubao / qwen / custom
_active_model_lock = threading.Lock()
INFERENCE_WORKERS = max(2, min(os.cpu_count() or 4, 8))  # 上限 8，避免 16 核机器创建过多线程
inference_executor = ThreadPoolExecutor(max_workers=INFERENCE_WORKERS, thread_name_prefix="inference")
# Dedicated single-worker executor for ESP32 CLIP — serializes CPU access,
# avoids competing with web inference threads for the same physical cores.
_esp32_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="esp32-clip")
runtime_metrics = {
    "requests_total": 0,
    "inference": {"classify_count": 0, "detect_count": 0, "fallback_count": 0, "vision_count": 0, "vision_failed": 0}
}

trigger_config = {
    "mode": "distance",           # "distance"
    "distance_min": 30,         # mm, 最小触发距离
    "distance_max": 300,        # mm, 最大触发距离
    "cooldown_ms": 2000,        # ms, 触发缓冲时间 (物体需稳定在范围内的时间)
    "trigger_interval_ms": 10000  # ms, 两次触发最小间隔
}

# SSE fan-out — all operations happen within the async event loop (single-threaded cooperative),
# so no additional locking is needed for _sse_queues.
_sse_queues = []

# P1-9: Inference semaphore for backpressure — limits concurrent inference calls
_inference_semaphore = asyncio.Semaphore(INFERENCE_WORKERS * 2)

async def _sse_notify(event_type, data):
    for q in _sse_queues:
        try:
            q.put_nowait({"event": event_type, "data": data})
        except asyncio.QueueFull:
            pass


def _get_hw_status_snapshot():
    """获取硬件状态快照（调用方需持有 _hw_lock 或只读场景）"""
    return dict(hardware_state)


async def _notify_hw_status_full():
    """推送完整硬件状态到所有 SSE 客户端"""
    with _hw_lock:
        data = dict(hardware_state)
    await _sse_notify("hw_status", data)


async def _hardware_status_checker():
    """后台任务：每 5 秒检查硬件在线状态，变化时通过 SSE 推送完整状态"""
    while True:
        await asyncio.sleep(5)
        is_online, changed = _update_hardware_online()
        if changed:
            with _hw_lock:
                data = dict(hardware_state)
            await _sse_notify("hw_status", data)


def _make_thumbnail(image_data: bytes, max_edge: int = 320) -> bytes:
    """将图片转为缩略图，返回 raw JPEG bytes"""
    try:
        img = Image.open(io.BytesIO(image_data)).convert("RGB")
        img = 缩放到最大边(img, max_edge)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=95)
        return buf.getvalue()
    except Exception:
        return None


def _add_history(mode: str, data: dict, image_data: bytes, trigger_mode: str = ""):
    """线程安全地添加历史记录"""
    thumb_bytes = _make_thumbnail(image_data)
    entry_id = str(int(time.time() * 1000))
    entry = {
        "id": entry_id,
        "mode": mode,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
        "imageUrl": f"/history/thumb/{entry_id}",
        "thumb_bytes": thumb_bytes,
        "trigger_mode": trigger_mode
    }
    with _hist_lock:
        # P3-13: deque with maxlen auto-truncates — no manual cleanup needed
        # Drop oldest before adding if at capacity (preserve thumb_bytes cleanup)
        if len(server_history) >= HISTORY_MAX:
            try:
                old = server_history.pop()
                old.pop("thumb_bytes", None)
            except IndexError:
                pass
        server_history.appendleft(entry)


def _mark_hardware_online(ip_address: str = "", device_id: str = "ESP32-S3", firmware_version: str = "", capture_event: bool = False):
    with _hw_lock:
        hardware_state["online"] = True
        hardware_state["last_seen"] = time.time()
        if ip_address:
            hardware_state["ip_address"] = ip_address
        if device_id:
            hardware_state["device_id"] = device_id
        if firmware_version:
            hardware_state["firmware_version"] = firmware_version
        # fall back to existing stored values when caller doesn't provide them
        if not ip_address:
            ip_address = hardware_state.get("ip_address", "")
        if not firmware_version:
            firmware_version = hardware_state.get("firmware_version", "5.0.0")
        if capture_event:
            hardware_state["capture_count"] += 1
            hardware_state["last_capture"] = datetime.now(timezone.utc).isoformat()

async def _run_blocking(fn, *args):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(inference_executor, lambda: fn(*args))


# ===================== FastAPI 初始化 =====================
# P1-10: httpx async client for Vision API (connection pooling)
_vision_client: httpx.AsyncClient = None


def _get_vision_client() -> httpx.AsyncClient:
    """Lazily initialize the shared httpx AsyncClient with connection pooling."""
    global _vision_client
    if _vision_client is None:
        _vision_client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0),
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
        )
    return _vision_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _models_ready
    loop = asyncio.get_running_loop()
    # P0-8: Load CLIP and YOLO in parallel to reduce startup latency
    logger.info("Loading models in parallel (CLIP + YOLO)...")
    await asyncio.gather(
        loop.run_in_executor(inference_executor, _load_clip_and_encode),
        loop.run_in_executor(inference_executor, _load_yolo),
    )
    _models_ready = True
    logger.info("✅ All models loaded and ready.")
    asyncio.create_task(_hardware_status_checker())
    yield
    # P1-10: Close the shared httpx client
    if _vision_client is not None:
        await _vision_client.aclose()
    inference_executor.shutdown(wait=True)
    _esp32_executor.shutdown(wait=True)
    _sse_queues.clear()


app = FastAPI(title="物品识别API", version="5.3.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# P2-11: Routes to skip in the observability middleware (static assets, SSE)
_SKIP_METRICS_PREFIXES = ("/assets/", "/events")


@app.middleware("http")
async def request_observability(request: Request, call_next):
    if any(request.url.path.startswith(p) for p in _SKIP_METRICS_PREFIXES):
        return await call_next(request)
    start = time.perf_counter()
    try:
        response = await call_next(request)
        return response
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        with _metrics_lock:
            runtime_metrics["requests_total"] += 1

# ===================== 核心加速（无编译，100%兼容Windows） =====================
device = "cpu"
torch.set_num_threads(2)              # 限制 PyTorch 内部线程数，避免与 ThreadPoolExecutor 争抢
torch.set_num_interop_threads(1)
torch.set_grad_enabled(False)

# ===================== 模型声明（P0-8：延迟到 lifespan 并行加载） =====================
# CLIP model components — loaded in lifespan via _load_clip_and_encode()
model = None
processor = None
text_inputs = None
_text_features = None
_logit_scale = None
_CLASSIFY_RESULTS = []
_CLASSIFY_RESULTS_ZH = []      # Chinese label per prompt index (for aggregation)
_CLASSIFY_RESULTS_BY_ZH = {}   # first result dict per unique Chinese label

# YOLO — loaded in lifespan via _load_yolo() (keeps lazy-load fallback)
YOLO_MODEL_PATH = os.path.join(os.path.dirname(__file__), "exp-22.pt")
_yolo_model = None
_yolo_lock = threading.Lock()
_models_ready = False


def _load_clip_and_encode():
    """Load SigLIP model, processor, pre-compute text features and classify results (blocking)."""
    global model, processor, text_inputs, _text_features, _logit_scale, _CLASSIFY_RESULTS
    global _CLASSIFY_RESULTS_ZH, _CLASSIFY_RESULTS_BY_ZH
    logger.info("正在加载SigLIP模型...")
    if os.path.exists(os.path.join(MODEL_DIR, "config.json")):
        model = SiglipModel.from_pretrained(MODEL_DIR).to(device).eval()
        processor = SiglipProcessor.from_pretrained(MODEL_DIR)
    else:
        logger.info("  首次运行，正在下载SigLIP模型 (~1.2GB)...")
        model = SiglipModel.from_pretrained(MODEL_NAME).to(device).eval()
        processor = SiglipProcessor.from_pretrained(MODEL_NAME)
        model.save_pretrained(MODEL_DIR)
        processor.save_pretrained(MODEL_DIR)
        logger.info(f"  模型已保存到 {MODEL_DIR}")

    # Pre-encode text labels
    logger.info("正在预编码文本标签...")
    text_inputs = processor(
        text=TEXT_PROMPTS, return_tensors="pt", padding=True, truncation=True
    ).to(device)

    # Pre-compute L2-normalized text features (SigLIP's get_text_features already normalizes,
    # but re-normalizing is harmless and keeps code consistent)
    with torch.inference_mode():
        _text_features = model.get_text_features(**text_inputs)
        _text_features = _text_features / _text_features.norm(dim=-1, keepdim=True)
    _logit_scale = model.logit_scale.exp()

    # Pre-compute classify result dicts
    _CLASSIFY_RESULTS = []
    _CLASSIFY_RESULTS_ZH = []
    _CLASSIFY_RESULTS_BY_ZH = {}
    for prompt in TEXT_PROMPTS:
        zh = LABEL_MAP[prompt]
        cat, cat_zh = 获取垃圾分类(zh)
        entry = {
            "item_label": prompt, "item_label_zh": zh,
            "waste_category": cat, "waste_category_zh": cat_zh,
        }
        _CLASSIFY_RESULTS.append(entry)
        _CLASSIFY_RESULTS_ZH.append(zh)
        if zh not in _CLASSIFY_RESULTS_BY_ZH:
            _CLASSIFY_RESULTS_BY_ZH[zh] = entry

    logger.info(f"✅ SigLIP模型加载成功！({len(TEXT_PROMPTS)} 个标签, {len(GROUP_IDS)} 个分组)")


def _load_yolo():
    """Load YOLO model (blocking). Called from lifespan for eager loading."""
    global _yolo_model
    with _yolo_lock:
        if _yolo_model is None:
            logger.info("正在加载YOLO模型...")
            _yolo_model = YOLO(YOLO_MODEL_PATH)
            logger.info("✅ 本地YOLO模型加载成功！")


def _get_yolo_model():
    """YOLO lazy-load fallback — returns cached model or loads on first call."""
    global _yolo_model
    if _yolo_model is None:
        with _yolo_lock:
            if _yolo_model is None:
                logger.info("Loading YOLO model (lazy)...")
                _yolo_model = YOLO(YOLO_MODEL_PATH)
                logger.info("YOLO model loaded")
    return _yolo_model


def 缩放到最大边(image: Image.Image, max_edge: int = 1280) -> Image.Image:
    width, height = image.size
    longest = max(width, height)
    if longest <= max_edge:
        return image
    scale = max_edge / float(longest)
    new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
    return image.resize(new_size, Image.Resampling.BILINEAR)


def _prep_image(image_data: bytes, max_edge: int | None = 1280) -> Image.Image:
    image = Image.open(io.BytesIO(image_data)).convert("RGB")
    if max_edge is not None:
        return 缩放到最大边(image, max_edge)
    return image


# ===================== SigLIP 两阶段分类 =====================
def _classify_clip(image_data: bytes):
    image = _prep_image(image_data, max_edge=None)
    pixel_values = processor(images=image, return_tensors="pt").pixel_values.to(device)

    with torch.inference_mode():
        img_feats = model.get_image_features(pixel_values)
        img_feats = img_feats / img_feats.norm(dim=-1, keepdim=True)
        logits_per_image = (img_feats @ _text_features.T) * _logit_scale

    logits = logits_per_image.squeeze().cpu().numpy()

    # Aggregate by Chinese label: MAX logit per label
    zh_logits = {}
    zh_best_idx = {}
    for i, zh in enumerate(_CLASSIFY_RESULTS_ZH):
        if zh not in zh_logits or logits[i] > zh_logits[zh]:
            zh_logits[zh] = logits[i]
            zh_best_idx[zh] = i

    zh_labels_list = list(zh_logits.keys())
    zh_logit_vals = np.array(list(zh_logits.values()))

    # ── Stage 1: group-level softmax ──
    group_logits = {}
    for gid in GROUP_IDS:
        members = GROUP_MEMBERS[gid]
        # max logit among labels in this group
        candidates = [zh_logits[lbl] for lbl in members if lbl in zh_logits]
        group_logits[gid] = max(candidates) if candidates else -1e9
    g_logit_arr = np.array(list(group_logits.values()))
    g_probs = np.exp(g_logit_arr - g_logit_arr.max())
    g_probs = g_probs / g_probs.sum()
    winning_group = GROUP_IDS[int(np.argmax(g_probs))]
    group_conf = float(g_probs.max())

    # ── Stage 2: within-group softmax ──
    mask = np.array([_LABEL_TO_GROUP.get(lbl, "") == winning_group for lbl in zh_labels_list])
    sub_labels = [zh_labels_list[i] for i in range(len(zh_labels_list)) if mask[i]]
    sub_logits = zh_logit_vals[mask]

    if len(sub_logits) == 0:
        return _unknown_result(0.0, "clip")

    sub_probs = np.exp(sub_logits - sub_logits.max())
    sub_probs = sub_probs / sub_probs.sum()
    sub_sorted = np.argsort(sub_probs)[::-1]

    best_zh = sub_labels[sub_sorted[0]]
    best_conf = float(sub_probs[sub_sorted[0]])

    # Threshold at 20%
    if best_conf < 0.20:
        return _unknown_result(best_conf, "clip")

    best_result = dict(_CLASSIFY_RESULTS_BY_ZH[best_zh])
    best_result["item_label"] = TEXT_PROMPTS[zh_best_idx[best_zh]]
    top3_list = [
        dict(_CLASSIFY_RESULTS_BY_ZH[sub_labels[i]], confidence=float(sub_probs[i]),
             item_label=TEXT_PROMPTS[zh_best_idx[sub_labels[i]]])
        for i in sub_sorted[:3]
    ]

    return {
        "waste_category": best_result["waste_category"],
        "waste_category_zh": best_result["waste_category_zh"],
        "item_label": best_result["item_label"],
        "item_label_zh": best_result["item_label_zh"],
        "confidence": best_conf,
        "tip": "请将垃圾投放到对应类别的收集容器中",
        "top3": top3_list,
        "model_used": "clip"
    }


def _detect_yolo(image_data: bytes):
    image = _prep_image(image_data)
    # P1-4: Pass PIL Image directly, skip PIL-to-NumPy conversion
    # P1-3: Wrap predict in inference_mode for memory savings
    with torch.inference_mode():
        return _get_yolo_model().predict(
            source=image,
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
        # P0-8: Reject requests before models are loaded
        if not _models_ready:
            raise HTTPException(status_code=503, detail="Models still loading — please retry shortly")
        image_data = await file.read()
        with _active_model_lock:
            classify_model = model if model else active_classify_model
        logger.info(f"[classify] source={source}, ip={ip}, model={classify_model}, image_size={len(image_data)}")

        # ESP32 硬件上线标记
        if source == "esp32":
            global last_capture_image
            with _hw_lock:
                last_capture_image = image_data
            _mark_hardware_online(
                ip_address=ip,
                device_id="ESP32-S3",
                firmware_version="",
                capture_event=True
            )
            await _sse_notify("new_capture", {"source": "esp32"})

        # P1-9: Backpressure — reject web clients if inference pool is saturated
        if source != "esp32" and _inference_semaphore.locked():
            raise HTTPException(
                status_code=429,
                detail="Server busy — too many concurrent inference requests. Please retry shortly.",
                headers={"Retry-After": "2"}
            )

        # 按模型路由
        t_infer_start = time.time()
        # ESP32 always uses CLIP (fast local inference) — skip semaphore + dedicated executor
        # to avoid queuing behind slow cloud vision API calls
        if source == "esp32" and classify_model == "clip":
            loop = asyncio.get_running_loop()
            result_data = await loop.run_in_executor(_esp32_executor, _classify_clip, image_data)
            with _metrics_lock:
                runtime_metrics["inference"]["classify_count"] += 1
        else:
            async with _inference_semaphore:
                if classify_model == "clip":
                    result_data = await _run_blocking(_classify_clip, image_data)
                    with _metrics_lock:
                        runtime_metrics["inference"]["classify_count"] += 1
                elif classify_model in VISION_PROVIDERS:
                    if not VISION_PROVIDERS[classify_model]["api_key"]:
                        logger.warning(f"[classify] {classify_model} 未配置 API Key，回退到 CLIP")
                        result_data = await _run_blocking(_classify_clip, image_data)
                        result_data["model_used"] = "clip (fallback)"
                        with _metrics_lock:
                            runtime_metrics["inference"]["classify_count"] += 1
                            runtime_metrics["inference"]["fallback_count"] += 1
                    else:
                        try:
                            item_en, conf = await _call_vision_llm(image_data, classify_model)
                        except HTTPException as e:
                            logger.warning(f"[classify] Vision API 调用失败: {e.detail}, 回退到 CLIP")
                            with _metrics_lock:
                                runtime_metrics["inference"]["vision_failed"] += 1
                            if source != "esp32":
                                raise
                            result_data = await _run_blocking(_classify_clip, image_data)
                            result_data["model_used"] = "clip (fallback)"
                            with _metrics_lock:
                                runtime_metrics["inference"]["classify_count"] += 1
                                runtime_metrics["inference"]["fallback_count"] += 1
                        else:
                            en_key, item_zh = _match_vision_label(item_en)
                            waste_category, waste_category_zh = 获取垃圾分类(item_zh)
                            top3_entry = {
                                "item_label": en_key, "item_label_zh": item_zh,
                                "waste_category": waste_category, "waste_category_zh": waste_category_zh,
                                "confidence": conf
                            }
                            result_data = {
                                "waste_category": waste_category, "waste_category_zh": waste_category_zh,
                                "item_label": en_key, "item_label_zh": item_zh,
                                "confidence": conf,
                                "tip": "请将垃圾投放到对应类别的收集容器中",
                                "top3": [top3_entry],
                                "model_used": classify_model
                            }
                            with _metrics_lock:
                                runtime_metrics["inference"]["vision_count"] += 1
                else:
                    raise HTTPException(status_code=400, detail=f"Unknown model: {classify_model}")

        inference_time_ms = int((time.time() - t_infer_start) * 1000)
        response_time_ms = int((time.time() - t_start) * 1000)
        result_data["inference_time_ms"] = inference_time_ms
        result_data["response_time_ms"] = response_time_ms

        with _trigger_lock:
            tm = trigger_mode or trigger_config["mode"]
        if background_tasks:
            background_tasks.add_task(_add_history, "classify", result_data, image_data, tm)

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
        logger.error(f"[错误] {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"识别失败：{str(e)}")


@app.get("/health")
async def health():
    if not _models_ready:
        return {"status": "starting", "active_model": active_classify_model}
    with _active_model_lock:
        am = active_classify_model
    return {"status": "healthy", "active_model": am}


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
    with _active_model_lock:
        am = active_classify_model
    return {
        "active": am,
        "providers": providers
    }


class ModelConfigBody(BaseModel):
    provider: str
    api_key: str = ""
    api_base: str = ""
    model: str = ""


class ActiveModelBody(BaseModel):
    model: str


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
async def set_active_model(body: ActiveModelBody):
    """设置当前分类模型"""
    global active_classify_model
    valid = ["clip"] + list(VISION_PROVIDERS.keys())
    if body.model not in valid:
        raise HTTPException(status_code=400, detail=f"Unknown model: {body.model}. Valid: {valid}")
    with _active_model_lock:
        active_classify_model = body.model
    return {"active": active_classify_model, "message": f"Active model set to '{body.model}'"}


# ===================== 触发配置接口 =====================

class TriggerConfigBody(BaseModel):
    mode: str = "distance"              # "distance"
    distance_min: int = 30            # mm
    distance_max: int = 300           # mm
    cooldown_ms: int = 2000           # ms
    trigger_interval_ms: int = 10000  # ms


@app.get("/trigger/config")
async def get_trigger_config():
    with _trigger_lock:
        return dict(trigger_config)


@app.post("/trigger/config")
async def set_trigger_config(body: TriggerConfigBody):
    if body.mode not in ("distance",):
        raise HTTPException(status_code=400, detail="mode must be 'distance'")
    if body.distance_min < 0 or body.distance_max > 2000:
        raise HTTPException(status_code=400, detail="distance range must be 0-2000 mm")
    if body.distance_min >= body.distance_max:
        raise HTTPException(status_code=400, detail="distance_min must be < distance_max")
    if body.cooldown_ms < 0 or body.cooldown_ms > 30000:
        raise HTTPException(status_code=400, detail="cooldown_ms must be 0-30000 ms")
    if body.trigger_interval_ms < 1000 or body.trigger_interval_ms > 60000:
        raise HTTPException(status_code=400, detail="trigger_interval_ms must be 1000-60000 ms")
    with _trigger_lock:
        trigger_config["mode"] = body.mode
        trigger_config["distance_min"] = body.distance_min
        trigger_config["distance_max"] = body.distance_max
        trigger_config["cooldown_ms"] = body.cooldown_ms
        trigger_config["trigger_interval_ms"] = body.trigger_interval_ms
    logger.info(f"[trigger] config updated: mode={body.mode} range={body.distance_min}-{body.distance_max}mm cooldown={body.cooldown_ms}ms interval={body.trigger_interval_ms}ms")
    return {"message": "Trigger config updated", "config": dict(trigger_config)}


# ===================== YOLO 检测接口 =====================


@app.post("/detect")
async def detect_image(file: UploadFile = File(...), background_tasks: BackgroundTasks = None):
    # P0-8: Reject requests before models are loaded
    if not _models_ready:
        raise HTTPException(status_code=503, detail="Models still loading — please retry shortly")
    try:
        image_data = await file.read()
        results = await _run_blocking(_detect_yolo, image_data)
        with _metrics_lock:
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
        if background_tasks:
            background_tasks.add_task(_add_history, "detect", result_data, image_data, "web")

        return {
            "success": True,
            "result": result_data,
            "message": f"检测到 {len(detections)} 个目标，最高置信度类别：{top1['class_name']}"
        }
    except Exception as e:
        logger.error(f"[错误] {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"检测失败：{str(e)}")


# ===================== 模型信息接口 =====================
@app.get("/models")
async def get_models():
    # P0-8: Return limited info before models are loaded
    if not _models_ready:
        raise HTTPException(status_code=503, detail="Models still loading — please retry shortly")
    yolo_m = _yolo_model  # P3-7: handle None gracefully (lazy-loaded)
    yolo_names = yolo_m.names if yolo_m else {}
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
    with _hist_lock:
        total = len(server_history)
        start = (page - 1) * limit
        end = start + limit
        # P3-13: deque supports iteration but not slicing — use list() or itertools.islice
        items = [{k: v for k, v in e.items() if k != "thumb_bytes"} for e in list(server_history)[start:end]]
    return {
        "total": total,
        "page": page,
        "limit": limit,
        "items": items
    }


@app.delete("/history")
async def clear_history():
    with _hist_lock:
        server_history.clear()
    return {"success": True, "message": "History cleared"}


@app.delete("/history/item")
async def delete_history_item(id: str = Query(...)):
    with _hist_lock:
        # P3-13: deque does not support O(1) arbitrary-index pop — rebuild via filter
        keep = [e for e in server_history if e.get("id") != id]
        if len(keep) == len(server_history):
            raise HTTPException(status_code=404, detail="Entry not found")
        server_history.clear()
        for e in reversed(keep):
            server_history.appendleft(e)
    return {"success": True, "message": f"Deleted {id}"}


@app.get("/history/thumb/{entry_id}")
async def get_history_thumbnail(entry_id: str):
    """获取历史记录缩略图"""
    with _hist_lock:
        for entry in server_history:
            if entry.get("id") == entry_id:
                thumb = entry.get("thumb_bytes")
                if thumb:
                    return Response(content=thumb, media_type="image/jpeg")
                raise HTTPException(status_code=404, detail="Thumbnail not available")
    raise HTTPException(status_code=404, detail="Entry not found")


# ===================== 硬件接口 =====================
@app.post("/hardware/capture")
async def hardware_capture(
    file: UploadFile = File(...),
    device_id: str = Query("ESP32-S3"),
    firmware_version: str = Query("5.0.0"),
    ip_address: str = Query("unknown"),
    background_tasks: BackgroundTasks = None
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
        with _trigger_lock:
            trig_mode = trigger_config["mode"]
        with _hw_lock:
            last_capture_image = image_data

        hw_data = {
            "source": "hardware",
            "device_id": device_id,
            "ip_address": ip_address
        }
        if background_tasks:
            background_tasks.add_task(_add_history, "hardware", hw_data, image_data, trig_mode)
        else:
            _add_history("hardware", hw_data, image_data, trig_mode)

        await _sse_notify("new_capture", {"source": "hardware"})

        return {"success": True, "message": "Image received"}
    except Exception as e:
        logger.error(f"[硬件错误] {str(e)}\n{traceback.format_exc()}")
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
    with _hw_lock:
        img = last_capture_image
    if img is None:
        raise HTTPException(status_code=404, detail="No hardware image available")
    return Response(content=img, media_type="image/jpeg")


@app.get("/hardware/status")
async def hardware_status():
    """获取硬件连接状态"""
    _update_hardware_online()
    with _hw_lock:
        status = dict(hardware_state)
    return status


@app.get("/events")
async def sse_endpoint(request: Request):
    """Server-Sent Events — real-time push when ESP32 captures a photo"""
    queue = asyncio.Queue(maxsize=64)
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
    with _metrics_lock:
        inference = dict(runtime_metrics["inference"])
    return {"queue_depth": 0, "error_rate": 0}


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

    uvicorn.run(app, host="0.0.0.0", port=8085,
                timeout_keep_alive=30,     # HTTP keep-alive 30s: ESP32 心跳间隔内可复用，但不超过心跳周期
                backlog=256)               # TCP accept 队列：accept 并发硬件 + web 前端
