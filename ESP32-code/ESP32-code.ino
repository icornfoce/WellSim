#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <driver/i2s.h>
#include <ArduinoJson.h>
#include "mbedtls/base64.h"

// ─── การตั้งค่า Wi-Fi และเซิร์ฟเวอร์ ──────────────────────────────────────
const char* ssid = "Micky";          
const char* password = "021657065"; 
const char* serverUrl = "https://wellsim-backend.onrender.com/api/device/audio"; 
const char* cmdUrl = "https://wellsim-backend.onrender.com/api/device/command?device_id=ESP32-INMP441-A";

// ⚠️ ใส่ DEVICE_API_KEY ของคุณที่กำหนดไว้บนเซิร์ฟเวอร์ Render (ต้องตรงกัน)
const char* deviceApiKey = "YOUR_DEVICE_API_KEY_HERE"; 

// ─── การตั้งค่า I2S Microphone (INMP441) ──────────────────────────────────
#define I2S_WS 25
#define I2S_SD 22
#define I2S_SCK 26
#define I2S_PORT I2S_NUM_0

const int SAMPLE_RATE = 16000;     
const float RECORD_TIME_SECONDS = 0.5;
const size_t PCM_BUFFER_SIZE = (size_t)(SAMPLE_RATE * RECORD_TIME_SECONDS * sizeof(int16_t)); 

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

const size_t TOTAL_WAV_SIZE = sizeof(WAVHeader) + PCM_BUFFER_SIZE;

// 🔍 ฟังก์ชัน Diagnostic วิเคราะห์ SSL Connection & Memory Heap
void diagnoseConnection() {
  Serial.println("\n========== CONNECTION DIAGNOSTIC ==========");
  Serial.printf("📊 Free Heap: %d bytes\n", ESP.getFreeHeap());
  Serial.printf("📊 Largest Free Block: %d bytes\n", ESP.getMaxAllocHeap());

  // Test 1: DNS Resolution
  Serial.println("\n[TEST 1] DNS Resolution...");
  IPAddress ip;
  if (WiFi.hostByName("wellsim-backend.onrender.com", ip)) {
    Serial.println("  ✅ DNS OK → " + ip.toString());
  } else {
    Serial.println("  ❌ DNS FAILED! (ปัญหาที่ DNS ไม่สามารถหา IP ได้)");
    return;
  }

  // Test 2: Raw SSL Connection (ไม่ผ่าน HTTPClient)
  Serial.println("\n[TEST 2] Direct SSL Connection...");
  Serial.printf("  📊 Free Heap before SSL: %d bytes\n", ESP.getFreeHeap());
  
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(15000);
  
  unsigned long start = millis();
  if (client.connect("wellsim-backend.onrender.com", 443)) {
    Serial.printf("  ✅ SSL OK! (ใช้เวลา %lu ms)\n", millis() - start);
    Serial.printf("  📊 Free Heap after SSL: %d bytes\n", ESP.getFreeHeap());
    
    // Test 3: ส่ง HTTP GET แบบ Manual (พร้อมแนบ Key)
    Serial.println("\n[TEST 3] Manual HTTP GET /api/device/command...");
    client.println("GET /api/device/command?device_id=ESP32-INMP441-A HTTP/1.1");
    client.println("Host: wellsim-backend.onrender.com");
    client.println("User-Agent: ESP32-Diagnostic");
    client.printf("X-Device-Key: %s\r\n", deviceApiKey); // แนบ X-Device-Key
    client.println("Connection: close");
    client.println();
    
    unsigned long timeout = millis() + 10000;
    while (client.connected() && millis() < timeout) {
      if (client.available()) {
        String line = client.readStringUntil('\n');
        Serial.println("  " + line);
        if (line.startsWith("{")) break; // พบ JSON body แล้ว
      }
    }
    client.stop();
  } else {
    Serial.printf("  ❌ SSL Connection FAILED! (ใช้เวลา %lu ms)\n", millis() - start);
    Serial.printf("  📊 Free Heap after attempt: %d bytes\n", ESP.getFreeHeap());
  }

  Serial.println("\n========== END DIAGNOSTIC ==========\n");
}

void setupI2S() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 1024,
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

  Serial.println("\n--- WELLSIM IOT STARTING ---");

  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");

  diagnoseConnection();

  setupI2S();
  Serial.println("🟢 [READY] WellSim IoT พร้อมรับคำสั่งอัดเสียงจาก Web Dashboard!");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    delay(2000);
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();
  client.setHandshakeTimeout(15);

  HTTPClient http;
  
  if (http.begin(client, cmdUrl)) {
    http.setTimeout(15000);
    http.addHeader("User-Agent", "ESP32-HTTPClient");
    http.addHeader("X-Device-Key", deviceApiKey); // แนบ Key สำหรับตรวจสอบสิทธิ์ฝั่ง GET

    int httpCode = http.GET();
    
    if (httpCode > 0) {
      if (httpCode == HTTP_CODE_OK) {
        String payload = http.getString();
        
        DynamicJsonDocument doc(300);
        DeserializationError err = deserializeJson(doc, payload);
        
        if (!err) {
          String command = doc["command"] | "none";
          String patientId = doc["patient_id"] | "p1";
          String audioType = doc["type"] | "lung";

          Serial.print("📡 Polling Server... Command: ");
          Serial.println(command);
          
          if (command == "record") {
            Serial.println("\n🚀 [ACTION] ได้รับคำสั่งอัดเสียงจากหน้าเว็บ!");
            
            http.end(); // คืน SSL Resource ของ Polling ก่อน
            delay(100);

            Serial.printf("📊 Free Heap ก่อนจอง WAV: %d bytes (Largest Block: %d bytes)\n", 
                          ESP.getFreeHeap(), ESP.getMaxAllocHeap());

            // 1. จอง WAV Buffer Dynamic
            uint8_t* wavBuffer = (uint8_t*)malloc(TOTAL_WAV_SIZE);
            if (wavBuffer == NULL) {
              Serial.println("❌ Critical Error: แรมไม่พอสำหรับ WAV Buffer!");
              return;
            }
            Serial.printf("✅ จอง RAM WAV Buffer สำเร็จ (%d bytes)\n", TOTAL_WAV_SIZE);

            // 2. สร้าง WAV Header
            WAVHeader header;
            header.chunkSize = TOTAL_WAV_SIZE - 8;
            header.subchunk2Size = PCM_BUFFER_SIZE;
            memcpy(wavBuffer, &header, sizeof(WAVHeader));

            // 3. เริ่มอัดเสียงผ่าน I2S
            Serial.println("🎙️ กำลังบันทึกเสียง...");
            int16_t* pcm16Bit = (int16_t*)(wavBuffer + sizeof(WAVHeader));
            size_t samplesRead = 0;
            size_t totalSamples = (size_t)(SAMPLE_RATE * RECORD_TIME_SECONDS);
            int32_t i2sBuffer[256];

            while (samplesRead < totalSamples) {
              size_t bytesRead = 0;
              i2s_read(I2S_PORT, i2sBuffer, sizeof(i2sBuffer), &bytesRead, portMAX_DELAY);
              
              int samplesInBatch = bytesRead / 4;
              for (int i = 0; i < samplesInBatch; i++) {
                if (samplesRead < totalSamples) {
                  pcm16Bit[samplesRead++] = (int16_t)(i2sBuffer[i] >> 14); 
                }
              }
            }
            Serial.println("✅ บันทึกเสียงเสร็จสิ้น!");

            // 4. แปลงเป็น Base64
            Serial.println("🔄 กำลังแปลง Base64...");
            size_t base64Len = 0;
            mbedtls_base64_encode(NULL, 0, &base64Len, wavBuffer, TOTAL_WAV_SIZE);
            
            char* base64Str = (char*)malloc(base64Len + 1);
            if (base64Str == NULL) {
              Serial.println("❌ Error: แรมไม่พอสำหรับ Base64!");
              free(wavBuffer);
              return;
            }

            mbedtls_base64_encode((unsigned char*)base64Str, base64Len + 1, &base64Len, wavBuffer, TOTAL_WAV_SIZE);
            base64Str[base64Len] = '\0';

            // คืน RAM WAV Buffer ทันทีเพื่อเปิดพื้นที่ RAM ให้ SSL POST
            free(wavBuffer);

            // 5. ส่ง HTTP POST ไปที่ Render Backend
            Serial.println("📡 กำลังยิงข้อมูลขึ้น Render Server...");
            
            WiFiClientSecure postClient;
            postClient.setInsecure(); 
            postClient.setHandshakeTimeout(20);
            
            HTTPClient postHttp;
            if (postHttp.begin(postClient, serverUrl)) {
              postHttp.setTimeout(30000); 
              postHttp.addHeader("Content-Type", "application/json");
              postHttp.addHeader("X-Device-Key", deviceApiKey); // แนบ Key สำหรับตรวจสอบสิทธิ์ฝั่ง POST

              // สร้าง C-String Payload รวมโดยตรง
              char headerJson[256];
              snprintf(headerJson, sizeof(headerJson), 
                "{\"device_id\":\"ESP32-INMP441-A\",\"patient_id\":\"%s\",\"type\":\"%s\",\"duration\":\"0:02\",\"audio_base64\":\"",
                patientId.c_str(), audioType.c_str());
              
              const char* footerJson = "\"}";
              size_t totalJsonLen = strlen(headerJson) + base64Len + strlen(footerJson);

              char* fullJsonPayload = (char*)malloc(totalJsonLen + 1);
              if (fullJsonPayload != NULL) {
                strcpy(fullJsonPayload, headerJson);
                strcat(fullJsonPayload, base64Str);
                strcat(fullJsonPayload, footerJson);

                free(base64Str); // คืน RAM Base64 ทันที

                int postCode = postHttp.POST((uint8_t*)fullJsonPayload, totalJsonLen);
                
                free(fullJsonPayload); // คืน RAM Payload ทันที

                if (postCode > 0) {
                  Serial.println(" Response Code: " + String(postCode));
                  Serial.println(" Response Body: " + postHttp.getString());
                } else {
                  Serial.printf("❌ HTTP POST Error Code: %d (%s)\n", postCode, postHttp.errorToString(postCode).c_str());
                }
              } else {
                Serial.println("❌ Error: แรมไม่พอสำหรับสร้าง JSON Payload!");
                free(base64Str);
              }

              postHttp.end();
            } else {
              Serial.println("❌ Unable to connect to POST URL");
              free(base64Str);
            }
          }
        } else {
          Serial.println("❌ JSON Parse Failed!");
        }
      }
    } else {
      Serial.printf("❌ HTTP GET Error Code: %d (%s)\n", httpCode, http.errorToString(httpCode).c_str());
    }
    http.end();
  } else {
    Serial.println("❌ Unable to connect to GET URL");
  }

  delay(3000); 
}
