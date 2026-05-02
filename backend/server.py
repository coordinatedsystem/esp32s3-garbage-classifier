import os

# 强制本地加载，不联网
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
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from transformers import CLIPProcessor, CLIPModel
from ultralytics import YOLO

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
MODEL_NAME = os.path.join(os.path.dirname(__file__), "clip_model")

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

# ===================== FastAPI 初始化 =====================
app = FastAPI(title="物品识别API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ===================== 核心加速（无编译，100%兼容Windows） =====================
device = "cpu"
torch.set_num_threads(4)
torch.set_num_interop_threads(1)
torch.set_grad_enabled(False)

# 加载模型（纯CPU，无编译）
print("正在加载CLIP模型...")
model = CLIPModel.from_pretrained(MODEL_NAME, local_files_only=True).to(device).eval()
processor = CLIPProcessor.from_pretrained(MODEL_NAME, local_files_only=True, use_fast=False)

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


# ===================== 识别接口（稳定无报错） =====================
@app.post("/classify")
async def classify_image(file: UploadFile = File(...)):
    try:
        # 读取图片
        image_data = await file.read()
        image = Image.open(io.BytesIO(image_data)).convert("RGB")
        image = 缩放到最大边(image, 1280)

        # 图片预处理
        pixel_values = processor(images=image, return_tensors="pt").pixel_values.to(device)

        # 极速推理（无编译，纯原生加速）
        with torch.inference_mode():
            outputs = model(pixel_values=pixel_values, **text_inputs)

        # 计算结果
        probs = outputs.logits_per_image.softmax(dim=1).squeeze().cpu().numpy()
        sorted_idx = np.argsort(probs)[::-1]

        # 构造返回
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
            "success": True,
            "result": {
                "waste_category": waste_category,
                "waste_category_zh": waste_category_zh,
                "item_label": TEXT_PROMPTS[best_idx],
                "item_label_zh": best_item_zh,
                "confidence": float(probs[best_idx]),
                "tip": "请将垃圾投放到对应类别的收集容器中",
                "top3": top3_list
            },
            "message": f"识别结果：{LABEL_MAP[TEXT_PROMPTS[best_idx]]} 置信度：{probs[best_idx] * 100:.1f}%"
        }

    except Exception as e:
        print(f"[错误] {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"识别失败：{str(e)}")


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/detect")
async def detect_image(file: UploadFile = File(...)):
    try:
        image_data = await file.read()
        image = Image.open(io.BytesIO(image_data)).convert("RGB")
        image = 缩放到最大边(image, 1280)
        image_np = np.array(image)

        results = yolo_model.predict(
            source=image_np,
            verbose=False,
            device="cpu",
            imgsz=512,
            conf=0.25,
            iou=0.45
        )
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
        return {
            "success": True,
            "result": {
                "detected": True,
                "count": len(detections),
                "item_label": top1["class_name"],
                "confidence": top1["confidence"],
                "top1": top1,
                "detections": detections
            },
            "message": f"检测到 {len(detections)} 个目标，最高置信度类别：{top1['class_name']}"
        }
    except Exception as e:
        print(f"[错误] {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"检测失败：{str(e)}")


# ===================== 启动服务 =====================
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8085)