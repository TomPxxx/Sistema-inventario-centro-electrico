import { z } from 'zod';

export const validate = (schema) => async (req, res, next) => {
  try {
    await schema.parseAsync({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    return next();
  } catch (error) {
    if (error instanceof z.ZodError || error.name === 'ZodError') {
      const issues = error.issues || error.errors || [];
      return res.status(400).json({
        success: false,
        message: 'Error de validación en los datos enviados',
        errors: issues.map(err => ({
          campo: Array.isArray(err.path) ? err.path.join('.') : String(err.path),
          mensaje: err.message
        }))
      });
    }
    return res.status(400).json({ success: false, message: 'Bad request' });
  }
};
