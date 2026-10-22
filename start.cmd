@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo.
echo Starting SIFT. The browser will open at http://127.0.0.1:8787
echo Keep this window open. Press Ctrl+C to stop.
echo.
call npm start
pause
