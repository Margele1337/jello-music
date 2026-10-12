@echo off
REM ============================================================
REM  Jello Music - Java version launcher
REM  (ASCII-only on purpose: .bat files are read as ANSI by cmd,
REM   Chinese comments here would be garbled)
REM
REM  Usage:
REM    run.bat                  build, make sure the API is up, launch GUI
REM    run.bat <direct-url>     build then launch with a given audio URL
REM    run.bat probe            build then run the headless pipeline probe
REM    run.bat probe-ui         build then run the silent UI probe (no window)
REM    run.bat probe-play       build then run the muted playback probe (no sound)
REM    run.bat probe-dock       build then measure the dock animation timing
REM                            -- a window appears for about 1.5s
REM    run.bat probe-spectrum  build then render a real song's spectrum to PNG
REM    run.bat api              run the KuGou API in the foreground (debugging)
REM    run.bat api-stop         kill whatever listens on the API port
REM
REM  The API (repo-root api/, port 6521) is started automatically when nothing
REM  is listening there yet, and stopped again on exit. An API you started
REM  yourself is never touched.
REM
REM  Credentials come from the login page (persisted) or env vars:
REM    JELLO_TOKEN  JELLO_USERID  JELLO_DFID  JELLO_HASH
REM
REM  NOTE: no PowerShell here on purpose -- powershell.exe -Command returns
REM  "access denied" (exit 5) when spawned from a .bat on this machine, so the
REM  port probing / PID lookup are done with netstat instead.
REM ============================================================
setlocal
cd /d "%~dp0"

set "REPO=%~dp0.."
set "API_PORT=6521"
set "API_LOG=%TEMP%\jello-api.log"
set "API_STARTED_BY_US="

if /i "%~1"=="api-stop" goto :api_stop
if /i "%~1"=="api" goto :api_foreground

REM ---- 1. make sure the KuGou API is reachable -----------------------------
echo [1/4] Checking KuGou API on port %API_PORT%...
call :api_alive
if errorlevel 1 (
  call :api_start
  if errorlevel 1 goto :fail
) else (
  echo       already running, leaving it alone.
)

REM ---- 2. compile -----------------------------------------------------------
set "MVN_CMD=mvn"
where mvn >nul 2>&1
if errorlevel 1 (
  REM fall back to a Maven extracted under tools\
  for /d %%D in ("tools\apache-maven-*") do set "MVN_CMD=%%~fD\bin\mvn.cmd"
)

if /i "%MVN_CMD%"=="mvn" (
  where mvn >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Maven not found.
    echo         Either install Maven and put it on PATH, or extract it to:
    echo           tools\apache-maven-3.9.9\
    echo         Download:
    echo           https://archive.apache.org/dist/maven/maven-3/3.9.9/binaries/apache-maven-3.9.9-bin.zip
    set "RC=1"
    goto :cleanup
  )
)

echo [2/4] Compiling...
call "%MVN_CMD%" -s settings.xml -q clean compile
if errorlevel 1 (
  echo [ERROR] Compile failed.
  set "RC=1"
  goto :cleanup
)

if /i "%~1"=="probe" (
  echo [3/4] Running pipeline probe...
  echo [4/4] Done.
  REM Must name the execution id: exec:java without one does not pick up the
  REM <mainClass> configured in pom.xml and fails with "parameters mainClass missing".
  call "%MVN_CMD%" -s settings.xml -q exec:java@probe
  set "RC=%errorlevel%"
  goto :cleanup
)

echo [3/4] Resolving runtime classpath...
call "%MVN_CMD%" -s settings.xml -q dependency:build-classpath "-Dmdep.outputFile=cp.txt"
if errorlevel 1 (
  echo [ERROR] Failed to resolve dependencies.
  echo         Check network access to the Aliyun mirror configured in settings.xml.
  set "RC=1"
  goto :cleanup
)

set "CP=target\classes;%CP%"
for /f "usebackq delims=" %%i in ("cp.txt") do set "CP=%CP%;%%i"

REM Silent UI check: never shows a window, never plays audio.
REM Safe to run while gaming -- it renders offscreen and writes a PNG.
if /i "%~1"=="probe-ui" (
  echo [4/4] Running silent UI probe...
  java --module-path "%CP%" -m com.jello.music/com.jello.music.tools.UiProbe "%TEMP%\jello-ui-probe.png"
  set "RC=%errorlevel%"
  goto :cleanup
)

REM Muted playback check: volume 0, no window, but the real audio pipeline runs.
if /i "%~1"=="probe-play" (
  echo [4/4] Running muted playback probe...
  java --module-path "%CP%" -m com.jello.music/com.jello.music.tools.PlaybackProbe
  set "RC=%errorlevel%"
  goto :cleanup
)

REM Dock motion check: DOES show an 800x600 window -- the animation under test
REM is the window position itself, so it has to be visible. Runs about 1.5s.
REM Use after touching EdgeDock / ElasticReveal to compare the alpha curve and
REM the arrival time against sigmarebase -- 80ms dim / 150ms brighten.
REM NOTE: no parentheses inside this block. cmd treats an unescaped ) as the
REM end of an if-block, so "echo ... (blah)..." closes the block early and the
REM leftover text becomes a bogus command. That is what "此时不应有 ..." was.
if /i "%~1"=="probe-dock" (
  echo [4/4] Running dock motion probe -- a window will appear briefly...
  java --module-path "%CP%" -m com.jello.music/com.jello.music.tools.DockMotionProbe
  set "RC=%errorlevel%"
  goto :cleanup
)

REM Real-spectrum check: connects to the api, pulls a real direct link and
REM decodes actual audio, then renders the spectrum and writes PNGs.
REM Needs the api up -- run.bat starts it automatically above.
if /i "%~1"=="probe-spectrum" (
  echo [4/4] Running real-spectrum probe -- pulls a real song...
  java --module-path "%CP%" -m com.jello.music/com.jello.music.tools.SpectrumProbe "%TEMP%"
  set "RC=%errorlevel%"
  goto :cleanup
)

echo [4/4] Launching GUI...
REM JavaFX must run on the module path, not the classpath.
REM %* forwards all args (empty when none, the URL when one is given).
REM Using %2..%6 here would silently drop the first arg -- the URL never
REM reached MainApp and playback silently fell back to the playlist path.
java --module-path "%CP%" -m com.jello.music/com.jello.music.MainApp %*
set "RC=%errorlevel%"
if not "%RC%"=="0" (
  echo.
  echo [ERROR] GUI exited abnormally.
)

:cleanup
REM Only stop the API if this run started it; one you started yourself stays up.
if defined API_STARTED_BY_US call :api_kill
endlocal & exit /b %RC%

:fail
call :api_kill_if_mine
set "RC=1"
goto :cleanup

REM ---- sub commands ---------------------------------------------------------

:api_foreground
echo Running the KuGou API in the foreground. Ctrl+C to stop.
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node not found on PATH.
  exit /b 1
)
pushd "%REPO%"
node api\app.js --platform=lite --port=%API_PORT%
set "RC=%errorlevel%"
popd
exit /b %RC%

:api_stop
call :api_pid
if not defined API_PID (
  echo Nothing is listening on port %API_PORT%.
  exit /b 0
)
echo Stopping the API on port %API_PORT% (pid %API_PID%)...
taskkill /PID %API_PID% /T /F >nul 2>&1
exit /b 0

REM ---- API helpers ----------------------------------------------------------
REM 0 = something is LISTENING on the port, non-zero = nothing there.

:api_alive
call :api_pid
if defined API_PID exit /b 0
exit /b 1

REM Fills API_PID with the pid listening on the API port, or leaves it empty.
:api_pid
set "API_PID="
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /r /c:"LISTENING" ^| findstr /r /c:":%API_PORT% "') do set "API_PID=%%p"
goto :eof

:api_start
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node not found on PATH -- cannot start the KuGou API.
  exit /b 1
)
if not exist "%REPO%\api\app.js" (
  echo [ERROR] %REPO%\api\app.js not found.
  echo         api/ is a git submodule; run:  git submodule update --init
  exit /b 1
)
echo       starting it in the background...
pushd "%REPO%"
REM start /b keeps it off any new window; the redirect lands in %TEMP%\jello-api.log
start "jello-api" /b node api\app.js --platform=lite --port=%API_PORT% > "%API_LOG%" 2>&1
popd

REM The API needs a moment to bind the port; give it ~30s.
set /a WAITED=0
:api_wait
call :api_alive
if not errorlevel 1 (
  echo       API is up ^(pid %API_PID%^).
  set "API_STARTED_BY_US=%API_PID%"
  exit /b 0
)
timeout /t 1 /nobreak >nul 2>&1 || ping -n 2 127.0.0.1 >nul
set /a WAITED+=1
if %WAITED% lss 30 goto :api_wait

echo [ERROR] API did not come up within 30s. Last lines of %API_LOG%:
if exist "%API_LOG%" type "%API_LOG%"
if defined API_PID taskkill /PID %API_PID% /T /F >nul 2>&1
exit /b 1

:api_kill
call :api_pid
if defined API_PID (
  echo [api] stopping the API this run started ^(pid %API_PID%^)...
  taskkill /PID %API_PID% /T /F >nul 2>&1
) else (
  echo [api] the API already went away.
)
exit /b 0

:api_kill_if_mine
if defined API_STARTED_BY_US call :api_kill
exit /b 0