/**
 * TOF200C VL53L0X 激光测距模块测试
 *
 * 接线:
 *   VIN  → 3.3V
 *   GND  → GND
 *   SDA  → GPIO 47
 *   SCL  → GPIO 21
 *   INT  → GPIO 48 (输入)
 *   SHUT → GPIO 45 (输出, 拉高使能)
 *
 * 依赖库 (Arduino Library Manager):
 *   - Adafruit VL53L0X
 *   - Adafruit GFX Library
 *   - Adafruit ST7735 and ST7789 Library
 */

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <Adafruit_VL53L0X.h>

// ==============================
// 屏幕引脚
// ==============================
#define PIN_CS   40
#define PIN_DC   39
#define PIN_RST  1
#define PIN_MOSI 38
#define PIN_SCLK 14
#define PIN_BLK  41
Adafruit_ST7735 tft = Adafruit_ST7735(PIN_CS, PIN_DC, PIN_MOSI, PIN_SCLK, PIN_RST);

// ==============================
// TOF200C 引脚
// ==============================
#define TOF_SDA  47
#define TOF_SCL  21
#define TOF_INT  48
#define TOF_SHUT 45

Adafruit_VL53L0X tof = Adafruit_VL53L0X();

#define C_BLACK     ST7735_BLACK
#define C_WHITE     ST7735_WHITE
#define C_RED       ST7735_RED
#define C_GREEN     ST7735_GREEN
#define C_BLUE      ST7735_BLUE
#define C_CYAN      ST7735_CYAN
#define C_YELLOW    ST7735_YELLOW
#define C_DARKGREY  0x7BEF

// ==============================
// 小工具
// ==============================
void cls() { tft.fillScreen(ST7735_BLACK); }

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

// ==============================
// setup
// ==============================
void setup() {
  // --- 屏幕 ---
  pinMode(PIN_BLK, OUTPUT);
  digitalWrite(PIN_BLK, HIGH);
  tft.initR(INITR_18GREENTAB);
  tft.setRotation(0);
  cls();
  txt(0, 0, 2, ST7735_CYAN, "TOF200C Test");

  // --- 串口 ---
  Serial.begin(115200);
  delay(500);
  Serial.println("\n========== TOF200C VL53L0X Test ==========");

  // --- SHUT 拉高使能模块 ---
  pinMode(TOF_SHUT, OUTPUT);
  digitalWrite(TOF_SHUT, HIGH);
  delay(10);
  Serial.println("[PIN] SHUT=HIGH");
  txt(0, 20, 1, ST7735_WHITE, "SHT=HI");

  // --- INT 输入 ---
  pinMode(TOF_INT, INPUT);
  int intVal = digitalRead(TOF_INT);
  Serial.printf("[PIN] INT=%d\n", intVal);
  txt(0, 32, 1, ST7735_WHITE, "INT=");
  num(30, 32, 1, intVal ? ST7735_GREEN : ST7735_RED, intVal);

  // --- I2C 初始化 ---
  Wire.begin(TOF_SDA, TOF_SCL);
  Wire.setClock(400000);
  Serial.println("[I2C] 初始化完成 (SDA=47 SCL=21, 400kHz)");
  txt(0, 44, 1, ST7735_WHITE, "I2C OK");

  // --- I2C 扫描 ---
  Serial.println("[I2C] 扫描总线...");
  int found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      found++;
      Serial.printf("[I2C]  发现设备 0x%02X (%d)\n", addr, addr);
    }
  }

  if (found == 0) {
    Serial.println("[I2C] 未发现任何设备! 检查接线和供电");
    txt(0, 60, 1, ST7735_RED, "No device!");
    txt(0, 72, 1, ST7735_RED, "Check wiring");
    for (;;) delay(1000);
  }
  Serial.printf("[I2C] 共发现 %d 个设备\n", found);
  txt(0, 60, 1, ST7735_GREEN, "Devices:");
  num(55, 60, 1, ST7735_GREEN, found);

  // --- VL53L0X 初始化 ---
  Serial.print("[VL53L0X] 初始化... ");
  txt(0, 78, 1, ST7735_YELLOW, "Init tof...");

  if (tof.begin()) {
    Serial.println("OK");
    txt(55, 78, 1, ST7735_GREEN, "OK");
  } else {
    Serial.println("FAIL - 检查 I2C 地址和供电");
    txt(55, 78, 1, ST7735_RED, "FAIL");
    for (;;) delay(1000);
  }

  Serial.println("[VL53L0X] 开始连续测距\n");
  delay(1500);
  cls();
}

// ==============================
// loop — 连续测距
// ==============================
void loop() {
  VL53L0X_RangingMeasurementData_t measure;
  tof.rangingTest(&measure, false);

  // 清除上一帧
  tft.fillRect(0, 0, 128, 24, ST7735_BLACK);
  txt(0, 0, 2, ST7735_CYAN, "TOF200C");

  // 结果显示区
  tft.fillRect(0, 36, 128, 90, ST7735_BLACK);

  if (measure.RangeStatus != 4) {
    int dist = measure.RangeMilliMeter;
    Serial.printf("[DIST] %d mm  status=%d\n", dist, measure.RangeStatus);

    // 距离大字
    if (dist >= 1000) {
      num(0, 40, 4, ST7735_GREEN, dist);
    } else if (dist >= 100) {
      num(8, 40, 4, ST7735_GREEN, dist);
    } else {
      num(20, 40, 4, ST7735_GREEN, dist);
    }
    txt(70, 48, 2, ST7735_WHITE, "mm");

    // 距离区间说明
    const char* hint;
    uint16_t hc;
    if (dist > 1200)      { hint = ">1.2m";     hc = ST7735_YELLOW; }
    else if (dist > 800)  { hint = "0.8~1.2m";  hc = ST7735_YELLOW; }
    else if (dist > 300)  { hint = "30~80cm";   hc = ST7735_CYAN;   }
    else if (dist > 100)  { hint = "10~30cm";   hc = ST7735_CYAN;   }
    else if (dist > 30)   { hint = "3~10cm";    hc = ST7735_GREEN;  }
    else                  { hint = "<3cm";       hc = ST7735_GREEN;  }
    txt(0, 82, 1, hc, hint);
  } else {
    Serial.println("[DIST] 超出范围 / 无目标");
    txt(0, 40, 3, ST7735_RED, "OUT OF");
    txt(0, 68, 3, ST7735_RED, "RANGE");
  }

  // 状态信息
  tft.fillRect(0, 108, 128, 30, ST7735_BLACK);
  txt(0, 110, 1, C_DARKGREY, "Status:");
  num(42, 110, 1, C_DARKGREY, measure.RangeStatus);

  int intState = digitalRead(TOF_INT);
  txt(68, 110, 1, C_DARKGREY, "INT:");
  num(90, 110, 1, intState ? ST7735_GREEN : ST7735_RED, intState);

  delay(250);
}
