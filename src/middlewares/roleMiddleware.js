/**
 * Middleware para autorización basada en roles (RBAC).
 * Permite especificar uno o múltiples roles autorizados.
 *
 * @param  {...string} allowedRoles - Lista de roles permitidos ('ADMINISTRADOR', 'ENCARGADO', 'EMPLEADO')
 */
export const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'No estás autenticado.'
      });
    }

    if (!allowedRoles.includes(req.user.rol)) {
      return res.status(403).json({
        success: false,
        message: `Acceso denegado. Se requiere uno de los siguientes roles: ${allowedRoles.join(', ')}.`
      });
    }

    next();
  };
};
