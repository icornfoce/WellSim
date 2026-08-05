#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <driver/i2s.h>
#include <ArduinoJson.h>

// ─── การตั้งค่า Wi-Fi และเซิร์ฟเวอร์ ──────────────────────────────────────
const char* ssid = "Micky";          
const char* password = "021657065"; 
const char* serverUrl = "https://wellsim-backend.onrender.com/api/device/audio"; 
const char* cmdUrl = "https://wellsim-backend.onrender.com/api/device/command?device_id=ESP32-INMP441-A";

const char* deviceApiKey = "4d1f990daf89c6db03665be522925344b002c36374cb1229ea3a5dbedb095fd6"; 

// ─── การตั้งค่า I2S Microphone (INMP441) ──────────────────────────────────
#define I2S_WS 25
#define I2S_SD 22
#define I2S_SCK 26
#define I2S_PORT I2S_NUM_0

const int SAMPLE_RATE = 16000;     
const float RECORD_TIME_SECONDS = 5.0; // 🚀 เวลาอัดเสียง (วินาที)

struct WAVHeader {
  char chunkID[4] = {'R', 'I', 'F', 'F'};
  uint32_t chunkSize;
  char format[4] = {'W', 'A', 'V', 'E'};
  char subchunk1ID[4] = {'f', 'm', 't', ' '};
  uint32_t subchunk1Size = 16;
  uint16_t audioFormat = 1; 
  uint16_t numChannels = 1; 
  uint32_t sampleRate = SAMPLE_RATE;
  uint32_t byteRate = SAMPLE_RATE * 1 * 2;
  uint16_t blockAlign = 1 * 2;
  uint16_t bitsPerSample = 16;
  char subchunk2ID[4] = {'d', 'a', 't', 'a'};
  uint32_t subchunk2Size;
};

// ⚡ Class ช่วยแปลงข้อมูลดิบเป็น Base64 และ Stream ลง Socket โดยใช้ RAM เพียง 512 bytes
class Base64Streamer {
private:
  WiFiClientSecure& client;
  uint8_t inBuf[3];
  uint8_t inCount = 0;
  uint8_t outBuf[512];
  size_t outIdx = 0;

  void encode3() {
    static const char b64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    uint32_t b = (inBuf[0] << 16) | (inBuf[1] << 8) | inBuf[2];
    outBuf[outIdx++] = b64[(b >> 18) & 0x3F];
    outBuf[outIdx++] = b64[(b >> 12) & 0x3F];
    outBuf[outIdx++] = b64[(b >> 6) & 0x3F];
    outBuf[outIdx++] = b64[b & 0x3F];
    inCount = 0;

    if (outIdx >= sizeof(outBuf) - 4) {
      flushNetwork();
    }
  }

  void flushNetwork() {
    if (outIdx > 0) {
      client.write(outBuf, outIdx);
      outIdx = 0;
    }
  }

public:
  Base64Streamer(WiFiClientSecure& c) : client(c) {}

  void writeByte(uint8_t b) {
    inBuf[inCount++] = b;
    if (inCount == 3) {
      encode3();
    }
  }

  void writeBytes(const uint8_t* data, size_t len) {
    for (size_t i = 0; i < len; i++) {
      writeByte(data[i]);
    }
  }

  void finish() {
    static const char b64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    if (inCount == 1) {
      uint32_t b = (inBuf[0] << 16);
      outBuf[outIdx++] = b64[(b >> 18) & 0x3F];
      outBuf[outIdx++] = b64[(b >> 12) & 0x3F];
      outBuf[outIdx++] = '=';
      outBuf[outIdx++] = '=';
    } else if (inCount == 2) {
      uint32_t b = (inBuf[0] << 16) | (inBuf[1] << 8);
      outBuf[outIdx++] = b64[(b >> 18) & 0x3F];
      outBuf[outIdx++] = b64[(b >> 12) & 0x3F];
      outBuf[outIdx++] = b64[(b >> 6) & 0x3F];
      outBuf[outIdx++] = '=';
    }
    inCount = 0;
    flushNetwork();
  }
};

void diagnoseConnection() {
  Serial.println("\n========== CONNECTION DIAGNOSTIC ==========");
  Serial.printf("📊 Free Heap: %d bytes\n", ESP.getFreeHeap());
  Serial.printf("📊 Largest Free Block: %d bytes\n", ESP.getMaxAllocHeap());

  IPAddress ip;
  if (WiFi.hostByName("wellsim-backend.onrender.com", ip)) {
    Serial.println("  ✅ DNS OK → " + ip.toString());
  } else {
    Serial.println("  ❌ DNS FAILED!");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(15000);
  
  if (client.connect("wellsim-backend.onrender.com", 443)) {
    Serial.println("  ✅ SSL Connection Test Passed!");
    client.stop();
  } else {
    Serial.println("  ❌ SSL Connection FAILED!");
  }
  Serial.println("========== END DIAGNOSTIC ==========\n");
}

void setupI2S() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = 512,
    .use_apll = false
  };

  i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_SCK,
    .ws_io_num = I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_SD
  };

  i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_PORT, &pin_config);
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n--- WELLSIM REAL-TIME STREAMING STARTING ---");

  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");

  diagnoseConnection();
  setupI2S();
  Serial.println("🟢 [READY] WellSim IoT พร้อมสตรีมเสียงความยาวสูงข้าม Cloud!");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    delay(2000);
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  
  if (http.begin(client, cmdUrl)) {
    http.setTimeout(15000);
    http.addHeader("User-Agent", "ESP32-HTTPClient");
    http.addHeader("X-Device-Key", deviceApiKey);

    int httpCode = http.GET();
    
    if (httpCode == HTTP_CODE_OK) {
      String payload = http.getString();
      
      DynamicJsonDocument doc(300);
      DeserializationError err = deserializeJson(doc, payload);
      
      if (!err) {
        String command = doc["command"] | "none";
        String patientId = doc["patient_id"] | "p1";
        String audioType = doc["type"] | "lung";

        if (command == "record") {
          Serial.println("\n🚀 [ACTION] เริ่มกระบวนการ Real-time Recording & Streaming...");
          
          http.end(); // ปิด Connection ของ Polling ทันที
          delay(100);

          // 1. คำนวณขนาดข้อมูลล่วงหน้า
          size_t pcmBufferSize = (size_t)(SAMPLE_RATE * RECORD_TIME_SECONDS * sizeof(int16_t));
          size_t totalWavSize = sizeof(WAVHeader) + pcmBufferSize;
          size_t base64Len = ((totalWavSize + 2) / 3) * 4;

          char headerJson[256];
          snprintf(headerJson, sizeof(headerJson), 
            "{\"device_id\":\"ESP32-INMP441-A\",\"patient_id\":\"%s\",\"type\":\"%s\",\"duration\":\"0:05\",\"audio_base64\":\"",
            patientId.c_str(), audioType.c_str());
          const char* footerJson = "\"}";

          size_t totalContentLength = strlen(headerJson) + base64Len + strlen(footerJson);

          // 2. เชื่อมต่อ SSL ไปยัง Server
          WiFiClientSecure postClient;
          postClient.setInsecure(); 
          postClient.setTimeout(30000);

          if (postClient.connect("wellsim-backend.onrender.com", 443)) {
            Serial.println("📡 เชื่อมต่อ Socket สำเร็จ สตรีม HTTP Header...");

            // 3. ส่ง HTTP Header
            postClient.println("POST /api/device/audio HTTP/1.1");
            postClient.println("Host: wellsim-backend.onrender.com");
            postClient.println("Content-Type: application/json");
            postClient.printf("X-Device-Key: %s\r\n", deviceApiKey);
            postClient.printf("Content-Length: %d\r\n", totalContentLength);
            postClient.println("Connection: close");
            postClient.println();

            // 4. ส่ง JSON Header
            postClient.print(headerJson);

            // 5. เตรียมตัว Streaming WAV + I2S Audio
            Base64Streamer streamer(postClient);

            WAVHeader header;
            header.chunkSize = totalWavSize - 8;
            header.subchunk2Size = pcmBufferSize;

            // Stream WAV Header เข้า Socket
            streamer.writeBytes((uint8_t*)&header, sizeof(WAVHeader));

            // 6. วน Loop อ่านจาก I2S แล้วยิงตรงลง Socket ทันทีขณะอัดเสียง
            Serial.printf("🎙️ กำลังอัดและสตรีมเสียงสดความยาว %.1f วินาที...\n", RECORD_TIME_SECONDS);
            
            size_t totalSamplesToRead = (size_t)(SAMPLE_RATE * RECORD_TIME_SECONDS);
            size_t samplesReadTotal = 0;

            int32_t i2sBatchBuf[128];
            int16_t pcmBatchBuf[128];

            while (samplesReadTotal < totalSamplesToRead) {
              size_t bytesRead = 0;
              i2s_read(I2S_PORT, i2sBatchBuf, sizeof(i2sBatchBuf), &bytesRead, portMAX_DELAY);

              int samplesInBatch = bytesRead / 4;
              for (int i = 0; i < samplesInBatch; i++) {
                if (samplesReadTotal < totalSamplesToRead) {
                  pcmBatchBuf[i] = (int16_t)(i2sBatchBuf[i] >> 14);
                  samplesReadTotal++;
                }
              }

              // สตรีม batch PCM ที่ได้ลง SSL Socket
              streamer.writeBytes((uint8_t*)pcmBatchBuf, samplesInBatch * sizeof(int16_t));
            }

            // จบการสตรีมส่วนเสียง
            streamer.finish();

            // 7. ส่ง JSON Footer
            postClient.print(footerJson);

            Serial.println("✅ อัดเสียงและส่งข้อมูลขึ้น Cloud สำเร็จ!");

            // 8. รอรับคำตอบจากเซิร์ฟเวอร์
            unsigned long respTimeout = millis() + 15000;
            while (postClient.connected() && millis() < respTimeout) {
              if (postClient.available()) {
                String line = postClient.readStringUntil('\n');
                if (line.startsWith("HTTP/1.1")) {
                  Serial.println(" Response: " + line);
                }
              }
            }
            postClient.stop();
          } else {
            Serial.println("❌ Direct SSL Connection สำหรับ Stream POST ล้มเหลว!");
          }
        }
      }
    }
    http.end();
  }

  delay(3000); 
}