import prisma from "../database/prisma";
import { withRetry } from "../database/prismaRetry";
import { subDays, startOfMonth, endOfMonth, differenceInDays } from "date-fns";

class StatusService {
    async getBusinessStatus(days: number = 30) {
        const now = new Date();
        const startDate = subDays(now, days);

        try {
            // Buscar todos os pedidos do período
            const orders = await withRetry(() =>
                prisma.order.findMany({
                    where: {
                        created_at: {
                            gte: startDate,
                        },
                    },
                    include: {
                        payment: true,
                        items: {
                            include: {
                                additionals: true
                            }
                        }
                    },
                    orderBy: { created_at: "asc" },
                })
            );

            // Agrupar por dia para o gráfico (daily_data)
            const dailyMap = new Map();

            // Inicializar o mapa com zeros para todos os dias do período
            for (let i = 0; i <= days; i++) {
                const dateKey = subDays(now, i).toISOString().split('T')[0];
                dailyMap.set(dateKey, {
                    date: dateKey,
                    total_sales: 0,
                    total_net_revenue: 0,
                    total_fees: 0,
                    total_orders: 0,
                    approved_orders: 0,
                    canceled_orders: 0,
                    pending_orders: 0,
                    total_products_sold: 0,
                    total_additionals_sold: 0,
                });
            }

            const totals = {
                total_sales: 0,
                total_net_revenue: 0,
                total_fees: 0,
                total_orders: orders.length,
                approved_orders: 0,
                canceled_orders: 0,
                pending_orders: 0,
                total_products_sold: 0,
                total_additionals_sold: 0,
            };

            orders.forEach(order => {
                const dateKey = order.created_at.toISOString().split('T')[0];
                const dayData = dailyMap.get(dateKey) || {
                    date: dateKey,
                    total_sales: 0,
                    total_net_revenue: 0,
                    total_fees: 0,
                    total_orders: 0,
                    approved_orders: 0,
                    canceled_orders: 0,
                    pending_orders: 0,
                    total_products_sold: 0,
                    total_additionals_sold: 0,
                };

                dayData.total_orders++;

                if (order.status === 'PAID' || order.status === 'SHIPPED' || order.status === 'DELIVERED') {
                    const orderValue = order.grand_total || order.total || 0;
                    const netValue = order.payment?.net_received_amount || orderValue * 0.95; // Fallback 5% taxa
                    const fees = orderValue - netValue;

                    dayData.approved_orders++;
                    dayData.total_sales += orderValue;
                    dayData.total_net_revenue += netValue;
                    dayData.total_fees += fees;

                    totals.approved_orders++;
                    totals.total_sales += orderValue;
                    totals.total_net_revenue += netValue;
                    totals.total_fees += fees;

                    // Contagem de produtos e adicionais
                    order.items.forEach(item => {
                        dayData.total_products_sold += item.quantity;
                        totals.total_products_sold += item.quantity;

                        item.additionals.forEach(add => {
                            dayData.total_additionals_sold += add.quantity;
                            totals.total_additionals_sold += add.quantity;
                        });
                    });
                } else if (order.status === 'CANCELED') {
                    dayData.canceled_orders++;
                    totals.canceled_orders++;
                } else if (order.status === 'PENDING') {
                    dayData.pending_orders++;
                    totals.pending_orders++;
                }

                dailyMap.set(dateKey, dayData);
            });

            // Converter o mapa para array ordenado por data
            const summaries = Array.from(dailyMap.values()).sort((a: any, b: any) =>
                new Date(a.date).getTime() - new Date(b.date).getTime()
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
