#pragma once
// Copy to attendance-config.h, fill locally, and never commit real credentials.
// Firmware 1.4.0: USB Wi-Fi settings saved in NVS override these boot defaults.
static const char* WIFI_SSID = "SHOP_WIFI_2_4_GHZ";
static const char* WIFI_PASSWORD = "REPLACE_LOCALLY";
static const char* DEVICE_ID = "REPLACE_FROM_ADMIN";
static const char* DEVICE_TOKEN = "REPLACE_FROM_ADMIN";
static const char* API_URL = "https://attendance-system-joe-2026.vercel.app/api/nfc/events";
// RC522: 3V3, GND, SS=21, RST=22, SCK=18, MISO=19, MOSI=23.
constexpr int STATUS_LED = 2;
// External indicators: green=13, red=14, yellow=33; buzzer driver signal=4.
// LCD removed; NFC results use the indicators and serial diagnostics.
#ifndef FEEDBACK_ARRIVAL_IS_RED
#define FEEDBACK_ARRIVAL_IS_RED 0 // 0: green arrival/red departure; 1: reverse.
#endif
#ifndef BUZZER_PASSIVE
#define BUZZER_PASSIVE 0 // 0: active buzzer through NPN; 1: passive at 2 kHz through NPN.
#endif
