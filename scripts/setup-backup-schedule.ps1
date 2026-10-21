param(
  [switch]$Register,
  [switch]$Unregister
)
$ErrorActionPreference='Stop'
if(!$Register -and !$Unregister){throw 'Pass -Register to create the weekly backup task, or -Unregister to remove it.'}
$taskName='JoeStore Attendance Weekly DB Backup'
if($Unregister){
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task '$taskName' (if it existed)."
  return
}
$taskRepoRoot=Split-Path -Parent $PSScriptRoot
$taskNode=(Get-Command node -ErrorAction SilentlyContinue).Source
if(!$taskNode){throw 'node.exe not found on PATH. Install Node.js or add it to PATH first.'}
$taskScript=Join-Path $taskRepoRoot 'scripts\backup-database.mjs'
if(!(Test-Path -LiteralPath $taskScript)){throw "Backup script missing: $taskScript"}

$taskAction=New-ScheduledTaskAction -Execute $taskNode -Argument "`"$taskScript`"" -WorkingDirectory $taskRepoRoot
$taskTrigger=New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 4am
# Only run when there is a network connection, and if the laptop was off/asleep at the
# scheduled time, catch up as soon as it is back online instead of skipping that week.
$taskSettings=New-ScheduledTaskSettingsSet -RunOnlyIfNetworkAvailable -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Description 'Weekly local backup of the attendance system database (schema + data) to %LOCALAPPDATA%\JoeStore\Attendance\Backups. Never committed to git.' -Force | Out-Null
Write-Host "Scheduled task '$taskName' created: runs every Sunday 4:00 AM, only with network available, catches up if missed."
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object NextRunTime, LastRunTime, LastTaskResult
