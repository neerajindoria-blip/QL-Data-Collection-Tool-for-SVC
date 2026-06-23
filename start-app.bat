@echo off
setlocal
cd /d "%~dp0"

set "BUNDLED_PY=C:\Users\Neeraj\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

echo Starting Stock Deploy Order...
echo.
echo After the server starts, open:
echo http://127.0.0.1:8000/index.html?v=split-backtest
echo.
echo To stop the app, close this window or press Ctrl+C.
echo.

if exist "%BUNDLED_PY%" (
  "%BUNDLED_PY%" server.py
) else (
  py server.py
)
