@echo off
chcp 65001 >nul
title ApiPilot

cd /d "%~dp0"

rem 某些宿主进程(如 Electron 系的编辑器/终端)会往环境里塞这两个变量，
rem 会让 electron 退化成纯 Node 模式启动失败，这里先清掉。
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="

if not exist "node_modules\electron\dist\electron.exe" (
  echo [ApiPilot] 还没安装依赖，正在执行 npm install ...
  call npm install
  if errorlevel 1 (
    echo [ApiPilot] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo [ApiPilot] 正在启动 ...
start "" "node_modules\electron\dist\electron.exe" "%~dp0."
exit /b 0
