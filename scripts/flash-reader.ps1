param(
  [Parameter(Mandatory=$true)][ValidateSet('branch1','branch2')][string]$Branch,
  [Parameter(Mandatory=$true)][ValidatePattern('^COM[0-9]+$')][string]$Port,
  [ValidateSet('i2c','parallel')][string]$Lcd='i2c'
)
$ErrorActionPreference='Stop'
$taskRepoRoot=Split-Path -Parent $PSScriptRoot
$taskPrivateConfig=Join-Path $env:LOCALAPPDATA "JoeStore\Attendance\ReaderConfigs\$Branch.h"
if(!(Test-Path -LiteralPath $taskPrivateConfig)){throw 'Private reader configuration missing; provision the reader from the admin panel first.'}
$taskConfigText=Get-Content -LiteralPath $taskPrivateConfig -Raw
if($taskConfigText -match 'SHOP_WIFI_2_4_GHZ|REPLACE_LOCALLY|REPLACE_FROM_ADMIN'){throw 'Fill Wi-Fi SSID/password and reader credentials in the private config first. Never publish this file.'}
$taskLcdMode=if($Lcd -eq 'i2c'){1}else{2}
$taskConfigText=$taskConfigText -replace '(?m)^#define LCD_MODE\s+\d+\s*$',"#define LCD_MODE $taskLcdMode"
$taskConfigText+="`n#ifndef LCD_MODE`n#define LCD_MODE $taskLcdMode`n#endif`n"
$taskConfigTarget=Join-Path $taskRepoRoot 'firmware\esp32-reader\include\attendance-config.h'
[IO.File]::WriteAllText($taskConfigTarget,$taskConfigText,[Text.UTF8Encoding]::new($false))
$taskPython=Join-Path $taskRepoRoot '.tools\pio-runtime\Scripts\python.exe'
if(!(Test-Path -LiteralPath $taskPython)){throw 'PlatformIO runtime missing. Install PlatformIO in VS Code or restore the project runtime.'}
$taskEnvironment=if($Lcd -eq 'i2c'){'esp32dev'}else{'esp32-parallel'}
& $taskPython -m platformio run -d (Join-Path $taskRepoRoot 'firmware\esp32-reader') -e $taskEnvironment -t upload --upload-port $Port
if($LASTEXITCODE -ne 0){throw 'Upload failed. Check the USB data cable, COM port and BOOT button.'}
Write-Host 'Upload completed. Open the serial monitor at 115200 baud. Do not format a device with queued events.'
