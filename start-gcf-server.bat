@echo off
setlocal

set "DEFAULT_GCF_PORT=24875"
set "GIT_CREDENTIAL_FORWARDER_DEBUG=true"
set "PATH=C:\Program Files\Git\mingw64\bin;%PATH%"
set "GIT_CREDENTIAL_FORWARDER_GIT_PATH=C:\PROGRA~1\Git\mingw64\bin\git.exe"
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
