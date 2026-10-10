param(
  [Parameter(Mandatory=$true)][ValidateSet('branch1','branch2')][string]$Branch,
  [Parameter(Mandatory=$true)][ValidatePattern('^COM[0-9]+$')][string]$Port,
  [ValidateSet('active','passive')][string]$Buzzer,
  [ValidateSet('green','red')][string]$ArrivalLed
)
$ErrorActionPreference='Stop'
$taskRepoRoot=Split-Path -Parent $PSScriptRoot
$taskPrivateConfig=Join-Path $env:LOCALAPPDATA "JoeStore\Attendance\ReaderConfigs\$Branch.h"
if(!(Test-Path -LiteralPath $taskPrivateConfig)){throw 'Private reader configuration missing; provision the reader from the admin panel first.'}
$taskConfigText=Get-Content -LiteralPath $taskPrivateConfig -Raw
if($taskConfigText -match 'SHOP_WIFI_2_4_GHZ|REPLACE_LOCALLY|REPLACE_FROM_ADMIN'){throw 'Fill Wi-Fi SSID/password and reader credentials in the private config first. Never publish this file.'}
foreach($taskHardwareOption in @(
  @{name='BUZZER_PASSIVE';selected=($null -ne $Buzzer -and $Buzzer -ne '');value=([int]($Buzzer -eq 'passive'))},
  @{name='FEEDBACK_ARRIVAL_IS_RED';selected=($null -ne $ArrivalLed -and $ArrivalLed -ne '');value=([int]($ArrivalLed -eq 'red'))}
)){
  if(!$taskHardwareOption.selected){continue}
  $taskHardwarePattern='(?m)^#define '+$taskHardwareOption.name+'\s+\d+[^\r\n]*'
  $taskHardwareLine='#define '+$taskHardwareOption.name+' '+$taskHardwareOption.value
  if([regex]::IsMatch($taskConfigText,$taskHardwarePattern)){$taskConfigText=[regex]::Replace($taskConfigText,$taskHardwarePattern,$taskHardwareLine)}
  else{$taskConfigText+="`n$taskHardwareLine`n"}
}
if($Buzzer -or $ArrivalLed){[IO.File]::WriteAllText($taskPrivateConfig,$taskConfigText,[Text.UTF8Encoding]::new($false))}
$taskConfigTarget=Join-Path $taskRepoRoot 'firmware\esp32-reader\include\attendance-config.h'
[IO.File]::WriteAllText($taskConfigTarget,$taskConfigText,[Text.UTF8Encoding]::new($false))
$taskPython=Join-Path $taskRepoRoot '.tools\pio-runtime\Scripts\python.exe'
if(!(Test-Path -LiteralPath $taskPython)){throw 'PlatformIO runtime missing. Install PlatformIO in VS Code or restore the project runtime.'}
& $taskPython -m platformio run -d (Join-Path $taskRepoRoot 'firmware\esp32-reader') -e esp32dev -t upload --upload-port $Port
if($LASTEXITCODE -ne 0){throw 'Upload failed. Check the USB data cable, COM port and BOOT button.'}
Write-Host 'Upload completed. Open the serial monitor at 115200 baud. Do not format a device with queued events.'
