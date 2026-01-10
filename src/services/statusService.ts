import prisma from "../database/prisma";
import { withRetry } from "../database/prismaRetry";
import { subDays, startOfMonth, endOfMonth, differenceInDays } from "date-fns";

class StatusService {
    async getBusinessStatus(days: number = 30) {
        const now = new Date();
        const startDate = subDays(now, days);

        try {
            const summaries = await withRetry(() =>
                prisma.financialSummary.findMany({
                    where: {
                        date: {
                            gte: startDate,
                        },
                    },
                    orderBy: { date: "asc" },
                })
            );

            const totals = summaries.reduce(
                (acc, curr) => ({
                    total_sales: acc.total_sales + curr.total_sales,
                    total_net_revenue: acc.total_net_revenue + curr.total_net_revenue,
                    total_fees: acc.total_fees + curr.total_fees,
                    total_orders: acc.total_orders + curr.total_orders,
                    approved_orders: acc.approved_orders + curr.approved_orders,
                    canceled_orders: acc.canceled_orders + curr.canceled_orders,
                    pending_orders: acc.pending_orders + curr.pending_orders,
                    total_products_sold: acc.total_products_sold + curr.total_products_sold,
                    total_additionals_sold: acc.total_additionals_sold + curr.total_additionals_sold,
                }),
                {
                    total_sales: 0,
                    total_net_revenue: 0,
                    total_fees: 0,
                    total_orders: 0,
                    approved_orders: 0,
                    canceled_orders: 0,
                    pending_orders: 0,
                    total_products_sold: 0,
                    total_additionals_sold: 0,
                }
            );

            // Ticket Médio
            const averageTicket = totals.approved_orders > 0
                ? totals.total_sales / totals.approved_orders
                : 0;

            // Taxa de Conversão
            const conversionRate = totals.total_orders > 0
                ? (totals.approved_orders / totals.total_orders) * 100
                : 0;

            // Projeção Mensal
            const last7Days = summaries.slice(-7);
            const last7DaysSales = last7Days.reduce((sum, s) => sum + s.total_sales, 0);
            const dailyAverage = last7Days.length > 0 ? last7DaysSales / last7Days.length : 0;

            const daysInMonth = differenceInDays(endOfMonth(now), startOfMonth(now)) + 1;
            const monthlyProjection = dailyAverage * daysInMonth;

            // Tendência (comparado aos 30 dias anteriores se disponível)
            // Por enquanto, vamos retornar apenas os dados atuais e a projeção.

            return {
                period: {
                    days,
                    startDate,
                    endDate: now,
                },
                totals,
                metrics: {
                    averageTicket: Number(averageTicket.toFixed(2)),
                    conversionRate: Number(conversionRate.toFixed(2)),
                    monthlyProjection: Number(monthlyProjection.toFixed(2)),
                },
                daily_data: summaries,
            };
        } catch (error: any) {
            console.error("Erro ao calcular status do negócio:", error);
            throw new Error(`Falha ao calcular status do negócio: ${error.message}`);
        }
    }

    async getTopSellingProducts(limit: number = 5) {
        try {
            // Simplificado: usar OrderItem para contar
            const topProducts = await prisma.orderItem.groupBy({
                by: ['product_id'],
                _sum: {
                    quantity: true,
                    price: true,
                },
                where: {
                    order: {
                        status: 'PAID', // Apenas pedidos pagos
                    }
                },
                orderBy: {
                    _sum: {
                        quantity: 'desc',
                    },
                },
                take: limit,
            });

            // Enriquecer com nomes dos produtos
            const enriched = await Promise.all(
                topProducts.map(async (item) => {
                    const product = await prisma.product.findUnique({
                        where: { id: item.product_id },
                        select: { name: true, image_url: true }
                    });
                    return {
                        product_id: item.product_id,
                        name: product?.name || 'Desconhecido',
                        image_url: product?.image_url,
                        total_sold: item._sum?.quantity || 0,
                        revenue: (item._sum?.price || 0) * (item._sum?.quantity || 1), // Aproximação do faturamento
                    };
                })
            );

            return enriched;
        } catch (error: any) {
            console.error("Erro ao buscar produtos mais vendidos:", error);
            return [];
        }
    }
}

export default new StatusService();
