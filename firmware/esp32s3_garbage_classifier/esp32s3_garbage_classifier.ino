/**
 * ESP32-S3 Garbage Classifier
 * OV3660 -> CLIP backend -> ST7735 128x160 TFT
 *
 * 按 BOOT 键拍照 -> 硬件JPEG -> 上传后端 -> 显示分类结果
 * 所有调试信息直接输出到屏幕，不依赖串口
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <Adafruit_VL53L0X.h>
#include "esp_camera.h"
#include "wifi_config.h"
#include "img_converters.h"   // fmt2jpg
#include "esp_heap_caps.h"    // heap_caps_malloc (PSRAM)

// ==============================
// 屏幕引脚 (软件SPI)
// ==============================
#define PIN_CS   40
#define PIN_DC   39
#define PIN_RST  1
#define PIN_MOSI 38
#define PIN_SCLK 14
#define PIN_BLK  41

Adafruit_ST7735 tft = Adafruit_ST7735(PIN_CS, PIN_DC, PIN_MOSI, PIN_SCLK, PIN_RST);

// ==============================
// BOOT 按钮 (GPIO 0, 按下为 LOW)
// ==============================
#define PIN_BOOT 0

// ==============================
// TOF200C VL53L0X 激光测距
// ==============================
#define TOF_SDA  47
#define TOF_SCL  21
#define TOF_INT  48
#define TOF_SHUT 45
Adafruit_VL53L0X tof = Adafruit_VL53L0X();

// ==============================
// 摄像头引脚
// ==============================
#define PWDN_GPIO_NUM   -1
#define RESET_GPIO_NUM  -1
#define XCLK_GPIO_NUM   15
#define SIOD_GPIO_NUM   4
#define SIOC_GPIO_NUM   5
#define Y9_GPIO_NUM     16
#define Y8_GPIO_NUM     17
#define Y7_GPIO_NUM     18
#define Y6_GPIO_NUM     12
#define Y5_GPIO_NUM     10
#define Y4_GPIO_NUM     9
#define Y3_GPIO_NUM     11
#define Y2_GPIO_NUM     8
#define VSYNC_GPIO_NUM  6
#define HREF_GPIO_NUM   7
#define PCLK_GPIO_NUM   13

// ==============================
// 参数
// ==============================
#define HTTP_TIMEOUT_MS  10000
#define FIRMWARE_VERSION "4.0.0"

// 颜色
#define C_BLACK     ST7735_BLACK
#define C_WHITE     ST7735_WHITE
#define C_RED       ST7735_RED
#define C_GREEN     ST7735_GREEN
#define C_BLUE      ST7735_BLUE
#define C_CYAN      ST7735_CYAN
#define C_YELLOW    ST7735_YELLOW
#define C_DARKGREY  0x7BEF

// ==============================
// 全局
// ==============================
// 触发配置 (从服务器拉取)
String  triggerMode = "button";   // "button" | "distance"
int     distanceMin = 30;         // mm
int     distanceMax = 300;        // mm
int     cooldownMs  = 2000;       // ms, 物体稳定时间
int     triggerIntervalMs = 10000; // ms, 两次触发最小间隔
unsigned long presenceStart = 0;  // TOF 物体出现计时
unsigned long lastTrigger = 0;    // 上次触发 ms (防重复触发)
unsigned long lastConfigFetch = 0;
unsigned long lastTofRefresh = 0; // 屏幕 TOF 刷新计时
bool    configChanged = false;    // 配置变更反馈标记
unsigned long configMsgMs = 0;    // 配置消息显示计时

// ==============================
// 屏幕小工具
// ==============================
void cls()  { tft.fillScreen(C_BLACK); }

void txt(int x, int y, uint8_t sz, uint16_t c, const char* s) {
  tft.setCursor(x, y);
  tft.setTextSize(sz);
  tft.setTextColor(c);
  tft.print(s);
}

void num(int x, int y, uint8_t sz, uint16_t c, int n) {
  tft.setCursor(x, y);
  tft.setTextSize(sz);
  tft.setTextColor(c);
  tft.print(n);
}

void bar(const char* s) {
  tft.fillRect(0, 140, 128, 20, C_BLACK);
  tft.setCursor(2, 144);
  tft.setTextSize(1);
  tft.setTextColor(C_YELLOW);
  tft.print(s);
}

void err(const char* s) {
  cls();
  txt(0, 5, 3, C_RED, "ERROR");
  txt(0, 50, 2, C_WHITE, s);
}

// ==============================
// WiFi
// ==============================
bool wifiConnect() {
  cls();
  txt(0, 0, 2, C_CYAN, "WiFi Setup");
  tft.drawFastHLine(0, 18, 128, C_DARKGREY);

  WiFi.mode(WIFI_STA);

  bar("Scanning...");
  txt(0, 22, 1, C_WHITE, "Scan...");
  int n = WiFi.scanNetworks();

  tft.fillRect(0, 22, 128, 10, C_BLACK);
  txt(0, 22, 1, C_YELLOW, "Found");
  num(40, 22, 1, C_YELLOW, n);
  txt(55, 22, 1, C_YELLOW, "networks");

  int show = (n < 8) ? n : 8;
  for (int i = 0; i < show; i++) {
    String ssid = WiFi.SSID(i);
    int rssi = WiFi.RSSI(i);
    if (ssid.length() > 16) ssid = ssid.substring(0, 14) + "~";
    uint16_t clr = (ssid == WIFI_SSID) ? C_GREEN : C_WHITE;
    txt(0, 34 + i * 10, 1, clr, ssid.c_str());
    num(100, 34 + i * 10, 1, C_DARKGREY, rssi);
  }

  bool found = false;
  for (int i = 0; i < n; i++)
    if (WiFi.SSID(i) == WIFI_SSID) { found = true; break; }

  WiFi.scanDelete();

  int infoY = 34 + show * 10 + 4;
  txt(0, infoY, 1, C_WHITE, "Target:");
  txt(42, infoY, 1, found ? C_GREEN : C_RED, found ? "FOUND" : "NOT FOUND");
  txt(0, infoY + 10, 1, C_WHITE, "SSID:");
  txt(36, infoY + 10, 1, C_CYAN, WIFI_SSID);

  bar("Connecting...");
  txt(0, infoY + 22, 1, C_YELLOW, "Connecting...");

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 60) {
    delay(500);
    retries++;
    if (retries % 5 == 0) tft.print(".");
  }

  wl_status_t st = WiFi.status();
  tft.fillRect(0, infoY + 22, 128, 10, C_BLACK);
  txt(0, infoY + 22, 1, C_WHITE, "Status:");
  num(48, infoY + 22, 1, (st == 3) ? C_GREEN : C_RED, st);

  if (st == WL_CONNECTED) {
    txt(0, infoY + 34, 1, C_GREEN, "CONNECTED");
    txt(0, infoY + 46, 1, C_WHITE, "IP:");
    txt(18, infoY + 46, 1, C_GREEN, WiFi.localIP().toString().c_str());
    delay(1500);
    return true;
  }

  txt(0, infoY + 34, 1, C_RED, "FAILED");
  if (st == 1)      txt(0, infoY + 46, 1, C_RED, "SSID not found");
  else if (st == 4) txt(0, infoY + 46, 1, C_RED, "Bad password?");
  else              { txt(0, infoY + 46, 1, C_RED, "Code:"); num(36, infoY + 46, 1, C_RED, st); }
  delay(4000);
  return false;
}

// ==============================
// 摄像头 (OV3660, YUV422 原生格式 -> fmt2jpg 转 JPEG)
// ==============================
bool cameraInit() {
  camera_config_t config;
  config.ledc_channel  = LEDC_CHANNEL_0;
  config.ledc_timer    = LEDC_TIMER_0;
  config.pin_d0        = Y2_GPIO_NUM;
  config.pin_d1        = Y3_GPIO_NUM;
  config.pin_d2        = Y4_GPIO_NUM;
  config.pin_d3        = Y5_GPIO_NUM;
  config.pin_d4        = Y6_GPIO_NUM;
  config.pin_d5        = Y7_GPIO_NUM;
  config.pin_d6        = Y8_GPIO_NUM;
  config.pin_d7        = Y9_GPIO_NUM;
  config.pin_xclk      = XCLK_GPIO_NUM;
  config.pin_pclk      = PCLK_GPIO_NUM;
  config.pin_vsync     = VSYNC_GPIO_NUM;
  config.pin_href      = HREF_GPIO_NUM;
  config.pin_sscb_sda  = SIOD_GPIO_NUM;
  config.pin_sscb_scl  = SIOC_GPIO_NUM;
  config.pin_pwdn      = PWDN_GPIO_NUM;
  config.pin_reset     = RESET_GPIO_NUM;
  config.xclk_freq_hz  = 20000000;
  config.pixel_format  = PIXFORMAT_YUV422;  // 传感器原生色彩空间，无 RGB565 字节序问题
  config.frame_size    = FRAMESIZE_QVGA;     // 320x240
  config.jpeg_quality  = 10;
  config.fb_count      = 1;   // 单缓冲，减轻 PSRAM 碎片化
  config.fb_location   = CAMERA_FB_IN_PSRAM;
  config.grab_mode     = CAMERA_GRAB_WHEN_EMPTY;

  esp_err_t e = esp_camera_init(&config);
  if (e != ESP_OK) {
    cls();
    txt(0, 5, 2, C_RED, "CAM ERR");
    txt(0, 30, 1, C_WHITE, "Code:");
    num(40, 30, 2, C_WHITE, (int)e);
    delay(3000);
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, 0);
    s->set_contrast(s, 0);
    s->set_saturation(s, 0);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 1);
    s->set_gain_ctrl(s, 1);
    s->set_hmirror(s, 0);
    s->set_vflip(s, 0);
  }
  return true;
}

// ==============================
// 服务器健康检查
// ==============================
bool serverHealth() {
  WiFiClient client;
  HTTPClient http;
  String url = "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT) + "/health";
  http.begin(client, url);
  http.setTimeout(5000);
  int code = http.GET();
  http.end();
  return (code == 200);
}

// ==============================
// TOF200C 初始化
// ==============================
bool tofInit() {
  pinMode(TOF_SHUT, OUTPUT);
  digitalWrite(TOF_SHUT, HIGH);
  delay(10);
  pinMode(TOF_INT, INPUT);

  Wire.begin(TOF_SDA, TOF_SCL);
  Wire.setClock(400000);

  if (!tof.begin()) {
    Serial.println("[TOF] VL53L0X init FAIL");
    return false;
  }
  Serial.println("[TOF] VL53L0X init OK");
  return true;
}

// ==============================
// 读取 TOF 距离 (mm), 超出范围返回 -1
// ==============================
int readTOF() {
  VL53L0X_RangingMeasurementData_t m;
  tof.rangingTest(&m, false);
  if (m.RangeStatus != 4) return m.RangeMilliMeter;
  return -1;
}

// ==============================
// 从服务器拉取触发配置
// ==============================
void fetchTriggerConfig() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClient client;
  HTTPClient http;
  String url = "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT) + "/trigger/config";
  http.begin(client, url);
  http.setTimeout(3000);
  int code = http.GET();
  if (code == 200) {
    String body = http.getString();
    StaticJsonDocument<256> doc;
    if (!deserializeJson(doc, body)) {
      String m  = doc["mode"] | "button";
      int    d1 = doc["distance_min"] | 30;
      int    d2 = doc["distance_max"] | 300;
      int    cd = doc["cooldown_ms"] | 2000;
      int    ti = doc["trigger_interval_ms"] | 10000;

      if (m != triggerMode || d1 != distanceMin || d2 != distanceMax || cd != cooldownMs || ti != triggerIntervalMs) {
        tft.fillRect(0, 140, 128, 20, C_BLACK);
        txt(2, 144, 1, C_YELLOW, "Updating...");
        triggerMode  = m;
        distanceMin  = d1;
        distanceMax  = d2;
        cooldownMs   = cd;
        triggerIntervalMs = ti;
        configChanged = true;
        configMsgMs   = millis();
        delay(400);
        tft.fillRect(0, 140, 128, 20, C_BLACK);
        txt(2, 144, 1, C_GREEN, "Config OK");
        Serial.printf("[CFG] trigger=%s range=%d-%dmm cooldown=%dms interval=%dms\n",
                      triggerMode.c_str(), distanceMin, distanceMax, cooldownMs, triggerIntervalMs);
        drawReady();
      }
    }
  }
  http.end();
}

// ==============================
// 拍照 -> 转 JPEG -> 上传 -> 解析 -> 显示
// OV3660 YUV422 -> fmt2jpg 转 JPEG
// ==============================
bool captureAndClassify() {
  unsigned long t0 = millis();

  cls();
  bar("Capturing...");
  txt(0, 50, 2, C_WHITE, "Photo...");

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) { err("Capture fail"); return false; }

  bar("Converting...");
  tft.fillRect(0, 48, 128, 20, C_BLACK);
  txt(0, 50, 2, C_WHITE, "Convert...");

  uint8_t *jpgBuf = NULL;
  size_t   jpgLen = 0;

  bool ok = fmt2jpg(fb->buf, fb->len, fb->width, fb->height,
                    PIXFORMAT_YUV422, 60, &jpgBuf, &jpgLen);
  esp_camera_fb_return(fb);

  if (!ok || !jpgBuf) {
    if (jpgBuf) free(jpgBuf);
    err("Convert fail");
    return false;
  }

  unsigned long t1 = millis();

  tft.fillRect(0, 48, 128, 20, C_BLACK);
  txt(0, 50, 1, C_GREEN, "Convert OK");
  num(0, 65, 1, C_DARKGREY, (int)jpgLen);
  txt(35, 65, 1, C_DARKGREY, "B");

  bar("Classifying...");

  // 使用 PSRAM 分配上传缓冲区，避免内部 RAM 碎片化
  String boundary = "----ESP32Boundary";
  String head = "--" + boundary + "\r\n";
  head += "Content-Disposition: form-data; name=\"file\"; filename=\"cap.jpg\"\r\n";
  head += "Content-Type: image/jpeg\r\n\r\n";
  String foot = "\r\n--" + boundary + "--\r\n";
  size_t bodySize = head.length() + jpgLen + foot.length();

  uint8_t *bodyBuf = (uint8_t *)heap_caps_malloc(bodySize, MALLOC_CAP_SPIRAM);
  if (!bodyBuf) {
    // PSRAM 不可用，回退到内部 RAM
    bodyBuf = (uint8_t *)malloc(bodySize);
  }
  if (!bodyBuf) { free(jpgBuf); err("No memory"); return false; }
  memcpy(bodyBuf, head.c_str(), head.length());
  memcpy(bodyBuf + head.length(), jpgBuf, jpgLen);
  memcpy(bodyBuf + head.length() + jpgLen, foot.c_str(), foot.length());

  HTTPClient http;
  String hostStr = String(SERVER_HOST) + ":" + String(SERVER_PORT);
  String url = "http://" + hostStr
             + "/classify?source=esp32&ip=" + WiFi.localIP().toString()
             + "&trigger_mode=" + triggerMode;
  http.begin(url);
  http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
  http.setTimeout(HTTP_TIMEOUT_MS);

  int code = http.POST(bodyBuf, bodySize);
  free(bodyBuf);

  if (code != 200) {
    http.end();
    free(jpgBuf);

    cls();
    txt(0, 5, 2, C_RED, "HTTP ERR");
    txt(0, 30, 1, C_WHITE, "Code:");
    num(45, 30, 2, C_WHITE, code);
    txt(0, 55, 1, C_DARKGREY, "Srv:");
    txt(30, 55, 1, C_YELLOW, hostStr.c_str());
    txt(0, 70, 1, C_DARKGREY, "RSSI:");
    num(40, 70, 1, C_YELLOW, WiFi.RSSI());
    txt(0, 95, 1, C_DARKGREY, "Retry in 3s...");
    delay(3000);
    drawReady();
    return false;
  }

  String body = http.getString();
  http.end();

  unsigned long t2 = millis();

  // 解析 — 使用堆分配避免大对象占栈
  DynamicJsonDocument doc(4096);
  if (body.length() == 0 || deserializeJson(doc, body)) { free(jpgBuf); err("JSON error"); return false; }

  String itemEn  = doc["result"]["item_label"] | "?";
  float  conf    = doc["result"]["confidence"] | 0.0f;
  String modelUs = doc["result"]["model_used"] | "?";

  cls();
  int pct = (int)(conf * 100);
  uint16_t cc;
  if (pct >= 80)      cc = C_GREEN;
  else if (pct >= 50) cc = C_YELLOW;
  else                cc = C_RED;

  txt(0, 2, 2, C_CYAN, "RESULT");

  const char* s = itemEn.c_str();
  int l = strlen(s);
  if (l <= 10) {
    txt(0, 28, 2, C_WHITE, s);
  } else {
    String l1 = itemEn.substring(0, 14);
    String l2 = itemEn.substring(14);
    txt(0, 22, 1, C_WHITE, l1.c_str());
    txt(0, 34, 1, C_WHITE, l2.c_str());
  }

  tft.drawFastHLine(0, 55, 128, C_DARKGREY);

  num(0, 60, 3, cc, pct);
  txt(40, 62, 2, cc, "%");

  int barW = map(pct, 0, 100, 0, 118);
  tft.drawRect(0, 95, 120, 10, C_WHITE);
  tft.fillRect(1, 96, barW, 8, cc);

  if (pct >= 80)
    txt(0, 112, 1, C_GREEN, "HIGH confidence");
  else if (pct >= 50)
    txt(0, 112, 1, C_YELLOW, "MED confidence");
  else
    txt(0, 112, 1, C_RED, "LOW confidence");

  int convMs  = (int)(t1 - t0);
  int uploadMs = (int)(t2 - t1);
  int totalMs  = (int)(t2 - t0);

  char buf[24];
  snprintf(buf, sizeof(buf), "Cv %d.%d U %d.%d",
           convMs / 1000, (convMs % 1000) / 100,
           uploadMs / 1000, (uploadMs % 1000) / 100);
  txt(0, 122, 1, C_DARKGREY, buf);

  snprintf(buf, sizeof(buf), "T %d.%ds %s",
           totalMs / 1000, (totalMs % 1000) / 100,
           triggerMode == "button" ? "BTN" : "TOF");
  txt(0, 134, 1, C_DARKGREY, buf);

  txt(0, 148, 1, C_DARKGREY, modelUs.c_str());

  free(jpgBuf);
  return true;
}

// ==============================
// 画面
// ==============================
void drawBoot() {
  cls();
  txt(0, 5, 3, C_GREEN, "ESP32-S3");
  txt(0, 45, 2, C_WHITE, "Garbage");
  txt(0, 64, 2, C_WHITE, "Classifier");
  tft.drawFastHLine(0, 80, 128, C_DARKGREY);
}

void drawReady() {
  cls();
  txt(0, 0, 2, C_WHITE, "Ready");

  if (triggerMode == "distance") {
    txt(0, 20, 1, C_CYAN, "Auto (TOF)");
    txt(0, 34, 1, C_DARKGREY, "Range:");
    num(42, 34, 1, C_WHITE, distanceMin);
    txt(0, 46, 1, C_DARKGREY, "  -");
    num(20, 46, 1, C_WHITE, distanceMax);
    txt(46, 46, 1, C_DARKGREY, "mm");
    txt(0, 58, 1, C_DARKGREY, "Buf:");
    num(26, 58, 1, C_WHITE, cooldownMs);
    txt(54, 58, 1, C_DARKGREY, "ms");
    txt(0, 68, 1, C_DARKGREY, "Int:");
    num(26, 68, 1, C_WHITE, triggerIntervalMs / 1000);
    txt(38, 68, 1, C_DARKGREY, "s");

    int dist = readTOF();
    txt(0, 82, 1, C_DARKGREY, "TOF:");
    if (dist >= 0) {
      num(28, 82, 1, C_GREEN, dist);
      txt(52, 82, 1, C_DARKGREY, "mm");
      if (dist >= distanceMin && dist <= distanceMax) {
        txt(0, 96, 1, C_GREEN, "IN RANGE");
      } else {
        txt(0, 96, 1, C_DARKGREY, "waiting...");
      }
    } else {
      txt(28, 82, 1, C_RED, "---");
      txt(0, 96, 1, C_DARKGREY, "no target");
    }
  } else {
    txt(0, 28, 1, C_WHITE, "Place item in");
    txt(0, 40, 1, C_WHITE, "front of camera");
    txt(0, 62, 2, C_CYAN, "Press BOOT");
    txt(0, 88, 1, C_YELLOW, "to classify");
  }

  // WiFi 状态
  int rssi = WiFi.RSSI();
  tft.setCursor(0, 116);
  tft.setTextSize(1);
  tft.setTextColor(rssi > -60 ? C_GREEN : rssi > -75 ? C_YELLOW : C_RED);
  tft.print("WiFi ");
  tft.print(rssi);
  tft.print("dBm");

  // 触发模式标签
  tft.setCursor(0, 130);
  tft.setTextSize(1);
  tft.setTextColor(C_DARKGREY);
  tft.print(triggerMode == "distance" ? "Trig:Auto" : "Trig:Btn");
}

// ==============================
// init
// ==============================
void setup() {
  pinMode(PIN_BLK, OUTPUT);
  digitalWrite(PIN_BLK, HIGH);

  pinMode(PIN_BOOT, INPUT_PULLUP);  // BOOT 按钮

  tft.initR(INITR_18GREENTAB);
  tft.setRotation(0);
  tft.invertDisplay(false);

  tft.fillScreen(C_RED);    delay(400);
  tft.fillScreen(C_GREEN);  delay(400);
  tft.fillScreen(C_BLUE);   delay(400);
  cls();

  drawBoot();

  bar("WiFi...");
  if (!wifiConnect()) { err("WiFi FAIL"); while(1) delay(1000); }

  drawBoot();
  txt(0, 83, 1, C_GREEN, "WiFi OK");
  txt(0, 93, 1, C_WHITE, WiFi.localIP().toString().c_str());

  bar("Camera...");
  if (!cameraInit()) { err("Cam FAIL"); while(1) delay(1000); }
  txt(0, 105, 1, C_GREEN, "Camera OK");

  bar("TOF...");
  if (tofInit()) txt(0, 118, 1, C_GREEN, "TOF OK");
  else          txt(0, 118, 1, C_YELLOW, "TOF ?");

  bar("Server...");
  if (serverHealth()) txt(0, 130, 1, C_GREEN, "Server OK");
  else                txt(0, 130, 1, C_YELLOW, "Server ?");

  // 拉取触发配置
  fetchTriggerConfig();
  lastConfigFetch = millis();

  delay(1500);
  drawReady();
}

// ==============================
// loop — 按钮触发 / TOF 距离触发
// ==============================
void loop() {
  unsigned long now = millis();

  // WiFi 断线重连
  if (WiFi.status() != WL_CONNECTED) {
    drawBoot();
    txt(0, 83, 1, C_RED, "WiFi lost");
    txt(0, 95, 1, C_WHITE, "Reconnecting...");
    wifiConnect();
    fetchTriggerConfig();
    lastConfigFetch = millis();
    drawReady();
    return;
  }

  // 每 30 秒同步触发配置
  if (now - lastConfigFetch > 30000) {
    fetchTriggerConfig();
    lastConfigFetch = now;
  }

  // 清除配置变更消息
  if (configChanged && now - configMsgMs > 2000) {
    configChanged = false;
    drawReady();
  }

  if (triggerMode == "button") {
    // === 按钮触发 ===
    if (digitalRead(PIN_BOOT) == LOW) {
      delay(50);
      if (digitalRead(PIN_BOOT) == LOW) {
        captureAndClassify();
        while (digitalRead(PIN_BOOT) == LOW) delay(10);

        fetchTriggerConfig();
        lastConfigFetch = millis();

        for (int i = 5; i > 0; i--) {
          tft.fillRect(0, 140, 128, 20, C_BLACK);
          tft.setCursor(50, 144);
          tft.setTextSize(1);
          tft.setTextColor(C_DARKGREY);
          tft.print(i);
          tft.print("s...");
          delay(1000);
        }
        drawReady();
      }
    }
  } else {
    // === 距离触发 ===
    int dist = readTOF();

    // 每 500ms 刷新屏幕 TOF 读数
    if (now - lastTofRefresh >= 500) {
      lastTofRefresh = now;
      tft.fillRect(28, 82, 50, 10, C_BLACK);
      if (dist >= 0) {
        num(28, 82, 1, C_GREEN, dist);
        if (dist >= distanceMin && dist <= distanceMax) {
          tft.fillRect(0, 96, 128, 10, C_BLACK);
          txt(0, 96, 1, C_GREEN, "IN RANGE");
        } else {
          tft.fillRect(0, 96, 128, 10, C_BLACK);
          txt(0, 96, 1, C_DARKGREY, "waiting...");
        }
      } else {
        txt(28, 82, 1, C_RED, "---");
        tft.fillRect(0, 96, 128, 10, C_BLACK);
        txt(0, 96, 1, C_DARKGREY, "no target");
      }
    }

    if (dist >= distanceMin && dist <= distanceMax) {
      if (presenceStart == 0) {
        presenceStart = now;
        tft.fillRect(0, 112, 128, 10, C_BLACK);
        txt(0, 112, 1, C_GREEN, "Item detected");
      }

      // 显示倒计时
      unsigned long elapsed = now - presenceStart;
      if (elapsed < (unsigned long)cooldownMs && now - lastTrigger > (unsigned long)triggerIntervalMs) {
        int secLeft = ((unsigned long)cooldownMs - elapsed) / 1000 + 1;
        tft.fillRect(60, 112, 68, 20, C_BLACK);
        num(80, 112, 1, C_YELLOW, secLeft);
        txt(92, 112, 1, C_YELLOW, "s");
      }

      // 稳定超过缓冲时间 → 触发拍照
      if (elapsed >= (unsigned long)cooldownMs && now - lastTrigger > (unsigned long)triggerIntervalMs) {
        lastTrigger = now;
        presenceStart = 0;

        bar("Auto capture!");
        delay(300);
        captureAndClassify();

        fetchTriggerConfig();
        lastConfigFetch = millis();

        // 等待物体移开（最多 10 秒）
        for (int w = 0; w < 200; w++) {
          int d2 = readTOF();
          if (d2 < distanceMin || d2 > distanceMax) break;
          delay(50);
        }
        delay(500);
        drawReady();
      }
    } else {
      if (presenceStart != 0) {
        tft.fillRect(0, 112, 128, 20, C_BLACK);
      }
      presenceStart = 0;
    }
  }
  delay(30);
}
