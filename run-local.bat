@echo off
setlocal
cd /d "%~dp0"

echo Starting La Magia match server on http://localhost:8787 ...
start "La Magia Match Server" /D "%~dp0" cmd /k npm run dev:server

timeout /t 2 /nobreak >nul

echo Starting La Magia web client on http://localhost:5173/lamagia/ ...
start "La Magia Web" /D "%~dp0" cmd /k npm run dev

echo.
echo Local test URLs:
echo   Web:    http://localhost:5173/lamagia/
echo   Health: http://localhost:8787/health
echo.
echo Close the two opened command windows to stop the local services.
endlocal
