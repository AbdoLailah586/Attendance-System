@echo off
cd /d "%~dp0"
title Attendance System - Database Backup Runner
echo ========================================================
echo   Attendance System - Automatic Database Backup
echo ========================================================
echo.
node -e "require('./src/lib/backupManager').runBackup().then(() => { console.log('Done!'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });"

