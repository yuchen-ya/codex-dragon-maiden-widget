@echo off
chcp 65001 >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-package.ps1" %*
if errorlevel 1 (pause & exit /b 1)
pause
