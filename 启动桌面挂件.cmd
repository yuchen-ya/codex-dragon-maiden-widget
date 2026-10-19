@echo off
node "%~dp0scripts\control.mjs" desktop
if errorlevel 1 pause
