# 📘 MANUAL TÉCNICO DE INSTALACIÓN, CONFIGURACIÓN Y MANTENIMIENTO
## Sistema de Gestión e Inventario Multisede — Grupo Eléctrico CE
**Versión del Software:** 1.0.0  
**Fecha de Publicación:** Octubre 2026  
**Documento para:** Equipo de Ingeniería, Administradores de Infraestructura y Soporte Técnico  

---

## 📑 Tabla de Contenidos
1. [Descripción General y Arquitectura](#1-descripción-general-y-arquitectura)
2. [Requisitos Previos del Sistema](#2-requisitos-previos-del-sistema)
3. [Guía de Instalación Paso a Paso](#3-guía-de-instalación-paso-a-paso)
4. [Configuración de Entorno y Seguridad](#4-configuración-de-entorno-y-seguridad)
5. [Puesta en Marcha y Ejecución](#5-puesta-en-marcha-y-ejecución)
6. [Mantenimiento del Sistema](#6-mantenimiento-del-sistema)
7. [Planes de Respaldo, Restauración y Sincronización Nube](#7-planes-de-respaldo-restauración-y-sincronización-nube)
8. [Auditoría, Seguridad y Control de Sesiones](#8-auditoría-seguridad-y-control-de-sesiones)
9. [Solución de Problemas Frecuentes (Troubleshooting)](#9-solución-de-problemas-frecuentes-troubleshooting)

---

## 1. Descripción General y Arquitectura

El **Sistema de Inventario Multisede de Grupo Eléctrico** es una solución web empresarial diseñada para el control centralizado y la distribución física de materiales eléctricos industriales a lo largo de **4 sedes operativas**:
1. **Centro Eléctrico EP** (Crr 20 # 12-30)
2. **Centro Eléctrico EP1** (Crr 20 # 12-04)
3. **Grupo Eléctrico EP3** (Crr 20 # 12-10)
4. **EP6 Ecoiluminación** (Crr 19 # 12-51)

### 1.1. Arquitectura del Sistema
El sistema se implementa bajo un patrón arquitectónico de **Capas Desacopladas (Controller - Repository - Service)** con comunicación bidireccional en tiempo real:

```mermaid
graph TD
    Client[Cliente Web / Navegador SPA] -->|HTTP REST / Cookies HttpOnly| Express[Backend Express.js Node.js]
    Client <-->|WebSockets Bidireccional| SocketIO[Socket.IO Server]
    Express --> Repositories[Capa de Repositorios SQL]
    Repositories -->|Pool Conexiones pg| PostgreSQL[(PostgreSQL 15 Docker)]
    Repositories -.->|Sync Bajo Demanda| Neon[(Neon PostgreSQL Cloud)]
    Express --> Security[Middlewares: JWT, Helmet, RateLimit, Honeypot]
```

* **Frontend:** Single Page Application (SPA) construida en HTML5 semántico, JavaScript Vanilla moderno (ES6+), estilos Tailwind CSS con paleta corporativa de alto contraste, e internacionalización dinámica (ES/EN) con [i18n.js](file:///public/js/i18n.js).
* **Backend:** Node.js (v18+, v20 LTS, v24) con Express en módulos ESM (`"type": "module"`).
* **Capa de Datos:** PostgreSQL 15 virtualizado en contenedor Docker con soporte de volumen persistente y fallback de sincronización a **Neon Serverless PostgreSQL**.
* **Tiempo Real:** Socket.IO para alertas de red, asignación de corredores logísticos y notificación instantánea de traslados.

---

## 2. Requisitos Previos del Sistema

### 2.1. Requisitos de Hardware
| Componente | Mínimo | Recomendado |
| :--- | :--- | :--- |
| **Procesador (CPU)** | 2 Núcleos (x64 o ARM64) | 4 Núcleos o superior |
| **Memoria RAM** | 4 GB | 8 GB o superior |
| **Almacenamiento** | 2 GB libres en disco | 10 GB SSD libres |
| **Conectividad** | Red local (LAN) | Acceso a Internet (para Neon y NTP) |

### 2.2. Requisitos de Software
1. **Sistema Operativo:** Windows 10/11 Pro, Linux (Ubuntu 20.04+ / Debian 11+) o macOS.
2. **Node.js:** Versión 18.x, 20.x LTS o 24.x ([Descargar Node.js](https://nodejs.org/)).
3. **Docker Desktop:** Versión 4.20+ con motor WSL 2 habilitado en Windows ([Descargar Docker](https://www.docker.com/products/docker-desktop/)).
4. **Git:** Para control de versiones y despliegue continuo.
5. **Navegador Web:** Google Chrome, Microsoft Edge, Mozilla Firefox o Brave (versiones recientes).

---

## 3. Guía de Instalación Paso a Paso

### Paso 1: Clonar el Repositorio
Abre tu consola (PowerShell, Git Bash o Terminal) y ejecuta:
```bash
git clone https://github.com/TomPxxx/Sistema-inventario-centro-electrico.git
cd Sistema-inventario-centro-electrico
```

### Paso 2: Instalar Dependencias de Node.js
Instala todos los paquetes requeridos por el servidor y el motor de pruebas:
```bash
npm install
```

### Paso 3: Configurar el Archivo de Variables de Entorno (`.env`)
Copia la plantilla base y genera tu archivo `.env`:
```bash
# En Windows (PowerShell) o Linux:
cp .env.example .env
```
Edita `.env` con las credenciales de tu servidor (ver sección 4 para parámetros detallados).

### Paso 4: Levantar la Base de Datos con Docker Compose
Inicia el contenedor de base de datos PostgreSQL y la interfaz web pgAdmin:
```bash
docker compose up -d
```
> **Verificación:** Ejecuta `docker ps` para corroborar que los contenedores `inventario_db` (puerto 5433) e `inventario_pgadmin` (puerto 5050) se encuentren en estado `Up`.

### Paso 5: Inicialización del Esquema de Base de Datos
El contenedor ejecuta automáticamente el script inicial en el primer arranque. Si requieres reestructurar la base de datos manualmente o desde cero:
```bash
# Mediante el cliente Docker de PostgreSQL:
docker exec -i inventario_db psql -U postgres -d inventario_electrico_ce < database_schema_pg.sql
```

---

## 4. Configuración de Entorno y Seguridad

### 4.1. Diccionario de Variables de Entorno (`.env`)
| Variable | Tipo | Default | Descripción |
| :--- | :--- | :--- | :--- |
| `PORT` | Entero | `4000` | Puerto en el que escucha la API y el servidor HTTP. |
| `NODE_ENV` | String | `development` | Entorno de ejecución (`development` / `production`). |
| `DATABASE_URL` | URI | `postgresql://postgres:Tomas1022352347@localhost:5433/inventario_electrico_ce` | Conexión principal al contenedor PostgreSQL local. |
| `NEON_DATABASE_URL` | URI | *(Opcional)* | Cadena de conexión para réplicas en la nube con Neon. |
| `JWT_SECRET` | String | `ce_secret_key_...` | Clave criptográfica para firma de tokens JWT. |
| `JWT_EXPIRES_IN` | String | `12h` | Tiempo de vida de la sesión antes de requerir re-login. |

### 4.2. Mapeo de Puertos y Servicios
* **Aplicación Web / API:** `http://localhost:4000`
* **PostgreSQL (Host Externo):** `localhost:5433` *(mapeado internamente a 5432 para evitar colisiones con instancias locales preexistentes)*
* **pgAdmin 4 (Gestor Web DB):** `http://localhost:5050`  
  * *Usuario:* `admin@grupoelectrico.com`
  * *Contraseña:* `admin`

---

## 5. Puesta en Marcha y Ejecución

### Opción A: Inicio en 1-Clic para Usuarios y Operativos (Windows)
Se ha provisto el script automatizado [iniciar_sistema.bat](file:///iniciar_sistema.bat):
1. Haz doble clic sobre el acceso directo en el Escritorio o sobre `iniciar_sistema.bat`.
2. El script:
   - Verifica si el puerto 4000 ya está activo.
   - Inicia Docker Desktop si está cerrado.
   - Levanta el contenedor de PostgreSQL (`docker compose up -d`).
   - Abre automáticamente el navegador en `http://localhost:4000`.
   - Inicia el servidor Node.js y mantiene la consola abierta para monitoreo.

### Opción B: Inicio Manual para Desarrolladores / Terminal
```bash
# 1. Asegurar contenedores activos:
docker compose up -d

# 2. Iniciar servidor con recarga en caliente:
npm run dev

# O en modo producción:
npm start
```

### 5.1. Cuentas Maestras Preconfiguradas
| Rol | Usuario (`username`) | Contraseña Corporativa | Alcance Operativo |
| :--- | :--- | :--- | :--- |
| **Administrador Global** | `tomas_admin` | `Admin#1022352347` | Gobernanza total, métricas, 4 sedes, backups y logs. |
| **Administrador Global** | `Cesar` | `Admin#123456789` | Acceso directivo global. |
| **Encargado Sede EP** | `encargado_ep` | `Encargado#102235` | Gestión de stock y recepción en Centro Eléctrico EP. |
| **Encargado Sede EP1** | `encargado_ep1` | `Encargado#102235` | Gestión de stock y recepción en Centro Eléctrico EP1. |
| **Encargado Sede EP3** | `encargado_ep3` | `Encargado#102235` | Gestión de stock y recepción en Grupo Eléctrico EP3. |
| **Encargado Sede EP6** | `encargado_ep6` | `Encargado#102235` | Gestión de stock y recepción en EP6 Ecoiluminación. |
| **Corredor Logístico** | `corredor1` | `Corredor#102235` | Entrega y transporte de material entre sedes. |

---

## 6. Mantenimiento del Sistema

### 6.1. Ejecución de Pruebas Automatizadas (Unit Tests y Seguridad)
Para validar que el núcleo de autenticación, validación de políticas y honeypots funcionen correctamente:
```bash
npm test
```
*Las pruebas se ejecutan mediante Jest (`tests/auth.test.js`) validando:*
- Bloqueo de inyecciones y bots vía Honeypot.
- Cumplimiento de la política de contraseñas mediante esquemas Zod.
- Integridad de asignación obligatoria de `sede_id` para encargados.

### 6.2. Monitoreo de Recursos y Limpieza de Docker
Para consultar el consumo de recursos de la base de datos:
```bash
docker stats inventario_db
```
Para reiniciar la base de datos de manera limpia preservando el volumen de datos:
```bash
docker compose restart db
```

---

## 7. Planes de Respaldo, Restauración y Sincronización Nube

El sistema cuenta con un motor de contingencia robusto integrado en la interfaz administrativa:

### 7.1. Generación de Respaldos (Backup)
* **Desde la Interfaz Gráfica:**
  1. Inicia sesión con rol `ADMINISTRADOR`.
  2. En el panel superior del catálogo, presiona el botón **"Backup"**.
  3. El sistema descargará un archivo `.sql` autocontenido con la marca de tiempo exacta (ej. `backup_inventario_ce_2026-10-21.sql`).
* **Desde Terminal (Docker Dump):**
  ```bash
  docker exec -t inventario_db pg_dump -U postgres -d inventario_electrico_ce > backups/dump_manual.sql
  ```

### 7.2. Restauración de Datos
* **Restaurar Último (1-Clic):**
  Presiona el botón **"Restaurar Último"** en la barra de herramientas. El sistema localiza el último punto de control seguro en la carpeta `backups/` y revierte la base de datos de forma transaccional.
* **Subir Archivo `.sql`:**
  Presiona el botón **"Subir .SQL"**, selecciona el archivo deseado y el backend ejecutará la transacción restaurando productos, existencias, sedes y usuarios.

### 7.3. Sincronización con Neon Cloud
Presionando el botón **"Sync Neon"**, el sistema sincroniza las existencias locales de Docker con la instancia remota configurada en `NEON_DATABASE_URL`, garantizando redundancia en caso de contingencia física de los servidores locales.

---

## 8. Auditoría, Seguridad y Control de Sesiones

### 8.1. Política de Contraseñas Corporativa
Toda contraseña registrada o modificada debe cumplir de manera estricta la siguiente regla de complejidad validada por Zod ([src/validators/authValidator.js](file:///src/validators/authValidator.js)):
* Longitud mínima de **12 caracteres**.
* Al menos **1 letra mayúscula** (`A-Z`).
* Al menos **1 letra minúscula** (`a-z`).
* Al menos **3 dígitos numéricos** (`0-9`).
* Al menos **1 carácter especial** (`!@#$%^&*(),.?":{}|<>`).

### 8.2. Prohibición de Doble Sesión Simultánea
Para garantizar trazabilidad legal de los inventarios:
1. Al iniciar sesión un usuario, se invalida cualquier sesión activa anterior mediante la tabla `token_blacklist`.
2. Se emite un evento WebSocket `forzar_cierre_sesion` que desconecta instantáneamente cualquier otra pestaña o dispositivo con dicha cuenta.

### 8.3. Auditoría de Actividad (Kardex Digital)
Cada movimiento físico de inventario, cambio de precio, login, rechazo de solicitud o despacho genera un registro inmutable en la tabla `auditoria_sistema` con:
* `usuario_id` y `usuario_nombre`.
* `accion` (ej. `LOGIN`, `TRANSFERENCIA`, `CREAR_PRODUCTO`, `BACKUP`).
* `detalles` (descripción completa con valores anteriores y nuevos).
* `ip_origen` y `created_at`.

---

## 9. Solución de Problemas Frecuentes (Troubleshooting)

### Problema 1: `Port 4000 is already in use`
* **Causa:** Quedó una instancia previa de Node.js ejecutándose en segundo plano.
* **Solución en Windows:**
  ```powershell
  # Localizar el proceso y finalizarlo:
  netstat -ano | findstr :4000
  taskkill /PID <PID_NUMERO> /F
  ```

### Problema 2: Error al conectar a PostgreSQL (`ECONNREFUSED 127.0.0.1:5433`)
* **Causa:** El contenedor Docker no se ha levantado o Docker Desktop no ha iniciado.
* **Solución:**
  1. Abre Docker Desktop y espera a que el icono esté en verde.
  2. Ejecuta `docker compose up -d`.
  3. Comprueba el log con `docker logs inventario_db`.

### Problema 3: "Doble sesión detectada"
* **Causa:** El usuario inició sesión en otro navegador o computador.
* **Solución:** La sesión antigua se cierra automáticamente por seguridad. Si se sospecha compromiso de credenciales, el Administrador puede forzar el cambio de clave desde el panel de usuarios.

---
*Manual elaborado para el Departamento de Tecnología — Grupo Eléctrico CE.*
