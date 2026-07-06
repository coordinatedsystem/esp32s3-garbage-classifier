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
#include "esp_wifi.h"          // esp_wifi_set_ps, esp_wifi_set_protocol

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
#define HTTP_TIMEOUT_MS  12000
#define FIRMWARE_VERSION "5.3.0"
#define HEARTBEAT_MS     30000
#define CONFIG_FETCH_MS  30000
#define LIVENESS_PROBE_MS  8000   // 后端 TCP 探测间隔
#define LIVENESS_TIMEOUT   3000   // TCP 连接超时

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
String  triggerMode = "distance"; // "button" | "distance"
int     distanceMin = 30;         // mm
int     distanceMax = 300;        // mm
int     cooldownMs  = 2000;       // ms, 物体稳定时间
int     triggerIntervalMs = 10000; // ms, 两次触发最小间隔
unsigned long presenceStart = 0;  // TOF 物体出现计时
unsigned long lastTrigger = 0;    // 上次触发 ms (防重复触发)
unsigned long lastConfigFetch = 0;
unsigned long lastTofRefresh = 0; // 屏幕 TOF 刷新计时
unsigned long lastWifiRefresh = 0; // 屏幕 WiFi RSSI 刷新计时
bool    configChanged = false;    // 配置变更反馈标记
unsigned long configMsgMs = 0;    // 配置消息显示计时
unsigned long postCaptureUntil = 0;     // 结果页保持到期时间
int lastCountdownSec = -1;              // 防重复刷新倒计时
bool waitingDistanceClear = false;      // 自动触发后等待目标移开
unsigned long distanceClearDeadline = 0;
unsigned long lastHeartbeatMs = 0;
DynamicJsonDocument classifyDoc(4096);  // v5.3.1: increased from 2048 — CLIP response with top3 + long English labels easily exceeds 2KB
bool firstBoot = true;
unsigned long lastLivenessProbe = 0;     // 后端 TCP 探测计时
bool serverReachable = false;            // 后端是否可达
unsigned long lastReadyMs = 0;           // 上次进入待机界面的时间（看门狗：超 30s 强制复位）

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
  tft.fillRect(0, 138, 128, 22, C_BLACK);
  tft.setCursor(4, 142);
  tft.setTextSize(1);
  tft.setTextColor(C_YELLOW);
  tft.print(s);
}

void bar_capture(const char* s) {
  tft.fillRect(8, 100, 112, 18, C_BLACK);
  tft.drawRoundRect(8, 100, 112, 18, 5, 0x2965);
  tft.setCursor(12, 103);
  tft.setTextSize(1);
  tft.setTextColor(C_GREEN);
  tft.print(s);
}

void err(const char* s) {
  cls();
  tft.fillRoundRect(8, 40, 112, 80, 10, 0x2965);
  txt(28, 52, 1, C_RED, "ERROR");
  txt(28, 66, 1, C_WHITE, s);
}

// ==============================
// WiFi
// ==============================
bool wifiConnect() {
  cls();
  txt(0, 0, 2, C_CYAN, "WiFi Setup");
  tft.drawFastHLine(0, 18, 128, C_DARKGREY);

  // 断开并重新初始化 WiFi，清除残留状态
  WiFi.disconnect(true, true);
  delay(200);
  WiFi.mode(WIFI_OFF);
  delay(100);
  WiFi.mode(WIFI_STA);

  // 禁用省电模式，保持 WiFi 持续活跃
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);

  int infoY;

  if (firstBoot) {
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

    infoY = 34 + show * 10 + 4;
    txt(0, infoY, 1, C_WHITE, "Target:");
    txt(42, infoY, 1, found ? C_GREEN : C_RED, found ? "FOUND" : "NOT FOUND");
    txt(0, infoY + 10, 1, C_WHITE, "SSID:");
    txt(36, infoY + 10, 1, C_CYAN, WIFI_SSID);
    infoY = infoY + 22;
  } else {
    infoY = 22;
  }

  bar("Connecting...");
  txt(0, infoY + 22, 1, C_YELLOW, "Connecting...");

  // 增加连接超时到 30s (60 * 500ms)，应对路由器干扰
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
  num(48, infoY + 22, 1, (st == WL_CONNECTED) ? C_GREEN : C_RED, st);

  if (st == WL_CONNECTED) {
    // 显示信号强度和 IP
    int rssi = WiFi.RSSI();
    txt(0, infoY + 34, 1, C_GREEN, "CONNECTED");
    txt(0, infoY + 46, 1, C_WHITE, "IP:");
    txt(18, infoY + 46, 1, C_GREEN, WiFi.localIP().toString().c_str());
    txt(0, infoY + 58, 1, C_WHITE, "RSSI:");
    num(36, infoY + 58, 1, rssi > -75 ? C_GREEN : C_YELLOW, rssi);
    txt(60, infoY + 58, 1, C_DARKGREY, "dBm");
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
  config.jpeg_quality  = 0;    // 0=best
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
  client.setTimeout(LIVENESS_TIMEOUT);
  if (!client.connect(SERVER_HOST, SERVER_PORT)) {
    Serial.println("[SRV] TCP connect FAIL");
    return false;
  }
  // 直接 TCP connect 成功即服务可达，不需发 HTTP 请求
  client.stop();
  return true;
}

// ==============================
// TCP 存活性检测 —— 空闲时每 8s 探测后端是否可达
// 解决 WiFi 已连接但后端实际不可达的场景
// ==============================
bool probeServerLiveness() {
  WiFiClient client;
  client.setTimeout(LIVENESS_TIMEOUT);
  if (!client.connect(SERVER_HOST, SERVER_PORT)) {
    serverReachable = false;
    Serial.println("[LIVENESS] server unreachable");
    return false;
  }
  client.stop();
  serverReachable = true;
  return true;
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
  if (m.RangeStatus == 0) return m.RangeMilliMeter;
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
  http.setTimeout(8000);
  // 配置同步用短连接: 请求少，复用连接意义不大
  http.addHeader("Connection", "close");
  int code = http.GET();
  if (code == 200) {
    serverReachable = true;
    String body = http.getString();
    StaticJsonDocument<256> doc;
    if (!deserializeJson(doc, body)) {
      String m  = doc["mode"] | "distance";
      if (m != "distance") {
        Serial.printf("[CFG] invalid mode '%s', defaulting to distance\n", m.c_str());
        m = "distance";
      }
      int    d1 = doc["distance_min"] | 30;
      int    d2 = doc["distance_max"] | 300;
      int    cd = doc["cooldown_ms"] | 2000;
      int    ti = doc["trigger_interval_ms"] | 10000;

      if (m != triggerMode || d1 != distanceMin || d2 != distanceMax || cd != cooldownMs || ti != triggerIntervalMs) {
        // Bottom bar message
        tft.fillRect(0, 138, 128, 22, C_BLACK);
        txt(4, 142, 1, C_YELLOW, "Updating");
        bool modeChanged = (m != triggerMode);
        triggerMode  = m;
        distanceMin  = d1;
        distanceMax  = d2;
        cooldownMs   = cd;
        triggerIntervalMs = ti;
        if (modeChanged) {
          presenceStart = 0;
          waitingDistanceClear = false;
        }
        configChanged = true;
        configMsgMs   = millis();
        tft.fillRect(0, 138, 128, 22, C_BLACK);
        txt(4, 142, 1, C_GREEN, "OK");
        Serial.printf("[CFG] trigger=%s range=%d-%dmm cooldown=%dms interval=%dms\n",
                      triggerMode.c_str(), distanceMin, distanceMax, cooldownMs, triggerIntervalMs);
        drawReadyConfig();
      }
    }
  }
  http.end();
  client.stop();
}

void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClient client;
  HTTPClient http;
  String url = "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT)
             + "/hardware/heartbeat?device_id=ESP32-S3"
             + "&firmware_version=" + String(FIRMWARE_VERSION)
             + "&ip_address=" + WiFi.localIP().toString();
  http.begin(client, url);
  http.setTimeout(8000);
  // Keep-Alive: 心跳复用连接，减轻 ESP32 和服务器 TCP 开销
  http.addHeader("Connection", "keep-alive");
  int code = http.GET();
  if (code == 200) {
    serverReachable = true;
  } else {
    Serial.printf("[HB] failed code=%d\n", code);
  }
  http.end();
  client.stop();
}

bool postMultipartJpeg(const String& path, const uint8_t* jpgBuf, size_t jpgLen, int& statusCode, String& responseBody) {
  const String boundary = "----ESP32Boundary";
  const String head = "--" + boundary + "\r\n"
                      "Content-Disposition: form-data; name=\"file\"; filename=\"cap.jpg\"\r\n"
                      "Content-Type: image/jpeg\r\n\r\n";
  const String foot = "\r\n--" + boundary + "--\r\n";

  // 最多重试 3 次（每次包含连接+发送+读取完整周期）
  // 总超时看门狗：所有重试合计超过 30s 则放弃
  unsigned long retryDeadline = millis() + 30000;
  for (int attempt = 0; attempt < 3; attempt++) {
    if (millis() > retryDeadline) break;  // 总超时看门狗
    if (attempt > 0) {
      delay(500);  // 重试间隔
      Serial.printf("[HTTP] retry %d/3\n", attempt + 1);
    }

    WiFiClient client;
    client.setTimeout(3000);  // socket 单次操作超时 (LAN短)
    // (不调用 client.stop() — 新创建的 client 无连接要清理)

    if (!client.connect(SERVER_HOST, SERVER_PORT)) {
      Serial.printf("[HTTP] connect failed\n");
      continue;
    }

    // 合并请求头
    String req = "POST " + path + " HTTP/1.1\r\n";
    req += "Host: " + String(SERVER_HOST) + ":" + String(SERVER_PORT) + "\r\n";
    req += "Content-Type: multipart/form-data; boundary=" + boundary + "\r\n";
    req += "Content-Length: " + String(head.length() + jpgLen + foot.length()) + "\r\n";
    req += "Connection: close\r\n\r\n";
    req += head;
    client.print(req);

    // 分块写入 JPEG 体
    size_t sent = 0;
    bool writeFail = false;
    while (sent < jpgLen) {
      size_t chunk = (jpgLen - sent > 4096) ? 4096 : (jpgLen - sent);
      size_t written = client.write(jpgBuf + sent, chunk);
      if (written == 0) { writeFail = true; break; }
      sent += written;
      yield();
    }
    if (writeFail) { continue; }

    client.print(foot);
    client.flush();

    // ── 等待响应（超时 → 下一轮重试） ──
    unsigned long respWaitStart = millis();
    while (!client.available() && client.connected()) {
      if (millis() - respWaitStart > HTTP_TIMEOUT_MS) break;
      delay(1);
    }
    if (!client.available() && !client.connected()) { continue; }

    // 解析 HTTP 状态行
    String statusLine = client.readStringUntil('\n');
    int sp1 = statusLine.indexOf(' ');
    int sp2 = statusLine.indexOf(' ', sp1 + 1);
    statusCode = (sp1 >= 0 && sp2 > sp1) ? statusLine.substring(sp1 + 1, sp2).toInt() : -4;

    // 跳过响应头
    int contentLength = -1;
    while (client.connected()) {
      String line = client.readStringUntil('\n');
      if (line == "\r" || line.length() <= 1) break;
      String lower = line;
      lower.toLowerCase();
      if (lower.startsWith("content-length:")) {
        int colon = line.indexOf(':');
        if (colon >= 0) contentLength = line.substring(colon + 1).toInt();
      }
    }

    // ── 读响应体（超时 → 下一轮重试） ──
    responseBody = "";
    responseBody.reserve(4096);
    bool bodyTimeout = false;
    if (contentLength >= 0) {
      int remaining = contentLength;
      while (remaining > 0 && client.connected() && !bodyTimeout) {
        unsigned long readStart = millis();
        while (!client.available() && client.connected()) {
          if (millis() - readStart > HTTP_TIMEOUT_MS) { bodyTimeout = true; break; }
          delay(1);
        }
        if (bodyTimeout) break;
        char buf[256];
        int toRead = remaining > (int)sizeof(buf) ? (int)sizeof(buf) : remaining;
        int n = client.readBytes(buf, toRead);
        if (n <= 0) break;
        responseBody.concat(buf, n);
        if (responseBody.length() > 4096) break;
        remaining -= n;
      }
      if (bodyTimeout) { continue; }
    } else {
      unsigned long readEnd = millis() + HTTP_TIMEOUT_MS;
      while (client.connected() || client.available()) {
        while (client.available()) {
          if (responseBody.length() > 4096) break;
          responseBody += (char)client.read();
        }
        if (millis() > readEnd) break;
        delay(1);
      }
    }

    if (statusCode == 200) return true;
    // HTTP 4xx/5xx → 不重试，直接返回
    if (statusCode >= 400) return false;
  }
  // 全部重试失败
  statusCode = -1;
  return false;
}

// ==============================
// 拍照 -> 转 JPEG -> 上传 -> 解析 -> 显示
// OV3660 YUV422 -> fmt2jpg 转 JPEG
// ==============================
bool captureAndClassify() {
  unsigned long t0 = millis();

  cls();
  // Cleaner capture screen
  // Draw a centered "capturing" card
  tft.drawRoundRect(16, 40, 96, 80, 10, 0x2965);
  txt(24, 55, 1, C_DARKGREY, "Scanning...");
  txt(28, 72, 2, C_WHITE, "Photo");

  // 丢弃传感器缓冲区的旧帧，确保每次拍照都是最新的画面
  camera_fb_t *stale = esp_camera_fb_get();
  if (stale) esp_camera_fb_return(stale);
  delay(50);  // 给传感器一点时间开始新一帧曝光

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) { err("Capture fail"); return false; }

  tft.fillRoundRect(16, 40, 96, 80, 10, 0x2965);
  txt(24, 55, 1, C_DARKGREY, "Processing...");
  txt(28, 72, 2, C_WHITE, "Convert");

  uint8_t *jpgBuf = NULL;
  size_t   jpgLen = 0;

  bool ok = fmt2jpg(fb->buf, fb->len, fb->width, fb->height,
                    PIXFORMAT_YUV422, 92, &jpgBuf, &jpgLen);
  esp_camera_fb_return(fb);

  if (!ok || !jpgBuf) {
    if (jpgBuf) free(jpgBuf);
    err("Convert fail");
    return false;
  }

  unsigned long t1 = millis();

  // Show uploading indicator
  tft.fillRoundRect(16, 40, 96, 80, 10, 0x2965);
  txt(24, 55, 1, C_GREEN, "Convert OK");
  txt(28, 72, 1, C_DARKGREY, "Uploading...");

  // Progress dot animation
  for (int i = 0; i < 3; i++) {
    tft.fillCircle(55 + i * 12, 98, 3, C_GREEN);
  }

  bar_capture("Classifying...");

  String hostStr = String(SERVER_HOST) + ":" + String(SERVER_PORT);
  char pathBuf[256];
  snprintf(pathBuf, sizeof(pathBuf), "/classify?source=esp32&ip=%s&trigger_mode=%s",
           WiFi.localIP().toString().c_str(), triggerMode.c_str());
  String path = String(pathBuf);
  int code = 0;
  String body;
  bool posted = postMultipartJpeg(path, jpgBuf, jpgLen, code, body);

  if (!posted || code != 200) {
    free(jpgBuf);

    cls();
    tft.fillRoundRect(8, 30, 112, 100, 10, 0x2965);
    txt(28, 42, 2, C_RED, "HTTP ERR");
    tft.drawFastHLine(20, 64, 88, 0x2965);
    txt(16, 70, 1, C_WHITE, "Code: ");
    num(56, 70, 1, C_RED, code);
    txt(16, 82, 1, C_DARKGREY, "Srv:");
    txt(46, 82, 1, C_YELLOW, hostStr.c_str());
    txt(16, 94, 1, C_DARKGREY, "RSSI:");
    num(56, 94, 1, C_YELLOW, WiFi.RSSI());
    txt(16, 106, 1, 0x7BEF, "Retry later");
    return false;
  }
  // 通信成功
  unsigned long t2 = millis();
  serverReachable = true;

  // 计算各阶段耗时（此前 totalMs/convMs/netMs 未被计算，是未定义变量，导致显示乱码等问题）
  unsigned long totalMs = t2 - t0;
  unsigned long convMs = t1 - t0;
  unsigned long netMs = t2 - t1;

  // 解析 — 使用堆分配避免大对象占栈
  int jsonStart = body.indexOf('{');
  int jsonEnd = body.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    body = body.substring(jsonStart, jsonEnd + 1);
  }

  classifyDoc.clear();
  DeserializationError jerr = deserializeJson(classifyDoc, body);
  if (body.length() == 0 || jerr) {
    Serial.printf("[JSON] parse failed: %s, code=%d, len=%d\n", jerr.c_str(), code, body.length());
    if (body.length() > 0) {
      String preview = body.substring(0, body.length() > 80 ? 80 : body.length());
      preview.replace('\n', ' ');
      preview.replace('\r', ' ');
      Serial.printf("[JSON] preview: %s\n", preview.c_str());
    }
    free(jpgBuf);
    // Show more info on screen: error type + response length
    cls();
    tft.fillRoundRect(8, 30, 112, 100, 10, 0x2965);
    txt(28, 42, 2, C_RED, "JSON ERR");
    tft.drawFastHLine(20, 64, 88, 0x2965);
    {
      char tmp[20];
      snprintf(tmp, sizeof(tmp), "%s", jerr.c_str());
      txt(12, 72, 1, C_WHITE, tmp);
    }
    {
      char tmp[20];
      snprintf(tmp, sizeof(tmp), "body: %d", body.length());
      txt(12, 84, 1, C_DARKGREY, tmp);
    }
    txt(12, 98, 1, 0x7BEF, "see Serial");
    return false;
  }

  float  conf    = classifyDoc["result"]["confidence"] | 0.0f;
  String modelUs = classifyDoc["result"]["model_used"] | "?";
  int    inferMs = classifyDoc["inference_time_ms"] | 0;
  String catEn   = classifyDoc["result"]["waste_category"] | "other";

  cls();

  // Status bar at top
  int rssi = WiFi.RSSI();
  drawSignalBars(2, 1, rssi);
  char rssiBuf[16];
  snprintf(rssiBuf, sizeof(rssiBuf), "%ddBm", rssi);
  tft.setCursor(24, 1);
  tft.setTextSize(1);
  tft.setTextColor(C_DARKGREY);
  tft.print(rssiBuf);
  txt(98, 1, 1, C_DARKGREY, "SORT");

  tft.drawFastHLine(0, 11, 128, 0x2965);

  int pct = (int)(conf * 100);

  // Map category to display label, color, and icon-ish representation
  const char* catLabel;
  uint16_t darkBg;
  if (catEn == "kitchen") {
    catLabel = "KITCHEN";
    darkBg = 0x04D0;
  } else if (catEn == "recyclable") {
    catLabel = "RECYCLE";
    darkBg = 0x2060;
  } else if (catEn == "hazardous") {
    catLabel = "HAZARD";
    darkBg = 0x7800;
  } else {
    catLabel = "OTHER";
    darkBg = 0x3984;
  }

  // Category card — large, centered
  tft.fillRoundRect(4, 18, 120, 92, 10, darkBg);
  tft.drawRoundRect(4, 18, 120, 92, 10, C_WHITE);

  // Category label in large font
  int clen = strlen(catLabel);
  int cw = clen * 18;  // textSize 3 = ~18px per char
  int cx = (128 - cw) / 2;
  if (cx < 4) cx = 4;
  txt(cx, 30, 3, C_WHITE, catLabel);

  // Confidence percentage below
  char pctBuf[8];
  snprintf(pctBuf, sizeof(pctBuf), "%d%%", pct);
  int pctX = (128 - strlen(pctBuf) * 24) / 2;  // textSize 2 = ~12px per char
  tft.setCursor(pctX, 66);
  tft.setTextSize(2);
  tft.setTextColor(C_WHITE);
  tft.print(pctBuf);

  // Thin confidence bar
  tft.drawRoundRect(20, 90, 88, 8, 4, C_WHITE);
  int barW = map(pct, 0, 100, 0, 80);
  if (barW > 0) {
    tft.fillRoundRect(24, 93, barW, 3, 2, C_WHITE);
  }

  // Timing line
  tft.drawFastHLine(0, 120, 128, 0x2965);

  char buf[30];
  snprintf(buf, sizeof(buf), "T %d.%ds  I %dms",
           totalMs / 1000, (totalMs % 1000) / 100, inferMs);
  txt(4, 124, 1, C_DARKGREY, buf);

  snprintf(buf, sizeof(buf), "C %d.%d  N %d.%d",
           convMs / 1000, (convMs % 1000) / 100,
           netMs / 1000, (netMs % 1000) / 100);
  txt(4, 134, 1, C_DARKGREY, buf);

  // Model name
  txt(4, 148, 1, 0x7BEF, modelUs.c_str());

  free(jpgBuf);
  return true;
}

// ==============================
// Apple Watch 风格显示
// ==============================

void drawBoot() {
  cls();
  // Minimal boot: small text, thin line, subtle
  tft.fillScreen(C_BLACK);
  txt(18, 30, 2, C_WHITE, "ESP32-S3");
  txt(44, 55, 1, C_DARKGREY, "Garbage");
  txt(44, 65, 1, C_DARKGREY, "Classifier");
  tft.drawFastHLine(20, 82, 88, C_DARKGREY);
  txt(48, 88, 1, C_DARKGREY, "v5.3.0");
}

void drawSignalBars(int x, int y, int rssi) {
  int level = (rssi > -50) ? 4 : (rssi > -65) ? 3 : (rssi > -80) ? 2 : 1;
  uint16_t color = (level >= 3) ? C_GREEN : (level >= 2) ? C_YELLOW : C_RED;
  for (int i = 0; i < 4; i++) {
    int bx = x + i * 5;
    int bh = 3 + i * 2;
    tft.fillRect(bx, y + 7 - bh, 3, bh, i < level ? color : 0x39E7);
  }
}

// ---- Ready Screen: 大数字距离显示 + 状态概览 ----
// Layout (128x160):
//   y0..11   ▄▄▄▄ -45dBm           Ready
//   y12      ─────────────────────
//   y18..94  ┌─ TOF Card ─────────┐
//            │     127             │  font 5 centered
//            │     mm              │  unit
//            │   ┌──────────┐     │
//            │   │ IN RANGE │     │  pill
//            │   └──────────┘     │
//            │ Range: 30-300mm    │
//            │ ───── ──────       │
//            └────────────────────┘
//   y100..118 Config: cooldown, interval
//   y120     ─────────────────────
//   y124..138 Stats line: Auto · WiFi · Server
//   y142..156 Status dots

void drawReadyTOF() {
  // Update just the TOF reading + status pill (inside the card).
  // Does NOT draw the card outline — caller (drawReadyAll) draws it once.
  int dist = readTOF();
  // Clear the inner area of the TOF card (y=34..95)
  tft.fillRoundRect(8, 34, 112, 65, 6, C_BLACK);

  if (dist >= 0) {
    // Big distance number
    char buf[8];
    snprintf(buf, sizeof(buf), "%d", dist);
    int nx = (128 - strlen(buf) * 30) / 2;  // font 5 = 30px wide
    if (nx < 4) nx = 4;
    tft.setCursor(nx, 40);
    tft.setTextSize(5);
    tft.setTextColor(C_WHITE);
    tft.print(buf);

    // mm unit
    txt(56, 80, 1, C_DARKGREY, "mm");

    // Status pill
    bool inRange = (dist >= distanceMin && dist <= distanceMax);
    uint16_t bg = inRange ? 0x04D0 : 0x3984;  // green-tinted or grey
    uint16_t fg = inRange ? C_GREEN : C_DARKGREY;
    const char* status = inRange ? "IN RANGE" : "waiting";
    int pillW = strlen(status) * 6 + 16;
    int pillX = (128 - pillW) / 2;
    tft.fillRoundRect(pillX, 56, pillW, 14, 7, bg);
    tft.setCursor(pillX + 8, 58);
    tft.setTextSize(1);
    tft.setTextColor(fg);
    tft.print(status);
  } else {
    txt(36, 42, 4, C_DARKGREY, "--");
    txt(52, 76, 1, C_DARKGREY, "mm");
    tft.fillRoundRect(36, 54, 56, 14, 7, 0x3984);
    txt(44, 56, 1, C_DARKGREY, "no tgt");
  }
}

int lastDrawnRssi = -128;  // RSSI cache for skip-redraw optimization in drawReadyWiFi

void drawReadyWiFi() {
  // Update WiFi status bar (y=0..10) — skip if RSSI hasn't changed materially
  int rssi = WiFi.RSSI();
  if (abs(rssi - lastDrawnRssi) < 10) return;
  lastDrawnRssi = rssi;
  tft.fillRect(0, 0, 128, 11, C_BLACK);

  // Signal bars
  drawSignalBars(2, 1, rssi);

  // RSSI text
  char buf[16];
  snprintf(buf, sizeof(buf), "%ddBm", rssi);
  uint16_t rssiColor = (rssi > -60) ? C_GREEN : (rssi > -75) ? C_YELLOW : C_RED;
  tft.setCursor(24, 1);
  tft.setTextSize(1);
  tft.setTextColor(rssiColor);
  tft.print(buf);

  // Right side: "Ready" dot
  tft.fillCircle(110, 5, 3, C_GREEN);
  txt(116, 1, 1, C_DARKGREY, "OK");
}

void drawReadyConfig() {
  // Config info at bottom of card (y=72..95)
  tft.fillRect(2, 72, 124, 28, C_BLACK);
  tft.setTextSize(1);
  tft.setTextColor(C_DARKGREY);
  tft.setCursor(10, 74);
  tft.print("Range: ");
  tft.setTextColor(C_WHITE);
  tft.print(distanceMin);
  tft.print("-");
  tft.print(distanceMax);
  tft.setTextColor(C_DARKGREY);
  tft.println("mm");

  tft.setCursor(10, 84);
  tft.setTextColor(C_DARKGREY);
  tft.print("Buf: ");
  tft.setTextColor(C_WHITE);
  tft.print(cooldownMs);
  tft.setTextColor(C_DARKGREY);
  tft.print("ms");
  tft.setCursor(66, 84);
  tft.print("Int: ");
  tft.setTextColor(C_WHITE);
  tft.print(triggerIntervalMs / 1000);
  tft.setTextColor(C_DARKGREY);
  tft.print("s");
}

void drawReadyAll() {
  // Full ready screen draw: delegate reusable sections to incremental helpers
  cls();

  drawReadyWiFi();

  // === y12: Hairline ===
  tft.drawFastHLine(0, 11, 128, 0x2965);

  // === y18-95: TOF Card (only outline — inner content drawn by drawReadyTOF) ===
  tft.drawRoundRect(8, 18, 112, 82, 8, 0x2965);
  drawReadyTOF();
  drawReadyConfig();

  // === y122-138: Bottom status lines ===
  tft.drawFastHLine(0, 120, 128, 0x2965);

  // Trigger mode
  tft.fillCircle(10, 128, 3, C_CYAN);
  txt(16, 124, 1, C_CYAN, "Auto");
  txt(48, 124, 1, C_DARKGREY, "TOF");

  // Server status
  tft.fillCircle(90, 128, 3, serverReachable ? C_GREEN : 0x7BEF);
  txt(96, 124, 1, serverReachable ? C_GREEN : C_DARKGREY, serverReachable ? "Srv OK" : "Srv ?");

  // Firmware version at bottom
  tft.setTextSize(1);
  tft.setTextColor(0x7BEF);
  tft.setCursor(10, 150);
  tft.print("Ready");
  tft.setCursor(84, 150);
  tft.print("v5.3.0");
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

  // Power-on animation: subtle fade-in
  tft.fillScreen(C_BLACK);
  delay(200);

  drawBoot();

  // Init steps with clean cards
  tft.fillRoundRect(8, 106, 112, 28, 6, 0x2965);
  txt(14, 112, 1, C_YELLOW, "WiFi...");
  if (!wifiConnect()) { err("WiFi FAIL"); while(1) delay(1000); }

  drawBoot();
  tft.fillRoundRect(8, 70, 112, 70, 6, 0x2965);
  txt(14, 76, 1, C_GREEN, "WiFi OK");
  txt(14, 90, 1, C_WHITE, WiFi.localIP().toString().c_str());

  txt(14, 108, 1, C_YELLOW, "Camera...");
  if (!cameraInit()) { err("Cam FAIL"); while(1) delay(1000); }
  txt(14, 108, 1, C_GREEN, "Camera OK");

  txt(14, 120, 1, tofInit() ? C_GREEN : C_YELLOW, "TOF");
  if (!tofInit()) txt(48, 120, 1, C_YELLOW, "?");

  txt(14, 132, 1, serverHealth() ? C_GREEN : C_YELLOW, "Server");
  if (!serverHealth()) txt(66, 132, 1, C_YELLOW, "?");

  // 拉取触发配置（错开心跳和配置拉取的首次触发时间）
  sendHeartbeat();
  lastHeartbeatMs = millis();
  fetchTriggerConfig();
  lastConfigFetch = millis() + 15000;  // 将 30s 定时器错开 15s

  delay(1500);
  firstBoot = false;
  drawReadyAll();
  lastReadyMs = millis();
}

// ==============================
// loop — 按钮触发 / TOF 距离触发
// 屏幕安全看门狗：30 秒无待机刷新 → 强制复位所有状态
// ==============================
void loop() {
  unsigned long now = millis();
  // 屏幕看门狗判定：卡在结果页面超过 30s 则强制复位
  // (postCaptureUntil > 0 表示 captureAndClassify 执行后尚未回落)
  if (postCaptureUntil > 0 && !firstBoot && now - lastReadyMs > 30000) {
    presenceStart = 0;
    waitingDistanceClear = false;
    postCaptureUntil = 0;
    lastCountdownSec = -1;
    configChanged = false;
    drawReadyAll();
    lastReadyMs = millis();
  }

  // === 后端 TCP 存活性检测 ===
  // 即使 WiFi 已连接，后端也可能不可达
  // 每 8 秒 TCP connect 探测，失败则标记服务不可达
  if (now - lastLivenessProbe > LIVENESS_PROBE_MS) {
    lastLivenessProbe = now;
    probeServerLiveness();
  }

  // 每 30 秒发送心跳并同步触发配置
  if (now - lastHeartbeatMs > HEARTBEAT_MS) {
    sendHeartbeat();
    lastHeartbeatMs = now;
  }
  if (now - lastConfigFetch > CONFIG_FETCH_MS) {
    fetchTriggerConfig();
    lastConfigFetch = now;
  }

  // 清除配置变更消息
  if (configChanged && now - configMsgMs > 2000) {
    configChanged = false;
    drawReadyConfig();
  }

  // === 采集后等待期 ===
  // captureAndClassify() 执行完后会显示结果页，停留 n 秒后自动退出
  if (postCaptureUntil > 0) {
    if (now < postCaptureUntil) {
      // postCaptureUntil 未到期 → 显示倒计时（仅在结果页覆盖 bar 区域）
      int secLeft = (int)((postCaptureUntil - now + 999) / 1000);
      if (secLeft != lastCountdownSec) {
        lastCountdownSec = secLeft;
        tft.fillRect(0, 138, 128, 22, C_BLACK);
        tft.drawRoundRect(38, 140, 52, 18, 5, 0x2965);
        tft.setCursor(50, 143);
        tft.setTextSize(1);
        tft.setTextColor(C_DARKGREY);
        tft.print(secLeft);
        tft.print("s");
      }
      delay(10);
      return;
    }
    // postCaptureUntil 到期 → 回落待机（但仍等待物体移开，防止重复触发）
    postCaptureUntil = 0;
    lastCountdownSec = -1;
    drawReadyAll();
    lastReadyMs = millis();
  }

  if (triggerMode == "distance") {
    // === 距离触发 ===
    int dist = readTOF();

    // 每 500ms 刷新屏幕 TOF 读数
    if (now - lastTofRefresh >= 500) {
      lastTofRefresh = now;
      drawReadyTOF();
    }

    // 每 5s 刷新 WiFi RSSI
    if (now - lastWifiRefresh >= 5000) {
      lastWifiRefresh = now;
      drawReadyWiFi();
    }

    // 等待物体移开（触发后保护期）
    if (waitingDistanceClear) {
      if (dist < distanceMin || dist > distanceMax || now > distanceClearDeadline) {
        waitingDistanceClear = false;
        drawReadyAll();
        lastReadyMs = millis();
      }
      delay(10);
      return;
    }

    // 物体进入触发范围
    if (dist >= distanceMin && dist <= distanceMax) {
      if (presenceStart == 0) {
        presenceStart = now;
        tft.fillRect(0, 100, 128, 20, C_BLACK);
        tft.fillCircle(10, 108, 3, C_GREEN);
        txt(16, 104, 1, C_GREEN, "Detected");
      }

      // 显示触发前倒计时（cooldown）
      unsigned long elapsed = now - presenceStart;
      if (elapsed < (unsigned long)cooldownMs && now - lastTrigger > (unsigned long)triggerIntervalMs) {
        int secLeft = ((unsigned long)cooldownMs - elapsed) / 1000 + 1;
        tft.fillRect(80, 100, 48, 20, C_BLACK);
        char cd[8];
        snprintf(cd, sizeof(cd), "%ds", secLeft);
        tft.setCursor(82, 105);
        tft.setTextSize(1);
        tft.setTextColor(C_YELLOW);
        tft.print(cd);
      }

      // 稳定超过缓冲时间 → 触发拍照（但跳过如果在触发间隔内）
      if (elapsed >= (unsigned long)cooldownMs && now - lastTrigger > (unsigned long)triggerIntervalMs) {
        lastTrigger = now;
        presenceStart = 0;

        cls();
        tft.drawRoundRect(24, 60, 80, 40, 10, C_CYAN);
        txt(30, 72, 1, C_CYAN, "Auto Capture");
        delay(800);

        // 执行拍照分类（内部可能显示 error 或 result 页）
        captureAndClassify();

        // 无论 captureAndClassify 成功与否，都进入等待期
        // 成功 → 显示 result 页 + 倒计时；失败 → 显示 error 页 + 倒计时
        // 两者都通过看门狗（30s）或定时回落回到待机
        postCaptureUntil = millis() + 5000;
        lastCountdownSec = -1;
        waitingDistanceClear = true;
        distanceClearDeadline = now + 10000;

        fetchTriggerConfig();
        lastHeartbeatMs = now;
        lastConfigFetch = millis();
      }
    } else {
      // 物体不在触发范围
      if (presenceStart != 0) {
        tft.fillRect(0, 100, 128, 20, C_BLACK);
      }
      presenceStart = 0;
    }
  }
  delay(30);
}
