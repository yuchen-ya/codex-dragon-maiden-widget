@echo off
node "%~dp0scripts\control.mjs" stop
if errorlevel 1 pause
