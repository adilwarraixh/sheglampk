@echo off
title SHEGLAM PK - Admin
cd /d "%~dp0"

echo.
echo  ===========================================
echo   SHEGLAM PK
echo  ===========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Node.js is not installed.
  echo  Download it from https://nodejs.org then run this again.
  echo.
  pause
  exit /b 1
)

echo  Starting the shop preview  ... http://localhost:5599
start "SHEGLAM PK - site"  /min cmd /c "node server.js"

echo  Starting the admin portal ... http://localhost:5600
start "SHEGLAM PK - admin" /min cmd /c "node admin-server.js"

echo.
echo  Opening the admin portal in your browser...
timeout /t 3 /nobreak >nul
start "" http://localhost:5600

echo.
echo  ===========================================
echo   Admin portal : http://localhost:5600
echo   Your shop    : http://localhost:5599
echo  ===========================================
echo.
echo  First time? You'll be asked to create a
echo  username and password. Remember them -
echo  there is no reset link, only:
echo      node set-admin-password.js
echo.
echo  Two small windows are now running in the
echo  background. Closing THIS window is fine,
echo  but closing those two stops the servers.
echo.
pause
