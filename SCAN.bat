@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title SCAN v22 - 89-entry Rainbow Defense Toolkit
cd /d "%~dp0"
if not exist "%~dp0Logs" mkdir "%~dp0Logs" >nul 2>&1
if not exist "%~dp0Logs\scan.log" type nul > "%~dp0Logs\scan.log"
if not exist "%~dp0Logs\errors.log" type nul > "%~dp0Logs\errors.log"
if not exist "%~dp0Logs\launcher.log" type nul > "%~dp0Logs\launcher.log"
echo [%DATE% %TIME%] LAUNCHER_START>>"%~dp0Logs\launcher.log"
if exist "%~dp0README.txt" goto HAS_GUIDE
echo [ERROR] README.txt is missing. Re-extract the complete ZIP.
echo [%DATE% %TIME%] LAUNCH ERROR: README.txt is missing>>"%~dp0Logs\errors.log"
pause
exit /b 1
:HAS_GUIDE
if exist "%~dp0consent.ps1" goto HAS_CONSENT
echo [ERROR] consent.ps1 is missing. Re-extract the entire ZIP.
echo [%DATE% %TIME%] LAUNCH ERROR: consent.ps1 is missing>>"%~dp0Logs\errors.log"
pause
exit /b 1
:HAS_CONSENT
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%PS_EXE%" goto HAVE_PS
set "PS_EXE=powershell.exe"
:HAVE_PS
if exist "%~dp0validate_scripts.ps1" goto HAVE_VALIDATOR
echo [ERROR] validate_scripts.ps1 is missing. Re-extract the full ZIP.
echo [%DATE% %TIME%] LAUNCH ERROR: validate_scripts.ps1 is missing>>"%~dp0Logs\errors.log"
pause
exit /b 1
:HAVE_VALIDATOR
echo [%DATE% %TIME%] POWERSHELL_SYNTAX_CHECK_START>>"%~dp0Logs\launcher.log"
"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0validate_scripts.ps1"
set "VALIDATE_RC=%ERRORLEVEL%"
echo [%DATE% %TIME%] POWERSHELL_SYNTAX_CHECK_EXIT=%VALIDATE_RC%>>"%~dp0Logs\launcher.log"
if "%VALIDATE_RC%"=="0" goto SYNTAX_OK
echo.
echo SCAN stopped before the consent screen because the PowerShell syntax preflight failed.
echo Open Logs\errors.log and Logs\launcher.log for file, line, and column details.
echo.
pause
exit /b 2
:SYNTAX_OK
echo [%DATE% %TIME%] CONSENT_START>>"%~dp0Logs\launcher.log"
echo [%DATE% %TIME%] LAUNCH: opening the short startup notice>>"%~dp0Logs\scan.log"
"%PS_EXE%" -STA -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0consent.ps1"
set "CONSENT_RC=%ERRORLEVEL%"
echo [%DATE% %TIME%] CONSENT_EXIT=%CONSENT_RC%>>"%~dp0Logs\launcher.log"
if "%CONSENT_RC%"=="0" goto CONSENT_OK
if "%CONSENT_RC%"=="10" goto CONSENT_CANCELLED
echo [%DATE% %TIME%] CONSENT_SCRIPT_FAILED code=%CONSENT_RC%. See consent.log for detail.>>"%~dp0Logs\errors.log"
echo [%DATE% %TIME%] CONSENT_SCRIPT_FAILED code=%CONSENT_RC%>>"%~dp0Logs\scan.log"
echo.
echo SCAN could not complete the startup notice. Details are in Logs\errors.log and Logs\consent.log.
echo.
pause
exit /b 1
:CONSENT_CANCELLED
echo [%DATE% %TIME%] USER_DECLINED_STARTUP_NOTICE>>"%~dp0Logs\scan.log"
echo.
echo Startup was cancelled. No optional package action was started.
pause
exit /b 0
:CONSENT_OK
echo [%DATE% %TIME%] STARTUP_NOTICE_ACKNOWLEDGED>>"%~dp0Logs\scan.log"
echo [%DATE% %TIME%] CONSENT_OK_BOOTSTRAP_START>>"%~dp0Logs\launcher.log"
echo.
echo [SCAN] Startup notice acknowledged. Checking the required Python runtime.
"%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap.ps1"
set "BOOTSTRAP_RC=%ERRORLEVEL%"
echo [%DATE% %TIME%] BOOTSTRAP_EXIT=%BOOTSTRAP_RC%>>"%~dp0Logs\launcher.log"
if "%BOOTSTRAP_RC%"=="0" goto BOOTSTRAP_OK
if "%BOOTSTRAP_RC%"=="10" goto SETUP_CANCELLED
echo [%DATE% %TIME%] BOOTSTRAP_FAILED code=%BOOTSTRAP_RC%. See bootstrap.log.>>"%~dp0Logs\errors.log"
echo [%DATE% %TIME%] BOOTSTRAP_FAILED code=%BOOTSTRAP_RC%>>"%~dp0Logs\scan.log"
echo.
echo [SCAN ERROR] Startup failed with exit code %BOOTSTRAP_RC%.
echo Open Logs\errors.log and Logs\bootstrap.log for details.
echo.
pause
exit /b 1
:SETUP_CANCELLED
echo [%DATE% %TIME%] USER_CANCELLED_REQUIRED_RUNTIME_SETUP>>"%~dp0Logs\scan.log"
echo.
echo Setup cancelled by user. No optional package action was started.
pause
exit /b 0
:BOOTSTRAP_OK
echo [%DATE% %TIME%] SCAN_EXIT_OK>>"%~dp0Logs\launcher.log"
echo.
echo ================================================================
echo [SUCCESS] SCAN closed normally. No startup error was reported.
echo Logs and reports are stored in the Logs folder.
echo ================================================================
echo.
echo Press any key to close this window.
pause >nul
endlocal
exit /b 0
