#pragma once
#include <NimBLEDevice.h>

// Experimental presence of a carried Bluetooth device, not proof of a person's location.
// This worker owns all GATT clients; the existing uploader owns all HTTPS requests.
constexpr unsigned BLE_MAX_TAGS=3,BLE_QUEUE_LIMIT=2000,BLE_RESERVE_BYTES=65536;
constexpr unsigned BLE_REPORT_MS=30000,BLE_CONFIG_MS=60000,BLE_RETRY_MS=5000;
struct BleTargetConfig {char address[18]{};uint16_t grace=90;bool localTest=false;time_t trackingUntil=0;};
struct BleTarget {
  BleTargetConfig config;
  NimBLEClient* client=nullptr;
  NimBLERemoteCharacteristic* batteryCharacteristic=nullptr;
  unsigned long observedAt=0,eventAt=0,rssiAt=0,connectAt=0,batteryAt=0;
  uint8_t addressType=0;
  int rssi=0,battery=-1,lastError=0;
  bool everSeen=false,notSeenReported=false,connected=false,advertised=false;
};
SemaphoreHandle_t bleLock=nullptr;
TaskHandle_t bleWorkerHandle=nullptr;
BleTarget bleTargets[BLE_MAX_TAGS];
BleTargetConfig bleDesired[BLE_MAX_TAGS];
unsigned bleTargetCount=0,bleDesiredCount=0,bleDesiredVersion=0;
bool bleRadioReady=false,bleQueueFault=false,bleOverCapacity=false;
unsigned long bleWorkerAt=0,bleLastAckAt=0,bleConfigAt=0,bleNetworkAt=0;
int bleLastHttpCode=0;
unsigned bleQueued=0,bleForeignQueued=0;
String bleBootId,bleConfigSource="none",bleTestAddress;
const char* bleRadioError="starting";
uint16_t bleTestGrace=90;
unsigned long bleTestStarted=0,bleTestDuration=0;
bool bleConfigLoaded=false;

bool bleValidAddress(const String& address){
  if(address.length()!=17)return false;
  for(unsigned i=0;i<17;i++)if(i%3==2?address[i]!=':':!isxdigit(static_cast<unsigned char>(address[i])))return false;
  return address!="00:00:00:00:00:00"&&address!="FF:FF:FF:FF:FF:FF";
}
String bleUtcTimestamp(time_t value){
  if(!value)return "";
  char timestamp[25];struct tm utc;gmtime_r(&value,&utc);
  strftime(timestamp,sizeof(timestamp),"%Y-%m-%dT%H:%M:%SZ",&utc);return String(timestamp);
}
String bleEndpoint(const char* path){
  String url=API_URL;int route=url.indexOf("/api/");
  return route>0?url.substring(0,route)+path:String();
}
time_t bleParseUtc(const String& timestamp){
  int year,month,day,hour,minute,second;
  if(sscanf(timestamp.c_str(),"%d-%d-%dT%d:%d:%d",&year,&month,&day,&hour,&minute,&second)!=6)return 0;
  if(year<2024||month<1||month>12||day<1||day>31||hour<0||hour>23||minute<0||minute>59||second<0||second>59)return 0;
  struct tm utc{};utc.tm_year=year-1900;utc.tm_mon=month-1;utc.tm_mday=day;utc.tm_hour=hour;utc.tm_min=minute;utc.tm_sec=second;
  return mktime(&utc); // The reader's system timezone is UTC (configTime(0,0,...)).
}
bool bleHealthy(){
  return bleRadioReady&&!bleQueueFault&&!bleOverCapacity&&diskReady&&utcNow()&&
    bleWorkerAt&&millis()-bleWorkerAt<20000;
}
void bleCacheConfig(JsonDocument& config){
  JsonDocument cache;cache["device_id"]=DEVICE_ID;
  // Do not rewrite NVS for changing server_time or every minute of unchanged monitoring.
  JsonObject normalized=cache["config"].to<JsonObject>();normalized["protocol"]="attendance-ble-v1";
  JsonArray tags=normalized["tags"].to<JsonArray>();
  for(JsonObject tag:config["tags"].as<JsonArray>()){
    JsonObject next=tags.add<JsonObject>();next["address"]=tag["address"];
    next["enabled"]=tag["enabled"];next["grace_seconds"]=tag["grace_seconds"];next["tracking_until"]=tag["tracking_until"];
  }
  String saved;serializeJson(cache,saved);Preferences preferences;
  if(preferences.begin("ble-presence",false)){if(preferences.getString("config","")!=saved)preferences.putString("config",saved);preferences.end();}
}
bool bleApplyConfig(JsonDocument& config,const String& source){
  if(config["protocol"]!="attendance-ble-v1"||!config["tags"].is<JsonArray>())return false;
  BleTargetConfig next[BLE_MAX_TAGS];unsigned count=0;bool overCapacity=false;
  for(JsonObject tag:config["tags"].as<JsonArray>()){
    if(tag["enabled"].is<bool>()&&!tag["enabled"].as<bool>())continue;
    String address=tag["address"]|"";address.toUpperCase();
    unsigned grace=tag["grace_seconds"]|90;
    if(!bleValidAddress(address)||grace<5||grace>1800)return false;
    bool duplicate=false;for(unsigned i=0;i<count;i++)if(address==next[i].address)duplicate=true;
    if(duplicate)continue;
    if(count>=BLE_MAX_TAGS){overCapacity=true;continue;}
    time_t until=bleParseUtc(tag["tracking_until"]|"");
    if(!until||until<=utcNow())continue; // A cached session cannot run past its known checkout/cap deadline.
    strlcpy(next[count].address,address.c_str(),sizeof(next[count].address));next[count].grace=grace;next[count++].trackingUntil=until;
  }
  // A USB test target is deliberately separate from employee assignment on the platform.
  xSemaphoreTake(bleLock,portMAX_DELAY);String testAddress=bleTestAddress;unsigned testGrace=bleTestGrace;
  bool testActive=testAddress.length()&&bleTestDuration&&millis()-bleTestStarted<bleTestDuration;xSemaphoreGive(bleLock);
  if(testActive){
    bool duplicate=false;for(unsigned i=0;i<count;i++)if(testAddress==next[i].address)duplicate=true;
    if(!duplicate){
      if(count>=BLE_MAX_TAGS)overCapacity=true;
      else{strlcpy(next[count].address,testAddress.c_str(),sizeof(next[count].address));next[count].grace=testGrace;next[count++].localTest=true;}
    }
  }
  xSemaphoreTake(bleLock,portMAX_DELAY);
  bool changed=count!=bleDesiredCount;
  for(unsigned i=0;i<count&&!changed;i++)changed=String(next[i].address)!=bleDesired[i].address||next[i].grace!=bleDesired[i].grace||next[i].localTest!=bleDesired[i].localTest||next[i].trackingUntil!=bleDesired[i].trackingUntil;
  if(changed){for(unsigned i=0;i<count;i++)bleDesired[i]=next[i];bleDesiredCount=count;bleDesiredVersion++;}
  bleOverCapacity=overCapacity;bleConfigSource=source;bleConfigLoaded=true;
  xSemaphoreGive(bleLock);return true;
}
void bleLoadConfig(){
  Preferences preferences;String saved;
  if(preferences.begin("ble-presence",true)){saved=preferences.getString("config","");preferences.end();}
  JsonDocument cache;
  if(saved.length()&&!deserializeJson(cache,saved)&&cache["device_id"].as<String>()==DEVICE_ID){
    JsonDocument config;config.set(cache["config"]);if(bleApplyConfig(config,"cached"))return;
  }
  JsonDocument empty;empty["protocol"]="attendance-ble-v1";empty["tags"].to<JsonArray>();bleApplyConfig(empty,bleTestAddress.length()?"usb_test":"none");
}
bool bleSaveObservation(unsigned index,const char* state){
  time_t captured=utcNow();if(!captured)return false;
  JsonDocument event;String id=eventUuid();
  event["event_id"]=id;event["boot_id"]=bleBootId;event["device_id"]=DEVICE_ID;
  xSemaphoreTake(bleLock,portMAX_DELAY);
  event["tag_address"]=bleTargets[index].config.address;
  int rssi=bleTargets[index].rssi;
  xSemaphoreGive(bleLock);
  event["state"]=state;event["recorded_at"]=bleUtcTimestamp(captured);
  if(String(state)=="seen"&&rssi>=-127&&rssi<0)event["rssi"]=rssi;
  xSemaphoreTake(diskLock,portMAX_DELAY);
  bool room=diskReady&&bleQueued<BLE_QUEUE_LIMIT&&LittleFS.totalBytes()>LittleFS.usedBytes()+BLE_RESERVE_BYTES+1024;
  String temp="/blequeue/"+id+".tmp",path="/blequeue/"+id+".json";
  File file=room?LittleFS.open(temp,"w"):File();bool opened=static_cast<bool>(file);
  size_t expected=measureJson(event),written=file?serializeJson(event,file):0;
  if(file){file.flush();file.close();}
  bool ok=opened&&written==expected&&LittleFS.rename(temp,path);
  if(!ok&&diskReady)LittleFS.remove(temp);
  if(ok)bleQueued++;
  bleQueueFault=!ok;xSemaphoreGive(diskLock);
  return ok;
}
class AttendanceBleScanCallbacks:public NimBLEScanCallbacks {
  void onResult(const NimBLEAdvertisedDevice* device)override{
    String address=device->getAddress().toString().c_str();address.toUpperCase();
    xSemaphoreTake(bleLock,portMAX_DELAY);
    for(unsigned i=0;i<bleTargetCount;i++)if(address==bleTargets[i].config.address){
      bleTargets[i].observedAt=millis();bleTargets[i].rssi=device->getRSSI();
      bleTargets[i].addressType=device->getAddress().getType();bleTargets[i].advertised=true;break;
    }
    xSemaphoreGive(bleLock);
  }
};
AttendanceBleScanCallbacks bleScanCallbacks;

void bleWorker(void*){
  bleWorkerAt=millis();
  NimBLEDevice::setSecurityAuth(false,false,false); // Read-only standard services; no pairing or alert writes.
  NimBLEScan* scan=NimBLEDevice::getScan();
  scan->setScanCallbacks(&bleScanCallbacks,true);scan->setActiveScan(true);
  scan->setInterval(300);scan->setWindow(60);scan->setMaxResults(0); // Callbacks only; no nearby-device inventory retained.
  unsigned appliedVersion=UINT_MAX,scanFailures=0;unsigned long scanAttempt=0;
  for(;;){
    bleWorkerAt=millis();BleTargetConfig desired[BLE_MAX_TAGS];unsigned desiredCount=0,version=0;
    xSemaphoreTake(bleLock,portMAX_DELAY);
    desiredCount=bleDesiredCount;version=bleDesiredVersion;for(unsigned i=0;i<desiredCount;i++)desired[i]=bleDesired[i];
    xSemaphoreGive(bleLock);
    if(version!=appliedVersion){
      // Keep existing connections when only grace/config order changes. Never create an absence on reboot/config removal.
      for(unsigned i=0;i<bleTargetCount;i++){
        bool retained=false;for(unsigned j=0;j<desiredCount;j++)if(String(bleTargets[i].config.address)==desired[j].address)retained=true;
        if(!retained&&bleTargets[i].client){bleTargets[i].client->disconnect();NimBLEDevice::deleteClient(bleTargets[i].client);bleTargets[i].client=nullptr;}
      }
      xSemaphoreTake(bleLock,portMAX_DELAY);BleTarget previous[BLE_MAX_TAGS];unsigned previousCount=bleTargetCount;
      for(unsigned i=0;i<previousCount;i++)previous[i]=bleTargets[i];
      for(unsigned i=0;i<desiredCount;i++){
        bleTargets[i]=BleTarget{};
        for(unsigned j=0;j<previousCount;j++)if(String(previous[j].config.address)==desired[i].address)bleTargets[i]=previous[j];
        bleTargets[i].config=desired[i];
      }
      bleTargetCount=desiredCount;appliedVersion=version;xSemaphoreGive(bleLock);
    }
    unsigned long now=millis();
    if(!scan->isScanning()&&now-scanAttempt>=1000){
      scanAttempt=now;
      if(scan->start(0)){scanFailures=0;bleRadioReady=true;bleRadioError="";}
      else if(++scanFailures>=3){bleRadioReady=false;bleRadioError="scan_start_failed";}
    }
    for(unsigned i=0;i<bleTargetCount;i++){
      bleWorkerAt=millis();BleTarget& tag=bleTargets[i];NimBLEClient* client=tag.client;
      bool active=tag.config.localTest?(bleTestDuration&&millis()-bleTestStarted<bleTestDuration):
        (tag.config.trackingUntil&&utcNow()&&utcNow()<tag.config.trackingUntil);
      if(!active){
        if(client&&client->isConnected())client->disconnect();
        xSemaphoreTake(bleLock,portMAX_DELAY);tag.connected=false;tag.everSeen=false;tag.notSeenReported=false;tag.batteryCharacteristic=nullptr;xSemaphoreGive(bleLock);
        continue;
      }
      if(client&&client->isConnected()){
        if(millis()-tag.rssiAt>=5000){
          int rssi=client->getRssi();
          xSemaphoreTake(bleLock,portMAX_DELAY);tag.rssiAt=millis();tag.connected=true;
          if(rssi<0&&rssi>=-127){tag.rssi=rssi;tag.observedAt=millis();}
          tag.lastError=client->getLastError();xSemaphoreGive(bleLock);
        }
        if(tag.batteryCharacteristic&&millis()-tag.batteryAt>=30000){
          NimBLEAttValue value=tag.batteryCharacteristic->readValue();
          xSemaphoreTake(bleLock,portMAX_DELAY);tag.batteryAt=millis();
          if(value.size()==1&&value[0]<=100){tag.battery=value[0];tag.observedAt=millis();}
          xSemaphoreGive(bleLock);
        }
      }else{
        xSemaphoreTake(bleLock,portMAX_DELAY);tag.connected=false;tag.batteryCharacteristic=nullptr;xSemaphoreGive(bleLock);
        if(bleRadioReady&&millis()-tag.connectAt>=BLE_RETRY_MS){
          // A separate worker may wait here without blocking NFC, LCD, feedback or USB commands.
          tag.connectAt=millis();scan->stop();
          if(!client){client=NimBLEDevice::createClient();tag.client=client;}
          if(!client){bleRadioReady=false;bleRadioError="client_capacity_or_memory";continue;}
          client->setConnectTimeout(3000);client->setConnectionParams(24,48,0,100);
          uint8_t type=tag.advertised?tag.addressType:static_cast<uint8_t>((tag.connectAt/BLE_RETRY_MS)%2);
          bool connected=client->connect(NimBLEAddress(std::string(tag.config.address),type),true,false,false);
          xSemaphoreTake(bleLock,portMAX_DELAY);tag.connected=connected;tag.lastError=client->getLastError();xSemaphoreGive(bleLock);
          if(connected){
            int rssi=client->getRssi();
            xSemaphoreTake(bleLock,portMAX_DELAY);tag.rssi=rssi;tag.observedAt=millis();tag.rssiAt=millis();xSemaphoreGive(bleLock);
            // Discover/read only the standard battery service; never activate Immediate Alert/vendor controls.
            NimBLERemoteService* service=client->getService(NimBLEUUID(static_cast<uint16_t>(0x180F)));
            NimBLERemoteCharacteristic* battery=service?service->getCharacteristic(NimBLEUUID(static_cast<uint16_t>(0x2A19))):nullptr;
            tag.batteryCharacteristic=battery&&battery->canRead()?battery:nullptr;tag.batteryAt=millis()-30000;
            Serial.printf("BLE own configured tag %s connected.\n",tag.config.address);
          }
          scanAttempt=0;
          if(!scan->isScanning()){if(scan->start(0)){scanFailures=0;bleRadioReady=true;bleRadioError="";}else if(++scanFailures>=3){bleRadioReady=false;bleRadioError="scan_start_failed";}}
        }
      }
      now=millis();bool recent=false,everSeen=false,notSeenReported=false;unsigned long observedAt,eventAt;unsigned grace;
      xSemaphoreTake(bleLock,portMAX_DELAY);
      observedAt=tag.observedAt;eventAt=tag.eventAt;everSeen=tag.everSeen;notSeenReported=tag.notSeenReported;grace=tag.config.grace;
      recent=observedAt&&now-observedAt<10000;xSemaphoreGive(bleLock);
      if(recent&&utcNow()&&(!everSeen||notSeenReported||now-eventAt>=BLE_REPORT_MS)){
        if(bleSaveObservation(i,"seen")){xSemaphoreTake(bleLock,portMAX_DELAY);tag.everSeen=true;tag.notSeenReported=false;tag.eventAt=now;xSemaphoreGive(bleLock);}
      }else if(everSeen&&!recent&&now-observedAt>=grace*1000UL&&bleHealthy()&&(!notSeenReported||now-eventAt>=BLE_REPORT_MS)){
        if(bleSaveObservation(i,"not_seen")){xSemaphoreTake(bleLock,portMAX_DELAY);tag.notSeenReported=true;tag.eventAt=now;xSemaphoreGive(bleLock);}
      }
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}
void bleBegin(){
  bleLock=xSemaphoreCreateMutex();bleBootId=eventUuid();bleLoadConfig();
  xSemaphoreTake(diskLock,portMAX_DELAY);
  if(diskReady){LittleFS.mkdir("/blequeue");File directory=LittleFS.open("/blequeue");
    if(directory){File file=directory.openNextFile();while(file){
      if(String(file.name()).endsWith(".json")){
        JsonDocument event;
        if(!deserializeJson(event,file)&&event["device_id"].as<String>()==DEVICE_ID)bleQueued++;
        else bleForeignQueued++;
      }
      file.close();file=directory.openNextFile();
    }directory.close();}
  }
  xSemaphoreGive(diskLock);
  // Initialization is synchronous so the uploader cannot allocate TLS while the controller is starting.
  if(!NimBLEDevice::init("Attendance BLE reader")){bleRadioReady=false;bleRadioError="initialization_failed";return;}
  if(xTaskCreatePinnedToCore(bleWorker,"ble-presence",8192,nullptr,1,&bleWorkerHandle,1)!=pdPASS){bleRadioReady=false;bleRadioError="worker_creation_failed";}
}
void bleWriteStatus(JsonDocument& status){
  status["ble_enabled"]=true;status["ble_mode"]="experimental";status["ble_max_connections"]=BLE_MAX_TAGS;
  status["ble_receiver_state"]=bleHealthy()?"ready":"fault";status["ble_queue_fault"]=bleQueueFault;
  status["ble_queued_events"]=bleQueued;status["ble_retained_other_device_events"]=bleForeignQueued;
  status["ble_last_http_code"]=bleLastHttpCode;
  if(bleLastAckAt)status["ble_last_ack_age_ms"]=millis()-bleLastAckAt;else status["ble_last_ack_age_ms"]=nullptr;
  status["ble_worker_age_ms"]=bleWorkerAt?millis()-bleWorkerAt:0;status["ble_radio_error"]=bleRadioError;
  status["ble_boot_id"]=bleBootId;status["ble_config_over_capacity"]=bleOverCapacity;
  if(bleWorkerHandle)status["ble_worker_free_stack_bytes"]=uxTaskGetStackHighWaterMark(bleWorkerHandle);
  xSemaphoreTake(bleLock,portMAX_DELAY);status["ble_config_source"]=bleConfigSource;JsonArray tags=status["ble_tags"].to<JsonArray>();
  for(unsigned i=0;i<bleTargetCount;i++){
    const BleTarget& tag=bleTargets[i];JsonObject entry=tags.add<JsonObject>();
    entry["address"]=tag.config.address;entry["experimental_usb_target"]=tag.config.localTest;entry["connected"]=tag.connected;
    entry["state"]=!bleHealthy()?"unknown":!tag.everSeen?"unknown":tag.notSeenReported?"not_seen":"seen";
    entry["grace_seconds"]=tag.config.grace;entry["last_error"]=tag.lastError;
    if(tag.config.trackingUntil)entry["tracking_until"]=bleUtcTimestamp(tag.config.trackingUntil);
    if(tag.config.localTest)entry["test_remaining_seconds"]=millis()-bleTestStarted<bleTestDuration?(bleTestDuration-(millis()-bleTestStarted))/1000:0;
    if(tag.observedAt)entry["last_observed_age_ms"]=millis()-tag.observedAt;else entry["last_observed_age_ms"]=nullptr;
    if(tag.rssi<0)entry["rssi_dbm"]=tag.rssi;else entry["rssi_dbm"]=nullptr;
    if(tag.battery>=0)entry["battery_percent"]=tag.battery;else entry["battery_percent"]=nullptr;
  }
  xSemaphoreGive(bleLock);
}
bool bleHandleCommand(JsonDocument& request,JsonDocument& response){
  if(request["command"]!="ble_test_config")return false;
  response["command"]="ble_test_config";response["ok"]=false;
  if(request["device_id"].as<String>()!=DEVICE_ID){response["error"]="wrong_reader";return true;}
  bool enabled=request["enabled"]|true;String address=request["address"]|"";address.toUpperCase();unsigned grace=request["grace_seconds"]|90;
  if(enabled&&(!bleValidAddress(address)||grace<5||grace>1800)){response["error"]="invalid_test_target";return true;}
  unsigned duration=request["duration_seconds"]|1800;
  if(enabled&&(duration<30||duration>1800)){response["error"]="invalid_test_duration";return true;}
  // Explicit physical diagnostics expire within thirty minutes and never survive a restart.
  xSemaphoreTake(bleLock,portMAX_DELAY);bleTestAddress=enabled?address:"";bleTestGrace=grace;
  bleTestStarted=millis();bleTestDuration=enabled?duration*1000UL:0;xSemaphoreGive(bleLock);bleLoadConfig();
  response["ok"]=true;response["experimental"]=true;response["enabled"]=enabled;response["expires_in_seconds"]=enabled?duration:0;return true;
}
void bleRefreshConfig(){
  String endpoint=bleEndpoint("/api/ble/config");if(!endpoint.length())return;
  WiFiClientSecure tls;tls.setCACert(TRUSTED_ROOTS);tls.setHandshakeTimeout(10);
  HTTPClient http;http.setReuse(false);http.setConnectTimeout(8000);http.setTimeout(8000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if(!http.begin(tls,endpoint+"?device_id="+DEVICE_ID))return;
  http.addHeader("Authorization",String("Bearer ")+DEVICE_TOKEN);int code=http.GET();
  if(code==200){JsonDocument config;if(!deserializeJson(config,http.getString())&&bleApplyConfig(config,"server"))bleCacheConfig(config);}
  http.end();
}
void bleUploadObservations(){
  String endpoint=bleEndpoint("/api/ble/events");if(!endpoint.length())return;
  JsonDocument request;request["device_id"]=DEVICE_ID;request["receiver_state"]=bleHealthy()?"ready":"fault";
  request["boot_id"]=bleBootId;request["heartbeat_at"]=bleUtcTimestamp(utcNow());JsonArray events=request["events"].to<JsonArray>();
  xSemaphoreTake(diskLock,portMAX_DELAY);File directory=diskReady?LittleFS.open("/blequeue"):File();
  if(directory){File file=directory.openNextFile();while(file&&events.size()<20){
    if(String(file.name()).endsWith(".json")){
      JsonDocument event;
      if(!deserializeJson(event,file)&&event["device_id"].as<String>()==DEVICE_ID){event.remove("device_id");events.add(event.as<JsonObject>());}
    }
    file.close();file=directory.openNextFile();
  }directory.close();}
  xSemaphoreGive(diskLock);
  WiFiClientSecure tls;tls.setCACert(TRUSTED_ROOTS);tls.setHandshakeTimeout(10);
  HTTPClient http;http.setReuse(false);http.setConnectTimeout(8000);http.setTimeout(8000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if(!http.begin(tls,endpoint))return;
  http.addHeader("Content-Type","application/json");http.addHeader("Authorization",String("Bearer ")+DEVICE_TOKEN);
  String body;serializeJson(request,body);int code=http.POST(body);bleLastHttpCode=code;
  if(code==200){JsonDocument response;if(!deserializeJson(response,http.getString())&&response["acknowledged"].is<JsonArray>()){
    xSemaphoreTake(diskLock,portMAX_DELAY);
    for(JsonObject ack:response["acknowledged"].as<JsonArray>()){
      String id=ack["event_id"]|"",status=ack["status"]|"";bool sent=false;
      for(JsonObject event:events)if(event["event_id"].as<String>()==id)sent=true;
      if(sent&&id.length()==36&&(status=="accepted"||status=="unknown_tag"||status=="outside_session")&&LittleFS.remove("/blequeue/"+id+".json")){if(bleQueued)bleQueued--;}
    }
    if(diskReady&&bleQueued<BLE_QUEUE_LIMIT&&LittleFS.totalBytes()>LittleFS.usedBytes()+BLE_RESERVE_BYTES+1024)bleQueueFault=false;
    xSemaphoreGive(diskLock);bleLastAckAt=millis();
  }}
  http.end(); // Missing/invalid ACK always retains the original captured event.
}
void bleNetworkCycle(){
  if(!utcNow()||strlen(DEVICE_ID)!=36||strlen(DEVICE_TOKEN)!=43)return;
  unsigned long now=millis();
  if(!bleConfigAt||now-bleConfigAt>=BLE_CONFIG_MS){bleConfigAt=now;bleRefreshConfig();}
  now=millis();
  if(!bleNetworkAt||now-bleNetworkAt>=BLE_REPORT_MS||(bleQueued&&now-bleNetworkAt>=5000)){
    bleNetworkAt=now;bleUploadObservations();
  }
}
