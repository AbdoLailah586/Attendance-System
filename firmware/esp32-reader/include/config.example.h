#pragma once
// Copy to config.h, fill locally, and never commit real credentials.
static const char* WIFI_SSID = "SHOP_WIFI_2_4_GHZ";
static const char* WIFI_PASSWORD = "REPLACE_LOCALLY";
static const char* DEVICE_ID = "REPLACE_FROM_ADMIN";
static const char* DEVICE_TOKEN = "REPLACE_FROM_ADMIN";
static const char* API_URL = "https://attendance-system-joe-2026.vercel.app/api/nfc/events";
// RDM6300 TX -> 1k resistor -> GPIO16; GPIO16 -> 2k resistor -> GND.
constexpr int RFID_RX = 16;
constexpr int RTC_SDA = 21;
constexpr int RTC_SCL = 22;
constexpr int STATUS_LED = 2;

