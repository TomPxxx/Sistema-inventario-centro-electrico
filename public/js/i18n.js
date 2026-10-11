/**
 * SISTEMA DE INTERNACIONALIZACIÓN (i18n) - GRUPO ELÉCTRICO CE
 * Soporta cambio dinámico de idioma (Español / English)
 * Sin afectar bases de datos ni depender del traductor de Google.
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

    // Menú Lateral
    menu_main: "PANEL PRINCIPAL",
    menu_dashboard: "Panel Operativo",
    menu_transfer: "Mover Stock",
    menu_requests: "Solicitudes de Red",
    menu_admin: "ADMINISTRACIÓN",
    menu_dashboards: "Dashboards",
    menu_access: "Aprobar Accesos",
    menu_arrivals: "Distribuir Llegadas",
    menu_new_product: "Nuevo Producto",
    menu_audit: "Vigilancia / Logs",
    badge_audit: "Auditoría",
    badge_live: "En Vivo",

    // Tabla de Inventario y Botones de Acción
    inv_title: "Catálogo y Existencias",
    btn_backup: "Backup",
    btn_restore: "Restaurar",
    btn_restore_latest: "Restaurar Último",
    btn_upload_sql: "Subir .SQL",
    btn_sync_neon: "Sync Neon",
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

    // Modal Auditoría / Logs
    audit_modal_title: "Registro de Auditoría y Vigilancia del Sistema",
    audit_modal_desc: "Monitoreo en tiempo real de operaciones, movimientos, modificaciones y acciones de usuarios.",
    audit_filter_all: "Todas las Acciones",
    audit_search_placeholder: "Buscar por usuario o detalle...",
    th_date: "Fecha / Hora",
    th_user: "Usuario / Actor",
    th_action: "Acción",
    th_details: "Detalles de la Operación",
    th_ip: "Dirección IP",
    btn_close: "Cerrar",
    btn_save: "Guardar",
    btn_cancel: "Cancelar",
    btn_edit: "Editar",
    btn_delete: "Eliminar",

    // Modal: Llegadas / Distribución
    arrivals_title: "Distribución de Mercancía Recibida",
    th_receiving_branch: "Sede Receptora",
    th_employee: "Encargado / Empleado",
    th_status: "Estado",

    // Modal: Edición de Producto
    edit_product_title: "Editar Producto",
    lbl_sku: "Código SKU *",
    lbl_unit: "Unidad de Medida",
    lbl_prod_name: "Nombre del Material *",
    lbl_category: "Categoría del Catálogo",
    lbl_brand: "Marca / Fabricante",
    lbl_desc: "Descripción Técnica",
    lbl_image: "Actualizar Imagen",
    lbl_stock_price_branches: "Stock Actual y Precio de Venta por Sede:",
    btn_update_product: "Actualizar Producto",

    // Paginación
    page_showing: "Mostrando",
    page_to: "a",
    page_of: "de",
    page_products: "productos",
    page_prev: "Anterior",
    page_next: "Siguiente",
    page_first: "Primero",
    page_last: "Último"
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
    logout: "Exit",
    theme_toggle: "Toggle Theme",
    lang_toggle: "Language",

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
    menu_audit: "Surveillance / Logs",
    badge_audit: "Audit",
    badge_live: "Live",

    // Inventory Table & Action Buttons
    inv_title: "Catalog & Stock Levels",
    btn_backup: "Backup",
    btn_restore: "Restore",
    btn_restore_latest: "Restore Latest",
    btn_upload_sql: "Upload .SQL",
    btn_sync_neon: "Sync Neon",
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

    // Modal Auditoría / Logs
    audit_modal_title: "System Audit & Surveillance Logs",
    audit_modal_desc: "Real-time monitoring of operations, transfers, product updates, and administrative actions.",
    audit_filter_all: "All Actions",
    audit_search_placeholder: "Search by user or details...",
    th_date: "Date / Time",
    th_user: "User / Actor",
    th_action: "Action",
    th_details: "Operation Details",
    th_ip: "IP Address",
    btn_close: "Close",
    btn_save: "Save",
    btn_cancel: "Cancel",
    btn_edit: "Edit",
    btn_delete: "Delete",

    // Modal: Arrivals / Distribution
    arrivals_title: "Incoming Goods Distribution",
    th_receiving_branch: "Receiving Branch",
    th_employee: "Manager / Employee",
    th_status: "Status",

    // Modal: Edit Product
    edit_product_title: "Edit Product",
    lbl_sku: "SKU Code *",
    lbl_unit: "Unit of Measure",
    lbl_prod_name: "Material / Item Name *",
    lbl_category: "Catalog Category",
    lbl_brand: "Brand / Manufacturer",
    lbl_desc: "Technical Description",
    lbl_image: "Update Image",
    lbl_stock_price_branches: "Current Stock and Sale Price by Branch:",
    btn_update_product: "Update Product",

    // Pagination
    page_showing: "Showing",
    page_to: "to",
    page_of: "of",
    page_products: "products",
    page_prev: "Previous",
    page_next: "Next",
    page_first: "First",
    page_last: "Last"
  }
};

let currentLang = localStorage.getItem('app_lang') || 'es';

function setLanguage(lang) {
  if (!translations[lang]) return;
  currentLang = lang;
  localStorage.setItem('app_lang', lang);

  // Actualizar todos los elementos con atributo data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[currentLang] && translations[currentLang][key]) {
      el.textContent = translations[currentLang][key];
    }
  });

  // Actualizar placeholders con data-i18n-placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (translations[currentLang] && translations[currentLang][key]) {
      el.setAttribute('placeholder', translations[currentLang][key]);
    }
  });

  // Actualizar títulos con data-i18n-title
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (translations[currentLang] && translations[currentLang][key]) {
      el.setAttribute('title', translations[currentLang][key]);
    }
  });

  // Actualizar indicadores visuales de idioma
  const labels = document.querySelectorAll('.lang-indicator');
  labels.forEach(lbl => {
    lbl.textContent = currentLang.toUpperCase();
  });

  // Actualizar atributo lang en html
  document.documentElement.lang = currentLang;

  // Re-renderizar vistas dinámicas de catálogo si están visibles
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
}

function toggleLanguage() {
  const nextLang = currentLang === 'es' ? 'en' : 'es';
  setLanguage(nextLang);
}

// Inicializar al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
  setLanguage(currentLang);
});
