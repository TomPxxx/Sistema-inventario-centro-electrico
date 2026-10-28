@echo off
title Grupo Electrico CE - Sistema de Inventario
color 0A

echo ========================================================
echo   SISTEMA DE INVENTARIO - GRUPO ELECTRICO CE
echo ========================================================
echo.

:: 1. Ir al directorio del proyecto
cd /d "C:\Users\tomas\OneDrive\Documentos\SISTEMA DE INVENTARIO CE"
set "PATH=%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin;%PATH%"

:: 2. Verificar si el servidor ya esta corriendo en el puerto 4000
netstat -ano | findstr /R ":4000.*LISTENING" >nul
if not errorlevel 1 (
    echo [INFO] El servidor ya esta en linea en http://localhost:4000
    echo Abriendo el sistema en tu navegador...
    start "" "http://localhost:4000"
    timeout /t 3 >nul
    exit /b 0
)

:: 3. Verificar e iniciar Docker Desktop
echo [1/3] Verificando Docker Desktop...
tasklist /fi "imagename eq Docker Desktop.exe" | findstr /i "Docker Desktop.exe" >nul
if errorlevel 1 (
    echo [INFO] Iniciando Docker Desktop en segundo plano...
    if exist "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe" (
        start "" "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
        timeout /t 8 /nobreak >nul
    ) else if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
        timeout /t 8 /nobreak >nul
    )
)

:: 4. Levantar contenedor de Base de Datos PostgreSQL
echo [2/3] Verificando contenedor PostgreSQL...
docker compose up -d 2>nul

:: 5. Abrir la aplicacion en el navegador
echo [3/3] Abriendo aplicacion en http://localhost:4000...
start "" "http://localhost:4000"

:: 6. Iniciar Servidor Node.js
echo.
echo ========================================================
echo   SERVIDOR EN LINEA - http://localhost:4000
echo   (Deja esta ventana abierta mientras uses el sistema)
echo ========================================================
echo.
node server.js
pause
