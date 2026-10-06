@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure-readers.ps1" -Mode Collect
if errorlevel 1 pause
