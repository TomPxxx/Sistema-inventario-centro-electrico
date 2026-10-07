// =============================================================================
// GRUPO ELÉCTRICO - SISTEMA MULTI-SEDE & LOGÍSTICA
// LÓGICA DE CLIENTE: LOGIN, REGISTRO, CREACIÓN DE PRODUCTOS Y TRASLADOS EN VIVO
// =============================================================================

const API_BASE = '/api';

// PWA: Registrar Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => console.log('ServiceWorker registrado con éxito:', reg.scope))
      .catch(err => console.error('Error registrando ServiceWorker:', err));
  });
}

// PWA: Indicador Offline
window.addEventListener('online', () => {
  showAuthAlert('Conexión restaurada. Sincronizando datos pendientes...', 'success');
  if (currentUser) loadRealInventory();
});
window.addEventListener('offline', () => {
  showAuthAlert('Sin conexión a Internet. Modo Offline Activado.', 'error');
});
// Interceptor global para fetch
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  let [resource, fetchConfig] = args;
  if (typeof resource === 'string' && resource.startsWith('/api') && typeof currentToken !== 'undefined' && currentToken) {
    fetchConfig = fetchConfig || {};
    fetchConfig.headers = fetchConfig.headers || {};
    if (!fetchConfig.headers['Authorization'] && !fetchConfig.headers.Authorization) {
      fetchConfig.headers['Authorization'] = `Bearer ${currentToken}`;
    }
    args = [resource, fetchConfig];
  }

  const response = await originalFetch.apply(this, args);
  
  if (response.status === 401) {
    // Solo interceptamos respuestas JSON
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const clonedResponse = response.clone();
      clonedResponse.json().then(data => {
        if (data.code === 'TOKEN_BLACKLISTED' || data.code === 'TOKEN_EXPIRED') {
          // Destruimos la sesión localmente
          sessionStorage.removeItem('token_inventario_ce');
          currentUser = null;
          currentToken = null;
          
          // PWA: Limpiar caché de la API por seguridad (RBAC)
          if ('caches' in window) {
            caches.delete('inventario-api-v1').catch(console.error);
          }

          document.getElementById('appSection').classList.add('hidden');
          document.getElementById('authSection').classList.remove('hidden');
          
          showAuthAlert(data.message, 'error');
        }
      }).catch(e => console.error('Error parseando 401 JSON', e));
    }
  }
  return response;
};

let currentUser = null;
let currentToken = null;
let liveProducts = []; // Almacena los productos reales traídos de MySQL
let liveCategories = []; // Categorías del inventario
let globalSocket = null;

function initSocketConnection() {
  if (globalSocket) return;
  if (typeof io === 'undefined') return;

  globalSocket = io();

  globalSocket.on('connect', () => {
    console.log('[Socket.io] Conectado exitosamente con ID:', globalSocket.id);
    if (currentUser && currentUser.sede_id) {
      globalSocket.emit('join_sede', currentUser.sede_id);
    }
  });

  globalSocket.on('recepcion_creada', (data) => {
    if (!currentUser) return;
    if (currentUser.rol === 'EMPLEADO' || currentUser.rol === 'ADMINISTRADOR') {
      showToast(`Nueva tarea de conteo asignada (Ref: ${data.id})`, 'info');
      if (currentUser.rol === 'EMPLEADO') loadEmpleadoRecepciones();
      if (currentUser.rol === 'ADMINISTRADOR') {
        const modal = document.getElementById('adminRecepcionesModal');
        if (modal && !modal.classList.contains('hidden')) loadAdminRecepciones();
      }
    }
  });

  globalSocket.on('recepcion_contabilizada', (data) => {
    if (!currentUser) return;
    if (currentUser.rol === 'ADMINISTRADOR' || currentUser.rol === 'ENCARGADO') {
      showToast(`Conteo finalizado para recepción #${data.id}`, 'success');
      if (currentUser.rol === 'ADMINISTRADOR') {
        const modal = document.getElementById('adminRecepcionesModal');
        if (modal && !modal.classList.contains('hidden')) loadAdminRecepciones();
      }
    }
  });

  globalSocket.on('stock_actualizado', (data) => {
    if (!currentUser) return;
    if (currentUser.rol === 'ADMINISTRADOR' || currentUser.rol === 'ENCARGADO') {
      showNotificationToast('🔔 Se ha detectado un movimiento. Inventario actualizado en tiempo real.');
      loadRealInventory();
    }
  });

  globalSocket.on('traslado_nuevo', (data) => {
    if (!currentUser) return;
    if (currentUser.rol === 'EMPLEADO' || currentUser.rol === 'ADMINISTRADOR') {
      showToast(`Nuevo traslado registrado de ${data.producto}`, 'info');
      if (currentUser.rol === 'EMPLEADO') loadEmployeeTransfers();
      // Si el modal de admin está abierto
      if (currentUser.rol === 'ADMINISTRADOR') loadRecentTransfers();
    }
  });
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-2xl z-[100] text-white font-bold transition-all transform translate-y-0 opacity-100 ${type === 'success' ? 'bg-emerald-500' : 'bg-sky-500'}`;
  toast.innerHTML = `<div class="flex items-center gap-2"><span class="material-symbols-outlined text-sm">${type === 'success' ? 'check_circle' : 'info'}</span><span>${message}</span></div>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.replace('translate-y-0', 'translate-y-10');
    toast.classList.replace('opacity-100', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}


let recaptchaWidgetId = null;

async function loadRecaptcha() {
  try {
    const res = await fetch(`${API_BASE}/auth/config/recaptcha`);
    const data = await res.json();
    if (data.success) {
      if (data.siteKey) {
        const initCaptcha = () => {
          if (typeof grecaptcha !== 'undefined' && grecaptcha.render) {
            recaptchaWidgetId = grecaptcha.render('google-recaptcha-container', {
              'sitekey': data.siteKey,
              'theme': document.documentElement.classList.contains('dark') ? 'dark' : 'light'
            });
          } else {
            setTimeout(initCaptcha, 100);
          }
        };
        initCaptcha();
      }

      if (data.googleClientId) {
        const initGoogle = () => {
          if (typeof google !== 'undefined' && google.accounts) {
            google.accounts.id.initialize({
              client_id: data.googleClientId,
              callback: handleGoogleLogin,
              context: 'signin',
              ux_mode: 'popup'
            });
            google.accounts.id.renderButton(
              document.getElementById("googleBtnContainer"),
              { theme: "outline", size: "large", type: "standard", shape: "rectangular", text: "signin_with" }
            );
          } else {
            setTimeout(initGoogle, 100);
          }
        };
        initGoogle();
      }
    }
  } catch(e) {
    console.error('Error loading auth config', e);
  }
}
// Cargar el widget al inicializar la aplicación
loadRecaptcha();

window.addEventListener('load', () => {
  const userField = document.getElementById('loginUsername');
  const passField = document.getElementById('loginPassword');
  if (userField) userField.value = '';
  if (passField) passField.value = '';
});

let inactivityTimer = null;
let logoutInterval = null;
const INACTIVITY_LIMIT = 2 * 60 * 1000; // 2 minutos en ms
const LOGOUT_LIMIT = 2 * 60; // 2 minutos en segundos

function resetInactivityTimer() {
  if (!currentUser) return; // Solo si está logueado
  if (inactivityTimer) clearTimeout(inactivityTimer);
  if (logoutInterval) clearInterval(logoutInterval);
  
  inactivityTimer = setTimeout(() => {
    // Bloquear pantalla
    document.getElementById('inactivityModal').classList.remove('hidden');
    document.getElementById('unlockPassword').value = '';
    document.getElementById('unlockPassword').focus();
    startLogoutTimer();
  }, INACTIVITY_LIMIT);
}

function startLogoutTimer() {
  const container = document.getElementById('countdownContainer');
  const countdownEl = document.getElementById('inactivityCountdown');
  if (container) container.classList.remove('hidden');
  
  let remainingTime = LOGOUT_LIMIT;
  
  const updateDisplay = () => {
    const minutes = Math.floor(remainingTime / 60).toString().padStart(2, '0');
    const seconds = (remainingTime % 60).toString().padStart(2, '0');
    if (countdownEl) countdownEl.textContent = `${minutes}:${seconds}`;
  };
  
  updateDisplay();
  
  logoutInterval = setInterval(() => {
    remainingTime--;
    updateDisplay();
    if (remainingTime <= 0) {
      clearInterval(logoutInterval);
      document.getElementById('inactivityModal').classList.add('hidden');
      if (container) container.classList.add('hidden');
      handleLogout();
    }
  }, 1000);
}

let eventSource = null;

function connectNotifications() {
  initSocketConnection();
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
      const container = document.getElementById('countdownContainer');
      if (container) container.classList.add('hidden');
      if (logoutInterval) clearInterval(logoutInterval);
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
  if (!dot || !text) return;

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
  const recaptchaToken = (typeof grecaptcha !== 'undefined' && recaptchaWidgetId !== null) 
    ? grecaptcha.getResponse(recaptchaWidgetId) 
    : null;
  
  const btn = document.getElementById('btnLoginSubmit');
  const btnText = document.getElementById('btnLoginText');

  if (!username || !password) {
    showAuthAlert('Ingresa tu usuario y contraseña.');
    return;
  }

  if (recaptchaWidgetId !== null && !recaptchaToken) {
    showAuthAlert('Por favor, marca la casilla de seguridad (No soy un robot).');
    return;
  }

  btn.disabled = true;
  btnText.textContent = 'Autenticando en Grupo Eléctrico...';

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, _honey: honey, recaptchaToken })
    });

    const data = await res.json();

    if (!res.ok) {
      showAuthAlert(data.message || 'Credenciales inválidas.');
      btn.disabled = false;
      btnText.textContent = 'Autenticar y Abrir Panel del Software';
      if (typeof grecaptcha !== 'undefined' && recaptchaWidgetId !== null) {
        grecaptcha.reset(recaptchaWidgetId);
      }
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
    if (typeof grecaptcha !== 'undefined' && recaptchaWidgetId !== null) {
      grecaptcha.reset(recaptchaWidgetId);
    }
  }
}

async function handleGoogleLogin(response) {
  hideAuthAlert();
  if (!response || !response.credential) {
    showAuthAlert('Error al autenticar con Google.');
    return;
  }

  const btnText = document.getElementById('btnLoginText');
  if (btnText) btnText.textContent = 'Verificando con Google...';

  try {
    const res = await fetch(`${API_BASE}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: response.credential })
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 403 && data.status === 'PENDIENTE') {
        showAuthAlert('Tu cuenta está pendiente de aprobación por un administrador. No puedes ingresar aún.', 'warning');
      } else if (res.status === 403 && data.status === 'RECHAZADO') {
        showAuthAlert('Tu solicitud fue rechazada por el administrador.', 'error');
      } else {
        showAuthAlert(data.message || 'Error al autenticar con Google.', 'error');
      }
      if (btnText) btnText.textContent = 'Autenticar y Abrir Panel del Software';
      return;
    }

    currentUser = data.user;
    currentToken = data.token;
    resetInactivityTimer();
    connectNotifications();

    if (btnText) btnText.textContent = 'Sincronizando vistas...';
    
    setTimeout(() => {
      if (btnText) btnText.textContent = 'Autenticar y Abrir Panel del Software';
      if (data.requires_policy_acceptance) {
        document.getElementById('policyVersionDisplay').textContent = data.current_policy_version || 'v1.0';
        document.getElementById('policyModal').classList.remove('hidden');
      } else {
        launchSoftwareView(data.user);
      }
    }, 400);

  } catch (error) {
    console.error('Error Google Login:', error);
    showAuthAlert('Error de conexión con el servidor.');
    if (btnText) btnText.textContent = 'Autenticar y Abrir Panel del Software';
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

async function uploadImage(fileInputId) {
  const input = document.getElementById(fileInputId);
  if (!input || !input.files || input.files.length === 0) return null;
  
  const file = input.files[0];
  const formData = new FormData();
  formData.append('image', file);
  
  try {
    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.success) {
      return data.imagen_url;
    } else {
      alert('Error subiendo imagen: ' + data.message);
      return null;
    }
  } catch (e) {
    console.error('Error uploading:', e);
    return null;
  }
}

function promptCreateCategory() {
  document.getElementById('createCategoryModal').classList.remove('hidden');
}

function closeCreateCategoryModal() {
  document.getElementById('createCategoryModal').classList.add('hidden');
}

async function handleCreateCategorySubmit(e) {
  e.preventDefault();
  const nombre = document.getElementById('newCategoryName').value.trim();
  if (!nombre) return;
  
  const btn = document.getElementById('btnSubmitNewCategory');
  btn.disabled = true;
  btn.textContent = 'Subiendo...';
  
  const imagen_url = await uploadImage('newCategoryImage');
  
  try {
    const res = await fetch(`${API_BASE}/inventory/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, descripcion: '', imagen_url })
    });
    const data = await res.json();
    if (res.ok) {
      showAuthAlert('Categoría creada exitosamente', 'success');
      closeCreateCategoryModal();
      document.getElementById('createCategoryForm').reset();
      loadRealInventory();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (e) {
    alert('Error al crear categoría');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-base">save</span><span>Guardar Categoría</span>';
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

  document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));

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
let currentAdminCategoryFilter = null;

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

function filterAdminCategory(categoryId) {
  currentAdminCategoryFilter = categoryId;
  renderAdminView();
}

// --- VISTA 1: ADMINISTRADOR (CESAR) ---
function renderAdminView() {
  const container = document.getElementById('viewAdmin');
  container.classList.remove('hidden');

  document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));

  const tableHead = document.getElementById('adminInventoryTableHead');
  const tableBody = document.getElementById('adminInventoryTableBody');
  const tableContainer = document.getElementById('adminInventoryTableContainer');
  const categoriesGrid = document.getElementById('adminCategoriesGrid');
  const btnBack = document.getElementById('btnAdminBackToCategories');
  
  tableBody.innerHTML = '';
  categoriesGrid.innerHTML = '';

  // Modo Galería de Categorías
  if (currentAdminSearchFilter === '' && currentAdminCategoryFilter === null) {
    tableContainer.classList.add('hidden');
    categoriesGrid.classList.remove('hidden');
    btnBack.classList.add('hidden');
    
    // Contar productos por categoría
    const catCounts = {};
    liveProducts.forEach(p => {
      const cid = p.categoria_id || 'uncategorized';
      if (!catCounts[cid]) catCounts[cid] = 0;
      catCounts[cid]++;
    });

    // Renderizar categorías
    if (liveCategories && liveCategories.length > 0) {
      liveCategories.forEach(cat => {
        const count = catCounts[cat.id] || 0;
        
        const imgHtml = cat.imagen_url 
          ? `<img src="${cat.imagen_url}" alt="" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
             <div class="w-full h-full bg-surface-container-highest items-center justify-center hidden">
               <span class="material-symbols-outlined text-4xl text-outline">category</span>
             </div>`
          : `<div class="w-full h-full bg-surface-container-highest flex items-center justify-center">
               <span class="material-symbols-outlined text-4xl text-outline">category</span>
             </div>`;
        
        categoriesGrid.innerHTML += `
          <div onclick="filterAdminCategory(${cat.id})" class="cursor-pointer group relative overflow-hidden rounded-xl bg-surface-container border border-outline-variant/30 hover:border-primary/50 hover:shadow-lg transition-all">
            <div class="aspect-video w-full bg-surface-container-highest overflow-hidden relative">
              ${imgHtml}
            </div>
            <div class="p-3">
              <h4 class="font-headline font-semibold text-sm text-on-surface truncate">${cat.nombre}</h4>
              <p class="text-[10px] text-outline mt-0.5">${count} producto(s)</p>
            </div>
          </div>
        `;
      });
    }
    
    // Categoría "Sin Categoría"
    if (catCounts['uncategorized'] > 0) {
      categoriesGrid.innerHTML += `
        <div onclick="filterAdminCategory('uncategorized')" class="cursor-pointer group relative overflow-hidden rounded-xl bg-surface-container border border-outline-variant/30 hover:border-primary/50 hover:shadow-lg transition-all">
          <div class="aspect-video w-full bg-surface-container-highest overflow-hidden flex items-center justify-center">
             <span class="material-symbols-outlined text-4xl text-outline">category</span>
          </div>
          <div class="p-3">
            <h4 class="font-headline font-semibold text-sm text-on-surface truncate">Sin Categoría</h4>
            <p class="text-[10px] text-outline mt-0.5">${catCounts['uncategorized']} producto(s)</p>
          </div>
        </div>
      `;
    }
    
    return;
  }

  // Modo Tabla de Productos
  tableContainer.classList.remove('hidden');
  categoriesGrid.classList.add('hidden');
  
  if (currentAdminSearchFilter === '' && currentAdminCategoryFilter !== null) {
    btnBack.classList.remove('hidden');
  } else {
    btnBack.classList.add('hidden');
  }

  let filteredProducts = (liveProducts || []).filter(p => {
    const q = currentAdminSearchFilter;
    const n = (p.nombre || '').toLowerCase();
    const s = (p.codigo_sku || '').toLowerCase();
    const c = (p.categoria_nombre || '').toLowerCase();
    const matchesSearch = n.includes(q) || s.includes(q) || c.includes(q);
    
    if (currentAdminCategoryFilter !== null && q === '') {
      if (currentAdminCategoryFilter === 'uncategorized') return !p.categoria_id && matchesSearch;
      return p.categoria_id === currentAdminCategoryFilter && matchesSearch;
    }
    return matchesSearch;
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
let currentEncargadoCategoryFilter = null;

function filterEncargadoSearch(query) {
  currentEncargadoSearchFilter = query.toLowerCase();
  renderEncargadoView();
}

function filterEncargadoCategory(categoryId) {
  currentEncargadoCategoryFilter = categoryId;
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
    } else if (sedeId === 3) {
      sedeImgEl.src = './assets/images/sede-ep3.png';
      sedeImgEl.classList.remove('hidden');
    } else if (sedeId === 4) {
      sedeImgEl.src = './assets/images/sede-ep6.png';
      sedeImgEl.classList.remove('hidden');
    } else {
      sedeImgEl.classList.add('hidden');
    }
  }

  const tableBody = document.getElementById('encargadoInventoryTableBody');
  const tableContainer = document.getElementById('encargadoInventoryTableContainer');
  const categoriesGrid = document.getElementById('encargadoCategoriesGrid');
  const btnBack = document.getElementById('btnEncargadoBackToCategories');

  tableBody.innerHTML = '';
  categoriesGrid.innerHTML = '';

  // Modo Galería de Categorías para Encargado
  if (currentEncargadoSearchFilter === '' && currentEncargadoCategoryFilter === null) {
    tableContainer.classList.add('hidden');
    categoriesGrid.classList.remove('hidden');
    btnBack.classList.add('hidden');
    
    const catCounts = {};
    liveProducts.forEach(p => {
      const cid = p.categoria_id || 'uncategorized';
      if (!catCounts[cid]) catCounts[cid] = 0;
      catCounts[cid]++;
    });

    if (liveCategories && liveCategories.length > 0) {
      liveCategories.forEach(cat => {
        const count = catCounts[cat.id] || 0;
        
        const imgHtml = cat.imagen_url 
          ? `<img src="${cat.imagen_url}" alt="" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
             <div class="w-full h-full bg-surface-container-highest items-center justify-center hidden">
               <span class="material-symbols-outlined text-4xl text-outline">category</span>
             </div>`
          : `<div class="w-full h-full bg-surface-container-highest flex items-center justify-center">
               <span class="material-symbols-outlined text-4xl text-outline">category</span>
             </div>`;
        
        categoriesGrid.innerHTML += `
          <div onclick="filterEncargadoCategory(${cat.id})" class="cursor-pointer group relative overflow-hidden rounded-xl bg-surface-container border border-outline-variant/30 hover:border-primary/50 hover:shadow-lg transition-all">
            <div class="aspect-video w-full bg-surface-container-highest overflow-hidden relative">
              ${imgHtml}
            </div>
            <div class="p-3">
              <h4 class="font-headline font-semibold text-sm text-on-surface truncate">${cat.nombre}</h4>
              <p class="text-[10px] text-outline mt-0.5">${count} producto(s)</p>
            </div>
          </div>
        `;
      });
    }
    
    if (catCounts['uncategorized'] > 0) {
      categoriesGrid.innerHTML += `
        <div onclick="filterEncargadoCategory('uncategorized')" class="cursor-pointer group relative overflow-hidden rounded-xl bg-surface-container border border-outline-variant/30 hover:border-primary/50 hover:shadow-lg transition-all">
          <div class="aspect-video w-full bg-surface-container-highest overflow-hidden flex items-center justify-center">
             <span class="material-symbols-outlined text-4xl text-outline">category</span>
          </div>
          <div class="p-3">
            <h4 class="font-headline font-semibold text-sm text-on-surface truncate">Sin Categoría</h4>
            <p class="text-[10px] text-outline mt-0.5">${catCounts['uncategorized']} producto(s)</p>
          </div>
        </div>
      `;
    }
    return;
  }

  // Modo Tabla para Encargado
  tableContainer.classList.remove('hidden');
  categoriesGrid.classList.add('hidden');
  
  if (currentEncargadoSearchFilter === '' && currentEncargadoCategoryFilter !== null) {
    btnBack.classList.remove('hidden');
  } else {
    btnBack.classList.add('hidden');
  }

  const filteredProducts = (liveProducts || []).filter(p => {
    const q = currentEncargadoSearchFilter;
    const n = (p.nombre || '').toLowerCase();
    const s = (p.codigo_sku || '').toLowerCase();
    const c = (p.categoria_nombre || '').toLowerCase();
    const matchesSearch = n.includes(q) || s.includes(q) || c.includes(q);
    
    if (currentEncargadoCategoryFilter !== null && q === '') {
      if (currentEncargadoCategoryFilter === 'uncategorized') return !p.categoria_id && matchesSearch;
      return p.categoria_id === currentEncargadoCategoryFilter && matchesSearch;
    }
    return matchesSearch;
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
          <button type="button" onclick="openTransferForProduct(${p.id}, '${p.codigo_sku}', null, ${sedeId})" class="px-2.5 py-1 bg-secondary text-on-secondary font-mono text-[11px] font-bold rounded shadow-sm hover:bg-yellow-400 transition-colors">
            Enviar a Otra Sede
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
  loadEmpleadoRecepciones();
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
  btn.textContent = 'Subiendo imagen...';
  
  let imagen_url = await uploadImage('newProdImage');
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
        imagen_url,
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
  btn.textContent = 'Subiendo imagen...';

  let imagen_url = await uploadImage('editProdImage');
  if (!imagen_url) {
    const oldProduct = liveProducts.find(p => p.id === parseInt(id));
    if (oldProduct && oldProduct.imagen_url) {
      imagen_url = oldProduct.imagen_url;
    }
  }

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
        imagen_url,
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

function openTransferForProduct(productId, sku, destId = null, origId = null) {
  toggleQuickTransferModal();
  const selectProd = document.getElementById('modalTransferProduct');
  if (selectProd) {
    selectProd.value = productId;
  }
  
  const selectOrig = document.getElementById('modalTransferOrigin');
  if (selectOrig) {
    if (currentUser && currentUser.rol === 'ENCARGADO') {
      selectOrig.value = currentUser.sede_id;
      for (let i = 0; i < selectOrig.options.length; i++) {
        if (Number(selectOrig.options[i].value) !== currentUser.sede_id) {
          selectOrig.options[i].disabled = true;
        } else {
          selectOrig.options[i].disabled = false;
        }
      }
    } else {
      for (let i = 0; i < selectOrig.options.length; i++) {
        selectOrig.options[i].disabled = false;
      }
      if (origId) {
        selectOrig.value = origId;
      }
    }
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

    alert(`✓ Traslado completado en tiempo real:\n\n• ${qty} unidades transferidas con éxito.`);
    toggleQuickTransferModal();

    // Recargar inventario en tiempo real para ver el cambio inmediato en la tabla
    await loadRealInventory();

  } catch (err) {
    console.error(err);
    alert('Error de conexión o de lectura al ejecutar el traslado.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar Traslado en Base de Datos';
  }
}

document.getElementById('modalTransferProduct')?.addEventListener('change', updateTransferAvailabilityHint);

// =============================================================================
// 8.5 RECEPCION DE MERCANCIAS (ENCARGADO -> EMPLEADO -> ADMIN)
// =============================================================================

// --- ENCARGADO ---
async function openCreateRecepcionModal() {
  document.getElementById('createRecepcionModal').classList.remove('hidden');
  document.getElementById('recObservaciones').value = '';
  
  const select = document.getElementById('recEmpleadoAsignado');
  select.innerHTML = '<option value="">Cargando empleados...</option>';
  try {
    const res = await fetch(`${API_BASE}/recepciones/empleados`, { headers: { 'Authorization': `Bearer ${currentToken}` } });
    const data = await res.json();
    if (res.ok) {
      select.innerHTML = '<option value="">Seleccione un empleado...</option>';
      data.empleados.forEach(emp => {
        select.innerHTML += `<option value="${emp.id}">${emp.nombre_completo} (@${emp.username})</option>`;
      });
    }
  } catch (err) {
    select.innerHTML = '<option value="">Error cargando empleados</option>';
  }
}

function closeCreateRecepcionModal() {
  document.getElementById('createRecepcionModal').classList.add('hidden');
}

async function handleCreateRecepcionSubmit(e) {
  e.preventDefault();
  const empleado_id = document.getElementById('recEmpleadoAsignado').value;
  const observaciones = document.getElementById('recObservaciones').value.trim();

  if (!empleado_id) {
    alert('Debes seleccionar un empleado.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/recepciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ empleado_id, observaciones })
    });
    const data = await res.json();
    if (res.ok) {
      alert('Tarea de conteo creada y asignada al empleado exitosamente.');
      closeCreateRecepcionModal();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (err) {
    alert('Error al crear la recepción.');
  }
}

// --- EMPLEADO ---
async function loadEmpleadoRecepciones() {
  const list = document.getElementById('employeeRecepcionesList');
  if (!list) return;

  try {
    const res = await fetch(`${API_BASE}/recepciones`, { headers: { 'Authorization': `Bearer ${currentToken}` } });
    const data = await res.json();
    if (res.ok && data.recepciones) {
      list.innerHTML = '';
      const pending = data.recepciones.filter(r => r.estado === 'PENDIENTE_CONTEO' && r.empleado_id === currentUser.id);
      if (pending.length > 0) {
        pending.forEach(r => {
          const div = document.createElement('div');
          div.className = 'p-3 bg-surface-container-low rounded-lg border border-outline-variant/30 flex justify-between items-center';
          div.innerHTML = `
            <div>
              <span class="font-bold text-tertiary">Rec. #${r.id}</span>
              <div class="text-[10px] text-outline">${new Date(r.created_at).toLocaleString()}</div>
              <div class="text-[11px] text-on-surface-variant">${r.observaciones || 'Sin observaciones'}</div>
            </div>
            <button onclick="openConteoRecepcionModal(${r.id})" class="px-3 py-1.5 bg-tertiary text-on-primary font-bold rounded-lg hover:bg-sky-400 text-xs shadow-md transition-colors">Contar</button>
          `;
          list.appendChild(div);
        });
      } else {
        list.innerHTML = `<div class="p-3 text-center text-outline">No tienes tareas de conteo pendientes.</div>`;
      }
    }
  } catch (err) {
    console.error(err);
  }
}

let activeConteoRecepcionId = null;
let currentConteoItems = [];

function openConteoRecepcionModal(id) {
  activeConteoRecepcionId = id;
  currentConteoItems = [];
  renderConteoList();
  document.getElementById('conteoCodigoSku').value = '';
  document.getElementById('conteoCantidad').value = '1';
  document.getElementById('conteoRecepcionModal').classList.remove('hidden');
}

function closeConteoRecepcionModal() {
  activeConteoRecepcionId = null;
  document.getElementById('conteoRecepcionModal').classList.add('hidden');
}

function addProductoToConteo() {
  const inputSku = document.getElementById('conteoCodigoSku');
  const inputQty = document.getElementById('conteoCantidad');
  const sku = inputSku.value.trim().toUpperCase();
  const qty = parseFloat(inputQty.value);

  if (!sku || qty <= 0 || isNaN(qty)) return;

  const product = liveProducts.find(p => p.codigo_sku.toUpperCase() === sku);
  if (!product) {
    alert('SKU no encontrado en la base de datos.');
    return;
  }

  const existing = currentConteoItems.find(i => i.producto_id === product.id);
  if (existing) {
    existing.cantidad_recibida += qty;
  } else {
    currentConteoItems.push({
      producto_id: product.id,
      sku: product.codigo_sku,
      nombre: product.nombre,
      cantidad_recibida: qty
    });
  }

  renderConteoList();
  inputSku.value = '';
  inputQty.value = '1';
  inputSku.focus();
}

function removeProductoFromConteo(productId) {
  currentConteoItems = currentConteoItems.filter(i => i.producto_id !== productId);
  renderConteoList();
}

function renderConteoList() {
  const tbody = document.getElementById('conteoListBody');
  tbody.innerHTML = '';
  currentConteoItems.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-outline-variant/20';
    tr.innerHTML = `
      <td class="py-1 px-2">
        <span class="font-bold text-on-surface block">${item.sku}</span>
        <span class="text-[10px] text-outline truncate block max-w-[150px]">${item.nombre}</span>
      </td>
      <td class="py-1 px-2 text-right font-bold text-primary">${item.cantidad_recibida}</td>
      <td class="py-1 px-2 text-center">
        <button onclick="removeProductoFromConteo(${item.producto_id})" class="text-error hover:text-red-400 transition-colors">
          <span class="material-symbols-outlined text-[14px]">delete</span>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function submitConteo() {
  if (currentConteoItems.length === 0) {
    alert('No has agregado ningún producto al conteo.');
    return;
  }

  const btn = event.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const res = await fetch(`${API_BASE}/recepciones/${activeConteoRecepcionId}/conteo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ items: currentConteoItems })
    });
    const data = await res.json();
    if (res.ok) {
      alert('Conteo enviado exitosamente. En espera de distribución por el administrador.');
      closeConteoRecepcionModal();
      loadEmpleadoRecepciones();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (err) {
    alert('Error enviando conteo');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Finalizar Conteo y Enviar';
  }
}

// --- ADMINISTRADOR ---
function openAdminRecepcionesModal() {
  document.getElementById('adminRecepcionesModal').classList.remove('hidden');
  loadAdminRecepciones();
}

function closeAdminRecepcionesModal() {
  document.getElementById('adminRecepcionesModal').classList.add('hidden');
}

async function loadAdminRecepciones() {
  const tbody = document.getElementById('adminRecepcionesTbody');
  tbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-outline text-sm">Cargando recepciones...</td></tr>';
  
  try {
    const res = await fetch(`${API_BASE}/recepciones`, { headers: { 'Authorization': `Bearer ${currentToken}` } });
    const data = await res.json();
    if (res.ok) {
      tbody.innerHTML = '';
      if (data.recepciones.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-outline text-sm">No hay recepciones registradas.</td></tr>';
        return;
      }
      data.recepciones.forEach(r => {
        const isContabilizado = r.estado === 'CONTABILIZADO';
        const tr = document.createElement('tr');
        tr.className = 'border-b border-outline-variant/30 hover:bg-surface-container-high/50 transition-colors text-on-surface';
        tr.innerHTML = `
          <td class="py-2 px-3 font-bold">${r.sede_nombre}</td>
          <td class="py-2 px-3">
            <div class="text-[10px] text-outline">Enc: ${r.encargado_nombre || 'N/A'}</div>
            <div class="text-[10px] text-primary">Emp: ${r.empleado_nombre || 'N/A'}</div>
          </td>
          <td class="py-2 px-3 text-[10px]">${new Date(r.created_at).toLocaleString()}</td>
          <td class="py-2 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
              r.estado === 'PENDIENTE_CONTEO' ? 'bg-orange-500/20 text-orange-400' :
              r.estado === 'CONTABILIZADO' ? 'bg-primary/20 text-primary' :
              'bg-surface-container-highest text-outline'
            }">${r.estado.replace('_', ' ')}</span>
          </td>
          <td class="py-2 px-3 text-right">
            ${isContabilizado ? `<button onclick="handleAdminDistribuir(${r.id})" class="px-3 py-1 bg-tertiary hover:bg-sky-400 text-white text-xs font-bold rounded shadow transition-colors">Distribuir</button>` : `<span class="text-[10px] text-outline">N/A</span>`}
          </td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-error text-sm">Error cargando recepciones.</td></tr>';
  }
}

async function handleAdminDistribuir(recepcionId) {
  if (!confirm('¿Estás seguro de distribuir esta mercancía contabilizada al inventario físico de la sede? Esto actualizará el stock disponible de forma irreversible.')) return;
  
  try {
    const res = await fetch(`${API_BASE}/recepciones/${recepcionId}/distribuir`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (res.ok) {
      alert('Mercancía distribuida exitosamente al inventario.');
      loadAdminRecepciones();
      loadRealInventory();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (err) {
    alert('Error en distribución.');
  }
}

// =============================================================================
// 9. CIERRE DE SESIÓN Y VERIFICACIÓN
// =============================================================================

async function handleLogout() {
  try {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
  } catch (err) {
    console.error('Error al notificar al servidor sobre el cierre de sesión:', err);
  }

  sessionStorage.removeItem('token_inventario_ce');
  currentUser = null;
  currentToken = null;

  document.getElementById('appSection').classList.add('hidden');
  document.getElementById('authSection').classList.remove('hidden');

  showAuthAlert('Has cerrado la sesión de forma segura.', 'success');
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
  checkDatabaseHealth();
  checkSavedSession();
  checkPolicies();
});

// Auto-refrescar datos en vivo cuando se vuelve a abrir/despertar la app (Multi-dispositivo)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentUser) {
    if (currentUser.rol === 'ADMINISTRADOR') {
      loadRealInventory();
      loadRecentTransfers();
      loadAdminDashboardData();
    } else if (currentUser.rol === 'ENCARGADO') {
      loadEncargadoInventory();
    }
  }
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

// =============================================================================
// 10. EXPORTACIÓN DE REPORTES (EXCEL, PDF, CSV)
// =============================================================================

window.exportReport = async function(type) {
  try {
    const res = await fetch(`${API_BASE}/dashboard/summary`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!res.ok || !data.dashboard || !data.dashboard.exactMovements) {
      alert('Error obteniendo datos para el reporte');
      return;
    }
    
    const movements = data.dashboard.exactMovements;
    
    // Preparar la data estructural
    const exportData = movements.map(m => ({
      Fecha: new Date(m.fecha_movimiento).toLocaleString(),
      Tipo: m.tipo_movimiento,
      Producto: m.producto_nombre,
      SKU: m.codigo_sku,
      Cantidad: m.cantidad,
      Stock_Anterior: m.stock_anterior,
      Stock_Posterior: m.stock_posterior,
      Sede: m.sede_nombre,
      Usuario: m.usuario_nombre
    }));

    if (type === 'excel') {
      if (typeof XLSX === 'undefined') return alert('Librería XLSX no cargada');
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Movimientos");
      XLSX.writeFile(workbook, "Reporte_Inventario.xlsx");
      
    } else if (type === 'pdf') {
      if (!window.jspdf) return alert('Librería jsPDF no cargada');
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF('landscape');
      
      doc.setFontSize(14);
      doc.text("Reporte de Movimientos de Inventario - Grupo Eléctrico", 14, 15);
      
      const tableColumn = ["Fecha", "Tipo", "Producto", "SKU", "Cant.", "Stk Ant->Post", "Sede", "Usuario"];
      const tableRows = [];

      movements.forEach(m => {
        tableRows.push([
          new Date(m.fecha_movimiento).toLocaleString(),
          m.tipo_movimiento,
          m.producto_nombre,
          m.codigo_sku,
          m.cantidad.toString(),
          `${m.stock_anterior} -> ${m.stock_posterior}`,
          m.sede_nombre,
          m.usuario_nombre
        ]);
      });

      doc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 22,
        styles: { fontSize: 8, font: 'helvetica' },
        headStyles: { fillColor: [0, 166, 81] }, // Verde corporativo
        theme: 'striped'
      });
      
      doc.save("Reporte_Inventario.pdf");
      
    } else if (type === 'csv') {
      if (typeof XLSX === 'undefined') return alert('Librería XLSX no cargada');
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
      
      const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "Reporte_Inventario.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } catch (err) {
    console.error('Error exportando reporte', err);
    alert('Error al generar el reporte. Verifica la conexión con el servidor.');
  }
};

// =============================================================================
// 11. GOOGLE OAUTH Y APROBACIONES DE USUARIOS
// =============================================================================

// Handler de google manejado arriba en la sección 3.

window.loadPendingUsers = async function() {
  if (!currentUser || currentUser.rol !== 'ADMINISTRADOR') return;
  try {
    const res = await fetch(`${API_BASE}/auth/pending-users`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (data.success) {
      renderPendingUsers(data.users);
    }
  } catch(e) {
    console.error(e);
  }
};

window.renderPendingUsers = function(users) {
  const tbody = document.getElementById('pendingUsersTbody');
  if (!tbody) return;
  
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-outline text-sm">No hay solicitudes pendientes.</td></tr>';
    document.getElementById('badgePendingCount').classList.add('hidden');
    return;
  }
  
  document.getElementById('badgePendingCount').innerText = users.length;
  document.getElementById('badgePendingCount').classList.remove('hidden');

  tbody.innerHTML = '';
  users.forEach(u => {
    tbody.innerHTML += `
      <tr class="border-b border-outline-variant/20 hover:bg-surface-container-high transition-colors">
        <td class="py-2 px-3 text-sm">${u.nombre_completo}</td>
        <td class="py-2 px-3 text-sm text-outline">${u.email}</td>
        <td class="py-2 px-3 text-xs font-mono">${new Date(u.created_at).toLocaleDateString()}</td>
        <td class="py-2 px-3">
          <select id="roleSelect_${u.id}" class="bg-surface-container-low border border-outline-variant rounded p-1 text-xs text-on-surface" onchange="toggleSedeSelect(${u.id})">
            <option value="EMPLEADO">Empleado</option>
            <option value="ENCARGADO">Encargado</option>
            <option value="ADMINISTRADOR">Administrador</option>
          </select>
          <select id="sedeSelect_${u.id}" class="bg-surface-container-low border border-outline-variant rounded p-1 text-xs text-on-surface hidden mt-1">
            <!-- Llenar con sedes activas -->
          </select>
        </td>
        <td class="py-2 px-3 text-right">
          <button onclick="approveUser(${u.id})" class="text-primary hover:text-primary-container p-1"><span class="material-symbols-outlined text-[18px]">check_circle</span></button>
          <button onclick="rejectUser(${u.id})" class="text-error hover:text-error-container p-1"><span class="material-symbols-outlined text-[18px]">cancel</span></button>
        </td>
      </tr>
    `;
    fillSedesSelect(`sedeSelect_${u.id}`);
  });
};

window.toggleSedeSelect = function(id) {
  const rol = document.getElementById(`roleSelect_${id}`).value;
  const sedeSelect = document.getElementById(`sedeSelect_${id}`);
  if (rol === 'ENCARGADO') {
    sedeSelect.classList.remove('hidden');
  } else {
    sedeSelect.classList.add('hidden');
  }
};

window.fillSedesSelect = async function(selectId) {
  const sel = document.getElementById(selectId);
  if(!sel) return;
  if(window.activeSedes && window.activeSedes.length > 0) {
    sel.innerHTML = window.activeSedes.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
  } else {
    try {
      const res = await fetch(`${API_BASE}/auth/sedes`);
      const data = await res.json();
      if(data.success) {
        window.activeSedes = data.sedes;
        sel.innerHTML = data.sedes.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
      }
    } catch(e) {}
  }
};

window.approveUser = async function(id) {
  const rol = document.getElementById(`roleSelect_${id}`).value;
  const sedeId = document.getElementById(`sedeSelect_${id}`).value;
  
  if (!confirm('¿Aprobar este usuario con el rol de ' + rol + '?')) return;
  
  try {
    const res = await fetch(`${API_BASE}/auth/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ userId: id, rol, sedeId })
    });
    const data = await res.json();
    if(data.success) {
      alert('Usuario aprobado.');
      loadPendingUsers();
    } else {
      alert(data.message);
    }
  } catch(e) { console.error(e); }
};

window.rejectUser = async function(id) {
  if (!confirm('¿Estás seguro de rechazar esta solicitud de acceso?')) return;
  try {
    const res = await fetch(`${API_BASE}/auth/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ userId: id })
    });
    const data = await res.json();
    if(data.success) {
      alert('Solicitud rechazada.');
      loadPendingUsers();
    } else {
      alert(data.message);
    }
  } catch(e) { console.error(e); }
};


// =============================================================================
// MODAL: NUEVA ENTRADA (ADMINISTRADOR)
// =============================================================================
window.openNewProductModal = function() {
  document.getElementById('newProductModal').classList.remove('hidden');
};

window.closeNewProductModal = function() {
  document.getElementById('newProductModal').classList.add('hidden');
  document.getElementById('newProductSku').value = '';
  document.getElementById('newProductName').value = '';
  document.getElementById('newProductCategory').value = '';
  document.getElementById('newProductUnit').value = '';
  document.getElementById('newProductPrice').value = '';
  document.getElementById('newProductStock').value = '0';
  document.getElementById('btnSubmitNewProduct').disabled = false;
  document.getElementById('btnSubmitNewProduct').textContent = 'Guardar Producto';
};

window.submitNewProduct = async function() {
  const btn = document.getElementById('btnSubmitNewProduct');
  const sku = document.getElementById('newProductSku').value.trim();
  const name = document.getElementById('newProductName').value.trim();
  const unit = document.getElementById('newProductUnit').value.trim();
  const price = parseFloat(document.getElementById('newProductPrice').value) || 0;
  const initialSede = document.getElementById('newProductSede').value;
  const initialStock = parseFloat(document.getElementById('newProductStock').value) || 0;

  if (!sku || !name) {
    showToast('El SKU y Nombre son obligatorios', 'error');
    return;
  }

  // Preparamos los datos de sedes (solo la sede inicial tendr stock y precio)
  const sedesData = [1, 2, 3, 4].map(id => ({
    sede_id: id,
    stock_actual: Number(id) === Number(initialSede) ? initialStock : 0,
    stock_minimo: 5,
    precio_venta: Number(id) === Number(initialSede) ? price : 0
  }));

  const payload = {
    codigo_sku: sku,
    nombre: name,
    categoria_id: null,
    unidad_medida: unit || 'UNIDAD',
    sedesData: sedesData
  };

  try {
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    const res = await fetch(`${API_BASE}/inventory/products`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}` 
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    
    if (data.success) {
      showToast('Producto y entrada registrados', 'success');
      closeNewProductModal();
      loadRealInventory();
    } else {
      showToast(data.message || 'Error al guardar', 'error');
      btn.disabled = false;
      btn.textContent = 'Guardar Producto';
    }
  } catch(e) {
    console.error(e);
    showToast('Falla en la red al guardar', 'error');
    btn.disabled = false;
    btn.textContent = 'Guardar Producto';
  }
};

// =============================================================================
// BACKUP Y RESTAURACION DE BASE DE DATOS (ADMINISTRADOR)
// =============================================================================
window.downloadBackup = async function() {
  if (!confirm('Deseas descargar una copia de seguridad SQL de toda la base de datos?')) return;
  try {
    const res = await fetch(`${API_BASE}/backup/download`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${currentToken}` 
      }
    });
    
    if (!res.ok) {
      showToast('Error al descargar backup', 'error');
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "backup_inventario.sql";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast('Copia de seguridad descargada', 'success');
  } catch(e) {
    console.error(e);
    showToast('Error de red al intentar descargar', 'error');
  }
};

window.restoreBackup = async function(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!confirm('PELIGRO! Restaurar una copia de seguridad REEMPLAZARA todos los datos actuales y es irreversible. Estas completamente seguro?')) {
    event.target.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('backupFile', file);

  try {
    showToast('Restaurando base de datos...', 'info');
    const res = await fetch(`${API_BASE}/backup/restore`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${currentToken}` 
      },
      body: formData
    });
    const data = await res.json();
    
    if (data.success) {
      showToast('Base de datos restaurada correctamente', 'success');
      setTimeout(() => window.location.reload(), 2000);
    } else {
      showToast(data.message || 'Error al restaurar backup', 'error');
    }
  } catch(e) {
    console.error(e);
    showToast('Falla en la red al restaurar', 'error');
  } finally {
    event.target.value = '';
  }
};
