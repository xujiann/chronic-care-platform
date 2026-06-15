@echo off
cd /d "%~dp0"
start "chronic-care-platform-server" cmd /k start-server.cmd
timeout /t 2 /nobreak >nul
start http://localhost:5173/
