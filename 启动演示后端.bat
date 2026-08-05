@echo off
chcp 65001 >nul
title ApiPilot Mock Server

cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="

echo [Mock] 演示后端启动中，端口 8899
echo [Mock] 账号 admin / 密码 123456，Token 有效期 60 秒
echo [Mock] 关闭本窗口即可停止
echo.
node mock-server.js
pause
