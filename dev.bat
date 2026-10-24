@echo off
cd /d "%~dp0"

echo ============================================
echo   Jello Music - Dev Mode (single console)
echo ============================================
echo.

:: Clean up stale processes from previous run
echo   Cleaning up old processes...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":6521"') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8080"') do taskkill /F /PID %%p >nul 2>&1

:: ELECTRON_RUN_AS_NODE is cleared by electron/start-electron.cjs
:: Electron itself waits for Vite/API readiness before spawning (start-electron.cjs)

echo.
echo   API  : http://localhost:6521
echo   Web  : http://localhost:8080
echo   All three services stream their logs into this one window.
echo   Press Ctrl+C here to stop everything.
echo ============================================
echo.

call npm run dev

echo.
echo   Dev session ended.
pause
