"""
下载所需模型文件
Download required model files
"""

import os
import sys

# 如果需要使用国内镜像，取消下面的注释
# os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CLIP_MODEL_DIR = os.path.join(SCRIPT_DIR, "clip_model")
CLIP_MODEL_ID = "openai/clip-vit-base-patch32"


def download_clip():
    """下载 CLIP 模型到 backend/clip_model/"""
    from transformers import CLIPProcessor, CLIPModel
    print(f"Downloading CLIP model: {CLIP_MODEL_ID}")
    print(f"Saving to: {CLIP_MODEL_DIR}")
    os.makedirs(CLIP_MODEL_DIR, exist_ok=True)

    model = CLIPModel.from_pretrained(CLIP_MODEL_ID)
    processor = CLIPProcessor.from_pretrained(CLIP_MODEL_ID)

    model.save_pretrained(CLIP_MODEL_DIR)
    processor.save_pretrained(CLIP_MODEL_DIR)

    print("CLIP model downloaded successfully.")


def download_yolo():
    """下载 YOLOv8n 模型 (如果 exp-22.pt 不存在则下载预训练权重)"""
    yolo_path = os.path.join(SCRIPT_DIR, "exp-22.pt")
    if os.path.exists(yolo_path):
        print(f"YOLO model already exists: {yolo_path}")
        return

    from ultralytics import YOLO
    print("Downloading YOLOv8n pretrained model...")
    model = YOLO("yolov8n.pt")
    import shutil
    shutil.move("yolov8n.pt", yolo_path)
    print(f"YOLO model saved to: {yolo_path}")


def main():
    print("=" * 50)
    print("Model Download Script")
    print("=" * 50)

    try:
        download_clip()
    except Exception as e:
        print(f"[WARNING] CLIP download failed: {e}")
        print("You can still use the YOLO detection endpoint without CLIP.")

    try:
        download_yolo()
    except Exception as e:
        print(f"[WARNING] YOLO download failed: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
