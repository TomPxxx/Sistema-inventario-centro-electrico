import { z } from 'zod';

export const passwordSchema = z.string()
  .min(12, 'La contraseña debe tener al menos 12 caracteres')
  .refine(val => /[A-Z]/.test(val), { message: 'La contraseña debe contener al menos una letra mayúscula' })
  .refine(val => /[a-z]/.test(val), { message: 'La contraseña debe contener al menos una letra minúscula' })
  .refine(val => (val.match(/\d/g) || []).length >= 3, { message: 'La contraseña debe contener al menos 3 números' })
  .refine(val => /[^a-zA-Z0-9]/.test(val), { message: 'La contraseña debe contener al menos un carácter especial (ej: !@#$%&*...)' });

export const registerSchema = z.object({
  body: z.object({
    nombre_completo: z.string().min(3, 'El nombre debe tener al menos 3 caracteres'),
    username: z.string().min(3, 'El usuario debe tener al menos 3 caracteres').max(50),
    email: z.string().email('Debe ser un correo válido').optional().or(z.literal('')),
    password: passwordSchema,
    _honey: z.string().optional(),
    rol: z.enum(['ADMINISTRADOR', 'ENCARGADO', 'EMPLEADO'], {
      errorMap: () => ({ message: 'Rol inválido. Debe ser ADMINISTRADOR, ENCARGADO o EMPLEADO' })
    }),
    sede_id: z.union([z.string(), z.number()]).optional()
  }).refine((data) => {
    // Regla de negocio: ENCARGADO requiere sede
    if (data.rol === 'ENCARGADO' && !data.sede_id) {
      return false;
    }
    return true;
  }, {
    message: 'Los usuarios con cargo ENCARGADO deben tener una sede asignada obligatoriamente.',
    path: ['sede_id']
  })
});
