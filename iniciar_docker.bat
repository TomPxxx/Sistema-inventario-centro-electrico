@echo off
set "PATH=%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin;%PATH%"
docker compose up -d
echo.
echo ========================================================
echo   DOCKER INVENTARIO CE - EN EJECUCION
echo   - PostgreSQL: localhost:5433
echo   - pgAdmin Web: http://localhost:5050 (admin@grupoelectrico.com / admin)
echo ========================================================
echo.
