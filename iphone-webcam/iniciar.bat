@echo off
REM Inicia o servidor da webcam do iPhone no Windows.
REM Basta dar dois cliques neste arquivo (precisa ter o Node.js instalado).

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js nao encontrado. Instale em https://nodejs.org e tente de novo.
  echo.
  pause
  exit /b 1
)

echo Iniciando o servidor... abra https://localhost:8443 no navegador do PC.
echo.
node server.js
pause
