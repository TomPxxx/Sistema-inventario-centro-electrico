# ⚡ Grupo Eléctrico - Sistema de Inventario Multisede

Sistema de gestión y control de inventario multisede para material eléctrico y suministros industriales, desarrollado con arquitectura escalable, vistas personalizadas por rol y persistencia en MySQL.

---

## 👥 Guía para el Equipo de Desarrollo (Trabajar Juntos)

¡Bienvenidos al repositorio! Para mantener el código sincronizado y trabajar sin conflictos, sigan esta guía paso a paso.

### 1. 📥 Primeros Pasos: Clonar y Configurar el Proyecto

Cada colaborador debe ejecutar en su terminal:

```bash
# 1. Clonar el repositorio
git clone https://github.com/TomPxxx/Sistema-inventario-centro-electrico.git

# 2. Entrar a la carpeta del proyecto
cd Sistema-inventario-centro-electrico

# 3. Instalar las dependencias de Node.js
npm install

# 4. Crear el archivo de variables de entorno a partir del ejemplo
cp .env.example .env
```

### 2. 🗄️ Base de Datos Local

1. Abre tu gestor de base de datos MySQL (MySQL Workbench, phpMyAdmin, DBeaver o XAMPP).
2. Crea la base de datos e importa el esquema inicial ejecutando el script:
   ```sql
   -- Ejecutar el archivo:
   database_schema.sql
   ```
3. Configura tus credenciales en tu archivo local `.env`:
   ```env
   PORT=4000
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=tu_contraseña_mysql
   DB_NAME=inventario_electrico_ce
   DB_PORT=3306
   JWT_SECRET=super_secret_jwt_key_2026
   ```

### 3. 🚀 Ejecutar el Servidor en Desarrollo

```bash
# Iniciar con nodemon (recarga automática ante cambios)
npm run dev

# O iniciar con Node tradicional:
npm start
```
Abre tu navegador en: `http://localhost:4000`

---

## 🌿 Flujo de Trabajo en Git (Para Colaborar en Equipo)

Para evitar sobrescribir el trabajo de los demás, **nunca hagan cambios directos en la rama `main`**. Sigan este flujo:

### Paso 1: Actualizar tu rama `main` local
Antes de empezar a trabajar en algo nuevo, asegúrate de tener lo último que subieron tus compañeros:
```bash
git checkout main
git pull origin main
```

### Paso 2: Crear tu propia rama de trabajo (Branch)
Crea una rama con tu nombre y la tarea que vas a realizar:
```bash
# Ejemplo: git checkout -b feature/nombre-modulo
git checkout -b feature/login-juan
```

### Paso 3: Guardar y subir tus cambios
Cuando hayas probado tus cambios localmente:
```bash
git add .
git commit -m "feat: descripción clara de lo que agregaste o corregiste"
git push -u origin feature/login-juan
```

### Paso 4: Crear un Pull Request (PR) en GitHub
1. Entra a [https://github.com/TomPxxx/Sistema-inventario-centro-electrico](https://github.com/TomPxxx/Sistema-inventario-centro-electrico).
2. Verás un botón verde: **"Compare & pull request"**.
3. Haz clic en él, escribe una breve descripción de tus cambios y presiona **"Create pull request"**.
4. Tomás revisará los cambios y los unirá (**Merge**) a la rama `main`.

---

## 🔑 Cuentas Preconfiguradas para Pruebas

| Rol | Usuario | Clave por defecto | Acceso |
|---|---|---|---|
| **Administrador Global** | `Cesar` | `Admin123*` | Gobernanza total, métricas, 4 sedes, traslados |
| **Encargado de Sede** | `encargado_matriz` | `Encargado123*` | Sede Matriz (Gestión de stock local y pedidos) |
| **Encargado de Sede** | `encargado_ep3` | `Encargado123*` | Sede EP3 (Gestión de stock local y pedidos) |
| **Empleado** | `empleado1` | `Empleado123*` | Consulta de inventario, stock multisede |

---

## 📁 Estructura del Proyecto

```text
├── public/                 # Frontend (HTML5, Google Stitch Tailwind CSS, JavaScript Vanilla)
│   ├── css/style.css       # Estilos complementarios y animaciones
│   ├── index.html          # Interfaz unificada con vistas dinámicas por rol
│   └── js/app.js           # Lógica frontend, consumo de APIs y autenticación
├── src/                    # Backend Node.js / Express
│   ├── config/             # Configuración de base de datos MySQL y variables de entorno
│   ├── controllers/        # Controladores de negocio (Autenticación, Inventario, Traslados)
│   ├── database/           # Scripts de inicialización
│   ├── middlewares/        # Middlewares de seguridad JWT y validación de roles
│   └── routes/             # Rutas API REST (/api/auth, /api/inventory)
├── .env.example            # Plantilla de variables de entorno
├── .gitignore              # Archivos excluidos del control de versiones
├── database_schema.sql     # Esquema completo DDL y datos semilla de MySQL
├── package.json            # Dependencias y scripts del proyecto
└── server.js               # Punto de entrada del servidor Express
```
