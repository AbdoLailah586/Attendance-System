param(
  [ValidateSet('Update','Collect')][string]$Mode='Update',
  [string]$ResultPath
)
$ErrorActionPreference='Stop'
$taskRepoRoot=Split-Path -Parent $PSScriptRoot
$taskPrivateRoot=Join-Path $env:LOCALAPPDATA 'JoeStore\Attendance\ReaderConfigs'
if($Mode -eq 'Collect' -and !$ResultPath){$ResultPath=Join-Path $taskPrivateRoot 'setup-result-latest.json'}
$taskPython=Join-Path $taskRepoRoot '.tools\pio-runtime\Scripts\python.exe'
if(!(Test-Path -LiteralPath $taskPython)){throw 'Project Python runtime missing.'}
function ConvertTo-TaskCppString([string]$Value){
  $taskLiteralBuilder=[Text.StringBuilder]::new();[void]$taskLiteralBuilder.Append('"')
  foreach($taskByte in [Text.Encoding]::UTF8.GetBytes($Value)){
    if($taskByte -eq 34){[void]$taskLiteralBuilder.Append('\"')}
    elseif($taskByte -eq 92){[void]$taskLiteralBuilder.Append('\\')}
    elseif($taskByte -ge 32 -and $taskByte -le 126){[void]$taskLiteralBuilder.Append([char]$taskByte)}
    else{[void]$taskLiteralBuilder.Append('\'+[Convert]::ToString($taskByte,8).PadLeft(3,'0'))}
  }
  [void]$taskLiteralBuilder.Append('"');return $taskLiteralBuilder.ToString()
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$taskDialog=New-Object Windows.Forms.Form
$taskDialog.Text='JoeStore - Reader Wi-Fi setup'
$taskDialog.Size=New-Object Drawing.Size(580,470)
$taskDialog.StartPosition='CenterScreen'
$taskDialog.FormBorderStyle='FixedDialog'
$taskDialog.MaximizeBox=$false
$taskDialog.TopMost=$true
function Add-TaskLabel([string]$Text,[int]$Top){
  $taskLabel=New-Object Windows.Forms.Label
  $taskLabel.Text=$Text;$taskLabel.Location=New-Object Drawing.Point(20,$Top);$taskLabel.Size=New-Object Drawing.Size(530,24)
  $taskDialog.Controls.Add($taskLabel)
}
function Add-TaskInput([int]$Top,[bool]$Secret=$false){
  $taskInput=New-Object Windows.Forms.TextBox
  $taskInput.Location=New-Object Drawing.Point(20,$Top);$taskInput.Size=New-Object Drawing.Size(525,25)
  $taskInput.UseSystemPasswordChar=$Secret;$taskDialog.Controls.Add($taskInput);return $taskInput
}
Add-TaskLabel 'Select branch (basic / wholesale), or save settings for both.' 15
$taskBranch=New-Object Windows.Forms.ComboBox
$taskBranch.DropDownStyle='DropDownList';$taskBranch.Location=New-Object Drawing.Point(20,40);$taskBranch.Width=525
[void]$taskBranch.Items.AddRange(@('branch1 - Basic','branch2 - Wholesale','Both branches'))
$taskBranch.SelectedIndex=0;$taskDialog.Controls.Add($taskBranch)
Add-TaskLabel 'Basic branch: Wi-Fi name (SSID), 2.4 GHz' 80
$taskSsid1=Add-TaskInput 105
Add-TaskLabel 'Basic branch: Wi-Fi password (leave empty for an open network)' 140
$taskPassword1=Add-TaskInput 165 $true
Add-TaskLabel 'Wholesale branch: Wi-Fi name (SSID), 2.4 GHz' 200
$taskSsid2=Add-TaskInput 225
Add-TaskLabel 'Wholesale branch: Wi-Fi password' 260
$taskPassword2=Add-TaskInput 285 $true
Add-TaskLabel 'Passwords stay on this PC and the ESP32. Connect one reader by USB.' 320
$taskSubmit=New-Object Windows.Forms.Button
$taskSubmit.Text=if($Mode -eq 'Collect'){'Save settings for first upload'}else{'Save and update connected reader'}
$taskSubmit.Location=New-Object Drawing.Point(20,355);$taskSubmit.Size=New-Object Drawing.Size(350,35)
$taskDialog.Controls.Add($taskSubmit)
$taskCancel=New-Object Windows.Forms.Button
$taskCancel.Text='Cancel';$taskCancel.Location=New-Object Drawing.Point(395,355);$taskCancel.Size=New-Object Drawing.Size(150,35)
$taskCancel.DialogResult='Cancel';$taskDialog.Controls.Add($taskCancel);$taskDialog.CancelButton=$taskCancel
$taskSubmit.Add_Click({
  $taskSelected=if($taskBranch.SelectedIndex -eq 0){@($taskSsid1,$taskPassword1)}elseif($taskBranch.SelectedIndex -eq 1){@($taskSsid2,$taskPassword2)}else{@($taskSsid1,$taskPassword1,$taskSsid2,$taskPassword2)}
  for($taskIndex=0;$taskIndex -lt $taskSelected.Count;$taskIndex+=2){
    $taskSsid=$taskSelected[$taskIndex].Text;$taskPassword=$taskSelected[$taskIndex+1].Text
    $taskSsidBytes=[Text.Encoding]::UTF8.GetByteCount($taskSsid);$taskPasswordBytes=[Text.Encoding]::UTF8.GetByteCount($taskPassword)
    if($taskSsidBytes -lt 1 -or $taskSsidBytes -gt 32 -or $taskSsid.Contains([char]0) -or $taskPassword.Contains([char]0) -or !($taskPasswordBytes -eq 0 -or ($taskPasswordBytes -ge 8 -and $taskPasswordBytes -le 63) -or $taskPassword -cmatch '^[0-9a-fA-F]{64}$')){
      [void][Windows.Forms.MessageBox]::Show('Enter a Wi-Fi name (1-32 UTF-8 bytes) and valid password (8-63 bytes, or empty for open Wi-Fi).','Check Wi-Fi settings');return
    }
  }
  $taskDialog.DialogResult='OK';$taskDialog.Close()
})
if($taskDialog.ShowDialog() -ne 'OK'){if($ResultPath){[IO.File]::WriteAllText($ResultPath,'{"status":"cancelled"}')};exit 1}
$taskBranches=if($taskBranch.SelectedIndex -eq 0){@('branch1')}elseif($taskBranch.SelectedIndex -eq 1){@('branch2')}else{@('branch1','branch2')}
$taskSettings=@{}
foreach($taskCurrentBranch in $taskBranches){
  $taskSettings[$taskCurrentBranch]=if($taskCurrentBranch -eq 'branch1'){@{ssid=$taskSsid1.Text;password=$taskPassword1.Text}}else{@{ssid=$taskSsid2.Text;password=$taskPassword2.Text}}
  $taskConfigPath=Join-Path $taskPrivateRoot "$taskCurrentBranch.h"
  if(!(Test-Path -LiteralPath $taskConfigPath)){throw "Private config missing for $taskCurrentBranch; no device key was created."}
  $taskConfigText=[IO.File]::ReadAllText($taskConfigPath)
  foreach($taskPair in @(@{name='WIFI_SSID';value=$taskSettings[$taskCurrentBranch].ssid},@{name='WIFI_PASSWORD';value=$taskSettings[$taskCurrentBranch].password})){
    $taskLiteral=ConvertTo-TaskCppString ([string]$taskPair.value)
    $taskPattern='(?m)^static const char\* '+$taskPair.name+' = .*;[ \t]*\r?$'
    if(![regex]::IsMatch($taskConfigText,$taskPattern)){throw "Config field $($taskPair.name) missing."}
    $taskReplacement='static const char* '+$taskPair.name+' = '+$taskLiteral+';'
    $taskConfigText=[regex]::Replace($taskConfigText,$taskPattern,[Text.RegularExpressions.MatchEvaluator]{param($taskMatch) $taskReplacement})
  }
  [IO.File]::WriteAllText($taskConfigPath,$taskConfigText,[Text.UTF8Encoding]::new($false))
}
if($Mode -eq 'Collect'){
  if($ResultPath){[IO.File]::WriteAllText($ResultPath,(@{status='saved';branches=$taskBranches} | ConvertTo-Json -Compress))}
  [void][Windows.Forms.MessageBox]::Show('Wi-Fi settings saved privately. Return to Codex to finish the first firmware upload.','Settings saved');exit 0
}
foreach($taskCurrentBranch in $taskBranches){
  [void][Windows.Forms.MessageBox]::Show("Connect ONLY the $taskCurrentBranch ESP32 by USB. Close Serial Monitor, then click OK.",'Connect reader')
  $taskPorts=@((& $taskPython -c 'import serial.tools.list_ports; print("\n".join(p.device for p in serial.tools.list_ports.comports() if p.vid is not None))') | Where-Object {$_ -match '^COM\d+$'})
  if($taskPorts.Count -ne 1){throw 'Connect exactly one USB serial reader and try again. Bluetooth COM ports are ignored.'}
  $taskConfigText=[IO.File]::ReadAllText((Join-Path $taskPrivateRoot "$taskCurrentBranch.h"))
  $taskDeviceMatch=[regex]::Match($taskConfigText,'static const char\* DEVICE_ID = "([^"]+)";')
  if(!$taskDeviceMatch.Success){throw 'Reader ID missing in private config.'}
  $taskPayload=$taskSettings[$taskCurrentBranch] | ConvertTo-Json -Compress
  $taskOldEncoding=$OutputEncoding
  try{
    $OutputEncoding=[Text.UTF8Encoding]::new($false)
    $taskPayload | & $taskPython (Join-Path $PSScriptRoot 'reader-usb.py') --port $taskPorts[0] --expected-device $taskDeviceMatch.Groups[1].Value --apply-wifi
    $taskUsbExit=$LASTEXITCODE
  }finally{$OutputEncoding=$taskOldEncoding}
  if($taskUsbExit -ne 0){throw 'Wi-Fi update was not confirmed. See the message above; do not reflash or format to fix a wrong password.'}
}
[void][Windows.Forms.MessageBox]::Show('Reader Wi-Fi updated without recompiling or flashing. Event queue preserved.','Done')
