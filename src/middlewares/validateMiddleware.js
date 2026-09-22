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
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Error de validación en los datos enviados',
        errors: error.errors.map(err => ({
          campo: err.path.join('.'),
          mensaje: err.message
        }))
      });
    }
    return res.status(400).json({ success: false, message: 'Bad request' });
  }
};
