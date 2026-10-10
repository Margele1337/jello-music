@echo off
REM ============================================================
REM  Jello Music - Java version launcher
REM  (ASCII-only on purpose: .bat files are read as ANSI by cmd,
REM   Chinese comments here would be garbled)
REM
REM  Usage:
REM    run.bat                  build then launch (GUI)
REM    run.bat <direct-url>     build then launch with a given audio URL
REM    run.bat probe            build then run the headless pipeline probe
REM    run.bat probe-ui         build then run the silent UI probe (no window)
REM    run.bat probe-play       build then run the muted playback probe (no sound)
REM
REM  Credentials for the probe / auto-fetch path come from env vars:
REM    JELLO_TOKEN  JELLO_USERID  JELLO_DFID  JELLO_HASH
REM ============================================================
setlocal
cd /d "%~dp0"

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
    exit /b 1
  )
)

echo [1/3] Compiling...
call "%MVN_CMD%" -s settings.xml -q clean compile
if errorlevel 1 (
  echo [ERROR] Compile failed.
  exit /b 1
)

if /i "%~1"=="probe" (
  echo [2/3] Running pipeline probe...
  echo [3/3] Done.
  call "%MVN_CMD%" -s settings.xml -q exec:java
  exit /b %errorlevel%
)

echo [2/3] Resolving runtime classpath...
call "%MVN_CMD%" -s settings.xml -q dependency:build-classpath "-Dmdep.outputFile=cp.txt"
if errorlevel 1 (
  echo [ERROR] Failed to resolve dependencies.
  echo         Check network access to the Aliyun mirror configured in settings.xml.
  exit /b 1
)

set "CP=target\classes;%CP%"
for /f "usebackq delims=" %%i in ("cp.txt") do set "CP=%CP%;%%i"

REM Silent UI check: never shows a window, never plays audio.
REM Safe to run while gaming -- it renders offscreen and writes a PNG.
if /i "%~1"=="probe-ui" (
  echo [3/3] Running silent UI probe...
  java --module-path "%CP%" -m com.jello.music/com.jello.music.tools.UiProbe "%TEMP%\jello-ui-probe.png"
  exit /b %errorlevel%
)

REM Muted playback check: volume 0, no window, but the real audio pipeline runs.
if /i "%~1"=="probe-play" (
  echo [3/3] Running muted playback probe...
  java --module-path "%CP%" -m com.jello.music/com.jello.music.tools.PlaybackProbe
  exit /b %errorlevel%
)

echo [3/3] Launching GUI...
REM JavaFX must run on the module path, not the classpath.
REM %* forwards all args (empty when none, the URL when one is given).
REM Using %2..%6 here would silently drop the first arg -- the URL never
REM reached MainApp and playback silently fell back to the playlist path.
java --module-path "%CP%" -m com.jello.music/com.jello.music.MainApp %*
if errorlevel 1 (
  echo.
  echo [ERROR] GUI exited abnormally.
)

endlocal