#pragma once
#include <Arduino.h>

// These pins are free with BOTH LCD wiring modes and RC522's SPI wiring.
#ifndef FEEDBACK_ENABLED
#define FEEDBACK_ENABLED 1
#endif
#ifndef FEEDBACK_ARRIVAL_IS_RED
#define FEEDBACK_ARRIVAL_IS_RED 0
#endif
#ifndef BUZZER_PASSIVE
#define BUZZER_PASSIVE 0
#endif
constexpr int FEEDBACK_GREEN=13,FEEDBACK_RED=14,FEEDBACK_YELLOW=33,FEEDBACK_BUZZER=4;
constexpr int FEEDBACK_BUZZER_CHANNEL=7;
enum class FeedbackResult:uint8_t {None,Waiting,Arrival,Refresh,Departure,AlreadyOut,Review};
FeedbackResult feedbackResult=FeedbackResult::None;
unsigned long feedbackStarted=0,buzzerStarted=0,feedbackTestStarted=0;
bool buzzerRunning=false,feedbackTesting=false;
uint8_t feedbackTestStep=0;

void feedbackSetBuzzer(bool enabled){
#if FEEDBACK_ENABLED
#if BUZZER_PASSIVE
  ledcWrite(FEEDBACK_BUZZER_CHANNEL,enabled?128:0);
#else
  digitalWrite(FEEDBACK_BUZZER,enabled?HIGH:LOW); // Via NPN driver, not the buzzer load itself.
#endif
#endif
}
void feedbackSetLeds(bool green,bool yellow,bool red){
#if FEEDBACK_ENABLED
  digitalWrite(FEEDBACK_GREEN,green);digitalWrite(FEEDBACK_YELLOW,yellow);digitalWrite(FEEDBACK_RED,red);
#endif
}
void feedbackBeep(){buzzerStarted=millis();buzzerRunning=true;feedbackSetBuzzer(true);}
void feedbackBegin(){
#if FEEDBACK_ENABLED
  for(int pin:{FEEDBACK_GREEN,FEEDBACK_YELLOW,FEEDBACK_RED,FEEDBACK_BUZZER}){digitalWrite(pin,LOW);pinMode(pin,OUTPUT);}
#if BUZZER_PASSIVE
  ledcSetup(FEEDBACK_BUZZER_CHANNEL,2000,8);ledcAttachPin(FEEDBACK_BUZZER,FEEDBACK_BUZZER_CHANNEL);
#endif
#endif
  feedbackSetLeds(false,false,false);feedbackSetBuzzer(false);
}
void feedbackShow(FeedbackResult result){
  feedbackTesting=false;feedbackResult=result;feedbackStarted=millis();
}
void feedbackCardRead(){feedbackShow(FeedbackResult::Waiting);feedbackBeep();}
void feedbackStartTest(){
  feedbackResult=FeedbackResult::None;feedbackTesting=true;feedbackTestStarted=millis();feedbackTestStep=0;
  feedbackSetLeds(true,false,false);feedbackBeep();
}
void feedbackTick(unsigned long now){
  if(buzzerRunning&&now-buzzerStarted>=90){buzzerRunning=false;feedbackSetBuzzer(false);}
  if(feedbackTesting){
    unsigned elapsed=now-feedbackTestStarted;
    if(elapsed>=3600){feedbackTesting=false;feedbackSetLeds(false,false,false);return;}
    uint8_t step=elapsed/1200;
    if(step!=feedbackTestStep){feedbackTestStep=step;feedbackBeep();}
    feedbackSetLeds(step==0,step==1,step==2);return;
  }
  unsigned elapsed=now-feedbackStarted;
  if(feedbackResult==FeedbackResult::Waiting){feedbackSetLeds(false,(elapsed/250)%2==0,false);return;}
  if(feedbackResult==FeedbackResult::Review){
    if(elapsed<3000){feedbackSetLeds(false,false,(elapsed/200)%2==0);return;}
  }else if(feedbackResult!=FeedbackResult::None&&elapsed<2000){
    bool arrival=feedbackResult==FeedbackResult::Arrival;
    bool departure=feedbackResult==FeedbackResult::Departure||feedbackResult==FeedbackResult::AlreadyOut;
    feedbackSetLeds(FEEDBACK_ARRIVAL_IS_RED?departure:arrival,feedbackResult==FeedbackResult::Refresh,FEEDBACK_ARRIVAL_IS_RED?arrival:departure);return;
  }
  feedbackResult=FeedbackResult::None;feedbackSetLeds(false,false,false);
}
