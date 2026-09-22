import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    nombre_completo: z.string().min(3, 'El nombre debe tener al menos 3 caracteres'),
    username: z.string().min(3, 'El usuario debe tener al menos 3 caracteres').max(50),
    email: z.string().email('Debe ser un correo válido').optional().or(z.literal('')),
    password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
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
