@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 20 或更新版本。
  pause
  exit /b 1
)
if not exist node_modules (
  call npm install
  if errorlevel 1 (pause & exit /b 1)
)
call npx playwright install chromium
if errorlevel 1 (pause & exit /b 1)
start "" http://127.0.0.1:4173
call npm start
pause
