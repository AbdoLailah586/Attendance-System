#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include <time.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Preferences.h>
#include "certs.h"
#if __has_include("attendance-config.h")
#include "attendance-config.h"
#else
#include "config.example.h"
#endif
#include "feedback.h"
MFRC522 reader(21,22);
struct ScreenMessage {char event[37];char name[64];char action[32];FeedbackResult feedback;};
QueueHandle_t screenMessages;
String lastTapId;
SemaphoreHandle_t diskLock;
bool diskReady=false;
String lastCard;
unsigned long lastCardSeen=0,ledAt=0;
bool storageFault=false,ledActive=false;
constexpr const char* FIRMWARE_VERSION="1.4.4";
#ifndef WIFI_FALLBACK_SSID
#define WIFI_FALLBACK_SSID ""
#endif
#ifndef WIFI_FALLBACK_PASSWORD
#define WIFI_FALLBACK_PASSWORD ""
#endif
struct WifiProfile {String ssid,password;};
WifiProfile wifiNetworks[2];
uint8_t wifiNetworkCount=0,wifiNetworkIndex=0;
unsigned long wifiAttemptAt=0;
String serialCommand;
bool storedWifi=false,serialOverflow=false;
byte readerVersion=0;
String eventUuid();
time_t utcNow();
#include "ble_presence.h"
void emitSerialJson(JsonDocument& document){
  String line;serializeJson(document,line);line+='\n';
  // A single UART write keeps upload-task log messages out of a JSON response.
  Serial.write(reinterpret_cast<const uint8_t*>(line.c_str()),line.length());
}
bool validWifi(const String& ssid,const String& password){
  if(ssid.length()==0||ssid.length()>32)return false;
  for(size_t i=0;i<ssid.length();i++)if(ssid[i]=='\0')return false;
  for(size_t i=0;i<password.length();i++)if(password[i]=='\0')return false;
  if(password.length()==0)return true; // Open networks are supported explicitly.
  if(password.length()>=8&&password.length()<=63)return true;
  if(password.length()!=64)return false;
  for(size_t i=0;i<password.length();i++)if(!isxdigit(static_cast<unsigned char>(password[i])))return false;
  return true;
}
bool parseWifiProfiles(const JsonDocument& config,WifiProfile* profiles,uint8_t& count){
  count=0;
  if(config["networks"].is<JsonArrayConst>()){
    JsonArrayConst networks=config["networks"].as<JsonArrayConst>();
    if(networks.size()<1||networks.size()>2)return false;
    for(JsonObjectConst network:networks){
      if(!network["ssid"].is<String>()||!network["password"].is<String>())return false;
      String ssid=network["ssid"].as<String>(),password=network["password"].as<String>();
      if(!validWifi(ssid,password)||(count&&ssid==profiles[0].ssid))return false;
      profiles[count++]={ssid,password};
    }
  }else{
    // Keep existing USB tools and single-network NVS settings compatible.
    if(!config["networks"].isUnbound()||!config["ssid"].is<String>()||!config["password"].is<String>())return false;
    String ssid=config["ssid"].as<String>(),password=config["password"].as<String>();
    if(!validWifi(ssid,password))return false;
    profiles[count++]={ssid,password};
  }
  return count>0;
}
void startWifiProfile(){
  if(!wifiNetworkCount)return;
  wifiAttemptAt=millis();WiFi.disconnect(false,false);
  WiFi.begin(wifiNetworks[wifiNetworkIndex].ssid.c_str(),wifiNetworks[wifiNetworkIndex].password.c_str());
}
void wifiTick(){
  // One owner on the main loop; no blocking scan and no Wi-Fi changes from the upload worker.
  if(WiFi.status()!=WL_CONNECTED&&wifiNetworkCount&&millis()-wifiAttemptAt>=15000){
    wifiNetworkIndex=(wifiNetworkIndex+1)%wifiNetworkCount;startWifiProfile();
  }
}
void loadWifi(){
  if(validWifi(WIFI_SSID,WIFI_PASSWORD))wifiNetworks[wifiNetworkCount++]={WIFI_SSID,WIFI_PASSWORD};
  if(validWifi(WIFI_FALLBACK_SSID,WIFI_FALLBACK_PASSWORD)&&(!wifiNetworkCount||wifiNetworks[0].ssid!=WIFI_FALLBACK_SSID))
    wifiNetworks[wifiNetworkCount++]={WIFI_FALLBACK_SSID,WIFI_FALLBACK_PASSWORD};
  Preferences preferences;
  if(!preferences.begin("attendance",false))return;
  String saved=preferences.getString("wifi","");preferences.end();
  JsonDocument config;
  if(saved.length()&&!deserializeJson(config,saved)&&config["device_id"].as<String>()==DEVICE_ID){
    WifiProfile savedProfiles[2];uint8_t count;
    if(parseWifiProfiles(config,savedProfiles,count)){
      if(config["networks"].is<JsonArrayConst>()){
        wifiNetworkCount=count;for(uint8_t i=0;i<count;i++)wifiNetworks[i]=savedProfiles[i];
      }else{
        wifiNetworks[0]=savedProfiles[0];if(!wifiNetworkCount)wifiNetworkCount=1;
        if(wifiNetworkCount==2&&wifiNetworks[1].ssid==wifiNetworks[0].ssid)wifiNetworkCount=1;
      }
      storedWifi=true;
    }
  }
}
void printStatus(){
  JsonDocument status;status["command"]="status";status["firmware"]=FIRMWARE_VERSION;status["device_id"]=DEVICE_ID;
  status["wifi_connected"]=WiFi.status()==WL_CONNECTED;status["wifi_source"]=storedWifi?"stored":"compiled";
  status["wifi_network_count"]=wifiNetworkCount;status["wifi_profile_index"]=wifiNetworkIndex;
  if(WiFi.status()==WL_CONNECTED)status["rssi_dbm"]=WiFi.RSSI();
  status["clock_ready"]=time(nullptr)>1700000000;status["storage_ready"]=diskReady;status["storage_fault"]=storageFault;
  status["rc522_version"]=readerVersion;status["rc522_detected"]=readerVersion!=0&&readerVersion!=0xFF;
  status["uptime_ms"]=millis();status["free_heap_bytes"]=ESP.getFreeHeap();
  status["minimum_free_heap_bytes"]=ESP.getMinFreeHeap();status["largest_free_heap_block"]=ESP.getMaxAllocHeap();
  status["feedback_enabled"]=FEEDBACK_ENABLED!=0;status["arrival_led"]=FEEDBACK_ARRIVAL_IS_RED?"red":"green";
  status["buzzer_type"]=BUZZER_PASSIVE?"passive":"active";status["feedback_test_running"]=feedbackTesting;
  unsigned queued=0;xSemaphoreTake(diskLock,portMAX_DELAY);
  File directory=diskReady?LittleFS.open("/queue"):File();
  if(directory){File file=directory.openNextFile();while(file){if(String(file.name()).endsWith(".json"))queued++;file.close();file=directory.openNextFile();}directory.close();}
  xSemaphoreGive(diskLock);status["queued_events"]=queued;bleWriteStatus(status);emitSerialJson(status);
}
void handleSerialCommand(const String& command){
  if(command=="--status"){printStatus();return;}
  if(command=="--feedback-test"){
    feedbackStartTest();JsonDocument response;response["command"]="feedback_test";response["ok"]=FEEDBACK_ENABLED!=0;emitSerialJson(response);return;
  }
  if(command=="--format"){
    xSemaphoreTake(diskLock,portMAX_DELAY);LittleFS.end();bool ok=LittleFS.format();diskReady=ok&&LittleFS.begin(false);
    if(diskReady){LittleFS.mkdir("/queue");LittleFS.mkdir("/blequeue");bleQueued=0;bleForeignQueued=0;}storageFault=!diskReady;xSemaphoreGive(diskLock);
    Serial.println(diskReady?"Formatted. Existing queue erased.":"Format failed.");return;
  }
  JsonDocument request,response;response["command"]="wifi_config";response["ok"]=false;
  bool parsed=!deserializeJson(request,command);
  if(parsed&&bleHandleCommand(request,response)){emitSerialJson(response);return;}
  if(!parsed||request["command"]!="wifi_config"){response["error"]="invalid_command";}
  else if(request["device_id"].as<String>()!=DEVICE_ID){response["error"]="wrong_reader";}
  else{
    WifiProfile profiles[2];uint8_t count;
    if(!parseWifiProfiles(request,profiles,count))response["error"]="invalid_wifi";
    else{
      JsonDocument config;config["device_id"]=DEVICE_ID;JsonArray networks=config["networks"].to<JsonArray>();
      for(uint8_t i=0;i<count;i++){JsonObject network=networks.add<JsonObject>();network["ssid"]=profiles[i].ssid;network["password"]=profiles[i].password;}
      String saved;serializeJson(config,saved);
      Preferences preferences;bool persisted=false;
      if(preferences.begin("attendance",false)){persisted=preferences.putString("wifi",saved)>0;preferences.end();}
      if(!persisted)response["error"]="storage_failed";
      else{
        wifiNetworkCount=count;for(uint8_t i=0;i<count;i++)wifiNetworks[i]=profiles[i];
        wifiNetworkIndex=0;storedWifi=true;startWifiProfile();
        response["ok"]=true;lastTapId="";
      }
    }
  }
  // Never echo the command, SSID/password or API token to the serial console.
  emitSerialJson(response);
}
void readSerialCommands(){
  unsigned budget=128; // Keep card scanning responsive even during serial input.
  while(Serial.available()&&budget--){
    char next=Serial.read();if(next=='\r')continue;
    if(next=='\n'){
      if(serialOverflow)Serial.println("{\"command\":\"wifi_config\",\"ok\":false,\"error\":\"command_too_long\"}");
      else if(serialCommand.length())handleSerialCommand(serialCommand);
      serialCommand="";serialOverflow=false;
    }else if(!serialOverflow){if(serialCommand.length()<2048)serialCommand+=next;else{serialCommand="";serialOverflow=true;}}
  }
}

String eventUuid(){
  uint8_t bytes[16];esp_fill_random(bytes,sizeof(bytes));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  char out[37];snprintf(out,sizeof(out),"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]);return String(out);
}
time_t utcNow(){time_t value=time(nullptr);return value>1700000000?value:0;}
void saveTap(const String& card){
  feedbackCardRead(); // One immediate chirp per new UID read; held cards are suppressed upstream.
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
  if(!ok)feedbackShow(FeedbackResult::Review);
  Serial.printf("Card %s: %s%s\n",card.c_str(),ok?"SAVED ":"NOT SAVED - STORAGE ERROR ",ok?id.c_str():"");
  if(!captured)Serial.println("Capture time unknown: server will keep this tap for administrator review.");
  if(ok){ledAt=millis();ledActive=true;}
  lastTapId=id;
}
void readCards(){
  byte atqa[2],size=2;auto status=reader.PICC_WakeupA(atqa,&size);
  if(status!=MFRC522::STATUS_OK&&status!=MFRC522::STATUS_COLLISION)return;
  if(!reader.PICC_ReadCardSerial())return;
  String card;char hex[3];for(byte i=0;i<reader.uid.size;i++){snprintf(hex,sizeof(hex),"%02X",reader.uid.uidByte[i]);card+=hex;}
  bool held=card==lastCard&&millis()-lastCardSeen<1000;lastCard=card;lastCardSeen=millis();
  reader.PICC_HaltA();reader.PCD_StopCrypto1();if(!held)saveTap(card);
}
void uploadTask(void*){
  bool clockAnnounced=false;
  for(;;){
    if(WiFi.status()!=WL_CONNECTED){
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
    if(events.size()==0){bleNetworkCycle();vTaskDelay(pdMS_TO_TICKS(1000));continue;}
    WiFiClientSecure tls;tls.setCACert(TRUSTED_ROOTS);tls.setHandshakeTimeout(10);
    HTTPClient http;http.setReuse(false);http.setConnectTimeout(8000);http.setTimeout(8000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    if(!http.begin(tls,API_URL)){vTaskDelay(pdMS_TO_TICKS(5000));continue;}
    http.addHeader("Content-Type","application/json");http.addHeader("Authorization",String("Bearer ")+DEVICE_TOKEN);
    String body;serializeJson(request,body);int code=http.POST(body);
    if(code==200){
      JsonDocument reply;
      if(!deserializeJson(reply,http.getString())){
        xSemaphoreTake(diskLock,portMAX_DELAY);
        for(JsonObject ack:reply["acknowledged"].as<JsonArray>()){
          String id=ack["event_id"]|"";bool sent=false;for(JsonObject event:events)if(id==event["event_id"].as<String>())sent=true;
          if(sent&&id.length()==36){LittleFS.remove("/queue/"+id+".json");Serial.printf("Server saved %s (%s)\n",id.c_str(),ack["status"]|"unknown");
            ScreenMessage message{};strlcpy(message.event,id.c_str(),sizeof(message.event));strlcpy(message.name,ack["display_name"]|"Unknown card",sizeof(message.name));
            String type=ack["event_type"]|"",state=ack["status"]|"";
            if(state=="accepted"&&(type=="clock_in"||type=="clock_out"))bleConfigAt=0;
            message.feedback=state=="accepted"?(type=="clock_in"?FeedbackResult::Arrival:type=="clock_out"?FeedbackResult::Departure:type=="refresh"?FeedbackResult::Refresh:FeedbackResult::Review):
              state=="rapid_repeat"||state=="duplicate_action"?FeedbackResult::Refresh:state=="after_checkout"?FeedbackResult::AlreadyOut:FeedbackResult::Review;
            const char* action=message.feedback==FeedbackResult::Arrival?"CHECK IN":message.feedback==FeedbackResult::Departure?"CHECK OUT":
              message.feedback==FeedbackResult::Refresh?"ALREADY IN":message.feedback==FeedbackResult::AlreadyOut?"ALREADY OUT":"ADMIN REVIEW";
            strlcpy(message.action,action,sizeof(message.action));xQueueSend(screenMessages,&message,0);
          }
        }
        xSemaphoreGive(diskLock);
      }
    }else Serial.printf("Upload %d; queued taps retained.\n",code);
    http.end();tls.stop();bleNetworkCycle(); // NFC takes priority; BLE shares this worker's TLS allocation.
    vTaskDelay(pdMS_TO_TICKS(code==200?1000:10000));
  }
}
void setup(){
  Serial.begin(115200);pinMode(STATUS_LED,OUTPUT);diskLock=xSemaphoreCreateMutex();
  feedbackBegin();
  diskReady=LittleFS.begin(false); // Never autoformat and lose queued taps.
  if(diskReady)LittleFS.mkdir("/queue");else{storageFault=true;Serial.println("LittleFS unavailable. Format only a NEW device with the explicit --format command.");}
  screenMessages=xQueueCreate(30,sizeof(ScreenMessage));
  SPI.begin(18,19,23,21);reader.PCD_Init();readerVersion=reader.PCD_ReadRegister(MFRC522::VersionReg);
  if(readerVersion==0||readerVersion==0xFF)Serial.println("RC522 not detected; check 3.3V and SPI wiring.");
  loadWifi();WiFi.mode(WIFI_STA);WiFi.setAutoReconnect(false);startWifiProfile();
  configTime(0,0,"time.google.com","pool.ntp.org");
  bleBegin(); // Allocate BLE before any HTTPS handshake starts.
  xTaskCreatePinnedToCore(uploadTask,"upload",16384,nullptr,1,nullptr,0);
  Serial.println("Reader ready; waiting for Internet time. Untimed taps are saved for review, never assigned a guessed time.");
  Serial.printf("Firmware %s; USB Wi-Fi settings available.\n",FIRMWARE_VERSION);
  if(strlen(DEVICE_ID)!=36||strlen(DEVICE_TOKEN)!=43)Serial.println("Configure this branch DEVICE_ID and DEVICE_TOKEN before installation.");
}
void loop(){
  readCards();
  ScreenMessage screen;while(xQueueReceive(screenMessages,&screen,0)==pdTRUE)if(lastTapId==screen.event){Serial.printf("NFC %s: %s\n",screen.name,screen.action);feedbackShow(screen.feedback);}
  unsigned long now=millis();
  if(ledActive&&now-ledAt>=200)ledActive=false; // Safe across millis() rollover during continuous operation.
  digitalWrite(STATUS_LED,storageFault?(now/150)%2:!utcNow()?(now/500)%2:ledActive?HIGH:WiFi.status()!=WL_CONNECTED&&now%2000<50);
  readSerialCommands();
  wifiTick();
  feedbackTick(millis()); // No sound/light delays that block card scanning or uploads.
  delay(30);
}
