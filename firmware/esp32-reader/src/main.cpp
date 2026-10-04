#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include <time.h>
#include "certs.h"
#if __has_include("attendance-config.h")
#include "attendance-config.h"
#else
#include "config.example.h"
#endif

HardwareSerial reader(2);
SemaphoreHandle_t diskLock;
bool diskReady=false;
String lastCard;
unsigned long lastCardSeen=0,ledAt=0;
bool storageFault=false,ledActive=false;

String eventUuid(){
  uint8_t bytes[16];esp_fill_random(bytes,sizeof(bytes));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  char out[37];snprintf(out,sizeof(out),"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]);return String(out);
}
time_t utcNow(){time_t value=time(nullptr);return value>1700000000?value:0;}
void saveTap(const String& card){
  JsonDocument event;String id=eventUuid();event["event_id"]=id;event["card_uid"]=card;
  time_t captured=utcNow();
  if(captured){char timestamp[25];struct tm utc;gmtime_r(&captured,&utc);strftime(timestamp,sizeof(timestamp),"%Y-%m-%dT%H:%M:%SZ",&utc);event["recorded_at"]=timestamp;}
  else event["recorded_at"]=nullptr; // Never substitute upload time for an unknown capture time.
  xSemaphoreTake(diskLock,portMAX_DELAY);
  String temp="/queue/"+id+".tmp",path="/queue/"+id+".json";
  File file=diskReady?LittleFS.open(temp,"w"):File();
  size_t expected=measureJson(event),written=file?serializeJson(event,file):0;
  if(file){file.flush();file.close();}
  bool ok=written==expected&&LittleFS.rename(temp,path);
  if(!ok&&diskReady)LittleFS.remove(temp);
  xSemaphoreGive(diskLock);
  storageFault=!ok;
  Serial.printf("Card %s: %s%s\n",card.c_str(),ok?"SAVED ":"NOT SAVED - STORAGE ERROR ",ok?id.c_str():"");
  if(!captured)Serial.println("Capture time unknown: server will keep this tap for administrator review.");
  if(ok){ledAt=millis();ledActive=true;}
}
int nibble(char c){if(c>='0'&&c<='9')return c-'0';if(c>='A'&&c<='F')return c-'A'+10;if(c>='a'&&c<='f')return c-'a'+10;return -1;}
void readCards(){
  static char frame[12];static int length=-1;static unsigned long started=0;
  while(reader.available()){
    char ch=reader.read();
    if(ch==2){length=0;started=millis();continue;}
    if(length>=0&&millis()-started>200){length=-1;continue;}
    if(ch==3){
      if(length==12){
        int checksum=0;bool valid=true;
        for(int i=0;i<12;i++)if(nibble(frame[i])<0)valid=false;
        if(valid){for(int i=0;i<10;i+=2)checksum^=(nibble(frame[i])<<4)|nibble(frame[i+1]);valid=checksum==((nibble(frame[10])<<4)|nibble(frame[11]));}
        if(valid){String card;for(int i=0;i<10;i++)card+=(char)toupper(frame[i]);
          bool held=card==lastCard&&millis()-lastCardSeen<1000;lastCardSeen=millis();lastCard=card;if(!held)saveTap(card);
        }else Serial.println("Invalid RFID checksum; ignored electrical noise.");
      }
      length=-1;continue;
    }
    if(length>=0){if(length<12)frame[length++]=ch;else length=-1;}
  }
}
void uploadTask(void*){
  unsigned long reconnectAttempt=millis();
  bool clockAnnounced=false;
  for(;;){
    if(WiFi.status()!=WL_CONNECTED){
      if(millis()-reconnectAttempt>=15000){WiFi.reconnect();reconnectAttempt=millis();}
      vTaskDelay(pdMS_TO_TICKS(3000));continue;
    }
    time_t current=utcNow();
    if(!current){vTaskDelay(pdMS_TO_TICKS(3000));continue;} // TLS needs a valid clock.
    if(!clockAnnounced){Serial.println("Clock synchronized from Internet. Timed capture and HTTPS upload ready.");clockAnnounced=true;}
    if(strlen(DEVICE_ID)!=36||strlen(DEVICE_TOKEN)!=43){vTaskDelay(pdMS_TO_TICKS(3000));continue;}
    JsonDocument request;request["device_id"]=DEVICE_ID;JsonArray events=request["events"].to<JsonArray>();
    xSemaphoreTake(diskLock,portMAX_DELAY);
    File directory=diskReady?LittleFS.open("/queue"):File();
    if(directory){File f=directory.openNextFile();while(f&&events.size()<20){
      if(String(f.name()).endsWith(".json")){JsonDocument record;if(!deserializeJson(record,f))events.add(record.as<JsonObject>());else Serial.printf("Unreadable queued file retained: %s\n",f.name());}
      f.close();f=directory.openNextFile();
    }directory.close();}
    xSemaphoreGive(diskLock);
    if(events.size()==0){vTaskDelay(pdMS_TO_TICKS(5000));continue;}
    WiFiClientSecure tls;tls.setCACert(TRUSTED_ROOTS);tls.setHandshakeTimeout(10);
    HTTPClient http;http.setConnectTimeout(8000);http.setTimeout(8000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    if(!http.begin(tls,API_URL)){vTaskDelay(pdMS_TO_TICKS(5000));continue;}
    http.addHeader("Content-Type","application/json");http.addHeader("Authorization",String("Bearer ")+DEVICE_TOKEN);
    String body;serializeJson(request,body);int code=http.POST(body);
    if(code==200){
      JsonDocument reply;
      if(!deserializeJson(reply,http.getString())){
        xSemaphoreTake(diskLock,portMAX_DELAY);
        for(JsonObject ack:reply["acknowledged"].as<JsonArray>()){
          String id=ack["event_id"]|"";bool sent=false;for(JsonObject event:events)if(id==event["event_id"].as<String>())sent=true;
          if(sent&&id.length()==36){LittleFS.remove("/queue/"+id+".json");Serial.printf("Server saved %s (%s)\n",id.c_str(),ack["status"]|"unknown");}
        }
        xSemaphoreGive(diskLock);
      }
    }else Serial.printf("Upload %d; queued taps retained.\n",code);
    http.end();vTaskDelay(pdMS_TO_TICKS(code==200?1000:10000));
  }
}
void setup(){
  Serial.begin(115200);pinMode(STATUS_LED,OUTPUT);diskLock=xSemaphoreCreateMutex();
  diskReady=LittleFS.begin(false); // Never autoformat and lose queued taps.
  if(diskReady)LittleFS.mkdir("/queue");else{storageFault=true;Serial.println("LittleFS unavailable. Format only a NEW device with the explicit --format command.");}
  reader.setRxBufferSize(2048);reader.begin(9600,SERIAL_8N1,RFID_RX,-1);
  WiFi.mode(WIFI_STA);WiFi.setAutoReconnect(true);WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
  configTime(0,0,"time.google.com","pool.ntp.org");
  xTaskCreatePinnedToCore(uploadTask,"upload",16384,nullptr,1,nullptr,0);
  Serial.println("Reader ready; waiting for Internet time. Untimed taps are saved for review, never assigned a guessed time.");
  if(strlen(DEVICE_ID)!=36||strlen(DEVICE_TOKEN)!=43)Serial.println("Configure this branch DEVICE_ID and DEVICE_TOKEN before installation.");
}
void loop(){
  readCards();
  unsigned long now=millis();
  if(ledActive&&now-ledAt>=200)ledActive=false; // Safe across millis() rollover during continuous operation.
  digitalWrite(STATUS_LED,storageFault?(now/150)%2:!utcNow()?(now/500)%2:ledActive?HIGH:WiFi.status()!=WL_CONNECTED&&now%2000<50);
  if(Serial.available()){String command=Serial.readStringUntil('\n');command.trim();
    if(command=="--format"){xSemaphoreTake(diskLock,portMAX_DELAY);LittleFS.end();bool ok=LittleFS.format();diskReady=ok&&LittleFS.begin(false);if(diskReady)LittleFS.mkdir("/queue");storageFault=!diskReady;xSemaphoreGive(diskLock);Serial.println(diskReady?"Formatted. Existing queue erased.":"Format failed.");}
  }
  delay(2);
}
