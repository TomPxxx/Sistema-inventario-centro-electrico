@echo off
title Sistema de Inventario Multi-Sede - Grupo Electrico CE
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin;%PATH%"

echo ========================================================
echo   INICIANDO SISTEMA DE INVENTARIO GRUPO ELECTRICO CE
echo ========================================================
echo.

:: 1. Verificar si Docker Desktop esta abierto
echo [1/3] Verificando Docker...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Iniciando Docker Desktop, espera unos segundos...
    start "" "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
    :wait_docker
    timeout /t 3 /nobreak >nul
    docker info >nul 2>&1
    if %errorlevel% neq 0 goto wait_docker
    echo [OK] Docker Desktop conectado.
) else (
    echo [OK] Docker ya esta en ejecucion.
)

:: 2. Levantar la base de datos PostgreSQL local
echo.
echo [2/3] Levantando base de datos PostgreSQL en contenedor Docker...
docker compose up -d

:: 3. Abrir la aplicacion en el navegador
echo.
echo [3/3] Abriendo navegador en http://localhost:4000...
start "" "http://localhost:4000"

:: 4. Iniciar Servidor Node.js
echo.
echo ========================================================
echo   SISTEMA LISTO Y EN LINEA
echo ========================================================
echo.
npm start
pause
