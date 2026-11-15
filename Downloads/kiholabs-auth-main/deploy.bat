@echo off
cd /d "%~dp0"

echo =========================================
echo  Cloudflare Worker Deploy and GitHub Push
echo =========================================
echo.

set /p commit_msg="Enter commit message (Press Enter for 'auto update'): "
if "%commit_msg%"=="" set commit_msg=auto update

echo.
echo [1/3] Deploying to Cloudflare Worker...
call npx wrangler deploy
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Wrangler deployment failed.
    goto error_end
)

echo.
echo [2/3] Adding and committing changes to Git...
call git add .
call git commit -m "%commit_msg%"

echo.
echo [3/3] Pulling latest changes from GitHub...
call git pull origin main --rebase
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Git pull failed. Please resolve conflicts manually.
    goto error_end
)

echo.
echo [4/3] Pushing to GitHub (main)...
call git push origin main
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Git push failed.
    goto error_end
)

echo.
echo =========================================
echo  All deployment tasks completed successfully!
echo =========================================
goto end

:error_end
echo.
echo Deployment stopped due to an error.

:end
pause