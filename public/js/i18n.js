/**
 * SISTEMA DE INTERNACIONALIZACIÓN (i18n) - GRUPO ELÉCTRICO CE
 * Soporta cambio dinámico de idioma (Español / English)
 * Sin recargar la página, sin afectar bases de datos y sin dependencias externas.
 */

const translations = {
  es: {
    // Auth & General
    app_title: "GRUPO ELÉCTRICO",
    app_subtitle: "SOFTWARE DE INVENTARIO",
    app_welcome: "Sistema de Inventario Multi-Sede",
    login_title: "Portal de Ingreso",
    username: "Usuario",
    username_placeholder: "Digita tu nombre de usuario",
    password: "Contraseña",
    password_placeholder: "Digita tu contraseña",
    btn_login: "Iniciar Sesión",
    btn_login_google: "Iniciar con Google",
    btn_forgot_password: "¿Olvidaste tu contraseña?",
    btn_register: "Solicitar Nuevo Registro",
    connected_branches: "Sedes Conectadas",
    connected_branches_count: "4 Sedes Conectadas",
    online: "EN LÍNEA",
    role: "Rol",
    logout: "Salir",
    theme_toggle: "Cambiar Tema",
    lang_toggle: "Idioma",

    // Tabs y Formularios de Auth
    tab_login: "Ingreso al Sistema",
    tab_register: "Crear Nuevo Usuario",
    lbl_user_email: "Usuario o Correo",
    lbl_password: "Contraseña de Seguridad",
    btn_login_submit: "Ingresar",
    lbl_or_login_with: "O INGRESA CON",
    lbl_full_name: "Nombre Completo",
    lbl_username_login: "Usuario (Login)",
    lbl_email: "Correo Electrónico",
    lbl_role: "Rol",
    lbl_assigned_branch: "Sede Asignada",
    lbl_password_policy_hint: "Mín. 12 caracteres (1 mayúscula, 1 minúscula, 3 números y 1 símbolo especial).",
    btn_register_submit: "Registrarse",
    btn_send_pin: "Enviar Código de Recuperación",
    btn_confirm_reset: "Restablecer Contraseña",
    btn_accept_policy: "Aceptar y Continuar",

    // Menú Lateral (Sidebar)
    menu_main: "PANEL PRINCIPAL",
    menu_dashboard: "Panel Operativo",
    menu_transfer: "Mover Stock",
    menu_requests: "Solicitudes de Red",
    menu_admin: "ADMINISTRACIÓN",
    menu_dashboards: "Dashboards",
    menu_access: "Aprobar Accesos",
    menu_arrivals: "Distribuir Llegadas",
    menu_new_product: "Nuevo Producto",
    menu_audit: "Actividad",
    badge_audit: "Historial",
    badge_live: "En Vivo",

    // Tabla de Inventario y Botones de Acción
    inv_title: "Catálogo y Existencias",
    btn_backup: "Backup",
    btn_restore: "Restaurar",
    btn_restore_latest: "Restaurar Último",
    btn_upload_sql: "Subir Copia",
    btn_sync_neon: "Sincronizar Nube",
    btn_new_entry: "Nueva Entrada",
    btn_refresh: "Actualizar",
    tab_all: "Todas",
    search_placeholder: "Buscar por SKU, producto o marca...",
    filter_all_categories: "Todas las Categorías",
    filter_all_branches: "Todas las Sedes",
    th_sku: "SKU",
    th_sku_product: "SKU / Producto",
    th_product: "Producto",
    th_category: "Categoría",
    th_unit: "Unidad",
    th_stock: "Existencias",
    th_price: "Precio Venta",
    th_actions: "Acciones",
    th_total_network: "Total Red",
    th_branch_price: "Precio Venta Sede",
    th_branch_stock: "Stock en Sede",
    loading_data: "Cargando datos...",
    uncategorized: "Sin Categoría",
    product_count_suffix: "producto(s)",
    back_to_categories: "Volver a Categorías",

    // Botones de Operación / Dashboard
    btn_register_arrival: "Registrar Llegada",
    btn_request_material: "Pedir Material a la Red",
    btn_yield_material: "Ceder Mercancía",
    btn_scan: "Escanear",
    btn_register_delivery: "Registrar Entrega",
    btn_save_product: "Guardar Producto",
    btn_confirm_transfer: "Confirmar Traslado",
    btn_save_category: "Guardar Categoría",
    btn_cancel: "Cancelar",
    btn_close: "Cerrar",
    btn_save: "Guardar",
    btn_edit: "Editar",
    btn_delete: "Eliminar",
    btn_delete_confirm: "Eliminar Definitivamente",

    // Títulos de Modales
    policy_modal_title: "Política de Tratamiento de Datos",
    forgot_password_title: "Recuperar Contraseña",
    create_product_title: "Crear Nuevo Producto",
    new_product_title: "Registrar Entrada Nueva",
    transfer_modal_title: "Traslado de Stock Entre Sedes",
    create_category_title: "Nueva Categoría",
    edit_product_title: "Editar Producto",
    delete_product_title: "¿Eliminar Producto?",
    network_requests_title: "Red de Solicitudes y Traslados entre Sedes",
    request_material_title: "Pedir Material a la Red de Sedes",
    yield_material_title: "Ceder Mercancía a Otra Sede",
    admin_attend_request_title: "Atender Solicitud de Material (Admin)",
    register_arrival_title: "Registrar Llegada de Mercancía",
    count_goods_title: "Conteo de Mercancía",

    // Modal Auditoría / Logs
    audit_modal_title: "Registro de Actividad",
    audit_modal_desc: "",
    audit_filter_all: "Todas las Acciones",
    audit_search_placeholder: "Buscar por usuario o detalle...",
    th_date: "Fecha y Hora",
    th_user: "Usuario",
    th_action: "Acción",
    th_details: "Detalles",
    th_ip: "Dirección IP",

    // Modal: Llegadas / Distribución
    arrivals_title: "Distribución de Mercancía Recibida",
    th_receiving_branch: "Sede Receptora",
    th_employee: "Encargado / Empleado",
    th_status: "Estado",

    // Formulario de Producto (Crear / Editar)
    lbl_sku: "Código SKU *",
    lbl_sku_code: "Código SKU *",
    lbl_unit: "Unidad de Medida",
    lbl_unit_measure: "Unidad de Medida",
    lbl_prod_name: "Nombre del Material *",
    lbl_product_name: "Nombre del Producto *",
    lbl_category: "Categoría",
    lbl_brand: "Marca / Fabricante",
    lbl_desc: "Descripción Técnica (Opcional)",
    lbl_image: "Imagen del Producto",
    lbl_stock_price_branches: "Stock Actual y Precio de Venta por Sede:",
    btn_update_product: "Actualizar Producto",

    // Formulario de Traslado
    lbl_product_to_move: "Producto a Mover",
    lbl_origin_branch: "Sede Origen",
    lbl_dest_branch: "Sede Destino",
    lbl_qty: "Cantidad",
    lbl_observations: "Observaciones",
    lbl_courier: "Empleado Corredor (Transporta la mercancía)",

    // Vista Empleado
    empleado_title: "Consulta de Precios y Traslados",
    empleado_subtitle: "Verificación rápida y entregas.",
    quick_price_title: "Consulta de Precios",
    transfers_between_branches_title: "Traslados Entre Sedes",

    // Paginación
    page_showing: "Mostrando",
    page_to: "a",
    page_of: "de",
    page_products: "productos",
    page_prev: "Anterior",
    page_next: "Siguiente",
    page_first: "Primero",
    page_last: "Último",

    // Modales de Operaciones y Red
    lbl_price_unit: "Precio Unitario ($)",
    lbl_initial_branch: "Sede de Ingreso Inicial",
    lbl_initial_stock: "Stock Inicial",
    btn_broadcast_request: "Emitir Solicitud a Todas las Sedes",
    lbl_receiving_branch_dest: "Sede Receptora (Destino)",
    lbl_materials_to_request: "Materiales a Solicitar",
    btn_add_another_product: "+ Agregar otro producto",
    lbl_urgency_reason: "Motivo / Nivel de Urgencia",
    lbl_dest_branch_accepts: "Sede Destino (Aceptará la mercancía)",
    lbl_product_to_transfer: "Producto a Transferir",
    lbl_qty_to_yield: "Cantidad a Ceder",
    lbl_reason_observation: "Motivo / Observación",
    btn_send_transfer_proposal: "Enviar Propuesta de Traslado",
    accept_request_title: "Aceptar Solicitud de Material",
    lbl_qty_to_dispatch: "Cantidad a Despachar / Enviar",
    lbl_assign_courier_opt: "Asignar Corredor Logístico (Opcional)",
    lbl_rejection_reason: "Motivo del Rechazo",
    btn_confirm: "Confirmar",
    btn_confirm_dispatch: "Confirmar Despacho y Poner en Tránsito",
    assign_courier_title: "Asignar Corredor Logístico",
    lbl_responsible_courier: "Empleado Corredor Responsable *",
    session_locked_title: "Sesión Bloqueada",
    session_locked_desc: "Por seguridad, la sesión se bloqueó tras 2 minutos de inactividad. Ingresa tu contraseña para continuar donde lo dejaste.",
    btn_unlock_session: "Desbloquear Sesión",
    pending_users_title: "Solicitudes de Acceso Pendientes",
    th_name: "Nombre / Usuario",
    th_email: "Correo / Origen",
    th_assign_role_branch: "Asignar Rol / Sede",
    lbl_assigned_employee_count: "Empleado Asignado para Conteo",
    btn_create_count_task: "Crear Tarea de Conteo",
    btn_add: "Añadir",
    btn_finish_count_send: "Finalizar Conteo y Enviar",
    lbl_brand_req: "Marca",
    lbl_quantity_req: "Cantidad",

    // Nuevas traducciones (Puntos 3 a 8)
    lbl_register_pending_notice: "Tu solicitud quedará en estado PENDIENTE. Un Administrador verificará tu identidad y te asignará tu Rol y Sede antes de habilitar tu acceso.",
    pending_approval_modal_title: "Pendiente de Aprobación",
    pending_approval_modal_desc: "Tu solicitud de registro fue enviada correctamente. Un Administrador debe aprobar tu cuenta y asignarte un Rol y Sede antes de que puedas ingresar.",
    pending_approval_listening: "Esperando confirmación del administrador en tiempo real...",
    btn_back_to_login: "Volver al Inicio de Sesión",
    pending_approval_success_title: "¡Registro exitoso!",
    btn_login_now: "Iniciar Sesión Ahora",
    menu_users_panel: "Panel de Usuarios",
    admin_users_modal_title: "Panel de Usuarios",
    admin_users_modal_desc: "",
    lbl_total_users: "Total de Usuarios",
    lbl_online_users: "En Línea",
    lbl_offline_users: "Desconectados",
    th_presence: "Conexión",
    th_last_login: "Último Acceso",
    btn_force_logout: "Cerrar Sesión",
    btn_delete_user: "Eliminar",
    status_online: "En línea",
    status_offline: "Desconectado",
    barcode_modal_title: "Lector de Código de Barras / SKU",
    barcode_https_warning_title: "Se requiere HTTPS o localhost para usar la cámara",
    barcode_https_warning_desc: "Por seguridad del navegador, el acceso a la cámara web solo está habilitado bajo conexiones seguras (HTTPS) o desde localhost. Puedes usar el campo manual inferior o un lector láser USB.",
    barcode_align_hint: "Alinea el código de barras o QR dentro del recuadro",
    barcode_manual_placeholder: "O digita / escanea el código SKU manualmente...",
    btn_search_code: "Buscar",
    encargado_subtitle: "Gestión de almacén local.",
    assigned_counting_tasks_title: "Tareas de Conteo Asignadas",
    btn_new_category: "+ Categoría",
    btn_create_new_category: "+ Crear Categoría",
    edit_category_title: "Editar Perfil de Categoría",
    lbl_category_name: "Nombre de la Categoría *",
    lbl_category_profile_image: "Imagen de la Categoría",
    category_image_fallback_hint: "",
    btn_use_fallback_icon: "Quitar Imagen"
  },
  en: {
    // Auth & General
    app_title: "ELECTRIC GROUP",
    app_subtitle: "INVENTORY SOFTWARE",
    app_welcome: "Multi-Branch Inventory System",
    login_title: "Access Portal",
    username: "Username",
    username_placeholder: "Enter your username",
    password: "Password",
    password_placeholder: "Enter your password",
    btn_login: "Log In",
    btn_login_google: "Sign in with Google",
    btn_forgot_password: "Forgot your password?",
    btn_register: "Request Account",
    connected_branches: "Connected Branches",
    connected_branches_count: "4 Connected Branches",
    online: "ONLINE",
    role: "Role",
    logout: "Log Out",
    theme_toggle: "Toggle Theme",
    lang_toggle: "Language",

    // Tabs & Auth Forms
    tab_login: "System Login",
    tab_register: "Create New User",
    lbl_user_email: "Username or Email",
    lbl_password: "Security Password",
    btn_login_submit: "Sign In",
    lbl_or_login_with: "OR SIGN IN WITH",
    lbl_full_name: "Full Name",
    lbl_username_login: "Username (Login)",
    lbl_email: "Corporate Email",
    lbl_role: "Role",
    lbl_assigned_branch: "Assigned Branch",
    lbl_password_policy_hint: "Min. 12 chars (1 uppercase, 1 lowercase, 3 numbers and 1 special symbol).",
    btn_register_submit: "Register",
    btn_send_pin: "Send Recovery Code",
    btn_confirm_reset: "Reset Password",
    btn_accept_policy: "Accept and Continue",

    // Sidebar
    menu_main: "MAIN PANEL",
    menu_dashboard: "Operational Panel",
    menu_transfer: "Transfer Stock",
    menu_requests: "Network Requests",
    menu_admin: "ADMINISTRATION",
    menu_dashboards: "Dashboards",
    menu_access: "Approve Users",
    menu_arrivals: "Distribute Arrivals",
    menu_new_product: "New Product",
    menu_audit: "Activity",
    badge_audit: "History",
    badge_live: "Live",

    // Inventory Table & Action Buttons
    inv_title: "Catalog & Stock Levels",
    btn_backup: "Backup",
    btn_restore: "Restore",
    btn_restore_latest: "Restore Latest",
    btn_upload_sql: "Upload Backup",
    btn_sync_neon: "Sincronizar Nube",
    btn_new_entry: "New Entry",
    btn_refresh: "Refresh",
    tab_all: "All",
    search_placeholder: "Search by SKU, product name or brand...",
    filter_all_categories: "All Categories",
    filter_all_branches: "All Branches",
    th_sku: "SKU",
    th_sku_product: "SKU / Product",
    th_product: "Product",
    th_category: "Category",
    th_unit: "Unit",
    th_stock: "Stock",
    th_price: "Sale Price",
    th_actions: "Actions",
    th_total_network: "Total Network",
    th_branch_price: "Branch Sale Price",
    th_branch_stock: "Branch Stock",
    loading_data: "Loading data...",
    uncategorized: "Uncategorized",
    product_count_suffix: "product(s)",
    back_to_categories: "Back to Categories",

    // Operation & Dashboard Buttons
    btn_register_arrival: "Register Arrival",
    btn_request_material: "Request Material",
    btn_yield_material: "Transfer Merchandise",
    btn_scan: "Scan",
    btn_register_delivery: "Register Delivery",
    btn_save_product: "Save Product",
    btn_confirm_transfer: "Confirm Transfer",
    btn_save_category: "Save Category",
    btn_cancel: "Cancel",
    btn_close: "Close",
    btn_save: "Save",
    btn_edit: "Edit",
    btn_delete: "Delete",
    btn_delete_confirm: "Permanently Delete",

    // Modal Titles
    policy_modal_title: "Data Protection & Privacy Policy",
    forgot_password_title: "Recover Password",
    create_product_title: "Create New Product",
    new_product_title: "Register New Inbound Stock",
    transfer_modal_title: "Stock Transfer Between Branches",
    create_category_title: "New Category",
    edit_product_title: "Edit Product",
    delete_product_title: "Delete Product?",
    network_requests_title: "Network Requests & Branch Transfers",
    request_material_title: "Request Material from Branches",
    yield_material_title: "Transfer Goods to Another Branch",
    admin_attend_request_title: "Process Material Request (Admin)",
    register_arrival_title: "Register Incoming Goods",
    count_goods_title: "Goods Inventory Count",

    // System Audit & Logs
    audit_modal_title: "Activity History",
    audit_modal_desc: "",
    audit_filter_all: "All Actions",
    audit_search_placeholder: "Search by user or details...",
    th_date: "Date / Time",
    th_user: "User",
    th_action: "Action",
    th_details: "Operation Details",
    th_ip: "IP Address",

    // Modal: Arrivals / Distribution
    arrivals_title: "Incoming Goods Distribution",
    th_receiving_branch: "Receiving Branch",
    th_employee: "Manager / Employee",
    th_status: "Status",

    // Product Form (Create / Edit)
    lbl_sku: "SKU Code *",
    lbl_sku_code: "SKU Code *",
    lbl_unit: "Unit of Measure",
    lbl_unit_measure: "Unit of Measure",
    lbl_prod_name: "Material / Item Name *",
    lbl_product_name: "Product Name *",
    lbl_category: "Category",
    lbl_brand: "Brand / Manufacturer",
    lbl_desc: "Technical Description (Optional)",
    lbl_image: "Product Photo",
    lbl_stock_price_branches: "Current Stock and Sale Price by Branch:",
    btn_update_product: "Update Product",

    // Transfer Form
    lbl_product_to_move: "Product to Move",
    lbl_origin_branch: "Origin Branch",
    lbl_dest_branch: "Destination Branch",
    lbl_qty: "Quantity",
    lbl_observations: "Observations",
    lbl_courier: "Courier (Transports the goods)",

    // Empleado View
    empleado_title: "Price Inquiry and Transfers",
    empleado_subtitle: "Quick verification and deliveries.",
    quick_price_title: "Price Check",
    transfers_between_branches_title: "Transfers Between Branches",

    // Pagination
    page_showing: "Showing",
    page_to: "to",
    page_of: "of",
    page_products: "products",
    page_prev: "Previous",
    page_next: "Next",
    page_first: "First",
    page_last: "Last",

    // Operations & Network Modals
    lbl_price_unit: "Unit Price ($)",
    lbl_initial_branch: "Initial Inbound Branch",
    lbl_initial_stock: "Initial Stock",
    btn_broadcast_request: "Broadcast Request to All Branches",
    lbl_receiving_branch_dest: "Receiving Branch (Destination)",
    lbl_materials_to_request: "Materials to Request",
    btn_add_another_product: "+ Add another product",
    lbl_urgency_reason: "Reason / Urgency Level",
    lbl_dest_branch_accepts: "Destination Branch (Accepts goods)",
    lbl_product_to_transfer: "Product to Transfer",
    lbl_qty_to_yield: "Quantity to Yield",
    lbl_reason_observation: "Reason / Observation",
    btn_send_transfer_proposal: "Send Transfer Proposal",
    accept_request_title: "Accept Material Request",
    lbl_qty_to_dispatch: "Quantity to Dispatch / Send",
    lbl_assign_courier_opt: "Assign Courier (Optional)",
    lbl_rejection_reason: "Rejection Reason",
    btn_confirm: "Confirm",
    btn_confirm_dispatch: "Confirm Dispatch & Set In Transit",
    assign_courier_title: "Assign Delivery Courier",
    lbl_responsible_courier: "Responsible Courier Employee *",
    session_locked_title: "Session Locked",
    session_locked_desc: "For security, your session was locked after 2 minutes of inactivity. Enter your password to continue.",
    btn_unlock_session: "Unlock Session",
    pending_users_title: "Pending Access Requests",
    th_name: "Name / Username",
    th_email: "Email / Provider",
    th_assign_role_branch: "Assign Role / Branch",
    lbl_assigned_employee_count: "Assigned Counting Employee",
    btn_create_count_task: "Create Counting Task",
    btn_add: "Add",
    btn_finish_count_send: "Finish Count & Send",
    lbl_brand_req: "Brand",
    lbl_quantity_req: "Quantity",

    // New translations (Points 3 to 8)
    lbl_register_pending_notice: "Your request will remain in PENDING status. An Administrator will verify your identity and assign your Role and Branch before enabling access.",
    pending_approval_modal_title: "Pending Approval",
    pending_approval_modal_desc: "Your registration request was submitted. An Administrator must approve your account and assign a Role and Branch before you can sign in.",
    pending_approval_listening: "Waiting for real-time administrator confirmation...",
    btn_back_to_login: "Back to Login",
    pending_approval_success_title: "Registration Successful!",
    btn_login_now: "Sign In Now",
    menu_users_panel: "Users Panel",
    admin_users_modal_title: "Users Panel",
    admin_users_modal_desc: "",
    lbl_total_users: "Total Users",
    lbl_online_users: "Online",
    lbl_offline_users: "Offline",
    th_presence: "Connection",
    th_last_login: "Last Login",
    btn_force_logout: "End Session",
    btn_delete_user: "Delete",
    status_online: "Online",
    status_offline: "Offline",
    barcode_modal_title: "Barcode / SKU Scanner",
    barcode_https_warning_title: "HTTPS or localhost is required to access the camera",
    barcode_https_warning_desc: "For browser security, camera access is only enabled over secure connections (HTTPS) or localhost. You can use the manual input below or a USB laser scanner.",
    barcode_align_hint: "Align the barcode or QR code inside the frame",
    barcode_manual_placeholder: "Or type / scan the SKU code manually...",
    btn_search_code: "Search",
    encargado_subtitle: "Local warehouse management.",
    assigned_counting_tasks_title: "Assigned Counting Tasks",
    btn_new_category: "+ Category",
    btn_create_new_category: "+ Create Category",
    edit_category_title: "Edit Category Profile",
    lbl_category_name: "Category Name *",
    lbl_category_profile_image: "Category Image",
    category_image_fallback_hint: "If no image is uploaded (or if removed), the fallback electrical icon tile will be displayed automatically.",
    btn_use_fallback_icon: "Use Fallback Icon"
  }
};

let currentLang = localStorage.getItem('app_lang') || 'es';

/**
 * Función auxiliar para obtener traducciones desde JS dinámico
 */
function t(key, fallback = '') {
  return translations[currentLang]?.[key] || fallback || key;
}
window.t = t;
window.getCurrentLang = () => currentLang;

/**
 * Aplica el idioma seleccionado al DOM de manera inteligente
 */
function setLanguage(lang) {
  if (!translations[lang]) return;
  currentLang = lang;
  localStorage.setItem('app_lang', lang);

  // 1. Actualizar elementos con data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translatedText = translations[currentLang]?.[key];
    if (!translatedText) return;

    // Si tiene un icono material-symbols-outlined, preservar el icono y actualizar solo el texto
    const icon = el.querySelector('.material-symbols-outlined');
    if (icon) {
      const textElement = Array.from(el.children).find(c => c !== icon && (c.tagName === 'SPAN' || c.tagName === 'B' || c.tagName === 'STRONG' || c.tagName === 'DIV'));
      if (textElement) {
        textElement.textContent = translatedText;
      } else {
        let textNodeFound = false;
        for (let n of el.childNodes) {
          if (n.nodeType === 3 && n.nodeValue.trim().length > 0) {
            n.nodeValue = ' ' + translatedText;
            textNodeFound = true;
            break;
          }
        }
        if (!textNodeFound) {
          el.innerHTML = `${icon.outerHTML} <span>${translatedText}</span>`;
        }
      }
    } else {
      el.textContent = translatedText;
    }
  });

  // 2. Actualizar placeholders con data-i18n-placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (translations[currentLang]?.[key]) {
      el.setAttribute('placeholder', translations[currentLang][key]);
    }
  });

  // 3. Actualizar títulos con data-i18n-title
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (translations[currentLang]?.[key]) {
      el.setAttribute('title', translations[currentLang][key]);
    }
  });

  // 4. Actualizar indicadores visuales de idioma (ES / EN)
  document.querySelectorAll('.lang-indicator').forEach(lbl => {
    lbl.textContent = currentLang.toUpperCase();
  });

  // 5. Actualizar atributo lang en <html>
  document.documentElement.lang = currentLang;

  // 6. Si hay funciones dinámicas de re-renderizado en la vista activa, invocarlas
  if (typeof renderAdminView === 'function') {
    const adminView = document.getElementById('viewAdmin');
    if (adminView && !adminView.classList.contains('hidden')) {
      renderAdminView();
    }
  }
  if (typeof renderEncargadoView === 'function') {
    const encView = document.getElementById('viewEncargado');
    if (encView && !encView.classList.contains('hidden')) {
      renderEncargadoView();
    }
  }
  if (typeof window.updatePasswordChecklist === 'function') {
    window.updatePasswordChecklist('regPassword', 'regPasswordChecklist');
    window.updatePasswordChecklist('recoveryNewPassword', 'recoveryPasswordChecklist');
  }
  if (typeof window.renderAdminUsersTable === 'function' && typeof adminUsersCache !== 'undefined' && Array.isArray(adminUsersCache) && adminUsersCache.length > 0) {
    window.renderAdminUsersTable(adminUsersCache);
  }
}
window.setLanguage = setLanguage;

/**
 * Alterna entre Español e Inglés
 */
function toggleLanguage() {
  const nextLang = currentLang === 'es' ? 'en' : 'es';
  setLanguage(nextLang);
}
window.toggleLanguage = toggleLanguage;

// Inicializar al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
  setLanguage(currentLang);
});
