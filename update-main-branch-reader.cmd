@echo off
setlocal
title Main branch ESP32 firmware update
set "reader_python=%~dp0.tools\pio-runtime\Scripts\python.exe"
if not exist "%reader_python%" (
    echo ERROR: The local PlatformIO runtime is missing from this project.
    pause
    exit /b 1
)
"%reader_python%" -u "%~dp0scripts\update-main-branch-reader.py"
set "reader_exit=%errorlevel%"
if not "%reader_exit%"=="0" (
    pause
    exit /b %reader_exit%
)
timeout /t 12 /nobreak >nul
exit /b 0
