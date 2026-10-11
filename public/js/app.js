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
let liveProducts = []; 
let liveCategories = []; 
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
      if (currentUser.rol === 'ADMINISTRADOR' && typeof loadRecentTransfers === 'function') loadRecentTransfers();
    }
  });

  globalSocket.on('solicitud_material_nueva', (data) => {
    if (!currentUser) return;
    showToast(`📢 Sede ${data.sede_solicitante_id} solicita material en la red.`, 'info');
    if (typeof loadNetworkRequests === 'function') loadNetworkRequests();
  });

  globalSocket.on('solicitud_actualizada', (data) => {
    if (!currentUser) return;
    showToast(`🔔 Solicitud #${data.id} actualizada: ${data.accion || data.estado}.`, 'info');
    if (typeof loadNetworkRequests === 'function') loadNetworkRequests();
    if (currentUser.rol === 'ADMINISTRADOR' || currentUser.rol === 'ENCARGADO') {
      loadRealInventory();
    }
    if (currentUser.rol === 'EMPLEADO') {
      loadEmployeeTransfers();
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
let fallbackData = null;
let useFallbackCaptcha = false;

async function loadRecaptcha() {
  try {
    const res = await fetch(`${API_BASE}/auth/config/recaptcha`);
    const data = await res.json();
    if (data.success) {
      if (data.fallbackToken && data.fallbackChallenge) {
        fallbackData = { challenge: data.fallbackChallenge, token: data.fallbackToken };
      }

      if (data.siteKey) {
        let attempts = 0;
        const initCaptcha = () => {
          if (typeof grecaptcha !== 'undefined' && grecaptcha.render) {
            recaptchaWidgetId = grecaptcha.render('google-recaptcha-container', {
              'sitekey': data.siteKey,
              'theme': document.documentElement.classList.contains('dark') ? 'dark' : 'light'
            });
          } else {
            attempts++;
            if (attempts > 30) { // Timeout after 3 seconds
               console.warn("ReCAPTCHA falló al cargar. Activando modo seguro offline (Math Fallback).");
               useFallbackCaptcha = true;
               
               const container = document.getElementById('google-recaptcha-container');
               container.innerHTML = `
                 <div class="flex items-center justify-between bg-surface-container-low border border-primary/30 p-2 rounded w-full max-w-sm">
                   <span class="text-xs font-mono text-on-surface-variant flex items-center gap-1">
                     <span class="material-symbols-outlined text-[16px] text-primary">security</span>
                     Resuelve: <strong class="text-on-surface ml-1">${data.fallbackChallenge} = </strong>
                   </span>
                   <input type="number" id="mathCaptchaInput" class="w-16 bg-surface-container text-center text-xs p-1.5 border border-outline-variant/40 rounded focus:border-primary focus:outline-none" required placeholder="?" />
                 </div>
               `;
            } else {
               setTimeout(initCaptcha, 100);
            }
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
const INACTIVITY_LIMIT = 15 * 60 * 1000; // 15 minutos en ms
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
  let recaptchaToken = null;
  if (useFallbackCaptcha) {
    const mathAnswer = document.getElementById('mathCaptchaInput').value.trim();
    if (!mathAnswer) {
      showAuthAlert('Por favor, resuelve el reto matemático de seguridad.');
      return;
    }
    recaptchaToken = `math:${mathAnswer}:${fallbackData.token}`;
  } else {
    recaptchaToken = (typeof grecaptcha !== 'undefined' && recaptchaWidgetId !== null) 
      ? grecaptcha.getResponse(recaptchaWidgetId) 
      : null;
    
    if (recaptchaWidgetId !== null && !recaptchaToken) {
      showAuthAlert('Por favor, marca la casilla de seguridad (No soy un robot).');
      return;
    }
  }

  const btnText = document.getElementById('btnLoginText');
  
  if (!username || !password) {
    showAuthAlert('Ingresa tu usuario y contraseña.');
    return;
  }

  const btn = document.getElementById('btnLoginSubmit');
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
    announceSessionStart(data.user);
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
    announceSessionStart(data.user);
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
    announceSessionStart(data.user);

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
    }
    
    if (catRes.ok && catData.categories) {
      liveCategories = catData.categories;
      populateCategoriesSelect();
    }
    
    renderActiveView();
    populateTransferModalProducts();
  } catch (err) {
    console.error('Error cargando inventario real:', err);
    renderActiveView();
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
let currentAdminPage = 1;
const adminPageSize = 50;

let currentEncargadoPage = 1;
const encargadoPageSize = 50;

function filterAdminTable(sedeId) {
  currentAdminSedeFilter = sedeId;
  currentAdminPage = 1;
  
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
  currentAdminPage = 1;
  renderAdminView();
}

function filterAdminCategory(categoryId) {
  currentAdminCategoryFilter = categoryId;
  currentAdminPage = 1;
  renderAdminView();
}

function goToAdminPage(page) {
  currentAdminPage = page;
  renderAdminView();
  const el = document.getElementById('adminInventoryTableContainer');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function goToEncargadoPage(page) {
  currentEncargadoPage = page;
  renderEncargadoView();
  const el = document.getElementById('encargadoInventoryTableContainer');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderPaginationControls(containerId, currentPage, totalItems, pageSize, onPageChangeFnName) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (totalItems <= 0) {
    container.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const clampedPage = Math.max(1, Math.min(currentPage, totalPages));
  const startItem = (clampedPage - 1) * pageSize + 1;
  const endItem = Math.min(clampedPage * pageSize, totalItems);

  const t = (typeof translations !== 'undefined' && typeof currentLang !== 'undefined' && translations[currentLang]) ? translations[currentLang] : {
    page_showing: "Mostrando",
    page_to: "a",
    page_of: "de",
    page_products: "productos",
    page_prev: "Anterior",
    page_next: "Siguiente",
    page_first: "Primero",
    page_last: "Último"
  };

  let pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (clampedPage > 3) pages.push('...');
    
    const start = Math.max(2, clampedPage - 1);
    const end = Math.min(totalPages - 1, clampedPage + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    
    if (clampedPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  let buttonsHtml = '';

  // Botón Primero
  buttonsHtml += `
    <button type="button" onclick="${onPageChangeFnName}(1)" ${clampedPage === 1 ? 'disabled' : ''} 
      class="px-2.5 py-1.5 rounded-lg border border-outline-variant/30 text-xs font-mono font-bold transition-all ${clampedPage === 1 ? 'opacity-30 cursor-not-allowed text-outline' : 'bg-surface-container-high hover:bg-surface-container-highest text-on-surface hover:text-primary active:scale-95'}" 
      title="${t.page_first || 'Primero'}">
      «
    </button>
  `;

  // Botón Anterior
  buttonsHtml += `
    <button type="button" onclick="${onPageChangeFnName}(${clampedPage - 1})" ${clampedPage === 1 ? 'disabled' : ''} 
      class="px-3 py-1.5 rounded-lg border border-outline-variant/30 text-xs font-mono font-bold transition-all flex items-center gap-1 ${clampedPage === 1 ? 'opacity-30 cursor-not-allowed text-outline' : 'bg-surface-container-high hover:bg-surface-container-highest text-on-surface hover:text-primary active:scale-95'}">
      ‹ ${t.page_prev || 'Anterior'}
    </button>
  `;

  // Botones Numéricos
  pages.forEach(p => {
    if (p === '...') {
      buttonsHtml += `<span class="px-2 py-1 text-xs text-outline font-mono select-none">...</span>`;
    } else {
      const isActive = p === clampedPage;
      buttonsHtml += `
        <button type="button" onclick="${onPageChangeFnName}(${p})" 
          class="w-8 h-8 rounded-lg text-xs font-mono font-bold transition-all ${isActive ? 'bg-primary text-on-primary shadow-md font-extrabold scale-105 border border-primary' : 'bg-surface-container-high hover:bg-surface-container-highest text-on-surface border border-outline-variant/30 hover:border-outline active:scale-95'}">
          ${p}
        </button>
      `;
    }
  });

  // Botón Siguiente
  buttonsHtml += `
    <button type="button" onclick="${onPageChangeFnName}(${clampedPage + 1})" ${clampedPage === totalPages ? 'disabled' : ''} 
      class="px-3 py-1.5 rounded-lg border border-outline-variant/30 text-xs font-mono font-bold transition-all flex items-center gap-1 ${clampedPage === totalPages ? 'opacity-30 cursor-not-allowed text-outline' : 'bg-surface-container-high hover:bg-surface-container-highest text-on-surface hover:text-primary active:scale-95'}">
      ${t.page_next || 'Siguiente'} ›
    </button>
  `;

  // Botón Último
  buttonsHtml += `
    <button type="button" onclick="${onPageChangeFnName}(${totalPages})" ${clampedPage === totalPages ? 'disabled' : ''} 
      class="px-2.5 py-1.5 rounded-lg border border-outline-variant/30 text-xs font-mono font-bold transition-all ${clampedPage === totalPages ? 'opacity-30 cursor-not-allowed text-outline' : 'bg-surface-container-high hover:bg-surface-container-highest text-on-surface hover:text-primary active:scale-95'}" 
      title="${t.page_last || 'Último'}">
      »
    </button>
  `;

  container.innerHTML = `
    <div class="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
      <div class="flex items-center gap-2 text-on-surface-variant font-mono">
        <span>${t.page_showing || 'Mostrando'} <strong class="text-primary font-bold">${startItem}</strong> - <strong class="text-primary font-bold">${endItem}</strong> ${t.page_of || 'de'} <strong class="text-on-surface font-bold">${totalItems}</strong> ${t.page_products || 'productos'}</span>
        <span class="text-outline">|</span>
        <span class="text-outline">Pág. <strong class="text-on-surface">${clampedPage}</strong> de <strong class="text-on-surface">${totalPages}</strong></span>
      </div>
      <div class="flex items-center gap-1.5 flex-wrap justify-center">
        ${buttonsHtml}
      </div>
    </div>
  `;
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

  const t = (typeof translations !== 'undefined' && typeof currentLang !== 'undefined' && translations[currentLang]) ? translations[currentLang] : {};

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
              <p class="text-[10px] text-outline mt-0.5">${count} ${t.product_count_suffix || 'producto(s)'}</p>
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
            <h4 class="font-headline font-semibold text-sm text-on-surface truncate">${t.uncategorized || 'Sin Categoría'}</h4>
            <p class="text-[10px] text-outline mt-0.5">${catCounts['uncategorized']} ${t.product_count_suffix || 'producto(s)'}</p>
          </div>
        </div>
      `;
    }
    
    // En modo galería de categorías no mostramos la barra de paginación de la tabla
    const paginationContainer = document.getElementById('adminPaginationContainer');
    if (paginationContainer) paginationContainer.innerHTML = '';
    
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

  const paginationContainer = document.getElementById('adminPaginationContainer');

  if (filteredProducts.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-outline">No hay productos que coincidan con los filtros.</td></tr>`;
    if (paginationContainer) paginationContainer.innerHTML = '';
    return;
  }

  const alertIcon = `<span class="material-symbols-outlined text-[12px] text-error align-middle" title="Stock bajo o agotado">warning</span>`;

  const totalMatches = filteredProducts.length;
  const totalPages = Math.ceil(totalMatches / adminPageSize) || 1;
  currentAdminPage = Math.max(1, Math.min(currentAdminPage, totalPages));
  const startIndex = (currentAdminPage - 1) * adminPageSize;
  const paginatedProducts = filteredProducts.slice(startIndex, startIndex + adminPageSize);

  if (currentAdminSedeFilter === 'ALL') {
    tableHead.innerHTML = `
      <tr class="bg-surface-container-lowest border-b border-outline-variant/40 font-mono text-[11px] uppercase tracking-wider text-outline">
        <th class="py-3 px-4">${t.th_sku_product || 'SKU / Producto'}</th>
        <th class="py-3 px-4">${t.th_unit || 'Unidad'}</th>
        <th class="py-3 px-4">Centro EP</th>
        <th class="py-3 px-4">EP1</th>
        <th class="py-3 px-4">EP3</th>
        <th class="py-3 px-4">EP6</th>
        <th class="py-3 px-4 text-center">${t.th_total_network || 'Total Red'}</th>
        <th class="py-3 px-4 text-right">${t.th_actions || t.th_action || 'Acción'}</th>
      </tr>
    `;

    paginatedProducts.forEach(p => {
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
            <button type="button" onclick="openTransferForProduct(${p.id}, '${p.codigo_sku}')" class="px-2 py-1 bg-secondary text-on-secondary hover:bg-yellow-400 font-mono text-[10px] font-bold rounded shadow-sm transition-colors" title="${t.menu_transfer || 'Mover Stock'}">
              <span class="material-symbols-outlined text-sm align-middle">swap_horiz</span>
            </button>
            <button type="button" onclick="openEditProductModal(${p.id})" class="px-2 py-1 bg-surface-container hover:bg-surface-container-high text-primary font-mono text-[10px] font-bold rounded border border-outline-variant/40 shadow-sm transition-colors" title="${t.btn_edit || 'Editar Producto'}">
              <span class="material-symbols-outlined text-sm align-middle">edit</span>
            </button>
            <button type="button" onclick="openDeleteProductModal(${p.id})" class="px-2 py-1 bg-surface-container hover:bg-error/20 hover:text-error text-error font-mono text-[10px] font-bold rounded border border-outline-variant/40 shadow-sm transition-colors" title="${t.btn_delete || 'Eliminar Producto'}">
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
        <th class="py-3 px-4">${t.th_sku_product || 'SKU / Producto'}</th>
        <th class="py-3 px-4">${t.th_unit || 'Unidad'}</th>
        <th class="py-3 px-4">${t.th_branch_price || 'Precio Venta Sede'}</th>
        <th class="py-3 px-4">${t.th_branch_stock || 'Stock en Sede'}</th>
        <th class="py-3 px-4 text-right">${t.th_actions || t.th_action || 'Acción'}</th>
      </tr>
    `;

    const grouped = paginatedProducts.reduce((acc, p) => {
      const cat = p.categoria_nombre || 'Sin Categoría';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(p);
      return acc;
    }, {});

    Object.keys(grouped).forEach(cat => {
      const catRow = document.createElement('tr');
      catRow.innerHTML = `<td colspan="5" class="bg-surface-container-low py-2 px-4 font-headline font-bold text-primary text-xs uppercase tracking-widest border-b border-outline-variant/30">${cat}</td>`;
      tableBody.appendChild(catRow);

      const itemsInCat = grouped[cat];

      itemsInCat.forEach(p => {
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

  // Renderizar la barra de paginación completa
  renderPaginationControls('adminPaginationContainer', currentAdminPage, totalMatches, adminPageSize, 'goToAdminPage');
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

  const paginationContainer = document.getElementById('encargadoPaginationContainer');

  if (filteredProducts.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-outline">No hay productos que coincidan con los filtros en esta sede.</td></tr>`;
    if (paginationContainer) paginationContainer.innerHTML = '';
    return;
  }

  const totalMatches = filteredProducts.length;
  const totalPages = Math.ceil(totalMatches / encargadoPageSize) || 1;
  currentEncargadoPage = Math.max(1, Math.min(currentEncargadoPage, totalPages));
  const startIndex = (currentEncargadoPage - 1) * encargadoPageSize;
  const paginatedProducts = filteredProducts.slice(startIndex, startIndex + encargadoPageSize);

  const grouped = paginatedProducts.reduce((acc, p) => {
    const cat = p.categoria_nombre || 'Sin Categoría';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

  Object.keys(grouped).forEach(cat => {
    const catRow = document.createElement('tr');
    catRow.innerHTML = `<td colspan="5" class="bg-surface-container-low py-2 px-4 font-headline font-bold text-primary text-xs uppercase tracking-widest border-b border-outline-variant/30">${cat}</td>`;
    tableBody.appendChild(catRow);

    const itemsInCat = grouped[cat];

    itemsInCat.forEach(p => {
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
          <button type="button" onclick="openTransferForProduct(${p.id}, '${p.codigo_sku}', null, ${sedeId})" class="px-2.5 py-1 bg-secondary text-on-secondary font-mono text-[11px] font-bold rounded shadow-sm hover:bg-yellow-400 transition-colors">
            Enviar a Otra Sede
          </button>
        </td>
      `;
      tableBody.appendChild(row);
    });
  });

  renderPaginationControls('encargadoPaginationContainer', currentEncargadoPage, totalMatches, encargadoPageSize, 'goToEncargadoPage');
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

  list.innerHTML = '<div class="p-3 text-center text-outline">Cargando misiones de entrega y traslados...</div>';

  try {
    // 1. Cargar solicitudes de material asignadas al corredor en tránsito
    const [resSol, resTrans] = await Promise.all([
      fetch(`${API_BASE}/solicitudes`, { credentials: 'include' }).then(r => r.ok ? r.json() : { solicitudes: [] }).catch(() => ({ solicitudes: [] })),
      fetch(`${API_BASE}/inventory/transfers`, { credentials: 'include' }).then(r => r.ok ? r.json() : { transfers: [] }).catch(() => ({ transfers: [] }))
    ]);

    const todasSol = resSol.solicitudes || [];
    const misMisiones = todasSol.filter(s => 
      s.estado === 'EN_TRANSITO' && (!s.empleado_corredor_id || Number(s.empleado_corredor_id) === Number(currentUser?.id))
    );

    const traslados = resTrans.transfers || [];

    if (misMisiones.length === 0 && traslados.length === 0) {
      list.innerHTML = `<div class="p-3 text-center text-outline">No hay traslados ni misiones asignadas por el momento.</div>`;
      return;
    }

    list.innerHTML = '';

    // A. MISIONES ACTIVAS EN TRÁNSITO (DÓNDE RECOGER Y LLEVAR)
    if (misMisiones.length > 0) {
      const headerMisiones = document.createElement('div');
      headerMisiones.className = 'flex items-center gap-1.5 text-secondary font-bold text-xs uppercase tracking-wider pb-1';
      headerMisiones.innerHTML = `
        <span class="material-symbols-outlined text-sm">directions_bike</span>
        <span>Misiones Activas (${misMisiones.length} en camino)</span>
      `;
      list.appendChild(headerMisiones);

      misMisiones.forEach(m => {
        const item = document.createElement('div');
        item.className = 'p-3.5 bg-secondary/10 border-2 border-secondary/50 rounded-xl space-y-2.5 shadow-md';

        // Detalle de materiales
        let itemsTexto = '';
        if (Array.isArray(m.items_json) && m.items_json.length > 0) {
          itemsTexto = m.items_json.map(it => 
            `<div class="flex justify-between text-xs font-mono"><span class="text-on-surface truncate">• ${it.nombre || 'Producto'}</span><span class="text-secondary font-bold ml-2">${it.cantidad || it.cantidad_solicitada || 1} un.</span></div>`
          ).join('');
        } else {
          itemsTexto = `<div class="flex justify-between text-xs font-mono"><span class="text-on-surface truncate">• ${m.producto_nombre || 'Producto'}</span><span class="text-secondary font-bold ml-2">${m.cantidad_aprobada || m.cantidad_solicitada} ${m.producto_unidad || 'un.'}</span></div>`;
        }

        item.innerHTML = `
          <div class="flex items-center justify-between">
            <span class="font-bold font-mono text-secondary text-xs flex items-center gap-1">
              <span class="material-symbols-outlined text-sm">local_shipping</span>
              SOL-${m.id}
            </span>
            <span class="text-[10px] bg-secondary text-on-secondary font-bold px-2 py-0.5 rounded-full animate-pulse">
              EN TRÁNSITO
            </span>
          </div>

          <!-- Ruta: Dónde Recoger y Dónde Llevar -->
          <div class="bg-surface-container-low p-2.5 rounded-lg border border-outline-variant/30 space-y-1.5 text-xs">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-amber-400 text-sm">store</span>
              <div class="text-[11px]">
                <span class="text-outline uppercase block text-[9px] font-bold">1. Recoger en:</span>
                <strong class="text-amber-300">${m.sede_proveedora_nombre || 'Sede Origen'}</strong>
              </div>
            </div>
            <div class="border-l-2 border-dashed border-secondary/40 ml-2 h-2.5"></div>
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-emerald-400 text-sm">location_on</span>
              <div class="text-[11px]">
                <span class="text-outline uppercase block text-[9px] font-bold">2. Entregar en:</span>
                <strong class="text-emerald-300">${m.sede_solicitante_nombre}</strong>
              </div>
            </div>
          </div>

          <!-- Lista de mercancía -->
          <div class="p-2 bg-surface-container rounded-lg border border-outline-variant/20">
            <span class="text-[9px] text-outline uppercase block font-bold mb-1">Mercancía a Transportar:</span>
            ${itemsTexto}
          </div>

          <!-- Botón de Confirmación para el Corredor -->
          <button type="button" onclick="confirmarRecepcionSolicitud(${m.id})" class="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold font-headline uppercase shadow-md flex items-center justify-center gap-1.5 transition-all active:scale-95">
            <span class="material-symbols-outlined text-base">task_alt</span>
            <span>Confirmar Entrega en Sede Destino</span>
          </button>
        `;
        list.appendChild(item);
      });
    }

    // B. HISTORIAL DE TRASLADOS REALIZADOS
    if (traslados.length > 0) {
      const headerHist = document.createElement('div');
      headerHist.className = 'flex items-center gap-1 text-outline font-bold text-[11px] uppercase tracking-wider pt-2 border-t border-outline-variant/30';
      headerHist.innerHTML = `
        <span class="material-symbols-outlined text-xs">history</span>
        <span>Historial de Traslados Completados</span>
      `;
      list.appendChild(headerHist);

      traslados.slice(0, 5).forEach(t => {
        const item = document.createElement('div');
        item.className = 'p-2.5 bg-surface-container-low rounded-lg border border-outline-variant/30 space-y-1';
        item.innerHTML = `
          <div class="flex items-center justify-between">
            <span class="font-bold text-primary font-mono text-xs">TR-${t.id}</span>
            <span class="text-[9px] bg-primary/20 text-primary font-bold px-1.5 py-0.5 rounded">COMPLETADO</span>
          </div>
          <div class="font-bold text-on-surface text-xs">${t.producto_nombre} (${t.cantidad} un.)</div>
          <div class="flex items-center justify-between text-on-surface-variant text-[10px]">
            <span>${t.origen_nombre}</span>
            <span class="text-secondary">&rarr;</span>
            <span>${t.destino_nombre}</span>
          </div>
          <div class="text-[9px] text-outline pt-0.5 border-t border-outline-variant/20">
            ${t.observaciones || 'Entrega física'} - ${new Date(t.created_at).toLocaleDateString()}
          </div>
        `;
        list.appendChild(item);
      });
    }

  } catch (err) {
    console.error('Error cargando traslados de empleado:', err);
    list.innerHTML = `<div class="p-3 text-center text-red-400">Error cargando traslados: ${err.message}</div>`;
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
  if (document.getElementById('editProdMarca')) {
    document.getElementById('editProdMarca').value = product.marca || '';
  }

  // Poblar selector de categorías
  const catSelect = document.getElementById('editProdCategory');
  const catList = (typeof liveCategories !== 'undefined' && Array.isArray(liveCategories)) ? liveCategories : [];
  if (catSelect) {
    catSelect.innerHTML = `
      <option value="">-- Sin Categoría --</option>
      ${catList.map(c => `
        <option value="${c.id}" ${product.categoria_id === c.id ? 'selected' : ''}>
          ${c.nombre}
        </option>
      `).join('')}
    `;
  }

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
  const categoria_id = document.getElementById('editProdCategory')?.value || null;
  const marca = document.getElementById('editProdMarca')?.value.trim() || null;

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
      credentials: 'include',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        codigo_sku: sku,
        nombre: name,
        descripcion: desc,
        unidad_medida: unit,
        categoria_id,
        marca,
        imagen_url,
        sedesData
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert('Error: ' + data.message);
      return;
    }

    alert('✓ Producto y categoría actualizados exitosamente.');
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

function renderTransferProductList(productsToShow) {
  const ul = document.getElementById('modalTransferProductList');
  if (!ul) return;
  ul.innerHTML = '';
  
  if (productsToShow.length === 0) {
    ul.innerHTML = '<li class="p-2 text-xs text-outline text-center">No hay coincidencias</li>';
    return;
  }

  productsToShow.forEach(p => {
    const li = document.createElement('li');
    li.className = 'p-2 cursor-pointer hover:bg-surface-container-highest transition-colors text-xs border-b border-outline-variant/20 last:border-0 font-sans';
    li.textContent = `${p.nombre} (SKU: ${p.codigo_sku})`;
    li.dataset.id = p.id;
    li.dataset.name = p.nombre;
    li.dataset.sku = p.codigo_sku;
    
    li.onmousedown = () => selectTransferProduct(p.id, p.nombre, p.codigo_sku);
    ul.appendChild(li);
  });
}

function populateTransferModalProducts() {
  // Render solo los primeros 30 para no saturar el DOM (UX Refactor para 1000+ productos)
  const initialProducts = liveProducts.slice(0, 30);
  renderTransferProductList(initialProducts);
  updateTransferAvailabilityHint();
}

window.filterTransferProducts = function() {
  const input = document.getElementById('modalTransferProductSearch');
  const filter = input.value.toLowerCase();
  
  // Buscar en memoria y no en el DOM
  const filtered = liveProducts.filter(p => 
    p.nombre.toLowerCase().includes(filter) || p.codigo_sku.toLowerCase().includes(filter)
  ).slice(0, 30); // Limitar a 30 resultados para velocidad

  renderTransferProductList(filtered);
};

window.showTransferProductsDropdown = function() {
  document.getElementById('modalTransferProductList').classList.remove('hidden');
}

window.hideTransferProductsDropdown = function() {
  setTimeout(() => {
    document.getElementById('modalTransferProductList').classList.add('hidden');
  }, 150);
}

window.selectTransferProduct = function(id, name, sku) {
  document.getElementById('modalTransferProduct').value = id;
  document.getElementById('modalTransferProductSearch').value = `${name} (SKU: ${sku})`;
  document.getElementById('modalTransferProductList').classList.add('hidden');
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
  if (!modal.classList.contains('hidden')) {
    poblarSelectCorredores(document.getElementById('modalTransferCorredor'));
  }
}

function openTransferForProduct(productId, sku, destId = null, origId = null) {
  toggleQuickTransferModal();
  const hiddenProd = document.getElementById('modalTransferProduct');
  const searchProd = document.getElementById('modalTransferProductSearch');
  
  if (hiddenProd && searchProd) {
    const prod = liveProducts.find(p => p.id === productId);
    if (prod) {
      hiddenProd.value = productId;
      searchProd.value = `${prod.nombre} (SKU: ${prod.codigo_sku})`;
    }
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
  let obs = document.getElementById('modalTransferObs').value.trim();
  const corredorEl = document.getElementById('modalTransferCorredor');
  const corredorId = corredorEl?.value;
  const corredorTexto = corredorEl?.selectedOptions?.[0]?.text;

  if (origId === destId) {
    alert('La sede de origen y destino deben ser distintas.');
    return;
  }

  if (corredorId && corredorTexto) {
    obs = obs ? `${obs} | Transportado por: ${corredorTexto}` : `Transportado por: ${corredorTexto}`;
  }

  const btn = document.getElementById('btnExecuteTransferSubmit');
  btn.disabled = true;
  btn.textContent = 'Procesando traslado en la base de datos...';

  try {
    const res = await fetch(`${API_BASE}/inventory/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
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

    showToast(`✓ Traslado de ${qty} unidades ejecutado con éxito.`, 'success');
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
  
  const inNombre = document.getElementById('conteoNombreProducto');
  const inMarca = document.getElementById('conteoMarca');
  const inSku = document.getElementById('conteoCodigoSku');
  const inQty = document.getElementById('conteoCantidad');
  const dropdown = document.getElementById('conteoProductoDropdown');

  if (inNombre) inNombre.value = '';
  if (inMarca) inMarca.value = '';
  if (inSku) inSku.value = '';
  if (inQty) inQty.value = '1';
  if (dropdown) dropdown.classList.add('hidden');

  document.getElementById('conteoRecepcionModal').classList.remove('hidden');
  if (inNombre) inNombre.focus();
}

function closeConteoRecepcionModal() {
  activeConteoRecepcionId = null;
  const dropdown = document.getElementById('conteoProductoDropdown');
  if (dropdown) dropdown.classList.add('hidden');
  document.getElementById('conteoRecepcionModal').classList.add('hidden');
}

// Búsqueda en vivo de productos existentes mientras el empleado escribe el nombre
window.handleSearchProductoConteo = function(inputEl) {
  const query = inputEl.value.trim().toLowerCase();
  const dropdown = document.getElementById('conteoProductoDropdown');
  if (!dropdown) return;

  if (query.length < 2) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    return;
  }

  const prods = (liveProducts || []).filter(p => 
    p.nombre?.toLowerCase().includes(query) ||
    p.codigo_sku?.toLowerCase().includes(query) ||
    (p.marca && p.marca.toLowerCase().includes(query))
  ).slice(0, 8);

  if (prods.length === 0) {
    dropdown.innerHTML = `
      <li class="p-2.5 text-xs text-outline font-sans italic border-b border-outline-variant/20">
        Producto no encontrado en catálogo (se registrará como producto nuevo).
      </li>
    `;
    dropdown.classList.remove('hidden');
    return;
  }

  dropdown.innerHTML = prods.map(p => `
    <li class="p-2.5 hover:bg-surface-container-high cursor-pointer border-b border-outline-variant/20 transition-colors"
        onmousedown="selectProductoParaConteo(${p.id})">
      <div class="flex justify-between items-center">
        <span class="text-xs font-sans font-bold text-on-surface truncate">${p.nombre}</span>
        <span class="text-[10px] font-mono font-bold text-primary ml-2">${p.codigo_sku}</span>
      </div>
      <div class="flex justify-between items-center text-[10px] text-outline font-mono mt-0.5">
        <span>Marca: ${p.marca || 'Genérica'}</span>
        <span>${p.unidad_medida || 'UNIDAD'}</span>
      </div>
    </li>
  `).join('');

  dropdown.classList.remove('hidden');
};

window.selectProductoParaConteo = function(productoId) {
  const p = (liveProducts || []).find(x => x.id === Number(productoId));
  const inNombre = document.getElementById('conteoNombreProducto');
  const inMarca = document.getElementById('conteoMarca');
  const inSku = document.getElementById('conteoCodigoSku');
  const dropdown = document.getElementById('conteoProductoDropdown');

  if (p) {
    if (inNombre) inNombre.value = p.nombre;
    if (inMarca) inMarca.value = p.marca || 'Genérica';
    if (inSku) inSku.value = p.codigo_sku;
  }
  if (dropdown) dropdown.classList.add('hidden');
};

function addProductoToConteo() {
  const inputNombre = document.getElementById('conteoNombreProducto');
  const inputMarca = document.getElementById('conteoMarca');
  const inputSku = document.getElementById('conteoCodigoSku');
  const inputQty = document.getElementById('conteoCantidad');

  const nombre = inputNombre ? inputNombre.value.trim() : '';
  const marca = inputMarca ? inputMarca.value.trim() : '';
  let sku = inputSku ? inputSku.value.trim().toUpperCase() : '';
  const qty = inputQty ? parseFloat(inputQty.value) : 0;

  if (!nombre) {
    alert('El Nombre del Producto es obligatorio.');
    if (inputNombre) inputNombre.focus();
    return;
  }

  if (!marca) {
    alert('La Marca del Producto es obligatoria.');
    if (inputMarca) inputMarca.focus();
    return;
  }

  if (!qty || qty <= 0 || isNaN(qty)) {
    alert('La cantidad debe ser un número mayor a 0.');
    if (inputQty) inputQty.focus();
    return;
  }

  let esAutoSku = false;
  if (!sku) {
    sku = 'SKU-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    esAutoSku = true;
  }

  // Buscar coincidencia en liveProducts
  const matchedProd = (liveProducts || []).find(p => 
    (sku && p.codigo_sku?.toUpperCase() === sku) ||
    p.nombre?.toLowerCase() === nombre.toLowerCase()
  );

  // Buscar si ya está en currentConteoItems (por SKU o nombre+marca)
  const existing = currentConteoItems.find(i => 
    i.sku === sku || 
    (i.nombre.toLowerCase() === nombre.toLowerCase() && i.marca.toLowerCase() === marca.toLowerCase())
  );

  if (existing) {
    existing.cantidad_recibida += qty;
  } else {
    currentConteoItems.push({
      temp_id: Date.now() + Math.random(),
      producto_id: matchedProd ? matchedProd.id : null,
      nombre: nombre,
      marca: marca,
      sku: sku,
      sku_auto: esAutoSku,
      cantidad_recibida: qty
    });
  }

  renderConteoList();

  if (inputNombre) inputNombre.value = '';
  if (inputMarca) inputMarca.value = '';
  if (inputSku) inputSku.value = '';
  if (inputQty) inputQty.value = '1';

  const dropdown = document.getElementById('conteoProductoDropdown');
  if (dropdown) dropdown.classList.add('hidden');

  if (inputNombre) inputNombre.focus();
}

function removeProductoFromConteo(tempId) {
  currentConteoItems = currentConteoItems.filter(i => (i.temp_id !== tempId && i.producto_id !== tempId));
  renderConteoList();
}

function renderConteoList() {
  const tbody = document.getElementById('conteoListBody');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (currentConteoItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-6 text-center text-outline text-xs font-sans">
          No hay productos en la lista de conteo. Usa el formulario de arriba para añadirlos.
        </td>
      </tr>
    `;
    return;
  }

  currentConteoItems.forEach(item => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-outline-variant/20 hover:bg-surface-container-high/40 transition-colors text-on-surface';
    const itemId = item.temp_id || item.producto_id;
    tr.innerHTML = `
      <td class="py-2 px-2.5">
        <span class="font-bold text-on-surface font-sans block truncate max-w-[200px]">${item.nombre}</span>
        ${item.producto_id ? `<span class="text-[9px] text-emerald-400 font-mono">✓ En Catálogo</span>` : `<span class="text-[9px] text-amber-400 font-mono">★ Producto Nuevo</span>`}
      </td>
      <td class="py-2 px-2 font-sans text-xs text-on-surface-variant">${item.marca}</td>
      <td class="py-2 px-2 font-mono text-[11px] text-outline">
        <span>${item.sku}</span>
        ${item.sku_auto ? `<span class="text-[8px] bg-outline-variant/30 text-outline px-1 rounded ml-1">AUTO</span>` : ''}
      </td>
      <td class="py-2 px-2 text-right font-bold font-mono text-primary text-xs">${item.cantidad_recibida}</td>
      <td class="py-2 px-2 text-center">
        <button type="button" onclick="removeProductoFromConteo(${itemId})" class="text-error hover:text-red-400 transition-colors p-1" title="Quitar">
          <span class="material-symbols-outlined text-[16px]">delete</span>
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
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined text-base animate-spin">refresh</span><span>Enviando Conteo...</span>';

  try {
    const res = await fetch(`${API_BASE}/recepciones/${activeConteoRecepcionId}/conteo`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {})
      },
      credentials: 'include',
      body: JSON.stringify({
        productos: currentConteoItems.map(i => ({
          producto_id: i.producto_id || null,
          nombre_producto: i.nombre,
          marca: i.marca,
          codigo_sku: i.sku,
          cantidad_recibida: i.cantidad_recibida
        }))
      })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('✓ Conteo finalizado y enviado exitosamente.', 'success');
      closeConteoRecepcionModal();
      loadEmpleadoRecepciones();
    } else {
      alert('Error: ' + (data.error || data.message || 'No se pudo enviar el conteo'));
    }
  } catch (err) {
    alert('Error enviando conteo: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
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
            <div class="flex items-center justify-end gap-1.5">
              <button onclick="verDetalleRecepcionModal(${r.id})" class="px-2.5 py-1 bg-surface-container hover:bg-surface-container-high text-on-surface border border-outline-variant/40 text-xs font-mono rounded transition-colors">
                Ver Items
              </button>
              ${isContabilizado ? `<button onclick="handleAdminDistribuir(${r.id})" class="px-3 py-1 bg-tertiary hover:bg-sky-400 text-white text-xs font-bold rounded shadow transition-colors">Distribuir</button>` : `<span class="text-[10px] text-outline">N/A</span>`}
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-error text-sm">Error cargando recepciones.</td></tr>';
  }
}

window.verDetalleRecepcionModal = async function(recepcionId) {
  try {
    const res = await fetch(`${API_BASE}/recepciones/${recepcionId}`, {
      headers: currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {},
      credentials: 'include'
    });
    const data = await res.json();
    if (res.ok && data.productos) {
      const itemsList = data.productos.map(p => 
        `• ${p.nombre_producto || 'SKU: ' + p.codigo_sku} [Marca: ${p.marca || 'N/A'}] - Cantidad: ${p.cantidad_recibida} (SKU: ${p.codigo_sku})`
      ).join('\n');
      alert(`Detalle de Mercancía Recibida (Recepción #${recepcionId}):\n\n${itemsList || 'Sin productos registrados.'}`);
    } else {
      alert('No se pudo cargar el detalle de la recepción.');
    }
  } catch (err) {
    alert('Error cargando detalle: ' + err.message);
  }
};

async function handleAdminDistribuir(recepcionId) {
  if (!confirm('¿Estás seguro de distribuir esta mercancía contabilizada al inventario físico de la sede? Esto actualizará el stock disponible de forma irreversible.')) return;
  
  try {
    const res = await fetch(`${API_BASE}/recepciones/${recepcionId}/distribuir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {})
      },
      credentials: 'include'
    });
    const data = await res.json();
    if (res.ok) {
      alert('Mercancía distribuida exitosamente al inventario.');
      loadAdminRecepciones();
      loadRealInventory();
    } else {
      alert('Error: ' + (data.message || data.error));
    }
  } catch (err) {
    alert('Error en distribución: ' + err.message);
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

  announceSessionEnd();
  sessionStorage.removeItem('token_inventario_ce');
  currentUser = null;
  currentToken = null;

  document.getElementById('appSection').classList.add('hidden');
  document.getElementById('authSection').classList.remove('hidden');

  showAuthAlert('Has cerrado la sesión de forma segura.', 'success');
}

// -----------------------------------------------------------------------------
// SESIÓN ÚNICA POR NAVEGADOR
// La cookie de sesión (httpOnly) es compartida por todas las pestañas. Si otra
// pestaña inicia sesión con otro usuario o cierra sesión, esta pestaña debe
// cerrarse para no mostrar la interfaz de un usuario con la identidad de otro.
// -----------------------------------------------------------------------------
const sessionChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('ce_session_sync') : null;

function announceSessionStart(user) {
  if (sessionChannel && user) {
    sessionChannel.postMessage({ type: 'login', userId: user.id, username: user.username });
  }
}

function announceSessionEnd() {
  if (sessionChannel) sessionChannel.postMessage({ type: 'logout' });
}

function forceLocalLogout(message) {
  sessionStorage.removeItem('token_inventario_ce');
  currentUser = null;
  currentToken = null;

  // Cerrar TODOS los modales flotantes abiertos en la pantalla
  const allModals = document.querySelectorAll('.fixed.inset-0');
  allModals.forEach(m => m.classList.add('hidden'));

  // Cerrar cualquier vista superpuesta (p. ej. el dashboard o la app principal)
  const dash = document.getElementById('dashboardSection');
  if (dash) dash.classList.add('hidden');
  const appSec = document.getElementById('appSection');
  if (appSec) appSec.classList.add('hidden');
  const authSec = document.getElementById('authSection');
  if (authSec) authSec.classList.remove('hidden');

  if (message) showAuthAlert(message, 'error');
}

if (sessionChannel) {
  sessionChannel.onmessage = (event) => {
    const msg = event.data || {};
    if (!currentUser) return;
    if (msg.type === 'login' && msg.userId !== currentUser.id) {
      forceLocalLogout(`Se inició sesión como "${msg.username}" en otra pestaña de este navegador. Solo se permite una sesión por navegador; usa una ventana de incógnito para otro usuario.`);
    } else if (msg.type === 'logout') {
      forceLocalLogout('La sesión se cerró desde otra pestaña de este navegador.');
    }
  };
}

// Verificación con el servidor al volver a la pestaña (respaldo por si se perdió el aviso)
async function verifySessionIdentity() {
  if (!currentUser) return true;
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    const serverUser = data.user;
    if (!res.ok || !serverUser) {
      forceLocalLogout('Tu sesión ya no es válida. Ingresa nuevamente.');
      return false;
    }
    if (serverUser.id !== currentUser.id) {
      forceLocalLogout(`Se inició sesión como "${serverUser.username}" en otra pestaña de este navegador. Solo se permite una sesión por navegador; usa una ventana de incógnito para otro usuario.`);
      return false;
    }
  } catch (e) {
    // Sin conexión: no forzamos cierre (modo offline)
  }
  return true;
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
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && currentUser) {
    const stillValid = await verifySessionIdentity();
    if (!stillValid) return;
    if (typeof loadRealInventory === 'function') loadRealInventory();
    if (typeof loadNetworkRequests === 'function') loadNetworkRequests();
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
  const stillValid = await verifySessionIdentity();
  if (!stillValid) return;
  document.getElementById('appSection').classList.add('hidden');
  document.getElementById('dashboardSection').classList.remove('hidden');
  await loadDashboardData();
}

function closeDashboard() {
  document.getElementById('dashboardSection').classList.add('hidden');
  document.getElementById('appSection').classList.remove('hidden');
}

async function loadDashboardData() {
  const tbody = document.getElementById('movementsTableBody');
  tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-outline text-sm">Cargando datos...</td></tr>`;

  let data = null;
  let res = null;
  try {
    res = await fetch(`${API_BASE}/dashboard/summary`, {
      headers: { 'Authorization': `Bearer ${currentToken}` },
      cache: 'no-store'
    });
    data = await res.json();
  } catch (err) {
    console.error('Error cargando dashboard', err);
    showDashboardError('No se pudo conectar con el servidor. Verifica que esté en ejecución.');
    return;
  }

  if (!res.ok || !data || !data.dashboard) {
    let msg = (data && (data.message || data.error)) || `Error ${res.status} al cargar el dashboard.`;
    if (res.status === 401 || res.status === 403) {
      msg += ' Es posible que hayas iniciado sesión con otro usuario en otra pestaña de este navegador. Cierra sesión y vuelve a ingresar como administrador.';
    }
    showDashboardError(msg);
    return;
  }

  // Tabla y gráficos se renderizan por separado para que un fallo no bloquee al otro
  try {
    renderExactMovements(data.dashboard.exactMovements);
  } catch (err) {
    console.error('Error renderizando historial', err);
    showDashboardError('Error mostrando el historial de movimientos: ' + err.message);
  }
  try {
    if (typeof Chart === 'undefined') throw new Error('La librería de gráficos (Chart.js) no cargó. Revisa tu conexión a Internet.');
    renderDashboardCharts(data.dashboard);
  } catch (err) {
    console.error('Error renderizando gráficos', err);
    alert('No se pudieron dibujar los gráficos: ' + err.message);
  }
}

function showDashboardError(message) {
  const tbody = document.getElementById('movementsTableBody');
  tbody.innerHTML = `
    <tr><td colspan="7" class="py-6 px-4 text-center text-error text-sm">
      <span class="material-symbols-outlined align-middle mr-1">error</span>${message}
    </td></tr>`;
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

      // Anchos de columna calculados profesionalmente para que ningún texto se corte
      worksheet['!cols'] = [
        { wch: 22 }, // Fecha
        { wch: 14 }, // Tipo
        { wch: 45 }, // Producto
        { wch: 18 }, // SKU
        { wch: 12 }, // Cantidad
        { wch: 16 }, // Stock Anterior
        { wch: 16 }, // Stock Posterior
        { wch: 26 }, // Sede
        { wch: 22 }  // Usuario
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Movimientos");
      const dateStr = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(workbook, `Reporte_Movimientos_GrupoElectrico_${dateStr}.xlsx`);
      
    } else if (type === 'pdf') {
      if (!window.jspdf) return alert('Librería jsPDF no cargada');
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF('landscape');
      
      // Encabezado Corporativo Premium
      doc.setFillColor(0, 143, 57); // Verde Brand
      doc.rect(0, 0, 297, 20, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text("GRUPO ELÉCTRICO - INFORME OFICIAL DE MOVIMIENTOS", 14, 13);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`Fecha de Emisión: ${new Date().toLocaleString()}`, 210, 13);

      // Metadatos
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(9);
      doc.text(`Total de registros listados: ${movements.length} movimientos`, 14, 27);

      const tableColumn = ["Fecha / Hora", "Tipo", "Descripción del Producto", "SKU", "Cant.", "Stk Ant->Post", "Sede", "Responsable"];
      const tableRows = [];

      movements.forEach(m => {
        tableRows.push([
          new Date(m.fecha_movimiento).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }),
          m.tipo_movimiento,
          m.producto_nombre,
          m.codigo_sku,
          Number(m.cantidad).toLocaleString('es-CO'),
          `${m.stock_anterior} -> ${m.stock_posterior}`,
          m.sede_nombre,
          m.usuario_nombre || 'Sistema'
        ]);
      });

      doc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 32,
        margin: { left: 14, right: 14 },
        styles: { 
          fontSize: 8, 
          font: 'helvetica', 
          cellPadding: 3, 
          overflow: 'linebreak',
          valign: 'middle' 
        },
        headStyles: { 
          fillColor: [0, 143, 57], 
          textColor: [255, 255, 255], 
          fontStyle: 'bold',
          halign: 'center'
        },
        alternateRowStyles: { 
          fillColor: [248, 250, 252] 
        },
        columnStyles: {
          0: { cellWidth: 32, halign: 'center' }, // Fecha
          1: { cellWidth: 24, halign: 'center', fontStyle: 'bold' }, // Tipo
          2: { cellWidth: 70 }, // Producto
          3: { cellWidth: 28, halign: 'center' }, // SKU
          4: { cellWidth: 18, halign: 'right' }, // Cant
          5: { cellWidth: 28, halign: 'center' }, // Stk
          6: { cellWidth: 35 }, // Sede
          7: { cellWidth: 34 }  // Responsable
        },
        theme: 'grid',
        didDrawPage: function(data) {
          // Pie de página con numeración
          const str = "Página " + doc.internal.getNumberOfPages();
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184);
          doc.text(str, 297 - 30, 205);
        }
      });
      
      const dateStr = new Date().toISOString().slice(0, 10);
      doc.save(`Reporte_Movimientos_GrupoElectrico_${dateStr}.pdf`);
      
    } else if (type === 'csv') {
      if (typeof XLSX === 'undefined') return alert('Librería XLSX no cargada');
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
      
      const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `Reporte_Inventario_${new Date().toISOString().slice(0,10)}.csv`);
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
// =============================================================================
// BACKUP, RESTAURACIÓN Y SINCRONIZACIÓN NEON (ADMINISTRADOR)
// =============================================================================
window.downloadBackup = async function() {
  if (!confirm('¿Deseas descargar una copia de seguridad SQL completa y auto-recuperable de la base de datos?')) return;
  try {
    showToast('Generando copia de seguridad...', 'info');
    const res = await fetch(`${API_BASE}/backup/download`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${currentToken}` 
      }
    });
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.message || 'Error al descargar backup', 'error');
      return;
    }

    const disposition = res.headers.get('content-disposition');
    let filename = 'backup_inventario_ce.sql';
    if (disposition && disposition.indexOf('filename=') !== -1) {
      const matches = /filename="?([^"]+)"?/.exec(disposition);
      if (matches != null && matches[1]) filename = matches[1];
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast('✅ Copia de seguridad descargada exitosamente', 'success');
  } catch(e) {
    console.error(e);
    showToast('Error de red al intentar descargar', 'error');
  }
};

window.restoreBackup = async function(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!confirm(`⚠️ ¡ATENCIÓN!\n\n¿Estás seguro de restaurar "${file.name}"?\nEsta acción recreará las tablas que falten y restaurará los datos a la versión del archivo.`)) {
    event.target.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('backupFile', file);

  try {
    showToast('Restaurando base de datos y recreando tablas... Por favor espera.', 'info');
    const res = await fetch(`${API_BASE}/backup/restore`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${currentToken}` 
      },
      body: formData
    });
    const data = await res.json();
    
    if (data.success) {
      showToast('✅ Base de datos restaurada correctamente', 'success');
      alert('✅ ' + data.message + '\n\nLa página se recargará para reflejar el estado restaurado.');
      setTimeout(() => window.location.reload(), 1500);
    } else {
      showToast(data.message || 'Error al restaurar backup', 'error');
      alert('❌ Error al restaurar: ' + (data.message || 'Error desconocido'));
    }
  } catch(e) {
    console.error(e);
    showToast('Falla en la red al restaurar', 'error');
  } finally {
    event.target.value = '';
  }
};

window.restoreLatestBackup = async function() {
  if (!confirm('⚡ ¿Deseas restaurar el sistema automáticamente a la última copia de seguridad guardada?\n\nNo necesitas buscar ningún archivo en tu computador; el servidor cargará la versión más reciente en tiempo real.')) return;
  try {
    showToast('Restaurando desde la copia más reciente del servidor...', 'info');
    const res = await fetch(`${API_BASE}/backup/restore-latest`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${currentToken}`
      }
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ ' + data.message, 'success');
      alert('✅ ' + data.message + '\n\nLa página se recargará ahora mismo.');
      setTimeout(() => window.location.reload(), 1200);
    } else {
      showToast(data.message || 'Error al restaurar', 'error');
      alert('❌ Error: ' + (data.message || 'Error desconocido'));
    }
  } catch(e) {
    console.error(e);
    showToast('Error de red al restaurar última copia', 'error');
  }
};

window.syncWithNeon = async function() {
  if (!confirm('¿Deseas sincronizar la base de datos de Docker hacia NEON en la nube?\n\nEsto enviará todas las tablas y datos actuales de Docker a la base de datos de Neon Cloud.')) return;
  try {
    showToast('Sincronizando con Neon Cloud...', 'info');
    const res = await fetch(`${API_BASE}/backup/sync-neon`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${currentToken}`
      }
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Sincronizado con Neon con éxito', 'success');
      alert('✅ ' + data.message);
    } else {
      showToast(data.message || 'Error sincronizando con Neon', 'error');
      alert('❌ Error: ' + (data.message || 'Error al conectar'));
    }
  } catch(e) {
    console.error(e);
    showToast('Error de red al sincronizar con Neon', 'error');
  }
};

// =============================================================================
// 10. MÓDULO DE AUDITORÍA Y VIGILANCIA (ADMINISTRADOR)
// =============================================================================

let allAuditLogs = [];

let auditAutoRefreshTimer = null;

window.openAuditLogsModal = async function() {
  const modal = document.getElementById('auditLogsModal');
  if (modal) modal.classList.remove('hidden');
  await loadAuditLogsData();

  // Actualización automática en tiempo real cada 4 segundos mientras la ventana esté abierta
  if (auditAutoRefreshTimer) clearInterval(auditAutoRefreshTimer);
  auditAutoRefreshTimer = setInterval(() => {
    const modalCheck = document.getElementById('auditLogsModal');
    if (modalCheck && !modalCheck.classList.contains('hidden')) {
      loadAuditLogsData(true); // background silent refresh
    } else {
      clearInterval(auditAutoRefreshTimer);
      auditAutoRefreshTimer = null;
    }
  }, 4000);
};

window.closeAuditLogsModal = function() {
  const modal = document.getElementById('auditLogsModal');
  if (modal) modal.classList.add('hidden');
  if (auditAutoRefreshTimer) {
    clearInterval(auditAutoRefreshTimer);
    auditAutoRefreshTimer = null;
  }
};

window.loadAuditLogsData = async function(isSilent = false) {
  const tbody = document.getElementById('auditLogsTableBody');
  if (!tbody) return;
  if (!isSilent && allAuditLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-outline text-sm">Cargando registros de auditoría en tiempo real...</td></tr>`;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/audit-logs?limit=300`, {
      credentials: 'include',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();

    if (data.success && Array.isArray(data.data)) {
      allAuditLogs = data.data;
      renderAuditLogs(allAuditLogs);
    } else {
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-error text-sm">${data.message || 'Error cargando auditoría'}</td></tr>`;
    }
  } catch (err) {
    console.error('Error cargando logs de auditoría:', err);
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-error text-sm">Error de conexión al cargar auditoría.</td></tr>`;
  }
};

window.filterAuditLogs = function() {
  const query = (document.getElementById('auditSearchInput')?.value || '').toLowerCase().trim();
  const actionFilter = document.getElementById('auditFilterAction')?.value || 'ALL';

  const filtered = allAuditLogs.filter(log => {
    const matchesAction = actionFilter === 'ALL' || log.accion === actionFilter;
    const matchesQuery = !query || 
      (log.username && log.username.toLowerCase().includes(query)) ||
      (log.accion && log.accion.toLowerCase().includes(query)) ||
      (log.detalles && log.detalles.toLowerCase().includes(query)) ||
      (log.ip_address && log.ip_address.toLowerCase().includes(query));
    return matchesAction && matchesQuery;
  });

  renderAuditLogs(filtered);
};

function renderAuditLogs(logs) {
  const tbody = document.getElementById('auditLogsTableBody');
  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-outline text-sm">No se encontraron registros de auditoría.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(log => {
    const dateStr = log.created_at ? new Date(log.created_at).toLocaleString('es-CO') : '-';
    
    let badgeColor = 'bg-surface-container text-on-surface-variant border-outline-variant/50';
    if (log.accion.includes('LOGIN')) badgeColor = 'bg-primary/10 text-primary border-primary/30';
    else if (log.accion.includes('LOGOUT')) badgeColor = 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    else if (log.accion.includes('CREAR')) badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    else if (log.accion.includes('SOLICITUD') || log.accion.includes('PETICION')) badgeColor = 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';
    else if (log.accion.includes('DESPACHO') || log.accion.includes('ATENDER')) badgeColor = 'bg-blue-500/10 text-blue-400 border-blue-500/30';
    else if (log.accion.includes('ASIGNAR_CORREDOR') || log.accion.includes('CORREDOR')) badgeColor = 'bg-orange-500/10 text-orange-400 border-orange-500/30';
    else if (log.accion.includes('COMPLETAR') || log.accion.includes('RECEPCION_SOLICITUD')) badgeColor = 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
    else if (log.accion.includes('EDITAR') || log.accion.includes('TRASLADO')) badgeColor = 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
    else if (log.accion.includes('ELIMINAR') || log.accion.includes('RECHAZAR') || log.accion.includes('RECHAZO')) badgeColor = 'bg-error/10 text-error border-error/30';
    else if (log.accion.includes('BACKUP') || log.accion.includes('RESTAURAR')) badgeColor = 'bg-purple-500/10 text-purple-400 border-purple-500/30';
    else if (log.accion.includes('RECEPCION') || log.accion.includes('CONTEO')) badgeColor = 'bg-sky-500/10 text-sky-400 border-sky-500/30';

    return `
      <tr class="border-b border-outline-variant/20 hover:bg-surface-container-low transition-colors">
        <td class="py-2.5 px-3 font-mono text-[11px] text-outline whitespace-nowrap">${dateStr}</td>
        <td class="py-2.5 px-3 font-bold text-on-surface flex items-center gap-1.5">
          <span class="material-symbols-outlined text-sm text-primary">person</span>
          <span>@${log.username || 'SISTEMA'}</span>
        </td>
        <td class="py-2.5 px-3 whitespace-nowrap">
          <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${badgeColor}">
            ${log.accion}
          </span>
        </td>
        <td class="py-2.5 px-3 text-on-surface-variant max-w-md truncate" title="${(log.detalles || '').replace(/"/g, '&quot;')}">
          ${log.detalles || '-'}
        </td>
        <td class="py-2.5 px-3 font-mono text-[11px] text-outline whitespace-nowrap">
          ${log.ip_address || '-'}
        </td>
      </tr>
    `;
  }).join('');
}


// =============================================================================
// 12. RED DE SOLICITUDES Y TRASLADOS COLABORATIVOS ENTRE SEDES
// =============================================================================

let networkRequests = [];
let activeRequestsTab = 'PENDIENTES';
let selectedSolicitudParaResponder = null;
let selectedSolicitudParaCorredor = null;
let listaCorredoresDisponibles = [];

window.openNetworkRequestsModal = function() {
  const modal = document.getElementById('networkRequestsModal');
  if (modal) {
    modal.classList.remove('hidden');
    loadNetworkRequests();
  }
};

window.closeNetworkRequestsModal = function() {
  const modal = document.getElementById('networkRequestsModal');
  if (modal) modal.classList.add('hidden');
};

window.loadNetworkRequests = async function() {
  try {
    const res = await fetch(`${API_BASE}/solicitudes`);
    const data = await res.json();
    if (res.ok && data.success) {
      networkRequests = data.solicitudes || [];
      updateNetworkBadges();
      renderNetworkRequests();
    }
  } catch (err) {
    console.error('Error cargando solicitudes:', err);
  }
};

function updateNetworkBadges() {
  if (!currentUser) return;
  const mySede = Number(currentUser.sede_id || 0);
  const isAdm = currentUser.rol === 'ADMINISTRADOR';

  // Contadores
  const pendientes = networkRequests.filter(s => {
    if (s.estado !== 'PENDIENTE') return false;
    // Si soy admin, veo todas las pendientes
    if (isAdm) return true;
    
    // Si soy encargado: verificar si mi sede ya declinó esta solicitud
    const yaRechazadaPorMiSede = Array.isArray(s.sedes_rechazadas_json) && 
      s.sedes_rechazadas_json.some(r => Number(r.sede_id) === mySede);
    if (yaRechazadaPorMiSede) return false;

    // Si otra sede solicita a la red, o si me enviaron un envío proactivo a mi sede
    return Number(s.sede_solicitante_id) !== mySede && (!s.sede_proveedora_id || Number(s.sede_proveedora_id) === mySede);
  });

  const misPedidos = networkRequests.filter(s => {
    if (isAdm) return true;
    return Number(s.sede_solicitante_id) === mySede;
  });

  const transito = networkRequests.filter(s => s.estado === 'EN_TRANSITO');

  // Actualizar badges numéricos
  const countP = pendientes.length;
  const badgeTop = document.getElementById('networkRequestsBadge');
  const badgeSide = document.getElementById('sidebarRequestsBadge');

  if (badgeTop) {
    badgeTop.textContent = countP;
    badgeTop.classList.toggle('hidden', countP === 0);
  }
  if (badgeSide) {
    badgeSide.textContent = countP;
    badgeSide.classList.toggle('hidden', countP === 0);
  }

  const tabCountP = document.getElementById('tabCountPendientes');
  if (tabCountP) tabCountP.textContent = pendientes.length;

  const tabCountM = document.getElementById('tabCountMisPedidos');
  if (tabCountM) tabCountM.textContent = misPedidos.length;

  const tabCountT = document.getElementById('tabCountTransito');
  if (tabCountT) tabCountT.textContent = transito.length;
}

window.filterRequestsTab = function(tab) {
  activeRequestsTab = tab;
  
  const tabs = ['tabReqPendientes', 'tabReqMisPedidos', 'tabReqTransito', 'tabReqHistorial'];
  tabs.forEach(tId => {
    const btn = document.getElementById(tId);
    if (!btn) return;
    btn.className = 'px-4 py-2 font-mono text-xs font-bold rounded-t-lg text-outline hover:text-on-surface transition-all flex items-center gap-1.5';
  });

  const activeBtn = document.getElementById(
    tab === 'PENDIENTES' ? 'tabReqPendientes' :
    tab === 'MIS_PEDIDOS' ? 'tabReqMisPedidos' :
    tab === 'TRANSITO' ? 'tabReqTransito' : 'tabReqHistorial'
  );

  if (activeBtn) {
    activeBtn.className = 'px-4 py-2 font-mono text-xs font-bold rounded-t-lg bg-surface-container text-amber-400 border-t-2 border-amber-500 transition-all flex items-center gap-1.5';
  }

  renderNetworkRequests();
};

function renderNetworkRequests() {
  const container = document.getElementById('networkRequestsList');
  if (!container || !currentUser) return;

  const mySede = Number(currentUser.sede_id || 0);
  const isAdm = currentUser.rol === 'ADMINISTRADOR';

  let filtered = [];

  if (activeRequestsTab === 'PENDIENTES') {
    filtered = networkRequests.filter(s => {
      if (s.estado !== 'PENDIENTE') return false;
      if (isAdm) return true;
      
      const yaRechazadaPorMiSede = Array.isArray(s.sedes_rechazadas_json) && 
        s.sedes_rechazadas_json.some(r => Number(r.sede_id) === mySede);
      if (yaRechazadaPorMiSede) return false;

      // Mostrar si otra sede solicita a la red, o si me enviaron un envío proactivo a mi sede
      return Number(s.sede_solicitante_id) !== mySede && (!s.sede_proveedora_id || Number(s.sede_proveedora_id) === mySede);
    });
  } else if (activeRequestsTab === 'MIS_PEDIDOS') {
    filtered = networkRequests.filter(s => {
      if (isAdm) return true;
      return Number(s.sede_solicitante_id) === mySede;
    });
  } else if (activeRequestsTab === 'TRANSITO') {
    filtered = networkRequests.filter(s => s.estado === 'EN_TRANSITO');
  } else if (activeRequestsTab === 'HISTORIAL') {
    filtered = networkRequests.filter(s => {
      if (s.estado === 'COMPLETADA' || s.estado === 'RECHAZADA') return true;
      // Mostrar al encargado solicitudes de red que su sede declinó
      if (!isAdm && Array.isArray(s.sedes_rechazadas_json) && s.sedes_rechazadas_json.some(r => Number(r.sede_id) === mySede)) {
        return true;
      }
      return false;
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-outline font-mono text-xs flex flex-col items-center gap-2">
        <span class="material-symbols-outlined text-4xl text-outline/40">inbox</span>
        <span>No hay solicitudes en esta sección.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(s => {
    const isMine = Number(s.sede_solicitante_id) === mySede;
    const isSupplier = Number(s.sede_proveedora_id) === mySede;
    const declinedByMySede = !isAdm && Array.isArray(s.sedes_rechazadas_json) && s.sedes_rechazadas_json.some(r => Number(r.sede_id) === mySede);
    const fecha = new Date(s.created_at).toLocaleString('es-CO');

    // Badges de estado
    let estadoBadge = '';
    if (s.estado === 'PENDIENTE') {
      if (declinedByMySede && activeRequestsTab === 'HISTORIAL') {
        estadoBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">DECLINADA POR TU SEDE</span>`;
      } else {
        estadoBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">PENDIENTE</span>`;
      }
    } else if (s.estado === 'ACEPTADA') {
      estadoBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-500/20 text-blue-400 border border-blue-500/40">ACEPTADA</span>`;
    } else if (s.estado === 'EN_TRANSITO') {
      estadoBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/20 text-purple-400 border border-purple-500/40 animate-pulse">🚚 EN TRÁNSITO</span>`;
    } else if (s.estado === 'COMPLETADA') {
      estadoBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">✅ COMPLETADA</span>`;
    } else if (s.estado === 'RECHAZADA') {
      estadoBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-500/20 text-red-400 border border-red-500/40">RECHAZADA</span>`;
    }

    // Materiales
    let itemsHtml = '';
    if (s.items_json && Array.isArray(s.items_json) && s.items_json.length > 0) {
      itemsHtml = `
        <div class="space-y-1 mt-1">
          <span class="text-[10px] text-outline uppercase font-mono">Lista de Materiales (${s.items_json.length}):</span>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs font-mono">
            ${s.items_json.map(it => `
              <div class="p-1.5 bg-surface-container rounded border border-outline-variant/30 flex justify-between items-center">
                <span class="text-on-surface truncate font-sans">${it.nombre || ('SKU: ' + it.producto_id)}</span>
                <span class="text-primary font-bold ml-2">${it.cantidad} un.</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      itemsHtml = `
        <div class="flex items-center gap-2 text-xs font-mono">
          <span class="text-on-surface font-semibold font-sans">${s.producto_nombre || 'Producto SKU-' + s.producto_id}</span>
          <span class="text-outline text-[11px]">(SKU: ${s.producto_sku || s.producto_id})</span>
          <span class="text-primary font-bold bg-primary/10 px-2 py-0.5 rounded">Requerido: ${s.cantidad_solicitada} ${s.producto_unidad || 'un.'}</span>
          ${s.cantidad_aprobada ? `<span class="text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded">Aprobado a Enviar: ${s.cantidad_aprobada}</span>` : ''}
        </div>
      `;
    }

    // Botones de acción dinámicos
    let accionesHtml = '';

    // 1. Petición PENDIENTE
    if (s.estado === 'PENDIENTE') {
      if (isAdm) {
        accionesHtml += `
          <div class="flex items-center gap-2 pt-2 border-t border-outline-variant/20">
            <button type="button" onclick="openAdminAtenderModal(${s.id})" class="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1.5 shadow-md active:scale-95">
              <span class="material-symbols-outlined text-sm">admin_panel_settings</span>
              <span>⚡ Atender Petición (Gestionar Sedes y Corredor)</span>
            </button>
            <button type="button" onclick="openResponderModal(${s.id}, 'RECHAZAR')" class="px-3 py-1.5 bg-surface-container hover:bg-red-500/20 text-red-400 border border-red-500/40 rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1">
              <span class="material-symbols-outlined text-sm">cancel</span>
              <span>Rechazar</span>
            </button>
          </div>
        `;
      } else if (!isMine) {
        accionesHtml += `
          <div class="flex items-center gap-2 pt-2 border-t border-outline-variant/20">
            <button type="button" onclick="openResponderModal(${s.id}, 'ACEPTAR', ${s.cantidad_solicitada})" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1 shadow-sm active:scale-95">
              <span class="material-symbols-outlined text-sm">check_circle</span>
              <span>Aceptar y Enviar</span>
            </button>
            <button type="button" onclick="openResponderModal(${s.id}, 'RECHAZAR')" class="px-3 py-1.5 bg-surface-container hover:bg-red-500/20 text-red-400 border border-red-500/40 rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1">
              <span class="material-symbols-outlined text-sm">cancel</span>
              <span>No Tengo / Rechazar</span>
            </button>
          </div>
        `;
      }
    }

    // 2. Solicitud ACEPTADA -> Botón Asignar Corredor (visible para sede solicitante, sede proveedora y admin)
    if (s.estado === 'ACEPTADA') {
      accionesHtml += `
        <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-outline-variant/20">
          <div class="text-xs text-blue-400 font-sans">
            Aceptada por <strong>${s.sede_proveedora_nombre || 'Sede Proveedora'}</strong>. Listo para asignar el corredor que transportará:
          </div>
          <button type="button" onclick="openAsignarCorredorModal(${s.id})" class="px-3 py-1.5 bg-secondary hover:bg-yellow-400 text-on-secondary rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1 shadow-sm active:scale-95">
            <span class="material-symbols-outlined text-sm">directions_bike</span>
            <span>Asignar Corredor Logístico</span>
          </button>
        </div>
      `;
    }

    // 3. Solicitud EN_TRANSITO -> Confirmar Recepción Física
    if (s.estado === 'EN_TRANSITO') {
      accionesHtml += `
        <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-outline-variant/20">
          <div class="text-xs text-purple-300 font-sans flex items-center gap-1.5">
            <span class="material-symbols-outlined text-sm">local_shipping</span>
            <span>En camino por corredor: <strong class="text-secondary">${s.corredor_nombre || 'Corredor Asignado'}</strong></span>
          </div>
          <button type="button" onclick="confirmarRecepcionSolicitud(${s.id})" class="px-3.5 py-1.5 bg-primary hover:bg-emerald-400 text-on-primary rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1 shadow-md active:scale-95">
            <span class="material-symbols-outlined text-sm">inventory</span>
            <span>Confirmar Llegada e Ingresar Stock</span>
          </button>
        </div>
      `;
    }

    return `
      <div class="p-4 bg-surface-container-low rounded-xl border border-outline-variant/40 space-y-2.5 hover:border-outline-variant transition-all">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="font-headline font-bold text-xs text-on-surface">#${s.id}</span>
            <span class="text-outline text-xs">•</span>
            <span class="font-mono text-xs font-bold text-amber-400">${s.sede_solicitante_nombre || 'Sede ' + s.sede_solicitante_id}</span>
            <span class="material-symbols-outlined text-xs text-outline">arrow_forward</span>
            <span class="font-mono text-xs font-bold text-primary">${s.sede_proveedora_nombre || (s.tipo === 'ENVIO_PROACTIVO' ? 'Sede ' + s.sede_proveedora_id : 'Red Abierta')}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-mono text-outline">${fecha}</span>
            ${estadoBadge}
          </div>
        </div>

        ${itemsHtml}

        ${Array.isArray(s.sedes_rechazadas_json) && s.sedes_rechazadas_json.length > 0 ? `
          <div class="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs space-y-1 font-mono">
            <div class="text-amber-400 font-bold flex items-center gap-1.5">
              <span class="material-symbols-outlined text-sm">info</span>
              <span>Sedes que reportaron falta de existencias (${s.sedes_rechazadas_json.length}):</span>
            </div>
            <div class="space-y-1 mt-1 font-sans">
              ${s.sedes_rechazadas_json.map(r => `
                <div class="flex items-center justify-between text-[11px] bg-surface-container/60 px-2 py-1 rounded border border-outline-variant/20">
                  <span class="font-bold text-on-surface">📍 ${r.sede_nombre || 'Sede #' + r.sede_id}</span>
                  <span class="text-red-400 italic font-mono">${r.motivo || 'Sin existencias'}</span>
                </div>
              `).join('')}
            </div>
            ${isAdm && s.estado === 'PENDIENTE' ? `
              <div class="text-[10px] text-amber-300 font-sans pt-0.5">
                ⚡ Como Administrador, puedes atender la solicitud despachando desde otra sede disponible o gestionar el requerimiento.
              </div>
            ` : ''}
          </div>
        ` : ''}

        ${s.motivo_solicitud ? `
          <div class="text-xs text-on-surface-variant font-sans bg-surface-container/60 p-2 rounded border border-outline-variant/20">
            <strong>Motivo:</strong> ${s.motivo_solicitud}
          </div>
        ` : ''}

        ${s.motivo_rechazo ? `
          <div class="text-xs text-red-400 font-sans bg-red-500/10 p-2 rounded border border-red-500/20">
            <strong>Motivo de rechazo:</strong> ${s.motivo_rechazo}
          </div>
        ` : ''}

        <div class="text-[10px] text-outline font-mono flex items-center gap-2">
          <span>Solicitado por: @${s.usuario_solicitante_nombre || 'Encargado'}</span>
          ${s.usuario_respuesta_nombre ? `<span>| Respondido por: @${s.usuario_respuesta_nombre}</span>` : ''}
          ${s.corredor_nombre ? `<span>| Corredor: @${s.corredor_nombre}</span>` : ''}
        </div>

        ${accionesHtml}
      </div>
    `;
  }).join('');
}

// --- MODAL: PEDIR MATERIAL A LA RED ---
window.openPedirMaterialModal = function() {
  const modal = document.getElementById('pedirMaterialModal');
  if (!modal || !currentUser) return;

  const destLabel = document.getElementById('pedirMaterialDestinoLabel');
  if (destLabel) {
    destLabel.value = `${currentUser.sede_nombre || 'Tu Sede Asignada'} (Sede #${currentUser.sede_id || 1})`;
  }

  // Reiniciar contenedor a una fila limpia
  const contenedor = document.getElementById('contenedorItemsPedidos');
  if (contenedor) {
    contenedor.innerHTML = `
      <div class="item-pedido-row p-2.5 bg-surface-container-low rounded-lg border border-outline-variant/30 space-y-2">
        <div class="relative w-full">
          <input type="text" placeholder="Buscar producto por SKU o nombre..." class="item-search-input w-full bg-surface-container text-on-surface p-2 rounded border border-outline-variant/40 focus:border-amber-400 focus:outline-none" oninput="handleSearchProductoPedido(this)" autocomplete="off" required />
          <input type="hidden" class="item-producto-id" required />
          <ul class="item-dropdown absolute z-20 w-full bg-surface-container border border-outline-variant/40 rounded mt-1 max-h-40 overflow-y-auto hidden shadow-xl text-left"></ul>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex-1">
            <label class="text-[10px] text-outline block mb-0.5">Cantidad</label>
            <input type="number" min="0.1" step="any" value="1" required class="item-cantidad-input w-full bg-surface-container text-amber-400 font-bold p-1.5 rounded border border-outline-variant/40 text-center" />
          </div>
          <div class="flex-1">
            <label class="text-[10px] text-outline block mb-0.5">Unidad</label>
            <input type="text" readonly class="item-unidad-input w-full bg-surface-container-lowest text-outline p-1.5 rounded border border-outline-variant/20 text-center" value="UNIDAD" />
          </div>
        </div>
      </div>
    `;
  }

  const motivoInput = document.getElementById('pedirMaterialMotivo');
  if (motivoInput) motivoInput.value = '';

  modal.classList.remove('hidden');
};

window.closePedirMaterialModal = function() {
  const modal = document.getElementById('pedirMaterialModal');
  if (modal) modal.classList.add('hidden');
};

window.agregarFilaMaterialPedido = function() {
  const contenedor = document.getElementById('contenedorItemsPedidos');
  if (!contenedor) return;

  const row = document.createElement('div');
  row.className = 'item-pedido-row p-2.5 bg-surface-container-low rounded-lg border border-outline-variant/30 space-y-2 relative';
  row.innerHTML = `
    <button type="button" onclick="this.parentElement.remove()" class="absolute top-2 right-2 text-outline hover:text-error text-xs" title="Quitar">
      <span class="material-symbols-outlined text-sm">delete</span>
    </button>
    <div class="relative w-full pr-6">
      <input type="text" placeholder="Buscar producto por SKU o nombre..." class="item-search-input w-full bg-surface-container text-on-surface p-2 rounded border border-outline-variant/40 focus:border-amber-400 focus:outline-none" oninput="handleSearchProductoPedido(this)" autocomplete="off" required />
      <input type="hidden" class="item-producto-id" required />
      <ul class="item-dropdown absolute z-20 w-full bg-surface-container border border-outline-variant/40 rounded mt-1 max-h-40 overflow-y-auto hidden shadow-xl text-left"></ul>
    </div>
    <div class="flex items-center gap-2">
      <div class="flex-1">
        <label class="text-[10px] text-outline block mb-0.5">Cantidad</label>
        <input type="number" min="0.1" step="any" value="1" required class="item-cantidad-input w-full bg-surface-container text-amber-400 font-bold p-1.5 rounded border border-outline-variant/40 text-center" />
      </div>
      <div class="flex-1">
        <label class="text-[10px] text-outline block mb-0.5">Unidad</label>
        <input type="text" readonly class="item-unidad-input w-full bg-surface-container-lowest text-outline p-1.5 rounded border border-outline-variant/20 text-center" value="UNIDAD" />
      </div>
    </div>
  `;
  contenedor.appendChild(row);
};

window.handleSearchProductoPedido = function(inputEl) {
  const query = (inputEl.value || '').trim().toLowerCase();
  const row = inputEl.closest('.item-pedido-row');
  const dropdown = row.querySelector('.item-dropdown');
  const idInput = row.querySelector('.item-producto-id');
  const hintEl = row.querySelector('.item-stock-hint');

  if (!query) {
    dropdown.classList.add('hidden');
    idInput.value = '';
    if (hintEl) hintEl.textContent = '';
    return;
  }

  const mySedeId = Number(currentUser?.sede_id || 0);

  // Filtrar productos
  const matches = (liveProducts || []).filter(p => 
    (p.nombre && p.nombre.toLowerCase().includes(query)) ||
    (p.codigo_sku && p.codigo_sku.toLowerCase().includes(query))
  ).slice(0, 10);

  if (matches.length === 0) {
    dropdown.innerHTML = `<li class="p-2.5 text-xs text-outline italic">No se encontraron productos coincidentes.</li>`;
    dropdown.classList.remove('hidden');
    return;
  }

  dropdown.innerHTML = matches.map(p => {
    // Calcular stock en otras sedes colaboradoras
    let stockEnOtrasSedes = 0;
    const sedesConStock = [];

    if (p.sedes) {
      Object.values(p.sedes).forEach(s => {
        const qty = parseFloat(s.stock_actual) || 0;
        if (s.sede_id !== mySedeId && qty > 0) {
          stockEnOtrasSedes += qty;
          sedesConStock.push(`${s.sede_nombre}: ${qty}`);
        }
      });
    }

    const totalRed = parseFloat(p.total_stock) || 0;
    const tieneStockEnOtras = stockEnOtrasSedes > 0;

    if (!tieneStockEnOtras) {
      // Producto sin existencias en las demás sedes
      const mensajeAgotado = totalRed <= 0 
        ? '🚫 AGOTADO EN TODAS LAS SEDES (Stock: 0)' 
        : `⚠️ Sin existencias en otras sedes (Solo en tu sede: ${p.sedes?.[mySedeId]?.stock_actual || 0})`;

      return `
        <li class="p-2.5 bg-red-950/20 border-b border-red-500/20 text-outline cursor-not-allowed transition-colors" 
            title="No disponible para solicitar"
            onclick="showToast('Este producto no tiene existencias en las demás sedes.', 'info')">
          <div class="flex justify-between items-center">
            <div class="text-xs font-sans text-outline-variant line-through">${p.nombre}</div>
            <span class="text-[10px] font-mono font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/30">0 DISPONIBLE</span>
          </div>
          <div class="flex justify-between items-center mt-0.5">
            <span class="text-[10px] font-mono text-outline">SKU: ${p.codigo_sku}</span>
            <span class="text-[10px] text-red-400 italic font-mono">${mensajeAgotado}</span>
          </div>
        </li>
      `;
    }

    // Producto CON existencias disponibles en la red colaboradora
    const desgloseStr = sedesConStock.join(' • ');
    return `
      <li class="p-2.5 hover:bg-surface-container-high cursor-pointer border-b border-outline-variant/20 transition-colors" 
          onmousedown="selectProductoPedido(${p.id}, this)">
        <div class="flex justify-between items-center">
          <div class="text-xs font-sans text-on-surface font-semibold">${p.nombre}</div>
          <span class="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30">
            ${stockEnOtrasSedes} ${p.unidad_medida || 'un.'} en red
          </span>
        </div>
        <div class="flex justify-between items-center mt-0.5 text-[10px] font-mono">
          <span class="text-primary font-bold">SKU: ${p.codigo_sku}</span>
          <span class="text-emerald-300 font-sans truncate max-w-[240px]">${desgloseStr}</span>
        </div>
      </li>
    `;
  }).join('');

  dropdown.classList.remove('hidden');
};

window.selectProductoPedido = function(id, clickedEl) {
  const p = (liveProducts || []).find(x => x.id === Number(id));
  if (!p) return;

  const row = clickedEl.closest('.item-pedido-row');
  row.querySelector('.item-search-input').value = `[${p.codigo_sku}] ${p.nombre}`;
  row.querySelector('.item-producto-id').value = p.id;
  row.querySelector('.item-unidad-input').value = p.unidad_medida || 'UNIDAD';
  row.querySelector('.item-dropdown').classList.add('hidden');

  const mySedeId = Number(currentUser?.sede_id || 0);
  let stockEnOtrasSedes = 0;
  const sedesConStock = [];
  if (p.sedes) {
    Object.values(p.sedes).forEach(s => {
      const qty = parseFloat(s.stock_actual) || 0;
      if (s.sede_id !== mySedeId && qty > 0) {
        stockEnOtrasSedes += qty;
        sedesConStock.push(`${s.sede_nombre}: ${qty}`);
      }
    });
  }

  let hintEl = row.querySelector('.item-stock-hint');
  if (!hintEl) {
    hintEl = document.createElement('div');
    hintEl.className = 'item-stock-hint text-[10px] font-mono text-emerald-400 mt-1 flex items-center gap-1';
    row.appendChild(hintEl);
  }
  hintEl.innerHTML = `<span class="material-symbols-outlined text-xs">check_circle</span> <span>Disponible en otras sedes: <strong>${stockEnOtrasSedes} ${p.unidad_medida || 'un.'}</strong> (${sedesConStock.join(' • ')})</span>`;
};

window.handleEmitirPeticionRed = async function(e) {
  e.preventDefault();
  const rows = document.querySelectorAll('#contenedorItemsPedidos .item-pedido-row');
  const items = [];

  rows.forEach(r => {
    const pId = r.querySelector('.item-producto-id').value;
    const txt = r.querySelector('.item-search-input').value;
    const cant = parseFloat(r.querySelector('.item-cantidad-input').value) || 1;
    if (pId) {
      items.push({ producto_id: Number(pId), nombre: txt, cantidad: cant });
    }
  });

  if (items.length === 0) {
    alert('Por favor selecciona al menos un producto para solicitar.');
    return;
  }

  const motivo = document.getElementById('pedirMaterialMotivo').value.trim();
  const btn = document.getElementById('btnEmitirPeticionSubmit');
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/solicitudes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo: 'PETICION',
        producto_id: items[0].producto_id,
        cantidad: items[0].cantidad,
        items: items,
        motivo
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('📢 Solicitud emitida a todas las sedes de la red.', 'success');
      closePedirMaterialModal();
      loadNetworkRequests();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (err) {
    alert('Error al emitir solicitud: ' + err.message);
  } finally {
    btn.disabled = false;
  }
};

// --- MODAL: CEDER MERCANCÍA (ENVÍO PROACTIVO) ---
window.openCederMaterialModal = function(preselectedId = null) {
  const modal = document.getElementById('cederMaterialModal');
  if (!modal || !currentUser) return;

  const destSelect = document.getElementById('cederSedeDestino');
  if (destSelect) {
    const mySede = Number(currentUser.sede_id || 0);
    // Filtrar sedes para no mostrar la mía
    destSelect.innerHTML = [
      { id: 1, nombre: 'Centro Eléctrico EP' },
      { id: 2, nombre: 'Centro Eléctrico EP1' },
      { id: 3, nombre: 'Grupo Eléctrico EP3' },
      { id: 4, nombre: 'EP6 Ecoiluminación' }
    ].filter(s => s.id !== mySede)
     .map(s => `<option value="${s.id}">${s.nombre}</option>`)
     .join('');
  }

  document.getElementById('cederProductSearch').value = '';
  document.getElementById('cederProductoId').value = '';
  document.getElementById('cederStockDisponibleHint').textContent = 'Disponible en tu sede: --';
  document.getElementById('cederMotivo').value = '';

  if (preselectedId) {
    selectProductoCeder(Number(preselectedId));
  }

  modal.classList.remove('hidden');
};

window.closeCederMaterialModal = function() {
  const modal = document.getElementById('cederMaterialModal');
  if (modal) modal.classList.add('hidden');
};

window.handleSearchProductoCeder = function(query) {
  query = (query || '').trim().toLowerCase();
  const dropdown = document.getElementById('cederProductDropdown');
  if (!query) {
    dropdown.classList.add('hidden');
    return;
  }

  const matches = (liveProducts || []).filter(p => 
    (p.nombre && p.nombre.toLowerCase().includes(query)) ||
    (p.codigo_sku && p.codigo_sku.toLowerCase().includes(query))
  ).slice(0, 8);

  if (matches.length === 0) {
    dropdown.innerHTML = `<li class="p-2.5 text-xs text-outline italic">No se encontraron productos.</li>`;
    dropdown.classList.remove('hidden');
    return;
  }

  dropdown.innerHTML = matches.map(p => `
    <li class="p-2 hover:bg-surface-container-high cursor-pointer border-b border-outline-variant/20 transition-colors" 
        onmousedown="selectProductoCeder(${p.id})">
      <div class="text-xs font-sans text-on-surface font-semibold">${p.nombre}</div>
      <div class="text-[10px] font-mono text-primary font-bold">SKU: ${p.codigo_sku}</div>
    </li>
  `).join('');
  dropdown.classList.remove('hidden');
};

window.selectProductoCeder = function(id) {
  const prod = (liveProducts || []).find(p => p.id === Number(id));
  if (!prod) return;

  document.getElementById('cederProductSearch').value = `[${prod.codigo_sku}] ${prod.nombre}`;
  document.getElementById('cederProductoId').value = prod.id;
  document.getElementById('cederProductDropdown').classList.add('hidden');

  // Calcular stock disponible en mi sede
  const mySede = Number(currentUser.sede_id || 1);
  if (prod.sedes && prod.sedes[mySede]) {
    const stock = prod.sedes[mySede].stock_actual || 0;
    document.getElementById('cederStockDisponibleHint').textContent = `Disponible en tu sede: ${stock} ${prod.unidad_medida || 'un.'}`;
  } else {
    document.getElementById('cederStockDisponibleHint').textContent = 'Disponible en tu sede: 0';
  }
};

window.handleEmitirEnvioProactivo = async function(e) {
  e.preventDefault();
  const pId = document.getElementById('cederProductoId').value;
  if (!pId) {
    alert('Selecciona un producto a transferir.');
    return;
  }

  const sedeDestino = document.getElementById('cederSedeDestino').value;
  const cant = parseFloat(document.getElementById('cederCantidad').value) || 1;
  const motivo = document.getElementById('cederMotivo').value.trim();

  const btn = document.getElementById('btnCederMaterialSubmit');
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/solicitudes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo: 'ENVIO_PROACTIVO',
        producto_id: Number(pId),
        sede_proveedora_id: Number(sedeDestino),
        cantidad: cant,
        motivo
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Propuesta de envío enviada a la sede destino.', 'success');
      closeCederMaterialModal();
      loadNetworkRequests();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (err) {
    alert('Error enviando propuesta: ' + err.message);
  } finally {
    btn.disabled = false;
  }
};

// --- MODAL: RESPONDER SOLICITUD ---
window.openResponderModal = function(id, accion, cantSugerida = 1) {
  selectedSolicitudParaResponder = { id, accion };
  const modal = document.getElementById('responderSolicitudModal');
  if (!modal) return;

  const titulo = document.getElementById('modalResponderTitulo');
  const detalle = document.getElementById('modalResponderDetalle');
  const secCant = document.getElementById('seccionAceptarCantidad');
  const secMotivo = document.getElementById('seccionRechazarMotivo');
  const btn = document.getElementById('btnConfirmarRespuesta');

  if (accion === 'ACEPTAR') {
    titulo.textContent = 'Aceptar Solicitud de Material';
    detalle.textContent = `Indica la cantidad que vas a despachar a la otra sede (puedes enviar parcial o más de respaldo):`;
    secCant.classList.remove('hidden');
    secMotivo.classList.add('hidden');
    document.getElementById('inputCantidadAprobada').value = cantSugerida;
    btn.className = 'flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs shadow-md';
    btn.textContent = 'Confirmar Envío';
  } else {
    titulo.textContent = 'Rechazar Solicitud';
    detalle.textContent = `Indica el motivo por el cual tu sede no puede atender esta solicitud:`;
    secCant.classList.add('hidden');
    secMotivo.classList.remove('hidden');
    document.getElementById('inputMotivoRechazo').value = '';
    btn.className = 'flex-1 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold text-xs shadow-md';
    btn.textContent = 'Rechazar Solicitud';
  }

  // Si se va a aceptar, poblar select de corredores disponibles
  const respCorredorSelect = document.getElementById('responderSelectCorredor');
  if (respCorredorSelect) {
    poblarSelectCorredores(respCorredorSelect);
  }

  modal.classList.remove('hidden');
};

window.closeResponderModal = function() {
  const modal = document.getElementById('responderSolicitudModal');
  if (modal) modal.classList.add('hidden');
  selectedSolicitudParaResponder = null;
};

window.submitRespuestaSolicitud = async function() {
  if (!selectedSolicitudParaResponder) return;
  const { id, accion } = selectedSolicitudParaResponder;

  const cantidad_aprobada = document.getElementById('inputCantidadAprobada').value;
  const motivo_rechazo = document.getElementById('inputMotivoRechazo').value;
  const corredorId = document.getElementById('responderSelectCorredor')?.value;

  try {
    const res = await fetch(`${API_BASE}/solicitudes/${id}/responder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ accion, cantidad_aprobada, motivo_rechazo })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      // Si además seleccionó un corredor de una vez al aceptar, despachar inmediatamente
      if (accion === 'ACEPTAR' && corredorId) {
        try {
          const resCorr = await fetch(`${API_BASE}/solicitudes/${id}/asignar-corredor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ empleado_corredor_id: Number(corredorId) })
          });
          const dataCorr = await resCorr.json();
          if (resCorr.ok && dataCorr.success) {
            showToast('✓ Solicitud aceptada y corredor asignado en camino.', 'success');
          } else {
            showToast(data.message, 'success');
          }
        } catch (e) {
          showToast(data.message, 'success');
        }
      } else {
        showToast(data.message, 'success');
      }

      closeResponderModal();
      loadNetworkRequests();
      loadRealInventory();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (err) {
    alert('Error al responder: ' + err.message);
  }
};

// =============================================================================
// GESTIÓN ROBUSTA DE CORREDORES LOGÍSTICOS
// =============================================================================
const CORREDORES_PREDETERMINADOS = [
  { id: 6, nombre_completo: 'Corredor Logístico 1', username: 'corredor_1' },
  { id: 7, nombre_completo: 'Corredor Logístico 2', username: 'corredor_2' }
];

async function obtenerCorredoresDisponibles() {
  if (Array.isArray(listaCorredoresDisponibles) && listaCorredoresDisponibles.length > 0) {
    return listaCorredoresDisponibles;
  }
  try {
    const res = await fetch(`${API_BASE}/solicitudes/corredores`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.corredores) && data.corredores.length > 0) {
        listaCorredoresDisponibles = data.corredores;
        return data.corredores;
      }
    }
  } catch (err) {
    console.warn('[Corredores] Fallback a corredores registrados en sistema:', err);
  }
  listaCorredoresDisponibles = CORREDORES_PREDETERMINADOS;
  return CORREDORES_PREDETERMINADOS;
}

async function poblarSelectCorredores(selectElement, valorSeleccionado = null) {
  if (!selectElement) return;
  const corredores = await obtenerCorredoresDisponibles();
  selectElement.innerHTML = '<option value="">-- Selecciona un Corredor Logístico --</option>' + 
    corredores.map(c => `<option value="${c.id}" ${valorSeleccionado && Number(valorSeleccionado) === Number(c.id) ? 'selected' : ''}>🚴 ${c.nombre_completo} (@${c.username})</option>`).join('');
  if (valorSeleccionado) {
    selectElement.value = valorSeleccionado;
  }
}

// --- MODAL: ASIGNAR CORREDOR ---
window.openAsignarCorredorModal = async function(id) {
  selectedSolicitudParaCorredor = id;
  const modal = document.getElementById('asignarCorredorModal');
  if (!modal) return;

  const numId = Number(id);
  // Buscar datos de la solicitud para mostrar resumen claro
  let sol = (networkRequests || []).find(s => s.id === numId) || (currentSolicitudesList || []).find(s => s.id === numId);
  if (!sol) {
    try {
      const res = await fetch(`${API_BASE}/solicitudes`, { credentials: 'include' });
      const data = await res.json();
      if (data.solicitudes) {
        networkRequests = data.solicitudes;
        currentSolicitudesList = data.solicitudes;
        sol = networkRequests.find(s => s.id === numId);
      }
    } catch (e) {}
  }

  const resumenEl = document.getElementById('modalAsignarCorredorResumen');
  if (resumenEl && sol) {
    let itemsTexto = '';
    if (Array.isArray(sol.items_json) && sol.items_json.length > 0) {
      itemsTexto = sol.items_json.map(it => `• ${it.nombre || 'Producto'}: ${it.cantidad || it.cantidad_solicitada || 1} un.`).join('<br>');
    } else {
      itemsTexto = `• ${sol.producto_nombre || 'Producto'}: ${sol.cantidad_aprobada || sol.cantidad_solicitada} ${sol.producto_unidad || 'un.'}`;
    }

    resumenEl.innerHTML = `
      <div class="flex justify-between items-center pb-1 border-b border-outline-variant/20">
        <span class="font-bold text-secondary">SOLICITUD #${sol.id}</span>
        <span class="text-[10px] text-outline font-mono">ESTADO: ${sol.estado}</span>
      </div>
      <div class="grid grid-cols-2 gap-2 pt-1">
        <div>
          <span class="text-[9px] text-outline uppercase block font-bold">1. Recoger en:</span>
          <strong class="text-amber-300 text-xs">${sol.sede_proveedora_nombre || 'Sede Proveedora'}</strong>
        </div>
        <div>
          <span class="text-[9px] text-outline uppercase block font-bold">2. Llevar a:</span>
          <strong class="text-emerald-300 text-xs">${sol.sede_solicitante_nombre}</strong>
        </div>
      </div>
      <div class="pt-1 border-t border-outline-variant/20">
        <span class="text-[9px] text-outline uppercase block font-bold">Mercancía a transportar:</span>
        <span class="text-on-surface text-xs font-mono">${itemsTexto}</span>
      </div>
    `;
  }

  const select = document.getElementById('selectEmpleadoCorredor');
  await poblarSelectCorredores(select);

  modal.classList.remove('hidden');
};

window.closeAsignarCorredorModal = function() {
  const modal = document.getElementById('asignarCorredorModal');
  if (modal) modal.classList.add('hidden');
  selectedSolicitudParaCorredor = null;
};

window.submitAsignarCorredor = async function() {
  if (!selectedSolicitudParaCorredor) return;
  const corredorId = document.getElementById('selectEmpleadoCorredor').value;
  if (!corredorId) {
    alert('Selecciona un empleado corredor para hacer la entrega.');
    return;
  }

  const btn = document.getElementById('btnSubmitAsignarCorredor');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Despachando...';
  }

  try {
    const res = await fetch(`${API_BASE}/solicitudes/${selectedSolicitudParaCorredor}/asignar-corredor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ empleado_corredor_id: Number(corredorId) })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      closeAsignarCorredorModal();
      loadNetworkRequests();
      loadRealInventory();
    } else {
      alert('Error: ' + data.message);
    }
  } catch (err) {
    alert('Error asignando corredor: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Despachar Mercancía';
    }
  }
};

// --- CONFIRMAR RECEPCIÓN FÍSICA ---
window.confirmarRecepcionSolicitud = async function(id) {
  if (!confirm('¿Confirmas que la mercancía fue entregada y recibida físicamente? Esto ingresará el stock disponible en la sede destino en tiempo real.')) return;

  try {
    const res = await fetch(`${API_BASE}/solicitudes/${id}/completar`, {
      method: 'POST',
      credentials: 'include'
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('✓ Recepción confirmada. Stock ingresado al sistema.', 'success');
      loadNetworkRequests();
      loadRealInventory();
      if (currentUser?.rol === 'EMPLEADO') {
        loadEmployeeTransfers();
      }
    } else {
      alert('Error: ' + data.message);
    }
  } catch (err) {
    alert('Error al confirmar recepción: ' + err.message);
  }
};

// =============================================================================
// MODAL: ATENCIÓN DE SOLICITUD POR ADMINISTRADOR (MULTI-SEDE Y CORREDOR)
// =============================================================================
let currentSolicitudAdminAtendiendo = null;

window.openAdminAtenderModal = async function(id) {
  const numId = Number(id);
  // Buscar en networkRequests
  let sol = (networkRequests || []).find(s => s.id === numId);
  
  if (!sol) {
    try {
      const res = await fetch(`${API_BASE}/solicitudes`, { credentials: 'include' });
      const data = await res.json();
      if (data.solicitudes) {
        networkRequests = data.solicitudes;
        sol = networkRequests.find(s => s.id === numId);
      }
    } catch (e) {
      console.error('Error buscando solicitud:', e);
    }
  }

  if (!sol) {
    alert('No se encontró la solicitud seleccionada.');
    return;
  }
  currentSolicitudAdminAtendiendo = sol;

  if (!liveProducts || liveProducts.length === 0) {
    await loadRealInventory();
  }

  const modal = document.getElementById('adminAtenderSolicitudModal');
  if (!modal) return;

  // Ocultar modal de la lista de solicitudes para tener foco total
  const netModal = document.getElementById('networkRequestsModal');
  if (netModal) netModal.classList.add('hidden');

  document.getElementById('adminAtenderSedeDestino').textContent = sol.sede_solicitante_nombre || `Sede #${sol.sede_solicitante_id}`;
  document.getElementById('adminAtenderUsuarioSolicitante').textContent = `@${sol.usuario_solicitante_nombre || 'Encargado'}`;

  // Mostrar advertencia si alguna sede reportó falta de existencias
  const advEl = document.getElementById('adminAtenderAdvertenciaRechazos');
  if (advEl) {
    if (Array.isArray(sol.sedes_rechazadas_json) && sol.sedes_rechazadas_json.length > 0) {
      advEl.classList.remove('hidden');
      advEl.innerHTML = `
        <div class="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs space-y-1">
          <div class="text-amber-400 font-bold flex items-center gap-1.5 font-mono">
            <span class="material-symbols-outlined text-sm">warning</span>
            <span>Sedes que reportaron falta de existencias (${sol.sedes_rechazadas_json.length}):</span>
          </div>
          <div class="space-y-0.5 text-[11px] text-on-surface-variant font-sans">
            ${sol.sedes_rechazadas_json.map(r => `
              <div>• <strong>${r.sede_nombre || 'Sede #' + r.sede_id}</strong>: <em class="text-red-400 font-mono">${r.motivo || 'Sin stock'}</em></div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      advEl.classList.add('hidden');
      advEl.innerHTML = '';
    }
  }

  // Cargar corredores logísticos en el select de manera robusta
  const corredorSelect = document.getElementById('adminAtenderSelectCorredor');
  await poblarSelectCorredores(corredorSelect);

  // Lista de materiales a atender
  let items = [];
  if (Array.isArray(sol.items_json) && sol.items_json.length > 0) {
    items = sol.items_json;
  } else if (sol.producto_id) {
    items = [{
      producto_id: sol.producto_id,
      nombre: sol.producto_nombre || sol.producto_sku || `Producto #${sol.producto_id}`,
      cantidad: sol.cantidad_solicitada || 1
    }];
  }

  const itemsContainer = document.getElementById('adminAtenderItemsList');
  itemsContainer.innerHTML = '';

  const sedesCatalogo = [
    { id: 1, nombre: 'Centro Eléctrico EP' },
    { id: 2, nombre: 'Centro Eléctrico EP1' },
    { id: 3, nombre: 'Grupo Eléctrico EP3' },
    { id: 4, nombre: 'EP6 Ecoiluminación' }
  ];

  items.forEach((item) => {
    const pId = Number(item.producto_id);
    const prod = (liveProducts || []).find(p => p.id === pId);
    const cantPedida = parseFloat(item.cantidad || item.cantidad_solicitada || 1);
    const nombreProd = prod ? prod.nombre : (item.nombre || `Producto #${pId}`);
    const skuProd = prod ? prod.codigo_sku : (item.codigo_sku || '--');
    const unidad = prod ? (prod.unidad_medida || 'un.') : 'un.';

    // Desglose de existencias por sede
    let chipsStockHtml = '';
    const sedesConStock = [];

    sedesCatalogo.forEach(s => {
      const stockSede = prod?.sedes?.[s.id]?.stock_actual !== undefined 
        ? parseFloat(prod.sedes[s.id].stock_actual) 
        : 0;
      const isDestino = s.id === Number(sol.sede_solicitante_id);
      
      const chipClass = isDestino 
        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' 
        : stockSede > 0 
          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40 font-bold' 
          : 'bg-surface-container-highest/40 text-outline border-outline-variant/20';

      chipsStockHtml += `
        <div class="px-2 py-1 rounded border ${chipClass} text-[10px] flex items-center justify-between gap-1">
          <span class="truncate max-w-[120px]">${s.nombre}${isDestino ? ' (Destino)' : ''}:</span>
          <span class="font-mono">${stockSede} ${unidad}</span>
        </div>
      `;

      if (!isDestino && stockSede > 0) {
        sedesConStock.push({ ...s, stock: stockSede });
      }
    });

    // Opciones del select de sede proveedora
    let optionsSedesHtml = '';
    if (sedesConStock.length === 0) {
      optionsSedesHtml = '<option value="" disabled selected>❌ Sin stock disponible en ninguna otra sede</option>';
    } else {
      optionsSedesHtml = sedesConStock.map((s, sIdx) => 
        `<option value="${s.id}" ${sIdx === 0 ? 'selected' : ''}>${s.nombre} (Stock: ${s.stock} ${unidad})</option>`
      ).join('');
    }

    const card = document.createElement('div');
    card.className = 'admin-item-atender-row p-3.5 bg-surface-container-low rounded-xl border border-outline-variant/30 space-y-2.5';
    card.innerHTML = `
      <input type="hidden" class="item-atender-producto-id" value="${pId}" />
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="text-xs font-sans font-bold text-on-surface">${nombreProd}</div>
          <div class="text-[10px] font-mono text-primary font-bold">SKU: ${skuProd}</div>
        </div>
        <div class="text-right">
          <span class="text-[10px] text-outline block">Cantidad Requerida</span>
          <span class="text-xs font-mono font-bold text-amber-400">${cantPedida} ${unidad}</span>
        </div>
      </div>

      <!-- Cuadrícula de Stock Actual por Sede -->
      <div class="pt-1">
        <span class="text-[9px] uppercase tracking-wider text-outline block mb-1">Stock en vivo en cada sede:</span>
        <div class="grid grid-cols-2 gap-1.5 font-mono">
          ${chipsStockHtml}
        </div>
      </div>

      <!-- Selección de Sede Origen y Cantidad Despachada -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-outline-variant/20">
        <div>
          <label class="text-[10px] text-primary font-bold uppercase block mb-0.5">Sede Proveedora (Origen)</label>
          <select class="item-atender-sede-origen w-full bg-surface-container text-on-surface p-1.5 rounded border border-outline-variant/40 text-xs font-mono focus:border-amber-400 focus:outline-none" required ${sedesConStock.length === 0 ? 'disabled' : ''}>
            ${optionsSedesHtml}
          </select>
        </div>
        <div>
          <label class="text-[10px] text-amber-400 font-bold uppercase block mb-0.5">Cantidad a Despachar</label>
          <input type="number" min="0.1" step="any" value="${cantPedida}" class="item-atender-cantidad w-full bg-surface-container text-amber-400 font-bold p-1.5 rounded border border-outline-variant/40 text-center font-mono text-xs focus:border-amber-400 focus:outline-none" required />
        </div>
      </div>
    `;
    itemsContainer.appendChild(card);
  });

  modal.classList.remove('hidden');
};

window.closeAdminAtenderModal = function() {
  const modal = document.getElementById('adminAtenderSolicitudModal');
  if (modal) modal.classList.add('hidden');
  currentSolicitudAdminAtendiendo = null;

  // Restaurar modal de la lista de solicitudes
  const netModal = document.getElementById('networkRequestsModal');
  if (netModal) netModal.classList.remove('hidden');
};

window.handleConfirmarDespachoAdmin = async function(e) {
  e.preventDefault();
  if (!currentSolicitudAdminAtendiendo) return;

  const corredorId = document.getElementById('adminAtenderSelectCorredor').value;
  if (!corredorId) {
    alert('Por favor selecciona un Empleado Corredor para realizar el traslado.');
    return;
  }

  const rows = document.querySelectorAll('#adminAtenderItemsList .admin-item-atender-row');
  const itemsPayload = [];

  for (const r of rows) {
    const pId = Number(r.querySelector('.item-atender-producto-id').value);
    const sedeOrigenSelect = r.querySelector('.item-atender-sede-origen');
    const sedeOrigenId = Number(sedeOrigenSelect.value);
    const cant = parseFloat(r.querySelector('.item-atender-cantidad').value) || 0;

    if (!sedeOrigenId || isNaN(sedeOrigenId)) {
      alert(`No has seleccionado una sede proveedora con existencias para uno de los productos.`);
      return;
    }

    if (cant <= 0) {
      alert(`La cantidad a despachar debe ser mayor a 0.`);
      return;
    }

    itemsPayload.push({
      producto_id: pId,
      sede_proveedora_id: sedeOrigenId,
      cantidad_despachada: cant
    });
  }

  const btn = document.getElementById('btnAdminConfirmarDespacho');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Procesando Despacho...';
  }

  try {
    const res = await fetch(`${API_BASE}/solicitudes/${currentSolicitudAdminAtendiendo.id}/admin-despachar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        empleado_corredor_id: Number(corredorId),
        items: itemsPayload
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('✓ Despacho multi-sede procesado. Mercancía en camino con el corredor.', 'success');
      
      const modal = document.getElementById('adminAtenderSolicitudModal');
      if (modal) modal.classList.add('hidden');
      currentSolicitudAdminAtendiendo = null;

      const netModal = document.getElementById('networkRequestsModal');
      if (netModal) netModal.classList.remove('hidden');

      loadNetworkRequests();
      loadRealInventory();
    } else {
      alert('Error en despacho: ' + (data.message || 'Error desconocido'));
    }
  } catch (err) {
    alert('Error de conexión al despachar: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-sm">local_shipping</span><span>Confirmar Despacho y Poner en Tránsito</span>';
    }
  }
};

// Global Window Bindings for HTML onclick handlers
window.openAuditLogsModal = openAuditLogsModal;
window.closeAuditLogsModal = closeAuditLogsModal;
window.loadAuditLogsData = loadAuditLogsData;
window.filterAuditLogs = filterAuditLogs;
window.openEditProductModal = openEditProductModal;
window.closeEditProductModal = closeEditProductModal;
window.handleEditProductSubmit = handleEditProductSubmit;
window.filterAdminCategory = filterAdminCategory;
window.filterAdminSearch = filterAdminSearch;
window.goToAdminPage = goToAdminPage;
window.goToEncargadoPage = goToEncargadoPage;



