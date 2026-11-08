import DashboardRepository from '../repositories/DashboardRepository.js';
import AuditRepository from '../repositories/AuditRepository.js';

// Garantizar índices de rendimiento al iniciar el módulo (fuera de entorno de tests unitarios)
if (process.env.NODE_ENV !== 'test') {
  DashboardRepository.ensurePerformanceIndexes().catch(() => {});
}

/**
 * Obtener el resumen de datos para los gráficos del dashboard
 * GET /api/dashboard/summary
 * Restringido a: ADMINISTRADOR
 */
export const getDashboardSummary = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 15, 200));
    const offset = (page - 1) * limit;

    // Ejecutar las consultas en paralelo para mejorar rendimiento
    const [movementsData, topProductsData, stockDistributionData, exactMovementsData, totalMovements] = await Promise.all([
      DashboardRepository.getMovementsOverTime(7),
      DashboardRepository.getTopProducts(5, 30),
      DashboardRepository.getStockDistribution(),
      DashboardRepository.getExactMovements(limit, offset),
      DashboardRepository.getMovementsTotalCount()
    ]);

    // Formatear numéricamente los resultados para enviar un JSON limpio
    const movements = movementsData.map(m => ({
      fecha: m.fecha,
      entradas: parseFloat(m.entradas) || 0,
      salidas: parseFloat(m.salidas) || 0
    }));

    const topProducts = topProductsData.map(p => ({
      ...p,
      total_movido: parseFloat(p.total_movido) || 0
    }));

    const stockDistribution = stockDistributionData.map(s => ({
      ...s,
      stock_total: parseFloat(s.stock_total) || 0
    }));

    return res.status(200).json({
      success: true,
      dashboard: {
        movementsOverTime: movements,
        topProducts: topProducts,
        stockDistribution: stockDistribution,
        exactMovements: exactMovementsData,
        movementsPagination: {
          page,
          limit,
          totalItems: totalMovements,
          totalPages: Math.ceil(totalMovements / limit) || 1
        }
      }
    });

  } catch (error) {
    console.error('[Dashboard Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al consultar los datos del dashboard: ' + error.message
    });
  }
};

/**
 * Obtener únicamente la página solicitada de movimientos exactos en vivo (15 por página)
 * GET /api/dashboard/movements?page=1&limit=15
 * Restringido a: ADMINISTRADOR
 */
export const getPaginatedMovements = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 15, 200));
    const offset = (page - 1) * limit;

    const [exactMovementsData, totalMovements] = await Promise.all([
      DashboardRepository.getExactMovements(limit, offset),
      DashboardRepository.getMovementsTotalCount()
    ]);

    return res.status(200).json({
      success: true,
      movements: exactMovementsData,
      pagination: {
        page,
        limit,
        totalItems: totalMovements,
        totalPages: Math.ceil(totalMovements / limit) || 1
      }
    });
  } catch (error) {
    console.error('[Dashboard Movements Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al consultar el historial paginado de movimientos: ' + error.message
    });
  }
};

/**
 * Optimizar y archivar movimientos antiguos (> N meses) para mantener la tabla activa ligera
 * POST /api/dashboard/movements/optimize
 * Restringido a: ADMINISTRADOR
 */
export const optimizeMovementsStorage = async (req, res) => {
  try {
    const retentionMonths = Math.max(6, parseInt(req.body?.retentionMonths, 10) || 24);
    const result = await DashboardRepository.archiveOldMovements(retentionMonths);
    const remainingTotal = await DashboardRepository.getMovementsTotalCount();

    if (req.user) {
      await AuditRepository.logAction(
        req.user.id,
        req.user.username,
        'OPTIMIZAR_HISTORIAL_MOVIMIENTOS',
        `Ejecutó optimización e indexación de movimientos (> ${result.retentionMonths} meses). Archivados: ${result.archivedCount}. Activos: ${remainingTotal}.`,
        req.ip
      );
    }

    return res.status(200).json({
      success: true,
      message: `Optimización completada. ${result.archivedCount} movimiento(s) anteriores a ${result.retentionMonths} meses fueron movidos al archivo histórico y los índices B-Tree fueron actualizados.`,
      archivedCount: result.archivedCount,
      remainingTotal
    });
  } catch (error) {
    console.error('[Dashboard Optimize Error]:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al optimizar el historial de movimientos: ' + error.message
    });
  }
};
