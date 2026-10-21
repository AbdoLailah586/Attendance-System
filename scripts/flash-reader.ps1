param(
  [Parameter(Mandatory=$true)][ValidateSet('branch1','branch2')][string]$Branch,
  [ValidatePattern('^COM[0-9]+$')][string]$Port,
  [ValidateSet('active','passive')][string]$Buzzer,
  [ValidateSet('green','red')][string]$ArrivalLed
)
$ErrorActionPreference='Stop'
$taskRepoRoot=Split-Path -Parent $PSScriptRoot
Write-Host '[1/7] Checking project PlatformIO runtime...'
$taskPython=Join-Path $taskRepoRoot '.tools\pio-runtime\Scripts\python.exe'
if(!(Test-Path -LiteralPath $taskPython)){throw 'PlatformIO runtime missing. Install PlatformIO in VS Code or restore the project runtime.'}
Write-Host '[2/7] Checking private reader configuration...'
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
Write-Host '[3/7] Writing reader configuration into firmware source...'
if($Buzzer -or $ArrivalLed){[IO.File]::WriteAllText($taskPrivateConfig,$taskConfigText,[Text.UTF8Encoding]::new($false))}
$taskConfigTarget=Join-Path $taskRepoRoot 'firmware\esp32-reader\include\attendance-config.h'
[IO.File]::WriteAllText($taskConfigTarget,$taskConfigText,[Text.UTF8Encoding]::new($false))

function Get-TaskEsp32Ports(){
  # Only ports exposed by a real USB device (a VID) are candidates; virtual/Bluetooth
  # COM ports report no VID and are never the ESP32's USB-UART bridge.
  $taskListing=& $taskPython -c 'import serial.tools.list_ports,json
print(json.dumps([{"device":p.device,"description":p.description,"vid":p.vid,"pid":p.pid} for p in serial.tools.list_ports.comports() if p.vid is not None]))'
  if($LASTEXITCODE -ne 0){throw 'Could not list serial ports (pyserial missing from the project runtime?).'}
  return ,(@($taskListing | ConvertFrom-Json))
}

Write-Host '[4/7] Detecting the ESP32 reader on USB...'
if($Port){
  Write-Host "Using the port you specified: $Port"
}else{
  $taskCandidates=Get-TaskEsp32Ports
  if($taskCandidates.Count -eq 0){throw 'No USB-serial device detected. Plug in a USB DATA cable (not charge-only), install the CP210x or CH340 driver, and try again.'}
  if($taskCandidates.Count -gt 1){
    $taskList=($taskCandidates | ForEach-Object{"  $($_.device): $($_.description)"}) -join "`n"
    throw "More than one USB-serial device is connected; the reader cannot be identified safely:`n$taskList`nDisconnect every other USB-serial device (keep only the one reader you are flashing) and try again, or pass -Port explicitly."
  }
  $Port=$taskCandidates[0].device
  Write-Host "Auto-detected reader on $Port ($($taskCandidates[0].description))"
}

Write-Host '[5/7] Checking the port is free (not held by Serial Monitor or another tool)...'
$taskPortBusy=& $taskPython -c "import serial,sys
try:
    s=serial.Serial('$Port')
    s.close()
except Exception as error:
    print(str(error)); sys.exit(1)
sys.exit(0)"
if($LASTEXITCODE -ne 0){throw "Cannot open $Port; it looks busy or inaccessible. Close Serial Monitor/other serial tools and retry. ($taskPortBusy)"}

Write-Host '[6/7] Building and uploading firmware...'
& $taskPython -m platformio run -d (Join-Path $taskRepoRoot 'firmware\esp32-reader') -e esp32dev -t upload --upload-port $Port
if($LASTEXITCODE -ne 0){throw 'Upload failed. Check the USB data cable, COM port and BOOT button (hold BOOT while "Connecting..." shows, release once transfer starts).'}

Write-Host '[7/7] Verifying the reader boots the new firmware...'
Start-Sleep -Seconds 2
$taskOldEncoding=$OutputEncoding
try{
  $OutputEncoding=[Text.UTF8Encoding]::new($false)
  $taskStatusJson=& $taskPython (Join-Path $PSScriptRoot 'reader-usb.py') --port $Port
  $taskStatusExit=$LASTEXITCODE
}finally{$OutputEncoding=$taskOldEncoding}
if($taskStatusExit -ne 0){
  Write-Warning 'Upload succeeded, but the reader did not answer --status afterward (see the message above, if any).'
  Write-Warning 'This can still be normal right after a reboot. Open the serial monitor at 115200 baud to confirm manually.'
}else{
  $taskStatus=$taskStatusJson | ConvertFrom-Json
  Write-Host "Reader is alive: firmware $($taskStatus.firmware), device_id $($taskStatus.device_id), wifi_connected=$($taskStatus.wifi_connected), clock_ready=$($taskStatus.clock_ready)"
  if(-not $taskStatus.wifi_connected){Write-Warning 'Wi-Fi is not connected yet. Give it a few seconds, or re-check the SSID/password with configure-readers.ps1.'}
}
Write-Host 'Done. Do not format a device with queued events.'
