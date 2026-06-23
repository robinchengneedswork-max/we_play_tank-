@echo off
title Tank Arena
cd /d "%~dp0"

echo ============================================
echo            TANK ARENA  -  LAN game
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js is not installed or not on PATH.
  echo     Install it from https://nodejs.org/ then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run - installing dependencies...
  call npm install
  echo.
)

REM Open the host page in the default browser shortly after the server starts.
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:3000/host"

echo Starting server...  (close this window to stop the game)
echo.
node server\server.js

echo.
echo Server stopped.
pause
