@echo off
setlocal

set "DEFAULT_GCF_PORT=24875"
if not "%~1"=="" (
  set "GIT_CREDENTIAL_FORWARDER_PORT=%~1"
) else (
  set "GIT_CREDENTIAL_FORWARDER_PORT=%DEFAULT_GCF_PORT%"
)

echo Installing git-credential-forwarder globally...
call npm install -g git-credential-forwarder
if errorlevel 1 exit /b %errorlevel%

echo Starting gcf-server...
call gcf-server
