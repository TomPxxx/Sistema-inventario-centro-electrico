// =============================================================================
// GRUPO ELÉCTRICO - SISTEMA MULTI-SEDE & LOGÍSTICA
// LÓGICA DE CLIENTE: LOGIN, REGISTRO, CREACIÓN DE PRODUCTOS Y TRASLADOS EN VIVO
// =============================================================================

const API_BASE = '/api';

let currentUser = null;
let currentToken = null;
let liveProducts = []; // Almacena los productos reales traídos de MySQL
let liveCategories = []; // Categorías del inventario

let expectedLoginCaptcha = 0;

function generateLoginCaptcha() {
  const el = document.getElementById('loginCaptchaQuestion');
  const input = document.getElementById('loginCaptchaAnswer');
  if (el && input) {
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    expectedLoginCaptcha = num1 + num2;
    el.textContent = `${num1} + ${num2}`;
    input.value = '';
  }
}

let inactivityTimer = null;
const INACTIVITY_LIMIT = 2 * 60 * 1000; // 2 minutos en ms

function resetInactivityTimer() {
  if (!currentUser) return; // Solo si está logueado
  if (inactivityTimer) clearTimeout(inactivityTimer);
  
  inactivityTimer = setTimeout(() => {
    // Bloquear pantalla
    document.getElementById('inactivityModal').classList.remove('hidden');
    document.getElementById('unlockPassword').value = '';
    document.getElementById('unlockPassword').focus();
  }, INACTIVITY_LIMIT);
}

let eventSource = null;

function connectNotifications() {
  if (eventSource) eventSource.close();
  
  // El backend usa cookies (httpOnly), EventSource las envía si activamos withCredentials
  eventSource = new EventSource(`${API_BASE}/notifications/stream`, { withCredentials: true });
  
  eventSource.onmessage = function(event) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'CONNECTED') return; // Ignorar el primer mensaje

      if (data.type === 'NUEVO_TRASLADO') {
        showNotificationToast(data.message || 'Se ha registrado un nuevo movimiento de inventario.');
        // Refrescar inventario si estamos en vista principal
        if (typeof loadRealInventory === 'function') {
          loadRealInventory();
        }
      } else {
        showNotificationToast(data.message);
      }
    } catch (e) {
      console.error('Error procesando notificación SSE:', e);
    }
  };
}

function showNotificationToast(msg) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'fixed top-20 right-4 z-[300] flex flex-col items-end w-80 max-w-full pointer-events-none gap-2';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'bg-surface-container-highest text-on-surface p-4 rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.4)] border border-primary/30 transform transition-all duration-500 translate-x-full flex items-start gap-3 w-full';
  toast.innerHTML = `
    <span class="material-symbols-outlined text-primary shrink-0 mt-0.5">notifications_active</span>
    <p class="text-xs font-semibold font-sans leading-tight mt-0.5 text-primary-content">${msg}</p>
  `;
  container.appendChild(toast);
  
  // Entra suavemente
  setTimeout(() => toast.classList.remove('translate-x-full'), 50);
  
  // Sale suavemente a los 6 segundos
  setTimeout(() => {
    toast.classList.add('translate-x-full');
    toast.classList.add('opacity-0');
    setTimeout(() => toast.remove(), 500);
  }, 6000);
}

// Configurar listeners de actividad
document.addEventListener('mousemove', resetInactivityTimer);
document.addEventListener('keydown', resetInactivityTimer);
document.addEventListener('click', resetInactivityTimer);

async function handleUnlockSubmit(e) {
  e.preventDefault();
  const pwd = document.getElementById('unlockPassword').value;
  const btn = document.getElementById('btnUnlock');
  
  btn.disabled = true;
  btn.textContent = 'Verificando...';

  try {
    const res = await fetch(`${API_BASE}/auth/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });

    if (res.ok) {
      document.getElementById('inactivityModal').classList.add('hidden');
      resetInactivityTimer();
    } else {
      alert('Contraseña incorrecta');
      document.getElementById('unlockPassword').focus();
    }
  } catch (err) {
    alert('Error al verificar');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Desbloquear Sesión';
  }
}

// =============================================================================
// 1. GESTIÓN DE PESTAÑAS Y FORMULARIOS DE AUTENTICACIÓN
// =============================================================================

function switchAuthTab(tab) {
  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabRegisterBtn = document.getElementById('tabRegisterBtn');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  hideAuthAlert();

  if (tab === 'login') {
    tabLoginBtn.className = 'px-3 py-1.5 rounded-lg font-headline font-bold text-sm bg-primary text-on-primary shadow-md transition-all flex items-center gap-1.5';
    tabRegisterBtn.className = 'px-3 py-1.5 rounded-lg font-headline font-semibold text-sm bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-all flex items-center gap-1.5';
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
  } else {
    tabRegisterBtn.className = 'px-3 py-1.5 rounded-lg font-headline font-bold text-sm bg-primary text-on-primary shadow-md transition-all flex items-center gap-1.5';
    tabLoginBtn.className = 'px-3 py-1.5 rounded-lg font-headline font-semibold text-sm bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-all flex items-center gap-1.5';
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
  }
}

function handleRoleChange() {
  const role = document.getElementById('regRol').value;
  const container = document.getElementById('sedeSelectContainer');
  if (role === 'ENCARGADO') {
    container.classList.remove('hidden');
  } else {
    container.classList.add('hidden');
  }
}

function togglePassVisibility(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (input.type === 'password') {
    input.type = 'text';
    icon.textContent = 'visibility_off';
  } else {
    input.type = 'password';
    icon.textContent = 'visibility';
  }
}

function showAuthAlert(msg, type = 'error') {
  const alertBox = document.getElementById('authAlert');
  const alertMsg = document.getElementById('authAlertMsg');
  const alertIcon = document.getElementById('authAlertIcon');

  alertBox.className = type === 'success'
    ? 'p-3 rounded-lg text-xs font-mono border transition-all flex items-center justify-between bg-primary/15 border-primary text-primary'
    : 'p-3 rounded-lg text-xs font-mono border transition-all flex items-center justify-between bg-error-container/40 border-error text-error';

  alertIcon.textContent = type === 'success' ? 'check_circle' : 'warning';
  alertMsg.textContent = msg;
  alertBox.classList.remove('hidden');
}

function hideAuthAlert() {
  const alertBox = document.getElementById('authAlert');
  if (alertBox) alertBox.classList.add('hidden');
}

// =============================================================================
// 2. ESTADO DE BASE DE DATOS Y ACCESOS RÁPIDOS
// =============================================================================

async function checkDatabaseHealth() {
  const dot = document.getElementById('dbDot');
  const text = document.getElementById('dbStatusText');

  try {
    const res = await fetch(`${API_BASE}/health`);
    const data = await res.json();

    if (res.ok && data.database === 'Connected') {
      dot.className = 'w-2 h-2 rounded-full bg-primary animate-pulse';
      text.textContent = 'MySQL Conectado · 4 Sedes Online';
      text.className = 'text-primary font-semibold';
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-error';
      text.textContent = 'MySQL Desconectado';
      text.className = 'text-error font-semibold';
    }
  } catch (err) {
    dot.className = 'w-2 h-2 rounded-full bg-error';
    text.textContent = 'Backend Offline';
    text.className = 'text-error font-semibold';
  }
}

document.getElementById('btnInitDbTrigger')?.addEventListener('click', async () => {
  const confirmed = confirm('¿Deseas restablecer la base de datos con las 4 sedes de Grupo Eléctrico y el administrador Cesar?');
  if (!confirmed) return;

  try {
    const res = await fetch(`${API_BASE}/auth/init-db`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showAuthAlert('Base de datos restaurada con éxito. Admin configurado como Cesar.', 'success');
      checkDatabaseHealth();
      if (currentUser) loadRealInventory();
    } else {
      showAuthAlert('Error al inicializar BD: ' + data.message);
    }
  } catch (e) {
    showAuthAlert('Error de conexión al restaurar base de datos.');
  }
});

document.querySelectorAll('.quick-login-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('loginUsername').value = btn.dataset.user;
    document.getElementById('loginPassword').value = btn.dataset.pass;
    hideAuthAlert();
    document.getElementById('loginUsername').focus();
  });
});

// =============================================================================
// 3. AUTENTICACIÓN (LOGIN)
// =============================================================================

async function handleLoginSubmit(e) {
  e.preventDefault();
  hideAuthAlert();

  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const honey = document.getElementById('loginHoney') ? document.getElementById('loginHoney').value : '';
  const captchaAnswer = document.getElementById('loginCaptchaAnswer').value;
  
  const btn = document.getElementById('btnLoginSubmit');
  const btnText = document.getElementById('btnLoginText');

  if (!username || !password) {
    showAuthAlert('Ingresa tu usuario y contraseña.');
    return;
  }

  if (parseInt(captchaAnswer) !== expectedLoginCaptcha) {
    showAuthAlert('Validación de seguridad incorrecta (CAPTCHA). Intenta de nuevo.');
    generateLoginCaptcha();
    return;
  }

  btn.disabled = true;
  btnText.textContent = 'Autenticando en Grupo Eléctrico...';

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, _honey: honey })
    });

    const data = await res.json();

    if (!res.ok) {
      showAuthAlert(data.message || 'Credenciales inválidas.');
      btn.disabled = false;
      btnText.textContent = 'Autenticar y Abrir Panel del Software';
      generateLoginCaptcha();
      return;
    }

    // sessionStorage.setItem('token_inventario_ce', data.token); // Eliminado para forzar cierre de sesión al recargar
    currentUser = data.user;
    currentToken = data.token;
    resetInactivityTimer();
    connectNotifications();
    connectNotifications();

    btnText.textContent = 'Sincronizando vistas...';
    setTimeout(() => {
      btn.disabled = false;
      btnText.textContent = 'Autenticar y Abrir Panel del Software';

      if (data.requires_policy_acceptance) {
        document.getElementById('policyVersionDisplay').textContent = data.current_policy_version || 'v1.0';
        document.getElementById('policyModal').classList.remove('hidden');
      } else {
        launchSoftwareView(data.user);
      }
    }, 400);

  } catch (error) {
    showAuthAlert('Error al comunicar con el servidor backend.');
    btn.disabled = false;
    btnText.textContent = 'Autenticar y Abrir Panel del Software';
    generateLoginCaptcha();
  }
}

async function submitPolicyAcceptance() {
  const btn = document.getElementById('btnAcceptPolicy');
  const version = document.getElementById('policyVersionDisplay').textContent;
  
  btn.disabled = true;
  btn.textContent = 'Registrando aceptación...';
  
  try {
    const res = await fetch(`${API_BASE}/auth/accept-policy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version })
    });
    const data = await res.json();
    
    if (res.ok) {
      document.getElementById('policyModal').classList.add('hidden');
      launchSoftwareView(currentUser);
    } else {
      alert('Error al aceptar la política: ' + data.message);
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-base">check_circle</span><span>Aceptar y Continuar</span>';
    }
  } catch (err) {
    alert('Error de conexión con el servidor.');
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-base">check_circle</span><span>Aceptar y Continuar</span>';
  }
}

// =============================================================================
// 4. REGISTRO DE NUEVOS USUARIOS
// =============================================================================

async function handleRegisterSubmit(e) {
  e.preventDefault();
  hideAuthAlert();

  const nombre_completo = document.getElementById('regFullName').value.trim();
  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const rol = document.getElementById('regRol').value;
  const sede_id = rol === 'ENCARGADO' ? document.getElementById('regSedeId').value : null;
  const honey = document.getElementById('registerHoney') ? document.getElementById('registerHoney').value : '';

  const btn = document.getElementById('btnRegisterSubmit');
  const btnText = document.getElementById('btnRegisterText');

  btn.disabled = true;
  btnText.textContent = 'Registrando en Base de Datos MySQL...';

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre_completo, username, email, password, rol, sede_id, _honey: honey })
    });

    const data = await res.json();

    if (!res.ok) {
      showAuthAlert(data.message || 'Error al registrar el usuario.');
      btn.disabled = false;
      btnText.textContent = 'Registrar en Base de Datos';
      return;
    }

    // sessionStorage.setItem('token_inventario_ce', data.token); // Eliminado para forzar cierre de sesión al recargar
    currentUser = data.user;
    currentToken = data.token;

    showAuthAlert(`¡Cuenta creada con éxito! Bienvenido ${data.user.nombre_completo}.`, 'success');

    setTimeout(() => {
      launchSoftwareView(data.user);
      btn.disabled = false;
      btnText.textContent = 'Registrar en Base de Datos';
    }, 600);

  } catch (error) {
    showAuthAlert('Error al procesar la solicitud de registro.');
    btn.disabled = false;
    btnText.textContent = 'Registrar en Base de Datos';
  }
}

// =============================================================================
// 5. RECUPERACIÓN DE CONTRASEÑA
// =============================================================================

function openForgotPasswordModal() {
  document.getElementById('forgotPasswordModal').classList.remove('hidden');
  document.getElementById('recoveryStep1').classList.remove('hidden');
  document.getElementById('recoveryStep2').classList.add('hidden');
  document.getElementById('recoveryIdentifier').value = document.getElementById('loginUsername').value;
}

function closeForgotPasswordModal() {
  document.getElementById('forgotPasswordModal').classList.add('hidden');
}

async function requestRecoveryPin() {
  const identifier = document.getElementById('recoveryIdentifier').value.trim();
  const btn = document.getElementById('btnSendPin');

  if (!identifier) {
    alert('Ingresa tu usuario o correo.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Generando PIN...';

  try {
    const res = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.message || 'No se encontró la cuenta.');
      btn.disabled = false;
      btn.textContent = 'Enviar Código de Recuperación';
      return;
    }

    document.getElementById('recoveryStep1').classList.add('hidden');
    document.getElementById('recoveryStep2').classList.remove('hidden');
    document.getElementById('recoveryNotice').innerHTML = `
      ✓ Código generado y vinculado a <strong>${data.emailTarget}</strong>.<br/>
      <span class="text-primary font-bold">Código PIN simulado para pruebas: ${data.recoveryCodePreview}</span>
    `;
    document.getElementById('recoveryPin').value = data.recoveryCodePreview || '';

  } catch (e) {
    alert('Error de conexión al solicitar el PIN.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar Código de Recuperación';
  }
}

async function confirmResetPassword() {
  const identifier = document.getElementById('recoveryIdentifier').value.trim();
  const pin = document.getElementById('recoveryPin').value.trim();
  const newPassword = document.getElementById('recoveryNewPassword').value;
  const btn = document.getElementById('btnConfirmReset');

  if (!pin || !newPassword) {
    alert('Ingresa el código PIN y la nueva contraseña.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Actualizando contraseña...';

  try {
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, pin, newPassword })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.message || 'Error al restablecer contraseña.');
      btn.disabled = false;
      btn.textContent = 'Restablecer Contraseña';
      return;
    }

    alert('¡Contraseña actualizada exitosamente! Ahora puedes iniciar sesión.');
    closeForgotPasswordModal();
    document.getElementById('loginPassword').value = newPassword;

  } catch (e) {
    alert('Error al restablecer contraseña.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Restablecer Contraseña';
  }
}

// =============================================================================
// 6. CARGA DE INVENTARIO REAL DESDE MYSQL & RENDERIZADO DE VISTAS
// =============================================================================

async function loadRealInventory() {
  try {
    const res = await fetch(`${API_BASE}/inventory/products`);
    const data = await res.json();
    
    const catRes = await fetch(`${API_BASE}/inventory/categories`);
    const catData = await catRes.json();

    if (res.ok && data.products) {
      liveProducts = data.products;
      if (catRes.ok && catData.categories) {
        liveCategories = catData.categories;
        populateCategoriesSelect();
      }
      renderActiveView();
      populateTransferModalProducts();
    }
  } catch (err) {
    console.error('Error cargando inventario real:', err);
  }
}

function populateCategoriesSelect() {
  const select = document.getElementById('newProdCategory');
  if (!select) return;
  select.innerHTML = '<option value="">-- Sin categoría --</option>';
  liveCategories.forEach(c => {
    select.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
  });
}

async function promptCreateCategory() {
  const nombre = prompt('Nombre de la nueva categoría (Ej: Tubería):');
  if (!nombre) return;
  const descripcion = prompt('Descripción (Opcional):') || '';
  
  try {
    const res = await fetch(`${API_BASE}/inventory/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, descripcion })
    });
    const data = await res.json();
    if (res.ok) {
      showAuthAlert('Categoría creada exitosamente', 'success');
      loadRealInventory();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (e) {
    alert('Error al crear categoría');
  }
}

function launchSoftwareView(user) {
  document.getElementById('authSection').classList.add('hidden');
  document.getElementById('appSection').classList.remove('hidden');

  document.getElementById('appUserName').textContent = user.nombre_completo;
  document.getElementById('appUserUsername').textContent = `@${user.username}`;
  document.getElementById('appUserInitial').textContent = user.nombre_completo.charAt(0).toUpperCase();
  document.getElementById('appHeaderRole').textContent = user.rol;

  if (user.rol === 'ENCARGADO') {
    document.getElementById('appHeaderSede').textContent = user.sede_nombre || 'Sede Asignada';
    document.getElementById('appHeaderSedeSub').textContent = user.sede_direccion || 'Sucursal';
  } else {
    document.getElementById('appHeaderSede').textContent = 'Todas las Sedes';
    document.getElementById('appHeaderSedeSub').textContent = 'Red Central Grupo Eléctrico';
  }

  // Cargar datos reales de MySQL
  loadRealInventory();
  
  // Iniciar notificaciones en tiempo real
  if (typeof setupNotificationObserver === 'function') {
    setupNotificationObserver();
  }
}

function renderActiveView() {
  if (!currentUser) return;

  document.getElementById('viewAdmin').classList.add('hidden');
  document.getElementById('viewEncargado').classList.add('hidden');
  document.getElementById('viewEmpleado').classList.add('hidden');

  if (currentUser.rol === 'ADMINISTRADOR') {
    renderAdminView();
  } else if (currentUser.rol === 'ENCARGADO') {
    renderEncargadoView();
  } else if (currentUser.rol === 'EMPLEADO') {
    renderEmpleadoView();
  }
}

let currentAdminSedeFilter = 'ALL';
let currentAdminSearchFilter = '';

function filterAdminTable(sedeId) {
  currentAdminSedeFilter = sedeId;
  
  const tabs = document.getElementById('adminSedeTabs').querySelectorAll('button');
  tabs.forEach(t => {
    t.className = 'px-3 py-1.5 rounded bg-surface-container-high text-on-surface hover:bg-surface-container-highest font-mono text-xs font-bold transition-colors';
  });
  
  if (window.event && window.event.currentTarget) {
    window.event.currentTarget.className = 'px-3 py-1.5 rounded bg-primary text-on-primary font-mono text-xs font-bold transition-colors shadow-sm';
  }
  
  renderAdminView();
}

function filterAdminSearch(query) {
  currentAdminSearchFilter = query.toLowerCase();
  renderAdminView();
}

// --- VISTA 1: ADMINISTRADOR (CESAR) ---
function renderAdminView() {
  const container = document.getElementById('viewAdmin');
  container.classList.remove('hidden');

  const tableHead = document.getElementById('adminInventoryTableHead');
  const tableBody = document.getElementById('adminInventoryTableBody');
  tableBody.innerHTML = '';

  const filteredProducts = (liveProducts || []).filter(p => {
    const q = currentAdminSearchFilter;
    const n = (p.nombre || '').toLowerCase();
    const s = (p.codigo_sku || '').toLowerCase();
    const c = (p.categoria_nombre || '').toLowerCase();
    return n.includes(q) || s.includes(q) || c.includes(q);
  });

  if (filteredProducts.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-outline">No hay productos que coincidan con los filtros.</td></tr>`;
    return;
  }

  const alertIcon = `<span class="material-symbols-outlined text-[12px] text-error align-middle" title="Stock bajo o agotado">warning</span>`;

  if (currentAdminSedeFilter === 'ALL') {
    tableHead.innerHTML = `
      <tr class="bg-surface-container-lowest border-b border-outline-variant/40 font-mono text-[11px] uppercase tracking-wider text-outline">
        <th class="py-3 px-4">SKU / Producto</th>
        <th class="py-3 px-4">Unidad</th>
        <th class="py-3 px-4">Centro EP</th>
        <th class="py-3 px-4">EP1</th>
        <th class="py-3 px-4">EP3</th>
        <th class="py-3 px-4">EP6</th>
        <th class="py-3 px-4 text-center">Total Red</th>
        <th class="py-3 px-4 text-right">Acción</th>
      </tr>
    `;

    filteredProducts.forEach(p => {
      const s1 = p.sedes[1] ? p.sedes[1].stock_actual : 0;
      const s2 = p.sedes[2] ? p.sedes[2].stock_actual : 0;
      const s3 = p.sedes[3] ? p.sedes[3].stock_actual : 0;
      const s4 = p.sedes[4] ? p.sedes[4].stock_actual : 0;
      const s1_min = p.sedes[1] ? p.sedes[1].stock_minimo : 0;
      const s2_min = p.sedes[2] ? p.sedes[2].stock_minimo : 0;
      const s3_min = p.sedes[3] ? p.sedes[3].stock_minimo : 0;
      const s4_min = p.sedes[4] ? p.sedes[4].stock_minimo : 0;

      const row = document.createElement('tr');
      row.className = 'hover:bg-surface-container-high/50 transition-colors';
      row.innerHTML = `
        <td class="py-3 px-4">
          <div class="flex flex-col">
            <span class="font-semibold text-on-surface">${p.nombre}</span>
            <span class="font-mono text-[10px] text-primary font-bold">SKU: ${p.codigo_sku}</span>
            ${p.categoria_nombre ? `<span class="text-[10px] text-outline uppercase tracking-wider">${p.categoria_nombre}</span>` : ''}
          </div>
        </td>
        <td class="py-3 px-4 font-mono text-outline">${p.unidad_medida}</td>
        <td class="py-3 px-4 font-mono ${s1 > 0 ? 'text-primary font-bold' : 'text-error'}">${s1 <= s1_min ? alertIcon : ''} ${s1}</td>
        <td class="py-3 px-4 font-mono ${s2 > 0 ? 'text-secondary font-bold' : 'text-error'}">${s2 <= s2_min ? alertIcon : ''} ${s2}</td>
        <td class="py-3 px-4 font-mono ${s3 > 0 ? 'text-on-surface font-bold' : 'text-error'}">${s3 <= s3_min ? alertIcon : ''} ${s3}</td>
        <td class="py-3 px-4 font-mono ${s4 > 0 ? 'text-on-surface font-bold' : 'text-error'}">${s4 <= s4_min ? alertIcon : ''} ${s4}</td>
        <td class="py-3 px-4 text-center font-mono font-bold text-on-surface text-sm">${p.total_stock}</td>
        <td class="py-3 px-4 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <button type="button" onclick="openTransferForProduct(${p.id}, '${p.codigo_sku}')" class="px-2 py-1 bg-secondary text-on-secondary hover:bg-yellow-400 font-mono text-[10px] font-bold rounded shadow-sm transition-colors" title="Mover Stock">
              <span class="material-symbols-outlined text-sm align-middle">swap_horiz</span>
            </button>
            <button type="button" onclick="openEditProductModal(${p.id})" class="px-2 py-1 bg-surface-container hover:bg-surface-container-high text-primary font-mono text-[10px] font-bold rounded border border-outline-variant/40 shadow-sm transition-colors" title="Editar Producto">
              <span class="material-symbols-outlined text-sm align-middle">edit</span>
            </button>
            <button type="button" onclick="openDeleteProductModal(${p.id})" class="px-2 py-1 bg-surface-container hover:bg-error/20 hover:text-error text-error font-mono text-[10px] font-bold rounded border border-outline-variant/40 shadow-sm transition-colors" title="Eliminar Producto">
              <span class="material-symbols-outlined text-sm align-middle">delete</span>
            </button>
          </div>
        </td>
      `;
      tableBody.appendChild(row);
    });
  } else {
    tableHead.innerHTML = `
      <tr class="bg-surface-container-lowest border-b border-outline-variant/40 font-mono text-[11px] uppercase tracking-wider text-outline">
        <th class="py-3 px-4">SKU / Producto</th>
        <th class="py-3 px-4">Unidad</th>
        <th class="py-3 px-4">Precio Venta Sede</th>
        <th class="py-3 px-4">Stock en Sede</th>
        <th class="py-3 px-4 text-right">Acción</th>
      </tr>
    `;

    const grouped = filteredProducts.reduce((acc, p) => {
      const cat = p.categoria_nombre || 'Sin Categoría';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(p);
      return acc;
    }, {});

    Object.keys(grouped).forEach(cat => {
      const catRow = document.createElement('tr');
      catRow.innerHTML = `<td colspan="5" class="bg-surface-container-low py-2 px-4 font-headline font-bold text-primary text-xs uppercase tracking-widest border-b border-outline-variant/30">${cat}</td>`;
      tableBody.appendChild(catRow);

      grouped[cat].forEach(p => {
        const sedeInfo = p.sedes[currentAdminSedeFilter] || { stock_actual: 0, stock_minimo: 0, precio_venta: 0 };
        const s_actual = sedeInfo.stock_actual;
        const s_min = sedeInfo.stock_minimo;
        const precio = sedeInfo.precio_venta;

        const row = document.createElement('tr');
        row.className = 'hover:bg-surface-container-high/50 transition-colors';
        row.innerHTML = `
          <td class="py-3 px-4">
            <div class="flex flex-col">
              <span class="font-semibold text-on-surface">${p.nombre}</span>
              <span class="font-mono text-[10px] text-primary font-bold">SKU: ${p.codigo_sku}</span>
            </div>
          </td>
          <td class="py-3 px-4 font-mono text-outline">${p.unidad_medida}</td>
          <td class="py-3 px-4 font-mono text-secondary font-bold">$${precio.toLocaleString()}</td>
          <td class="py-3 px-4 font-mono ${s_actual > 0 ? 'text-primary font-bold' : 'text-error'}">${s_actual <= s_min ? alertIcon : ''} ${s_actual}</td>
          <td class="py-3 px-4 text-right">
            <div class="flex items-center justify-end gap-1.5">
              <button type="button" onclick="openTransferForProduct(${p.id}, '${p.codigo_sku}')" class="px-2 py-1 bg-secondary text-on-secondary hover:bg-yellow-400 font-mono text-[10px] font-bold rounded shadow-sm transition-colors" title="Mover Stock">
                <span class="material-symbols-outlined text-sm align-middle">swap_horiz</span>
              </button>
            </div>
          </td>
        `;
        tableBody.appendChild(row);
      });
    });
  }
}

// --- VISTA 2: ENCARGADO DE SEDE ---
let currentEncargadoSearchFilter = '';

function filterEncargadoSearch(query) {
  currentEncargadoSearchFilter = query.toLowerCase();
  renderEncargadoView();
}

// --- VISTA 2: ENCARGADO DE SEDE ---
function renderEncargadoView() {
  const container = document.getElementById('viewEncargado');
  container.classList.remove('hidden');

  const sedeId = currentUser.sede_id || 1;
  const sedeName = currentUser.sede_nombre || 'Sede Asignada';
  document.getElementById('encargadoSedeTitle').textContent = sedeName;
  document.getElementById('encargadoTableHeading').textContent = `Stock Físico en ${sedeName}`;

  const sedeImgEl = document.getElementById('encargadoSedeImg');
  if (sedeImgEl) {
    if (sedeId === 2) {
      sedeImgEl.src = './assets/images/sede-ep1.png';
      sedeImgEl.classList.remove('hidden');
    } else {
      sedeImgEl.classList.add('hidden');
    }
  }

  const tableBody = document.getElementById('encargadoInventoryTableBody');
  tableBody.innerHTML = '';

  const filteredProducts = (liveProducts || []).filter(p => {
    const q = currentEncargadoSearchFilter;
    const n = (p.nombre || '').toLowerCase();
    const s = (p.codigo_sku || '').toLowerCase();
    const c = (p.categoria_nombre || '').toLowerCase();
    return n.includes(q) || s.includes(q) || c.includes(q);
  });

  if (filteredProducts.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-outline">No hay productos que coincidan con los filtros en esta sede.</td></tr>`;
    return;
  }

  const grouped = filteredProducts.reduce((acc, p) => {
    const cat = p.categoria_nombre || 'Sin Categoría';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

  Object.keys(grouped).forEach(cat => {
    const catRow = document.createElement('tr');
    catRow.innerHTML = `<td colspan="5" class="bg-surface-container-low py-2 px-4 font-headline font-bold text-primary text-xs uppercase tracking-widest border-b border-outline-variant/30">${cat}</td>`;
    tableBody.appendChild(catRow);

    grouped[cat].forEach(p => {
      const sedeInfo = p.sedes[sedeId] || { stock_actual: 0, precio_venta: 0, stock_minimo: 0 };
      const stock = sedeInfo.stock_actual;
      const precio = sedeInfo.precio_venta;
      const isLow = stock <= (sedeInfo.stock_minimo || 0);
      const alertIcon = `<span class="material-symbols-outlined text-[12px] text-error align-middle" title="Stock bajo o agotado">warning</span>`;

      const row = document.createElement('tr');
      row.className = 'hover:bg-surface-container-high/50 transition-colors';
      row.innerHTML = `
        <td class="py-3 px-4 font-mono text-outline font-bold">${p.codigo_sku}</td>
        <td class="py-3 px-4 font-semibold text-on-surface">${p.nombre}</td>
        <td class="py-3 px-4 font-mono font-bold text-on-surface">$${precio.toLocaleString()}</td>
        <td class="py-3 px-4 font-mono font-bold ${isLow ? 'text-error' : 'text-primary'}">${isLow ? alertIcon : ''} ${stock} ${p.unidad_medida}</td>
        <td class="py-3 px-4 text-right">
          <button type="button" onclick="openTransferForProduct(${p.id}, '${p.codigo_sku}', ${sedeId})" class="px-2.5 py-1 bg-primary text-on-primary font-mono text-[11px] font-bold rounded shadow-sm hover:bg-emerald-400 transition-colors">
            Pedir a Otra Sede
          </button>
        </td>
      `;
      tableBody.appendChild(row);
    });
  });
}

// --- VISTA 3: EMPLEADO / OPERADOR ---
function renderEmpleadoView() {
  const container = document.getElementById('viewEmpleado');
  container.classList.remove('hidden');

  // Cargar historial de traslados entre sedes
  loadEmployeeTransfers();
  handleQuickPriceSearch('');
}

async function loadEmployeeTransfers() {
  const list = document.getElementById('employeeTransfersList');
  if (!list) return;

  try {
    const res = await fetch(`${API_BASE}/inventory/transfers`);
    const data = await res.json();

    if (res.ok && data.transfers && data.transfers.length > 0) {
      list.innerHTML = '';
      data.transfers.forEach(t => {
        const item = document.createElement('div');
        item.className = 'p-3 bg-surface-container-low rounded-lg border border-outline-variant/30 space-y-1.5';
        item.innerHTML = `
          <div class="flex items-center justify-between">
            <span class="font-bold text-primary">TR-${t.id}</span>
            <span class="text-[10px] bg-primary/20 text-primary font-bold px-2 py-0.5 rounded">COMPLETADO</span>
          </div>
          <div class="font-bold text-on-surface text-xs">${t.producto_nombre} (${t.cantidad} un.)</div>
          <div class="flex items-center justify-between text-on-surface-variant text-[11px]">
            <span>Origen: <strong class="text-secondary">${t.origen_nombre}</strong></span>
            <span>➜</span>
            <span>Destino: <strong class="text-primary">${t.destino_nombre}</strong></span>
          </div>
          <div class="text-[10px] text-outline pt-1 border-t border-outline-variant/20">
            ${t.observaciones || 'Entrega entre sedes'} · ${new Date(t.created_at).toLocaleString()}
          </div>
        `;
        list.appendChild(item);
      });
    } else {
      list.innerHTML = `<div class="p-3 text-center text-outline">No hay traslados recientes registrados.</div>`;
    }
  } catch (err) {
    console.error('Error cargando traslados:', err);
  }
}

function handleQuickPriceSearch(query) {
  const container = document.getElementById('quickPriceResults');
  if (!container) return;

  const q = query.trim().toLowerCase();
  const filtered = q ? liveProducts.filter(p => p.nombre.toLowerCase().includes(q) || p.codigo_sku.toLowerCase().includes(q)) : liveProducts.slice(0, 4);

  container.innerHTML = '';
  filtered.forEach(p => {
    const div = document.createElement('div');
    div.className = 'p-2 bg-surface-container-low rounded border border-outline-variant/20 flex items-center justify-between';
    div.innerHTML = `
      <div class="truncate pr-2">
        <span class="text-on-surface font-semibold block truncate">${p.nombre}</span>
        <span class="text-[10px] text-outline">${p.codigo_sku}</span>
      </div>
      <div class="text-right shrink-0">
        <span class="text-primary font-bold block">$${p.precio_referencia ? p.precio_referencia.toLocaleString() : '0'}</span>
        <span class="text-[9px] text-outline">Stock Red: ${p.total_stock}</span>
      </div>
    `;
    container.appendChild(div);
  });
}

function simulateBarcodeScan() {
  if (liveProducts.length === 0) {
    alert('No hay productos en inventario para escanear.');
    return;
  }
  const random = liveProducts[Math.floor(Math.random() * liveProducts.length)];
  alert(`⚡ Lector de Código de Barras:\n\nProducto: ${random.nombre}\nSKU: ${random.codigo_sku}\nStock Total en las 4 Sedes: ${random.total_stock} unidades.`);
}

// =============================================================================
// 7. MODAL Y CREACIÓN DE PRODUCTOS EN MYSQL (SUPERADMIN)
// =============================================================================

function openCreateProductModal() {
  document.getElementById('createProductModal').classList.remove('hidden');
}

function closeCreateProductModal() {
  document.getElementById('createProductModal').classList.add('hidden');
}

async function handleCreateProductSubmit(e) {
  e.preventDefault();

  const sku = document.getElementById('newProdSku').value.trim();
  const name = document.getElementById('newProdName').value.trim();
  const unit = document.getElementById('newProdUnit').value;
  const desc = document.getElementById('newProdDesc').value.trim();
  const categoryId = document.getElementById('newProdCategory').value;

  const sedesData = [
    {
      sede_id: 1,
      stock_actual: parseFloat(document.getElementById('stock_sede_1').value) || 0,
      stock_minimo: 5,
      precio_venta: parseFloat(document.getElementById('precio_sede_1').value) || 0
    },
    {
      sede_id: 2,
      stock_actual: parseFloat(document.getElementById('stock_sede_2').value) || 0,
      stock_minimo: 5,
      precio_venta: parseFloat(document.getElementById('precio_sede_2').value) || 0
    },
    {
      sede_id: 3,
      stock_actual: parseFloat(document.getElementById('stock_sede_3').value) || 0,
      stock_minimo: 5,
      precio_venta: parseFloat(document.getElementById('precio_sede_3').value) || 0
    },
    {
      sede_id: 4,
      stock_actual: parseFloat(document.getElementById('stock_sede_4').value) || 0,
      stock_minimo: 5,
      precio_venta: parseFloat(document.getElementById('precio_sede_4').value) || 0
    }
  ];

  const btn = document.getElementById('btnSubmitNewProduct');
  btn.disabled = true;
  btn.textContent = 'Guardando en Base de Datos MySQL...';

  try {
    const res = await fetch(`${API_BASE}/inventory/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigo_sku: sku,
        nombre: name,
        descripcion: desc,
        categoria_id: categoryId ? parseInt(categoryId) : null,
        unidad_medida: unit,
        sedesData
      })
    });

    const data = await res.json();

    if (!res.ok) {
      alert('Error: ' + data.message);
      return;
    }

    alert('✓ Producto registrado exitosamente en la base de datos MySQL con sus precios para cada sede.');
    closeCreateProductModal();
    document.getElementById('createProductForm').reset();
    
    // Recargar inventario real en vivo
    await loadRealInventory();

  } catch (err) {
    alert('Error al comunicar con el servidor.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar Producto en MySQL';
  }
}

// =============================================================================
// 7.1 MODAL Y EDICIÓN/ELIMINACIÓN DE PRODUCTOS EN MYSQL (SUPERADMIN)
// =============================================================================

function openEditProductModal(id) {
  const product = liveProducts.find(p => p.id === id);
  if (!product) return;

  document.getElementById('editProdId').value = product.id;
  document.getElementById('editProdSku').value = product.codigo_sku;
  document.getElementById('editProdName').value = product.nombre;
  document.getElementById('editProdUnit').value = product.unidad_medida;
  document.getElementById('editProdDesc').value = product.descripcion || '';

  // Poblar sedes
  for (let i = 1; i <= 4; i++) {
    const s = product.sedes[i];
    document.getElementById(`edit_stock_sede_${i}`).value = s ? s.stock_actual : 0;
    document.getElementById(`edit_precio_sede_${i}`).value = s ? s.precio_venta : 0;
  }

  document.getElementById('editProductModal').classList.remove('hidden');
}

function closeEditProductModal() {
  document.getElementById('editProductModal').classList.add('hidden');
}

async function handleEditProductSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('editProdId').value;
  const sku = document.getElementById('editProdSku').value.trim();
  const name = document.getElementById('editProdName').value.trim();
  const unit = document.getElementById('editProdUnit').value;
  const desc = document.getElementById('editProdDesc').value.trim();

  const sedesData = [1, 2, 3, 4].map(sede_id => ({
    sede_id,
    stock_actual: parseFloat(document.getElementById(`edit_stock_sede_${sede_id}`).value) || 0,
    precio_venta: parseFloat(document.getElementById(`edit_precio_sede_${sede_id}`).value) || 0
  }));

  const btn = document.getElementById('btnSubmitEditProduct');
  btn.disabled = true;
  btn.textContent = 'Actualizando en BD...';

  try {
    const res = await fetch(`${API_BASE}/inventory/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigo_sku: sku,
        nombre: name,
        descripcion: desc,
        unidad_medida: unit,
        sedesData
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert('Error: ' + data.message);
      return;
    }

    alert('✓ Producto actualizado exitosamente.');
    closeEditProductModal();
    await loadRealInventory();
  } catch (err) {
    alert('Error al comunicar con el servidor.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-base">save</span><span>Actualizar Producto</span>';
  }
}

let deleteProductId = null;

function openDeleteProductModal(id) {
  deleteProductId = id;
  document.getElementById('deleteProductModal').classList.remove('hidden');
}

function closeDeleteProductModal() {
  deleteProductId = null;
  document.getElementById('deleteProductModal').classList.add('hidden');
}

document.getElementById('btnConfirmDeleteProduct')?.addEventListener('click', async () => {
  if (!deleteProductId) return;

  const btn = document.getElementById('btnConfirmDeleteProduct');
  btn.disabled = true;
  btn.textContent = 'Eliminando...';

  try {
    const res = await fetch(`${API_BASE}/inventory/products/${deleteProductId}`, {
      method: 'DELETE'
    });

    const data = await res.json();
    if (!res.ok) {
      alert('Error: ' + data.message);
      return;
    }

    alert('✓ Producto eliminado.');
    closeDeleteProductModal();
    await loadRealInventory();
  } catch (err) {
    alert('Error al comunicar con el servidor.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Eliminar';
  }
});

// =============================================================================
// 8. TRASLADOS EN TIEMPO REAL ENTRE SEDES (CAMBIO EN VIVO EN LA BD)
// =============================================================================

function populateTransferModalProducts() {
  const select = document.getElementById('modalTransferProduct');
  if (!select) return;

  select.innerHTML = '';
  liveProducts.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.nombre} (SKU: ${p.codigo_sku})`;
    select.appendChild(opt);
  });

  updateTransferAvailabilityHint();
}

function updateTransferAvailabilityHint() {
  const selectProd = document.getElementById('modalTransferProduct');
  const selectOrig = document.getElementById('modalTransferOrigin');
  const hint = document.getElementById('transferStockHint');

  if (!selectProd || !selectOrig || !hint) return;

  const prodId = Number(selectProd.value);
  const origId = Number(selectOrig.value);

  const prod = liveProducts.find(p => p.id === prodId);
  if (prod && prod.sedes && prod.sedes[origId]) {
    hint.textContent = `Disponible: ${prod.sedes[origId].stock_actual} ${prod.unidad_medida}`;
  } else {
    hint.textContent = 'Disponible: 0';
  }
}

function toggleQuickTransferModal() {
  const modal = document.getElementById('transferModal');
  modal.classList.toggle('hidden');
  updateTransferAvailabilityHint();
}

function openTransferForProduct(productId, sku, destId = null) {
  toggleQuickTransferModal();
  const selectProd = document.getElementById('modalTransferProduct');
  if (selectProd) {
    selectProd.value = productId;
  }
  if (destId) {
    document.getElementById('modalTransferDest').value = destId;
  }
  updateTransferAvailabilityHint();
}

async function handleExecuteTransferSubmit(e) {
  e.preventDefault();

  const prodId = Number(document.getElementById('modalTransferProduct').value);
  const origId = Number(document.getElementById('modalTransferOrigin').value);
  const destId = Number(document.getElementById('modalTransferDest').value);
  const qty = parseFloat(document.getElementById('modalTransferQty').value);
  const obs = document.getElementById('modalTransferObs').value.trim();

  if (origId === destId) {
    alert('La sede de origen y destino deben ser distintas.');
    return;
  }

  const btn = document.getElementById('btnExecuteTransferSubmit');
  btn.disabled = true;
  btn.textContent = 'Procesando traslado en MySQL...';

  try {
    const res = await fetch(`${API_BASE}/inventory/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        producto_id: prodId,
        sede_origen_id: origId,
        sede_destino_id: destId,
        cantidad: qty,
        observaciones: obs
      })
    });

    const data = await res.json();

    if (!res.ok) {
      alert('Error: ' + data.message);
      return;
    }

    alert(`✓ Traslado completado en tiempo real:\n\n• ${qty} unidades transferidas con éxito.\n• Origen ahora tiene: ${data.transfer.nuevo_stock_origen} un.\n• Destino ahora tiene: ${data.transfer.nuevo_stock_destino} un.`);
    toggleQuickTransferModal();

    // Recargar inventario en tiempo real para ver el cambio inmediato en la tabla
    await loadRealInventory();

  } catch (err) {
    alert('Error al ejecutar el traslado.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar Traslado en Base de Datos';
  }
}

document.getElementById('modalTransferProduct')?.addEventListener('change', updateTransferAvailabilityHint);

// =============================================================================
// 9. CIERRE DE SESIÓN Y VERIFICACIÓN
// =============================================================================

function handleLogout() {
  sessionStorage.removeItem('token_inventario_ce');
  currentUser = null;
  currentToken = null;

  document.getElementById('appSection').classList.add('hidden');
  document.getElementById('authSection').classList.remove('hidden');

  showAuthAlert('Has cerrado la sesión correctamente.', 'success');
}

async function checkSavedSession() {
  // const token = sessionStorage.getItem('token_inventario_ce');
  // if (!token) return;
  return; // Forzar que no haya auto-login al recargar la página

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (res.ok && data.user) {
      currentUser = data.user;
      currentToken = token;
      launchSoftwareView(data.user);
    } else {
      sessionStorage.removeItem('token_inventario_ce');
    }
  } catch (e) {
    sessionStorage.removeItem('token_inventario_ce');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  generateLoginCaptcha();
  checkDatabaseHealth();
  checkSavedSession();
  checkPolicies();
});

// =============================================================================
// POLÍTICAS Y COOKIES (SINGLETON)
// =============================================================================
function checkPolicies() {
  // Política de Datos ISO 27001
  if (!localStorage.getItem('policy_27001_accepted')) {
    const modal = document.getElementById('dataPolicyModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => modal.classList.remove('opacity-0'), 100);
  }

  // Aviso de Cookies
  if (!localStorage.getItem('cookies_accepted')) {
    const banner = document.getElementById('cookieBanner');
    banner.classList.remove('hidden');
    setTimeout(() => {
      banner.classList.remove('translate-y-full');
    }, 500);
  }
}

window.acceptDataPolicy = function() {
  localStorage.setItem('policy_27001_accepted', 'true');
  const modal = document.getElementById('dataPolicyModal');
  modal.classList.add('opacity-0');
  setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }, 300);
};

window.acceptCookies = function() {
  localStorage.setItem('cookies_accepted', 'true');
  const banner = document.getElementById('cookieBanner');
  banner.classList.add('translate-y-full');
  setTimeout(() => {
    banner.classList.add('hidden');
  }, 500);
};

// =============================================================================
// 8. DASHBOARD Y ESTADÍSTICAS (ADMIN)
// =============================================================================

let chartMovementsInstance = null;
let chartStockInstance = null;

// =============================================================================
// 9. DASHBOARD (ADMINISTRADOR)
// =============================================================================

async function openDashboard() {
  document.getElementById('appSection').classList.add('hidden');
  document.getElementById('dashboardSection').classList.remove('hidden');
  await loadDashboardData();
}

function closeDashboard() {
  document.getElementById('dashboardSection').classList.add('hidden');
  document.getElementById('appSection').classList.remove('hidden');
}

async function loadDashboardData() {
  try {
    const res = await fetch(`${API_BASE}/dashboard/summary`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (res.ok && data.dashboard) {
      renderDashboardCharts(data.dashboard);
      renderExactMovements(data.dashboard.exactMovements);
    }
  } catch (err) {
    console.error('Error cargando dashboard', err);
  }
}

function renderDashboardCharts(dashData) {
  // 1. Gráfico Entradas vs Salidas (Barras)
  const ctxMov = document.getElementById('chartMovements').getContext('2d');
  if (chartMovementsInstance) chartMovementsInstance.destroy();

  chartMovementsInstance = new Chart(ctxMov, {
    type: 'bar',
    data: {
      labels: dashData.movementsOverTime.map(m => m.fecha),
      datasets: [
        {
          label: 'Entradas',
          data: dashData.movementsOverTime.map(m => m.entradas),
          backgroundColor: '#4ade80' // primary color aprox
        },
        {
          label: 'Salidas',
          data: dashData.movementsOverTime.map(m => m.salidas),
          backgroundColor: '#f87171' // error color aprox
        }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  // 2. Distribución de Stock (Doughnut)
  const ctxStock = document.getElementById('chartStock').getContext('2d');
  if (chartStockInstance) chartStockInstance.destroy();

  chartStockInstance = new Chart(ctxStock, {
    type: 'doughnut',
    data: {
      labels: dashData.stockDistribution.map(s => s.sede_nombre),
      datasets: [{
        data: dashData.stockDistribution.map(s => s.stock_total),
        backgroundColor: ['#60a5fa', '#34d399', '#fbbf24', '#f87171']
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function renderExactMovements(movements) {
  const tbody = document.getElementById('movementsTableBody');
  tbody.innerHTML = '';
  
  if (!movements || movements.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-outline text-sm">No hay movimientos registrados.</td></tr>`;
    return;
  }

  movements.forEach(m => {
    const dateStr = new Date(m.fecha_movimiento).toLocaleString();
    const typeColor = m.tipo_movimiento.includes('ENTRADA') ? 'text-primary' : (m.tipo_movimiento.includes('SALIDA') ? 'text-error' : 'text-on-surface');
    
    tbody.innerHTML += `
      <tr class="hover:bg-surface-container-highest transition-colors cursor-default">
        <td class="py-3 px-4 font-mono text-xs text-outline">${dateStr}</td>
        <td class="py-3 px-4 font-bold text-xs ${typeColor}">${m.tipo_movimiento}</td>
        <td class="py-3 px-4 font-semibold text-sm">${m.producto_nombre} <span class="text-[10px] text-primary font-mono ml-1">#${m.codigo_sku}</span></td>
        <td class="py-3 px-4 font-mono text-center font-bold ${m.cantidad > 0 ? 'text-primary' : 'text-error'}">${m.cantidad > 0 ? '+'+m.cantidad : m.cantidad}</td>
        <td class="py-3 px-4 font-mono text-center text-xs text-outline">${m.stock_anterior} &rarr; ${m.stock_posterior}</td>
        <td class="py-3 px-4 text-xs font-bold text-on-surface-variant">${m.sede_nombre}</td>
        <td class="py-3 px-4 text-sm">${m.usuario_nombre}</td>
      </tr>
    `;
  });
}
