@echo off
chcp 65001 >nul
title dingtalk-photo - 拍照发钉钉
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 node。请先安装 Node.js ^(^>=18^)，或把 node 加入 PATH。
  pause
  exit /b 1
)

echo ============================================================
echo   拍摄一张照片并发送到钉钉
echo   摄像头指示灯会亮起，约 1 秒
echo ============================================================
echo.

node scripts\take-photo.mjs %*

echo.
pause
