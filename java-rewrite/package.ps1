# Jello Music (Java) - Windows packaging script.
#
# ASCII-only on purpose: PowerShell 5.1 reads .ps1 as ANSI when there is no BOM,
# so Chinese comments here would be parsed as mojibake. (See AGENTS.md.)
#
# Produces a self-contained app-image at pkgout\JelloMusic\ (JelloMusic.exe plus a
# trimmed private JRE). No installer (.msi/.exe setup): that needs WiX, which is
# not installed on this machine.
#
# ==============================================================================
# WHY IT IS BUILT THIS WAY -- four dead ends, all of which cost real time
# ==============================================================================
#
# 1) Automatic modules cannot be jlink roots.
#    jlayer, jna and slf4j-api have no module-info and no Automatic-Module-Name.
#    jlink says "automatic module cannot be read" and gives up. Passing
#    --bind-services does NOT help; this is JDK-8305967. So these jars must
#    stay OUT of the runtime image and be supplied at run time instead.
#
# 2) Therefore the module path is split in two:
#       mp-link -> given to jlink. Contains the app jar + javafx only.
#       mp-pkg  -> given to jpackage. Contains the app jar + the automatic-
#                  module jars, which get COPIED into app\.
#    javafx must NOT appear in mp-pkg: the runtime image already contains it,
#    and jpackage then dies with a bare
#        java.nio.file.FileAlreadyExistsException: <dest>\JelloMusic\app\mods
#    with no hint about which jar is at fault. Deleting any single dependency
#    does not make it pass, which makes it look like a JavaFX problem.
#
# 3) jlink needs more JDK modules than the obvious ones.
#    com.fasterxml.jackson.databind declares "requires java.logging", so
#    java.logging (plus java.management / java.naming / java.sql) must be
#    linked or the app dies at boot with:
#        java.lang.module.FindException: Module java.logging not found
#
# 4) jpackage emits a classpath-mode launcher, but this project is modular.
#    It writes app.mainclass / app.classpath, and JavaFX refuses to start from
#    the classpath ("Unsupported JavaFX configuration"). So JelloMusic.cfg is
#    rewritten afterwards to module mode:
#        java-options=--module-path=<jars>
#        java-options=--module=com.jello.music/com.jello.music.MainApp
#    Two details that each cost a round trip:
#      - values must use "=" (--module-path=X), a bare space splits into two
#        args and the JVM reports "Unrecognized option"
#      - values must NOT be quoted: the launcher keeps the quotes, and the JVM
#        then reports IllegalPathException: Illegal char <"> at index 0
#
# jlink is still retried: on this machine it intermittently fails with
# AccessDenied on bin\ucrtbase.dll, or leaves a stray ~29 byte FILE named after
# the output dir, which then makes the next rmdir fail the same way.

param(
    [string]$Dest = 'pkgout'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- 1. build
$mvnCmd = $null
$toolsDir = Join-Path $root 'tools'
if (Test-Path $toolsDir) {
    $m = Get-ChildItem $toolsDir -Directory -Filter 'apache-maven-*' -ErrorAction SilentlyContinue |
         Sort-Object Name -Descending | Select-Object -First 1
    if ($m) { $mvnCmd = Join-Path $m.FullName 'bin\mvn.cmd' }
}
if (-not $mvnCmd) { $mvnCmd = 'mvn' }

Write-Host "[1/5] mvn clean package"
& $mvnCmd -s settings.xml -q clean package -DskipTests
if ($LASTEXITCODE -ne 0) { Fail 'maven package failed' }

Write-Host "[2/5] resolving runtime classpath"
& $mvnCmd -s settings.xml -q dependency:build-classpath `
    '-Dmdep.outputFile=cp.txt' '-Dmdep.includeScope=runtime'
if ($LASTEXITCODE -ne 0) { Fail 'classpath resolution failed (check the Aliyun mirror in settings.xml)' }

# ----------------------------------------------- 2. split the module path
$raw = (Get-Content 'cp.txt' -Raw).Trim() -split ';' | Where-Object { $_ }
$testScope = @('junit', 'opentest4j', 'apiguardian')

$keep = New-Object System.Collections.Generic.List[string]
foreach ($entry in $raw) {
    $name = Split-Path $entry -Leaf
    if (-not $name) { continue }
    $isTest = $false
    foreach ($t in $testScope) { if ($name -like "$t-*" -or $name -like "$t.*") { $isTest = $true } }
    if ($isTest) { continue }
    # org.openjfx: keep only the platform classifier jar
    if ($name -like 'javafx-*' -and $name -notlike '*-win.jar') { continue }
    $keep.Add($entry)
}

$jar = 'target\jello-music-java-0.1.0-SNAPSHOT.jar'
if (-not (Test-Path $jar)) { Fail "expected $jar to exist" }

# jlink gets javafx (it links them into the image); jpackage does NOT, otherwise
# app\mods collides with what the runtime image already has.
$javafx = New-Object System.Collections.Generic.List[string]
$rest = New-Object System.Collections.Generic.List[string]
foreach ($entry in $keep) {
    if ((Split-Path $entry -Leaf) -like 'javafx-*') { $javafx.Add($entry) } else { $rest.Add($entry) }
}
$mpLink = (@($jar) + $javafx) -join ';'

Write-Host "[3/5] module path: jlink=$($javafx.Count + 1) (app+javafx), runtime-deps=$($rest.Count)"

# ------------------------------------------------------------- 3. jlink
$img = Join-Path $root '.jimg'
$ok = $false
for ($attempt = 1; $attempt -le 5 -and -not $ok; $attempt++) {
    Write-Host "      jlink attempt $attempt"
    if (Test-Path $img) {
        if ((Get-Item $img).PSIsContainer) { Remove-Item $img -Recurse -Force -ErrorAction SilentlyContinue }
        else { Remove-Item $img -Force -ErrorAction SilentlyContinue }
    }
    # java.logging & friends: jackson-databind declares "requires java.logging",
    # so without them the app cannot even boot (see note 3 above).
    # Keep --add-modules on ONE line: a backtick continuation after the comma
    # makes PowerShell parse it as an array and jlink then sees
    # "invalid argument: javafx.media javafx.fxml ...".
    $mods = 'javafx.controls,javafx.media,javafx.fxml,java.net.http,java.logging,java.management,java.naming,java.sql,jdk.unsupported,jdk.crypto.ec'
    & jlink --add-modules $mods --module-path $mpLink --output $img `
        --strip-debug --no-header-files --no-man-pages 2>&1 |
        ForEach-Object { Write-Host "        $_" }
    if ($LASTEXITCODE -eq 0) { $ok = $true }
}
if (-not $ok) { Fail "jlink failed after 5 attempts" }

# --------------------------------------------------- 4. jpackage + cfg fix
if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force -ErrorAction SilentlyContinue }

# jpackage insists on --input containing every jar, and they must sit in the
# input ROOT -- putting them in an "app" subdirectory makes it refuse with
# "the jars under --input must be in the top level".
$stage = Join-Path $env:TEMP "jello-pkg-$PID"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item $jar $stage
foreach ($entry in $rest) { Copy-Item $entry $stage }

Write-Host "[4/5] jpackage app-image -> $Dest"
# --runtime-image is REQUIRED. Without it jpackage builds its own runtime from
# the full JDK, which (a) is 156 MB instead of 105 MB and (b) contains no
# javafx at all -- javafx only exists in the jlink image we just built, so the
# app dies with "Module javafx.media not found, required by com.jello.music".
# javafx must NOT be in $stage either: it lives in the runtime image, and
# duplicating it makes jpackage fail with FileAlreadyExistsException on app\mods.
& jpackage --type app-image --name JelloMusic `
    --runtime-image $img `
    --input $stage `
    --main-jar (Split-Path $jar -Leaf) `
    --main-class com.jello.music.MainApp `
    --dest $Dest `
    --win-console --vendor Margele 2>&1 | ForEach-Object { Write-Host "  $_" }
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0) { Fail 'jpackage failed' }

# Rewrite the launcher into module mode (see note 4).
$cfg = Join-Path $Dest 'JelloMusic\app\JelloMusic.cfg'
if (-not (Test-Path $cfg)) { Fail "expected $cfg to exist" }
$jars = Get-ChildItem (Split-Path $cfg) -Filter *.jar | ForEach-Object { '$APPDIR\' + $_.Name }
$mp = $jars -join ';'
[System.IO.File]::WriteAllLines($cfg, @(
    '[Application]',
    'app.mainclass=com.jello.music.MainApp',
    '',
    '[JavaOptions]',
    "java-options=--module-path=$mp",
    'java-options=--module=com.jello.music/com.jello.music.MainApp'
))

# -------------------------------------------------------------- 5. report
$exe = Join-Path $Dest 'JelloMusic\JelloMusic.exe'
Write-Host "[5/5] done"
if (Test-Path $exe) {
    $sizeMb = [math]::Round(((Get-ChildItem (Join-Path $Dest 'JelloMusic') -Recurse -File |
                Measure-Object Length -Sum).Sum / 1MB), 1)
    Write-Host "  $exe  ($sizeMb MB total)" -ForegroundColor Green
    Write-Host "  run it with: $exe"
    Write-Host ""
    Write-Host "  NOTE: the app expects the KuGou API on 127.0.0.1:6521."
    Write-Host "  Start it from the repo root with:  npm run api"
} else {
    Fail "expected $exe but it is missing"
}