import DashboardRepository from '../repositories/DashboardRepository.js';

/**
 * Obtener el resumen de datos para los gráficos del dashboard
 * GET /api/dashboard/summary
 * Restringido a: ADMINISTRADOR
 */
export const getDashboardSummary = async (req, res) => {
  try {
    // Ejecutar las cuatro consultas en paralelo para mejorar rendimiento
    const [movementsData, topProductsData, stockDistributionData, exactMovementsData] = await Promise.all([
      DashboardRepository.getMovementsOverTime(7),
      DashboardRepository.getTopProducts(5, 30),
      DashboardRepository.getStockDistribution(),
      DashboardRepository.getExactMovements()
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
        exactMovements: exactMovementsData
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
