@echo off
title Invoice and Billing Studio
cd /d "%~dp0"
if exist "release\Invoice-Studio-3.0.1-Portable.exe" (
  start "" "release\Invoice-Studio-3.0.1-Portable.exe"
  exit /b
)
if exist "release\win-unpacked\Invoice Studio.exe" (
  start "" "release\win-unpacked\Invoice Studio.exe"
  exit /b
)
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" .
  exit /b
)
echo Build or download the Windows release, then open Invoice Studio.exe.
echo Developers: npm ci, then npm start.
pause
