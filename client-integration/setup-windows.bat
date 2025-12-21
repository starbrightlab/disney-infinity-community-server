@echo off
REM Disney Infinity Community Server - Windows Setup Script
REM This script helps configure Windows clients to use the community server

echo Disney Infinity Community Server Setup
echo ======================================
echo.

set /p SERVER_IP="Enter your community server IP or domain: "
if "%SERVER_IP%"=="" (
    echo Error: Server address is required
    pause
    exit /b 1
)

echo.
echo Configuring hosts file...
echo.

REM Backup original hosts file
copy "%windir%\System32\drivers\etc\hosts" "%windir%\System32\drivers\etc\hosts.backup" 2>nul

REM Add community server entries
echo. >> "%windir%\System32\drivers\etc\hosts"
echo # Disney Infinity Community Server >> "%windir%\System32\drivers\etc\hosts"
echo %SERVER_IP% disney.go.com >> "%windir%\System32\drivers\etc\hosts"
echo %SERVER_IP% toys.disney.go.com >> "%windir%\System32\drivers\etc\hosts"
echo %SERVER_IP% ugc.disney.go.com >> "%windir%\System32\drivers\etc\hosts"
echo %SERVER_IP% api.toybox.com >> "%windir%\System32\drivers\etc\hosts"

echo.
echo Testing connection to server...
echo.

ping -n 1 %SERVER_IP% >nul 2>&1
if %errorlevel% neq 0 (
    echo Warning: Cannot ping server. Please check the address and firewall settings.
) else (
    echo Server connection successful.
)

echo.
echo Testing API endpoint...
echo.

curl -s http://%SERVER_IP%/api/v1/health >nul 2>&1
if %errorlevel% neq 0 (
    echo Warning: Cannot reach API endpoint. Please check server configuration.
) else (
    echo API endpoint reachable.
)

echo.
echo Setup complete!
echo.
echo What was configured:
echo - Added server entries to hosts file
echo - Created backup of original hosts file
echo.
echo To revert changes, run: copy "%windir%\System32\drivers\etc\hosts.backup" "%windir%\System32\drivers\etc\hosts"
echo.
echo You can now launch Disney Infinity 3.0 Gold and use community UGC features.
echo.

pause
