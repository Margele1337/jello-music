# Jello Music (Java) - Windows packaging script.
#
# ASCII-only on purpose: PowerShell 5.1 reads .ps1 as ANSI when there is no BOM,
# so Chinese comments here would be parsed as mojibake. (See AGENTS.md.)
#
# Produces a self-contained app-image at pkgout\JelloMusic\ (a folder with
# JelloMusic.exe + a private JRE). No installer (.msi/.exe setup) because that
# requires WiX, which is not installed on this machine.
#
# The tricky parts, and why this script looks the way it does:
#
#  1) dependency:build-classpath emits BOTH javafx-graphics-21.0.5.jar and
#     javafx-graphics-21.0.5-win.jar (Maven resolves the plain artifact plus the
#     OS-classifier one). Both declare module javafx.graphics, so handing that
#     straight to jpackage makes it add the module twice and die with
#     FileAlreadyExistsException: app\mods. So we filter: for org.openjfx keep
#     only the -win classifier, and drop test-scope jars (junit/opentest4j/
#     apiguardian) that have no business in a runtime image.
#
#  2) --runtime-image and --dest must NOT live under --input, otherwise jpackage
#     treats them as part of the bundle source and reports them missing.
#
#  3) jlink is run explicitly (not by jpackage) and retried: on this machine it
#     intermittently fails with AccessDenied on bin\ucrtbase.dll, or with
#     "invalid directory name" while leaving a stray ~29 byte FILE named after
#     the output dir - which then makes the next rmdir fail the same way.
#     Hence the loop, and hence removing a stray file as well as a directory.

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

# ------------------------------------------------- 2. de-duplicated mod path
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
$mp = (@($jar) + $keep) -join ';'
[System.IO.File]::WriteAllText((Join-Path $root 'mp.txt'), $mp)

Write-Host "[3/5] module path: $($keep.Count + 1) entries (was $($raw.Count))"

# ------------------------------------------------------------- 3. jlink
$img = Join-Path $root '.jimg'
$ok = $false
for ($attempt = 1; $attempt -le 5 -and -not $ok; $attempt++) {
    Write-Host "      jlink attempt $attempt"
    if (Test-Path $img) {
        if ((Get-Item $img).PSIsContainer) { Remove-Item $img -Recurse -Force -ErrorAction SilentlyContinue }
        else { Remove-Item $img -Force -ErrorAction SilentlyContinue }
    }
    & jlink --add-modules javafx.controls,javafx.media,javafx.fxml,java.net.http `
        --module-path $mp --output $img --strip-debug --no-header-files --no-man-pages 2>&1 |
        ForEach-Object { Write-Host "        $_" }
    if ($LASTEXITCODE -eq 0) { $ok = $true }
}
if (-not $ok) { Fail "jlink failed after 5 attempts" }

# ---------------------------------------------------------- 4. jpackage
if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host "[4/5] jpackage app-image -> $Dest"
& jpackage --type app-image --name JelloMusic `
    --runtime-image $img `
    --module-path $mp `
    --module com.jello.music/com.jello.music.MainApp `
    --dest $Dest `
    --win-console --vendor Margele 2>&1 | ForEach-Object { Write-Host "  $_" }
if ($LASTEXITCODE -ne 0) { Fail 'jpackage failed' }

# -------------------------------------------------------------- 5. report
$exe = Join-Path $Dest 'JelloMusic\JelloMusic.exe'
Write-Host "[5/5] done"
if (Test-Path $exe) {
    $sizeMb = [math]::Round(((Get-ChildItem (Join-Path $Dest 'JelloMusic') -Recurse -File |
                Measure-Object Length -Sum).Sum / 1MB), 1)
    Write-Host "  $exe  ($sizeMb MB total)" -ForegroundColor Green
    Write-Host "  run it with: $exe"
} else {
    Fail "expected $exe but it is missing"
}