#pragma once
#include <Wire.h>
// 0: no LCD, 1: PCF8574 I2C backpack, 2: HD44780 parallel (RW grounded).
#ifndef LCD_MODE
#define LCD_MODE 0
#endif
#ifndef LCD_I2C_ADDRESS
#define LCD_I2C_ADDRESS 0x27
#endif
// I2C pins avoid RC522's SS=21 and RST=22.
constexpr int LCD_SDA=16,LCD_SCL=17;
constexpr int LCD_RS=16,LCD_E=17,LCD_D4=25,LCD_D5=26,LCD_D6=27,LCD_D7=32;
bool lcdReady=false;
void lcdNibble(uint8_t nibble,bool data){
#if LCD_MODE == 1
  // Common backpack: P0 RS, P1 RW, P2 E, P3 backlight, P4..7 D4..7.
  uint8_t value=(nibble<<4)|8|(data?1:0);
  Wire.beginTransmission(LCD_I2C_ADDRESS);Wire.write(value);Wire.write(value|4);Wire.write(value);Wire.endTransmission();
#elif LCD_MODE == 2
  digitalWrite(LCD_RS,data);digitalWrite(LCD_D4,nibble&1);digitalWrite(LCD_D5,nibble&2);digitalWrite(LCD_D6,nibble&4);digitalWrite(LCD_D7,nibble&8);
  digitalWrite(LCD_E,HIGH);delayMicroseconds(1);digitalWrite(LCD_E,LOW);
#endif
  delayMicroseconds(60);
}
void lcdByte(uint8_t value,bool data=false){lcdNibble(value>>4,data);lcdNibble(value&15,data);}
void lcdBegin(){
#if LCD_MODE == 1
  Wire.begin(LCD_SDA,LCD_SCL);Wire.setClock(100000);Wire.beginTransmission(LCD_I2C_ADDRESS);
  if(Wire.endTransmission()!=0){Serial.println("LCD I2C not found; check address, wiring and level converter.");return;}
#elif LCD_MODE == 2
  for(int pin:{LCD_RS,LCD_E,LCD_D4,LCD_D5,LCD_D6,LCD_D7})pinMode(pin,OUTPUT);
#else
  return;
#endif
  delay(50);lcdNibble(3,false);delay(5);lcdNibble(3,false);delay(1);lcdNibble(3,false);lcdNibble(2,false);
  lcdByte(0x28);lcdByte(0x0C);lcdByte(0x06);lcdByte(0x01);delay(2);lcdReady=true;
}
void lcdLine(int row,const String& text){
  if(!lcdReady)return;lcdByte(row?0xC0:0x80);
  for(int i=0;i<16;i++){char c=i<(int)text.length()?text[i]:' ';lcdByte(c>=32&&c<127?c:'?',true);}
}
void lcdShow(const String& name,const String& action){lcdLine(0,name);lcdLine(1,action);}
