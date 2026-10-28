import { z } from 'zod';
import { PASSWORD_RULES } from '../../public/js/passwordPolicy.js';

export const passwordSchema = PASSWORD_RULES.reduce(
  (schema, rule) => schema.refine(rule.test, { message: rule.message }),
  z.string()
);

export const registerSchema = z.object({
  body: z.object({
    nombre_completo: z.string().min(3, 'El nombre debe tener al menos 3 caracteres'),
    username: z.string().min(3, 'El usuario debe tener al menos 3 caracteres').max(50),
    email: z.string().email('Debe ser un correo válido').optional().or(z.literal('')),
    password: passwordSchema,
    _honey: z.string().optional(),
    rol: z.string().optional(),
    sede_id: z.union([z.string(), z.number(), z.null()]).optional()
  })
});
