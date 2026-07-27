@echo off
REM ==========================================================
REM  VYPA Tizen TEP Player — build a signed .wgt from the CLI
REM ==========================================================
REM  Lets you build without opening Tizen Studio. Source editing
REM  happens in VS Code; this drives the same toolchain the IDE's
REM  "Build Signed Package" button uses.
REM
REM  Usage (from the project root):
REM      tools\build.bat              -> signs with the default profile
REM      tools\build.bat MY-PROFILE   -> signs with a named profile
REM
REM  Output: .buildResult\VYPA_TEP.wgt
REM
REM  !! The EXCLUDE list below is a SECURITY control, not tidiness. !!
REM     VYPA2.wgt shipped author.p12 + author.pwd inside the package,
REM     and that package is served unauthenticated from
REM     packages.vypa.co — i.e. the code-signing key was public.
REM     Never remove these excludes. See README -> "Signing key exposure".
REM ==========================================================

setlocal

set TIZEN=C:\tizen-studio\tools\ide\bin\tizen.bat
set PROFILE=%1
if "%PROFILE%"=="" set PROFILE=VYPA2-CERT

if not exist "%TIZEN%" (
  echo [ERROR] Tizen CLI not found at %TIZEN%
  echo         Install Tizen Studio or edit TIZEN in this script.
  exit /b 1
)

echo.
echo === Cleaning previous build ===
if exist ".buildResult" rmdir /s /q ".buildResult"

echo.
echo === Building web app ===
REM Excludes, in order:
REM   author.p12 / author.pwd  - SIGNING KEY + PASSWORD. Must never ship.
REM   SSSP/*                   - URL Launcher manifest + any nested .wgt
REM                              (VYPA2.wgt embedded a 24MB copy of itself)
REM   tools/*, README.md       - dev-only, no runtime use
REM   .project/.tproject/.settings/.sign - IDE metadata
call "%TIZEN%" build-web ^
  -e "author.p12" -e "author.pwd" ^
  -e "SSSP/*" -e "SSSP" ^
  -e "tools/*" -e "tools" ^
  -e "README.md" -e ".gitignore" ^
  -e ".project" -e ".tproject" -e ".settings/*" -e ".sign/*" ^
  -e "*.wgt" ^
  -e "_pre_parity_backup/*" ^
  -out ".buildResult" -- "%CD%"
if errorlevel 1 (
  echo [ERROR] build-web failed
  exit /b 1
)

echo.
echo === Verifying no signing material reached the build ===
if exist ".buildResult\author.p12" (
  echo [ABORT] author.p12 is in .buildResult - refusing to package.
  exit /b 1
)
if exist ".buildResult\author.pwd" (
  echo [ABORT] author.pwd is in .buildResult - refusing to package.
  exit /b 1
)
echo OK - no signing material in build output.

echo.
echo === Packaging + signing with profile: %PROFILE% ===
call "%TIZEN%" package -t wgt -s "%PROFILE%" -- ".buildResult"
if errorlevel 1 (
  echo [ERROR] package failed. Check the profile name:
  echo         "%TIZEN%" security-profiles list
  exit /b 1
)

echo.
echo === Auditing package for key material ===
for %%F in (".buildResult\*.wgt") do (
  python "tools\verify_wgt.py" ".buildResult\%%~nxF"
  if errorlevel 1 (
    echo [ABORT] Package audit FAILED - do not publish.
    exit /b 1
  )
)

echo.
echo === Done ===
dir /b ".buildResult\*.wgt"
echo.

endlocal
