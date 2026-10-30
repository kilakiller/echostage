@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   EchoStage / 回响舞台
echo   Web 原型: http://127.0.0.1:8777/web/
echo   歌单助手: http://127.0.0.1:8787
echo ============================================
start "EchoStage Web" /D "%~dp0" cmd /k python -m http.server 8777 --bind 127.0.0.1
start "EchoStage Companion" /D "%~dp0" cmd /k python pipeline\server.py
timeout /t 2 >nul
start "" "http://127.0.0.1:8777/web/"
