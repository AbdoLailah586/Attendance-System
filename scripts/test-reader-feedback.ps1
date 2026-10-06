param([ValidateSet('branch1','branch2')][string]$Branch)
$ErrorActionPreference='Stop'
$taskRepoRoot=Split-Path -Parent $PSScriptRoot
$taskPython=Join-Path $taskRepoRoot '.tools\pio-runtime\Scripts\python.exe'
if(!$Branch){
  $taskChoice=Read-Host 'Choose reader: 1 = basic branch, 2 = wholesale'
  $Branch=switch($taskChoice){'1'{'branch1'}'2'{'branch2'}default{throw 'Select 1 or 2.'}}
}
$taskPorts=@((& $taskPython -c 'import serial.tools.list_ports; print("\n".join(p.device for p in serial.tools.list_ports.comports() if p.vid is not None))') | Where-Object {$_ -match '^COM\d+$'})
if($taskPorts.Count -ne 1){throw 'Connect one ESP32 by USB and close Serial Monitor.'}
$taskConfigPath=Join-Path $env:LOCALAPPDATA "JoeStore\Attendance\ReaderConfigs\$Branch.h"
$taskConfig=[IO.File]::ReadAllText($taskConfigPath)
$taskIdentity=[regex]::Match($taskConfig,'DEVICE_ID = "([^"]+)"').Groups[1].Value
if(!$taskIdentity){throw 'Reader identity missing.'}
Write-Host 'Watch green, yellow and red LEDs, with one short beep at each step. No attendance events are created.'
& $taskPython (Join-Path $PSScriptRoot 'reader-usb.py') --port $taskPorts[0] --expected-device $taskIdentity --test-feedback
if($LASTEXITCODE -ne 0){throw 'Feedback test failed; firmware 1.3.0 and the correct wiring are required.'}
Write-Host 'Output sequence finished. Confirm the actual lights and sound on the device.'
