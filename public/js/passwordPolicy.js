/**
 * Fuente única de verdad (Single Source of Truth) para la Política de Contraseñas
 * Compartida entre el Backend (Zod / Express) y el Frontend (Checklist en tiempo real).
 */

export const PASSWORD_RULES = [
  {
    id: 'minLength',
    shortLabel: '12+ caracteres',
    shortLabelEn: '12+ characters',
    message: 'La contraseña debe tener al menos 12 caracteres',
    test: (val) => typeof val === 'string' && val.length >= 12
  },
  {
    id: 'uppercase',
    shortLabel: '1 letra mayúscula (A-Z)',
    shortLabelEn: '1 uppercase letter (A-Z)',
    message: 'La contraseña debe contener al menos una letra mayúscula',
    test: (val) => typeof val === 'string' && /[A-Z]/.test(val)
  },
  {
    id: 'lowercase',
    shortLabel: '1 letra minúscula (a-z)',
    shortLabelEn: '1 lowercase letter (a-z)',
    message: 'La contraseña debe contener al menos una letra minúscula',
    test: (val) => typeof val === 'string' && /[a-z]/.test(val)
  },
  {
    id: 'threeNumbers',
    shortLabel: 'Mínimo 3 números (0-9)',
    shortLabelEn: 'At least 3 numbers (0-9)',
    message: 'La contraseña debe contener al menos 3 números',
    test: (val) => typeof val === 'string' && (val.match(/\d/g) || []).length >= 3
  },
  {
    id: 'specialChar',
    shortLabel: '1 carácter especial (!@#$%&*)',
    shortLabelEn: '1 special character (!@#$%&*)',
    message: 'La contraseña debe contener al menos un carácter especial (ej: !@#$%&*...)',
    test: (val) => typeof val === 'string' && /[^a-zA-Z0-9]/.test(val)
  }
];

export function evaluatePassword(password = '') {
  const val = typeof password === 'string' ? password : '';
  const results = PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    shortLabel: rule.shortLabel,
    shortLabelEn: rule.shortLabelEn,
    message: rule.message,
    passed: rule.test(val)
  }));
  const missing = results.filter((r) => !r.passed);
  return {
    isValid: missing.length === 0,
    results,
    missingLabels: missing.map((r) => r.shortLabel),
    missingLabelsEn: missing.map((r) => r.shortLabelEn),
    firstErrorMessage: missing.length > 0 ? missing[0].message : null
  };
}

export function renderPasswordChecklistUI(inputId, containerId) {
  if (typeof document === 'undefined') return;
  const inputEl = document.getElementById(inputId);
  const containerEl = document.getElementById(containerId);
  if (!containerEl) return;

  const val = inputEl ? inputEl.value : '';
  const evaluation = evaluatePassword(val);
  const lang = (typeof localStorage !== 'undefined' && localStorage.getItem('app_lang')) || 'es';
  const isEn = lang === 'en';

  const itemsHtml = evaluation.results.map((r) => {
    const label = isEn ? r.shortLabelEn : r.shortLabel;
    const icon = r.passed ? 'check_circle' : 'radio_button_unchecked';
    const colorClass = r.passed
      ? 'text-emerald-400 font-semibold'
      : (val.length > 0 ? 'text-rose-400' : 'text-outline');
    return `
      <div class="flex items-center gap-1.5 ${colorClass} transition-colors">
        <span class="material-symbols-outlined text-[14px]">${icon}</span>
        <span>${label}</span>
      </div>
    `;
  }).join('');

  let summaryHtml = '';
  if (evaluation.isValid) {
    summaryHtml = `
      <div class="pt-1 mt-1 border-t border-outline-variant/30 text-emerald-400 font-bold flex items-center gap-1">
        <span class="material-symbols-outlined text-[14px]">verified</span>
        <span>${isEn ? 'Strong password: all requirements met.' : 'Contraseña segura: cumple todos los requisitos.'}</span>
      </div>
    `;
  } else if (val.length > 0) {
    const missingText = (isEn ? evaluation.missingLabelsEn : evaluation.missingLabels).join(', ');
    summaryHtml = `
      <div class="pt-1 mt-1 border-t border-outline-variant/30 text-amber-400 text-[10px]">
        <strong>${isEn ? 'Missing:' : 'Falta:'}</strong> ${missingText}
      </div>
    `;
  } else {
    summaryHtml = `
      <div class="pt-1 mt-1 border-t border-outline-variant/30 text-outline text-[10px]">
        ${isEn ? 'Complete all 5 security requirements above.' : 'Completa los 5 requisitos de seguridad.'}
      </div>
    `;
  }

  containerEl.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-1">${itemsHtml}</div>${summaryHtml}`;
}

if (typeof window !== 'undefined') {
  window.PasswordPolicy = {
    PASSWORD_RULES,
    evaluatePassword,
    renderPasswordChecklistUI
  };
  window.updatePasswordChecklist = renderPasswordChecklistUI;

  const initChecklists = () => {
    renderPasswordChecklistUI('regPassword', 'regPasswordChecklist');
    renderPasswordChecklistUI('recoveryNewPassword', 'recoveryPasswordChecklist');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChecklists);
  } else {
    initChecklists();
  }
}
