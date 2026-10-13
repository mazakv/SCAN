@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title SCAN - Rainbow Defense Toolkit
cd /d "%~dp0"
if not exist "%~dp0Logs" mkdir "%~dp0Logs" >nul 2>&1
if not exist "%~dp0Logs\scan.log" type nul > "%~dp0Logs\scan.log"
if not exist "%~dp0Logs\errors.log" type nul > "%~dp0Logs\errors.log"
if not exist "%~dp0Logs\launcher.log" type nul > "%~dp0Logs\launcher.log"
echo [%DATE% %TIME%] LAUNCHER_START>>"%~dp0Logs\launcher.log"

if not exist "%~dp0README.txt" (
  echo [ERROR] README.txt is missing. Extract the complete project folder.
  echo [%DATE% %TIME%] README.txt missing>>"%~dp0Logs\errors.log"
  goto FAIL
)
if not exist "%~dp0consent.ps1" (
  echo [ERROR] consent.ps1 is missing.
  echo [%DATE% %TIME%] consent.ps1 missing>>"%~dp0Logs\errors.log"
  goto FAIL
)
if not exist "%~dp0validate_scripts.ps1" (
  echo [ERROR] validate_scripts.ps1 is missing.
  echo [%DATE% %TIME%] validate_scripts.ps1 missing>>"%~dp0Logs\errors.log"
  goto FAIL
)

set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" set "PS_EXE=powershell.exe"
echo [SCAN] Checking PowerShell syntax before startup...
echo [%DATE% %TIME%] POWERSHELL_SYNTAX_CHECK_START>>"%~dp0Logs\launcher.log"
"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0validate_scripts.ps1"
set "VALIDATE_RC=%ERRORLEVEL%"
echo [%DATE% %TIME%] POWERSHELL_SYNTAX_CHECK_EXIT=%VALIDATE_RC%>>"%~dp0Logs\launcher.log"
if not "%VALIDATE_RC%"=="0" (
  echo.
  echo [ERROR] PowerShell syntax validation failed.
  echo See Logs\errors.log and Logs\launcher.log for details.
  goto FAIL
)

echo [SCAN] Opening the startup notice...
"%PS_EXE%" -STA -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0consent.ps1"
set "CONSENT_RC=%ERRORLEVEL%"
if "%CONSENT_RC%"=="10" (
  echo Startup cancelled by user. No optional installation was started.
  goto CANCELLED
)
if not "%CONSENT_RC%"=="0" (
  echo [ERROR] Startup notice failed with exit code %CONSENT_RC%.
  echo See Logs\errors.log for details.
  goto FAIL
)

if not exist "%~dp0bootstrap.ps1" (
  echo [ERROR] bootstrap.ps1 is missing.
  goto FAIL
)
echo [SCAN] Checking the Python runtime and optional dependencies...
"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap.ps1"
set "BOOTSTRAP_RC=%ERRORLEVEL%"
if "%BOOTSTRAP_RC%"=="10" goto CANCELLED
if not "%BOOTSTRAP_RC%"=="0" (
  echo [ERROR] Runtime setup failed with exit code %BOOTSTRAP_RC%.
  echo See Logs\errors.log and Logs\bootstrap.log.
  goto FAIL
)

echo.
echo [SUCCESS] SCAN has closed normally.
echo Check Logs if you need the run history.
echo Press any key to close this window.
pause >nul
endlocal
exit /b 0

:CANCELLED
echo.
echo [INFO] Startup was cancelled. No optional setup was started.
echo Press any key to close this window.
pause >nul
endlocal
exit /b 0

:FAIL
echo.
echo [ERROR] SCAN could not start or complete successfully.
echo Review Logs\errors.log and Logs\launcher.log.
echo Press any key to close this window.
pause >nul
endlocal
exit /b 1
