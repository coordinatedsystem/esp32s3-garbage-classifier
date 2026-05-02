/*
 * ESP32-S3 垃圾分类识别客户端
 * ====================================
 *
 * 硬件:
 *   - ESP32-S3-WROOM-1-N16R8 (通用 DevKit 引脚)
 *   - OV2640 摄像头 (板载 FPC 接口)
 *   - ST7735S 1.8" 128x160 RGB-TFT
 *
 * 屏幕接线:
 *   GND -> GND       VDD -> 3.3V
 *   SCL -> GPIO 14   (SPI Clock)
 *   SDA -> GPIO 38   (SPI MOSI)
 *   RST -> GPIO 1
 *   DC  -> GPIO 39
 *   CS  -> GPIO 40
 *   BLK -> GPIO 41
 *
 * 操作方式:
 *   - 短按 BOOT 键: CLIP 分类识别 (调用 /classify)
 *   - 长按 BOOT 键(>0.5s): 切换 分类/检测 模式
 *
 * 依赖库 (Arduino Library Manager 安装):
 *   - esp32 by Espressif (>= 2.0.14)
 *   - Adafruit GFX Library
 *   - Adafruit ST7735 and ST7789 Library
 *   - ArduinoJson by Benoit Blanchon
 *
 * 开发板设置 (Arduino IDE -> Tools):
 *   Board:             "ESP32S3 Dev Module"
 *   USB CDC On Boot:   "Enabled"
 *   PSRAM:             "OPI PSRAM"
 *   Flash Size:        "16MB (128Mb)"
 *   Partition Scheme:  "Huge APP (3MB No OTA/1MB SPIFFS)"
 *   CPU Frequency:     "240MHz (WiFi)"
 *   Flash Mode:        "QIO 80MHz"
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <esp_camera.h>
#include <img_converters.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <ArduinoJson.h>

// ==================== WiFi & 服务器配置 ====================
#include "wifi_config.h"

// ==================== 屏幕引脚 (ST7735S, 软件 SPI) ====================
#define TFT_CS   40
#define TFT_DC   39
#define TFT_RST  1
#define TFT_MOSI 38
#define TFT_SCLK 14
#define TFT_BLK  41

// ==================== 按键 ====================
#define BTN_CAPTURE 0    // BOOT 键 (按下为 LOW, 外部上拉)

// ==================== 摄像头引脚 ====================
#define PWDN_GPIO_NUM     -1
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM     15
#define SIOD_GPIO_NUM      4   // SCCB I2C Data
#define SIOC_GPIO_NUM      5   // SCCB I2C Clock
#define Y9_GPIO_NUM       16   // D7
#define Y8_GPIO_NUM       17   // D6
#define Y7_GPIO_NUM       18   // D5
#define Y6_GPIO_NUM       12   // D4
#define Y5_GPIO_NUM       10   // D3
#define Y4_GPIO_NUM        9   // D2
#define Y3_GPIO_NUM       11   // D1
#define Y2_GPIO_NUM        8   // D0
#define VSYNC_GPIO_NUM     6
#define HREF_GPIO_NUM      7
#define PCLK_GPIO_NUM     13

// ==================== 摄像头参数 ====================
#define CAM_JPEG_QUALITY 12

// ==================== 全局对象 ====================
// 指针延迟到 setup() 初始化, 避免静态构造阶段崩溃
Adafruit_ST7735* tft = NULL;

// 颜色常量
#define C_BG          ST77XX_BLACK
#define C_TEXT        ST77XX_WHITE
#define C_ACCENT      ST77XX_GREEN
#define C_WARN        ST77XX_YELLOW
#define C_ERR         ST77XX_RED
#define C_RECYCLABLE  0x07E0   // 绿
#define C_KITCHEN     0xFD20   // 橙
#define C_HAZARDOUS   0xF800   // 红
#define C_OTHER       0x8410   // 灰

enum Mode { MODE_CLASSIFY, MODE_DETECT };
Mode currentMode = MODE_CLASSIFY;
bool wifiOk = false;

// ==================== 初始化 ====================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- Garbage Classifier ---");

  // 屏幕 (延迟初始化, 避免静态全局构造崩溃)
  tft = new Adafruit_ST7735(TFT_CS, TFT_DC, TFT_MOSI, TFT_SCLK, TFT_RST);
  pinMode(TFT_BLK, OUTPUT);
  digitalWrite(TFT_BLK, HIGH);
  tft->initR(INITR_BLACKTAB);
  tft->setRotation(1);
  tft->fillScreen(C_BG);
  tft->setTextWrap(true);
  drawBoot("LCD OK");

  // PSRAM 检测
  size_t psramSize = ESP.getPsramSize();
  Serial.printf("PSRAM: %u bytes\n", psramSize);
  if (psramSize < 1024 * 1024) {
    drawError("PSRAM missing! Check: Tools->PSRAM->OPI PSRAM");
    while (1) delay(1000);
  }

  // 摄像头 (内部自动尝试多套配置)
  if (!cameraInit()) {
    drawError("Camera fail");
    while (1) delay(1000);
  }
  drawBoot("Camera OK");

  // WiFi
  drawBoot("WiFi...");
  wifiOk = wifiConnect();
  if (!wifiOk) {
    drawError("WiFi fail");
    while (1) delay(1000);
  }

  // 按键
  pinMode(BTN_CAPTURE, INPUT_PULLUP);

  drawIdle();
  Serial.println("Ready.");
}

// ==================== 主循环 ====================
void loop() {
  static bool lastBtn = false;
  static unsigned long pressStart = 0;

  bool btn = (digitalRead(BTN_CAPTURE) == LOW);

  if (btn && !lastBtn) pressStart = millis();
  if (!btn && lastBtn) {
    unsigned long dur = millis() - pressStart;
    if (dur > 500) {
      currentMode = (currentMode == MODE_CLASSIFY) ? MODE_DETECT : MODE_CLASSIFY;
      drawIdle();
    } else if (dur > 30) {
      doCapture();
    }
  }
  lastBtn = btn;

  // WiFi 掉线重连
  static unsigned long lastCheck = 0;
  if (millis() - lastCheck > 10000) {
    lastCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      wifiOk = false;
      wifiOk = wifiConnect();
    }
  }

  delay(20);
}

// ==================== FreeRTOS 超时抓拍 ====================
static camera_fb_t* volatile fbResult = NULL;
static volatile bool fbDone = false;

static void fbTask(void* pv) {
  fbResult = esp_camera_fb_get();
  fbDone = true;
  vTaskDelete(NULL);
}

camera_fb_t* fbGetTimeout(int ms) {
  fbResult = NULL;
  fbDone = false;
  xTaskCreate(fbTask, "fb", 4096, NULL, 5, NULL);
  unsigned long t0 = millis();
  while (!fbDone && (millis() - t0 < (unsigned long)ms)) {
    delay(10);
    yield();
  }
  if (fbDone) return fbResult;
  Serial.printf("  TIMEOUT after %d ms — camera not streaming!\n", ms);
  return NULL;
}

// ==================== 拍照 + 识别 ====================
void doCapture() {
  Serial.println(">>> BOOT pressed");
  tft->fillScreen(C_BG);
  tft->setCursor(0, 30);
  tft->setTextColor(C_WARN, C_BG);
  tft->setTextSize(1);
  tft->println("Capturing...");

  camera_fb_t* fb = NULL;
  for (int i = 0; i < 3; i++) {
    tft->printf("try %d/3\n", i + 1);
    fb = fbGetTimeout(3000);
    if (fb && fb->len > 0) break;
    if (fb) { esp_camera_fb_return(fb); fb = NULL; }
  }

  if (!fb || fb->len == 0) {
    tft->println("CAPTURE FAIL");
    drawError("Capture fail");
    if (fb) esp_camera_fb_return(fb);
    delay(2000); drawIdle(); return;
  }

  Serial.printf("Frame: %u bytes, fmt=%d\n", fb->len, fb->format);
  drawUpload();

  // RGB565 需转 JPEG 才能发给服务器
  uint8_t* jpgBuf = NULL;
  size_t   jpgLen = 0;
  if (fb->format == PIXFORMAT_RGB565) {
    tft->println("RGB->JPG...");
    uint16_t w = fb->width, h = fb->height;
    size_t rawLen = fb->len;
    bool ok = fmt2jpg(fb->buf, fb->len, w, h,
                      PIXFORMAT_RGB565, 80, &jpgBuf, &jpgLen);
    esp_camera_fb_return(fb);
    fb = NULL;
    if (!ok || !jpgBuf || jpgLen == 0) {
      tft->println("convert fail");
      drawError("Convert fail");
      delay(1500); drawIdle(); return;
    }
    Serial.printf("RGB->JPG: %u -> %u bytes\n", rawLen, jpgLen);
  }

  const char* ep = (currentMode == MODE_CLASSIFY) ? "/classify" : "/detect";
  String resp = httpUpload(ep, jpgBuf ? jpgBuf : fb->buf, jpgBuf ? jpgLen : fb->len);
  if (jpgBuf) free(jpgBuf);
  if (fb) { esp_camera_fb_return(fb); fb = NULL; }

  if (resp.length() == 0) {
    drawError("No response");
    delay(1500); drawIdle(); return;
  }

  DynamicJsonDocument doc(8192);
  if (deserializeJson(doc, resp)) {
    drawError("JSON err");
    delay(1500); drawIdle(); return;
  }

  if (!doc["success"]) {
    drawError("Recog fail");
    delay(1500); drawIdle(); return;
  }

  if (currentMode == MODE_CLASSIFY) {
    const char* zh  = doc["result"]["item_label_zh"];
    float conf      = doc["result"]["confidence"];
    String s(zh);
    int idx = s.indexOf("、");
    String item  = (idx > 0) ? s.substring(0, idx)     : s;
    String cat   = (idx > 0) ? s.substring(idx + 1)    : "";
    drawResult(item.c_str(), cat.c_str(), conf);
    Serial.printf("=> %s | %s (%.1f%%)\n", item.c_str(), cat.c_str(), conf * 100);
  } else {
    if (!doc["result"]["detected"]) {
      drawResult("---", "No object", 0);
    } else {
      const char* name = doc["result"]["item_label"];
      float conf       = doc["result"]["confidence"];
      drawResult(name, "DETECTED", conf);
      Serial.printf("=> %s (%.1f%%)\n", name, conf * 100);
    }
  }

  delay(3000);
  drawIdle();
}

// ==================== WiFi ====================
bool wifiConnect() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500); Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("IP: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }
  return false;
}

// ==================== 摄像头 ====================
// OV3660 仅 RGB565 能出流, JPEG 由 doCapture 软件转码
// 使用多轮尝试结构做兜底, 但不 deinit (避免重启)
static const framesize_t trySizes[] = { FRAMESIZE_VGA, FRAMESIZE_QVGA, FRAMESIZE_SVGA };
#define TRY_COUNT (sizeof(trySizes) / sizeof(trySizes[0]))

bool cameraInit() {
  for (int t = 0; t < TRY_COUNT; t++) {
    camera_config_t cfg;
    // 不 memset, 只设需要的字段 (和之前工作的版本一致)
    cfg.ledc_channel    = LEDC_CHANNEL_0;
    cfg.ledc_timer      = LEDC_TIMER_0;
    cfg.pin_d0          = Y2_GPIO_NUM;
    cfg.pin_d1          = Y3_GPIO_NUM;
    cfg.pin_d2          = Y4_GPIO_NUM;
    cfg.pin_d3          = Y5_GPIO_NUM;
    cfg.pin_d4          = Y6_GPIO_NUM;
    cfg.pin_d5          = Y7_GPIO_NUM;
    cfg.pin_d6          = Y8_GPIO_NUM;
    cfg.pin_d7          = Y9_GPIO_NUM;
    cfg.pin_xclk        = XCLK_GPIO_NUM;
    cfg.pin_pclk        = PCLK_GPIO_NUM;
    cfg.pin_vsync       = VSYNC_GPIO_NUM;
    cfg.pin_href        = HREF_GPIO_NUM;
    cfg.pin_sccb_sda    = SIOD_GPIO_NUM;
    cfg.pin_sccb_scl    = SIOC_GPIO_NUM;
    cfg.pin_pwdn        = PWDN_GPIO_NUM;
    cfg.pin_reset       = RESET_GPIO_NUM;
    cfg.pixel_format    = PIXFORMAT_RGB565;
    cfg.frame_size      = trySizes[t];
    cfg.xclk_freq_hz    = 10000000;
    cfg.grab_mode       = CAMERA_GRAB_WHEN_EMPTY;
    cfg.jpeg_quality    = CAM_JPEG_QUALITY;
    cfg.fb_count        = 1;
    cfg.fb_location     = CAMERA_FB_IN_PSRAM;

    tft->printf("Try%d\n", t);
    Serial.printf("Cam try %d\n", t);

    // 注意: 不调 esp_camera_deinit(), 避免重启
    esp_err_t err = esp_camera_init(&cfg);
    if (err != ESP_OK) {
      tft->printf(" err 0x%x\n", err);
      Serial.printf(" init err: 0x%x\n", err);
      continue;
    }

    sensor_t* s = esp_camera_sensor_get();
    if (s) {
      tft->printf(" PID:0x%04X\n", s->id.PID);
      s->set_reg(s, 0x3008, 0xFF, 0x80); delay(30);
      s->set_reg(s, 0x3008, 0xFF, 0x00); delay(100);
    }
    delay(400);

    camera_fb_t* fb = fbGetTimeout(3000);
    if (fb && fb->len > 0) {
      tft->printf(" OK! %uB\n", fb->len);
      Serial.printf(" OK: %u bytes\n", fb->len);
      esp_camera_fb_return(fb);
      for (int w = 0; w < 2; w++) {
        fb = fbGetTimeout(2000);
        if (fb) { esp_camera_fb_return(fb); }
      }
      if (s) {
        s->set_brightness(s, 0);     s->set_contrast(s, 0);
        s->set_saturation(s, 0);     s->set_whitebal(s, 1);
        s->set_awb_gain(s, 1);       s->set_wb_mode(s, 0);
        s->set_exposure_ctrl(s, 1);  s->set_aec2(s, 1);
        s->set_gain_ctrl(s, 1);      s->set_bpc(s, 0);
        s->set_wpc(s, 1);            s->set_raw_gma(s, 1);
        s->set_lenc(s, 1);           s->set_hmirror(s, 0);
        s->set_vflip(s, 1);          s->set_dcw(s, 1);
        s->set_colorbar(s, 0);
      }
      return true;
    }
    tft->println(" no frame");
  }
  tft->println("ALL FAILED");
  return false;
}

// ==================== HTTP 上传 ====================
String httpUpload(const char* endpoint, uint8_t* jpg, size_t len) {
  const char* bd = "----ESP32S3Boundary";
  char head[256];
  int hLen = snprintf(head, sizeof(head),
    "--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"cap.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n", bd);
  char foot[64];
  int fLen = snprintf(foot, sizeof(foot), "\r\n--%s--\r\n", bd);

  size_t total = hLen + len + fLen;
  uint8_t* body = (uint8_t*)ps_malloc(total);
  if (!body) return "";
  memcpy(body, head, hLen);
  memcpy(body + hLen, jpg, len);
  memcpy(body + hLen + len, foot, fLen);

  String url = "http://" + String(SERVER_HOST) + ":" + SERVER_PORT + endpoint;
  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "multipart/form-data; boundary=" + String(bd));
  http.setTimeout(15000);

  unsigned long t0 = millis();
  int code = http.POST(body, total);
  free(body);

  Serial.printf("POST %s => %d (%lu ms)\n", endpoint, code, millis() - t0);
  if (code != 200) { http.end(); return ""; }
  String payload = http.getString();
  http.end();
  return payload;
}

// ==================== 屏幕 UI ====================
void drawBoot(const char* msg) {
  tft->setCursor(0, tft->getCursorY() + 12);
  tft->setTextColor(C_TEXT, C_BG);
  tft->setTextSize(1);
  tft->print("  "); tft->println(msg);
  Serial.println(msg);
}

void drawError(const char* msg) {
  tft->fillScreen(C_BG);
  tft->setCursor(10, 50); tft->setTextColor(C_ERR, C_BG); tft->setTextSize(2);
  tft->println("ERROR");
  tft->setCursor(10, 80); tft->setTextColor(C_TEXT, C_BG); tft->setTextSize(1);
  tft->println(msg);
}

void drawIdle() {
  tft->fillScreen(C_BG);

  // 状态栏
  tft->setCursor(0, 4); tft->setTextColor(C_TEXT, C_BG); tft->setTextSize(1);
  tft->print(wifiOk ? WiFi.localIP().toString().c_str() : "No WiFi");
  tft->fillRect(148, 4, 8, 8, wifiOk ? ST77XX_GREEN : ST77XX_RED);

  tft->setCursor(40, 16); tft->setTextColor(C_ACCENT, C_BG);
  tft->print(currentMode == MODE_CLASSIFY ? "[CLASSIFY]" : "[DETECT]");
  tft->drawFastHLine(0, 28, 160, ST77XX_BLUE);

  // 提示
  tft->setCursor(12, 48); tft->setTextColor(ST77XX_CYAN, C_BG); tft->setTextSize(2);
  tft->print("Press BOOT");
  tft->setCursor(8, 74); tft->setTextColor(C_TEXT, C_BG); tft->setTextSize(1);
  tft->print("Short: capture  Long: mode");

  tft->drawFastHLine(0, 108, 160, ST77XX_BLUE);
  tft->setCursor(6, 114); tft->setTextColor(C_OTHER, C_BG); tft->setTextSize(1);
  tft->print(SERVER_HOST); tft->print(":"); tft->print(SERVER_PORT);
}

void drawUpload() {
  tft->fillScreen(C_BG);
  tft->setCursor(20, 45); tft->setTextColor(C_ACCENT, C_BG); tft->setTextSize(2);
  tft->print("Uploading");
  for (int i = 0; i < 130; i += 5) {
    tft->drawFastHLine(15, 95, i, C_ACCENT);
    delay(10);
  }
}

void drawResult(const char* item, const char* cat, float conf) {
  tft->fillScreen(C_BG);

  // 模式
  tft->setCursor(0, 4); tft->setTextColor(C_ACCENT, C_BG); tft->setTextSize(1);
  tft->print(currentMode == MODE_CLASSIFY ? "CLASSIFY" : "DETECT");
  tft->drawFastHLine(0, 16, 160, 0x07E0);

  // 物品名
  tft->setCursor(4, 22); tft->setTextColor(ST77XX_CYAN, C_BG); tft->setTextSize(1);
  tft->print(item);

  // 分类
  tft->setCursor(4, 42); tft->setTextSize(2);
  uint16_t cc = C_TEXT;
  if      (strstr(cat, "可回收")) cc = C_RECYCLABLE;
  else if (strstr(cat, "厨余"))   cc = C_KITCHEN;
  else if (strstr(cat, "有害"))   cc = C_HAZARDOUS;
  else if (strstr(cat, "其他"))   cc = C_OTHER;
  tft->setTextColor(cc, C_BG);
  tft->print(cat);

  // 置信度
  tft->setCursor(4, 72); tft->setTextColor(C_TEXT, C_BG); tft->setTextSize(1);
  tft->print("Conf: ");
  tft->setTextColor(C_WARN, C_BG);
  tft->print(conf * 100, 1); tft->print("%");

  // 置信度条
  int bw = (int)(conf * 130);
  tft->drawRect(4, 88, 130, 10, C_TEXT);
  tft->fillRect(6, 90, bw, 6, cc);

  // 底部
  tft->drawFastHLine(0, 108, 160, ST77XX_BLUE);
  tft->setCursor(8, 114); tft->setTextColor(C_OTHER, C_BG); tft->setTextSize(1);
  tft->print("Wait 3s to return");
}
