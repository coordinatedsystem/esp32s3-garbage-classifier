import os
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

from PIL import Image
import torch
import cv2
from transformers import CLIPProcessor, CLIPModel
import numpy as np

# -------------------------- 垃圾分类专用标签映射（超高准确率） --------------------------
# 左：CLIP模型用【最优英文提示词】（覆盖大类特征，识别率拉满）
# 右：用户/老师看到的【中文大类名称】（简洁直观）
LABEL_MAP = {
    # 👉 文具大类（核心测试物品）
    "a common stationery pen": "笔",
    "a book for study": "书本",
    "an eraser for writing": "橡皮",
    "a sheet of white paper": "纸张",
    "a student notebook": "笔记本",
    # 👉 日常容器/垃圾大类
    "a plastic beverage bottle": "塑料瓶",
    "a glass or ceramic cup": "杯子",
    # 👉 电子/日常物品
    "a mobile phone": "手机",
    "a computer mouse": "鼠标",
    "a pair of glasses": "眼镜",
    # 👉 纸制品垃圾
    "a small cardboard box": "纸盒子"
}

# 自动提取提示词和中文标签
TEXT_PROMPTS = list(LABEL_MAP.keys())
CHINESE_LABELS = list(LABEL_MAP.values())

# -------------------------------------------------------------------------
MODEL_NAME = "openai/clip-vit-base-patch32"
CAMERA_INDEX = 0
# -------------------------------------------------------------------------

# 加载模型
device = "cuda" if torch.cuda.is_available() else "cpu"
model = CLIPModel.from_pretrained(MODEL_NAME).to(device)
processor = CLIPProcessor.from_pretrained(MODEL_NAME)

# 打开摄像头
cap = cv2.VideoCapture(CAMERA_INDEX)
if not cap.isOpened():
    raise Exception("摄像头打开失败！")

print("=== 垃圾分类识别系统已启动 ===")
print("按键说明：S键 = 拍照识别 | Q键 = 退出程序")

# 主循环
while True:
    ret, frame = cap.read()
    if not ret:
        print("读取摄像头失败！")
        break

    # 界面提示
    cv2.putText(frame, "S: 识别 | Q: 退出", (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
    cv2.imshow("垃圾分类识别器", frame)

    key = cv2.waitKey(1) & 0xFF
    if key == ord('q'):
        break
    elif key == ord('s'):
        print("\n正在识别物品类别...")
        # 图像格式转换
        image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

        # CLIP推理
        inputs = processor(text=TEXT_PROMPTS, images=image,
                           return_tensors="pt", padding=True).to(device)
        with torch.no_grad():
            outputs = model(**inputs)

        # 计算概率并排序
        probs = outputs.logits_per_image.softmax(dim=1).cpu().numpy()[0]
        sorted_idx = np.argsort(probs)[::-1]

        # 输出结果（纯中文，无英文提示词）
        print("="*50)
        for idx in sorted_idx:
            print(f"物品类别: {CHINESE_LABELS[idx]:8} | 置信概率: {probs[idx]*100:.1f}%")
        print("="*50)

        best_result = CHINESE_LABELS[sorted_idx[0]]
        print(f"\n✅ 最终识别结果：{best_result}")

# 释放资源
cap.release()
cv2.destroyAllWindows()
print("程序已退出")