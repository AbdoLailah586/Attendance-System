#pragma once
// Copy to attendance-config.h, fill locally, and never commit real credentials.
// Firmware 1.2.0: USB Wi-Fi settings saved in NVS override these boot defaults.
static const char* WIFI_SSID = "SHOP_WIFI_2_4_GHZ";
static const char* WIFI_PASSWORD = "REPLACE_LOCALLY";
static const char* DEVICE_ID = "REPLACE_FROM_ADMIN";
static const char* DEVICE_TOKEN = "REPLACE_FROM_ADMIN";
static const char* API_URL = "https://attendance-system-joe-2026.vercel.app/api/nfc/events";
// RC522: 3V3, GND, SS=21, RST=22, SCK=18, MISO=19, MOSI=23.
// LCD_MODE: 0=none, 1=I2C, 2=parallel. See MANUAL-SETUP.md for safe voltage wiring.
#ifndef LCD_MODE
#define LCD_MODE 1
#endif
#define LCD_I2C_ADDRESS 0x27
constexpr int STATUS_LED = 2;
