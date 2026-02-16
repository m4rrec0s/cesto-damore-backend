import OpenAI from "openai";
import statusService from "./statusService";
import logger from "../utils/logger";
import prisma from "../database/prisma";
import { startOfDay, endOfDay, isMonday } from "date-fns";

class AISummaryService {
    private openai: OpenAI;
    private model: string = "gpt-4o-mini";

    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    async getWeeklySummary(forceRefresh: boolean = false) {
        try {
            const now = new Date();
            const monday = isMonday(now);

            if (!monday && !forceRefresh) {
                const lastSummary = await prisma.aISummary.findFirst({
                    orderBy: { created_at: 'desc' }
                });

                if (lastSummary) {
                    return {
                        summary: lastSummary.summary,
                        generated_at: lastSummary.created_at,
                        period_start: lastSummary.period_start,
                        period_end: lastSummary.period_end,
                        from_cache: true
                    };
                }
            }

            if (monday && !forceRefresh) {
                const todaySummary = await prisma.aISummary.findFirst({
                    where: {
                        created_at: {
                            gte: startOfDay(now),
                            lte: endOfDay(now)
                        }
                    }
                });

                if (todaySummary) {
                    return {
                        summary: todaySummary.summary,
                        generated_at: todaySummary.created_at,
                        period_start: todaySummary.period_start,
                        period_end: todaySummary.period_end,
                        from_cache: true
                    };
                }
            }

            return this.generateAndSaveSummary();
        } catch (error: any) {
            logger.error("Erro no getWeeklySummary:", error);
            throw error;
        }
    }

    private async generateAndSaveSummary() {
        try {
            logger.info("Gerando novo resumo AI semanal...");

            const statusData = await statusService.getBusinessStatus(7);
            const topProducts = await statusService.getTopSellingProducts(5);

            const prompt = `
      Você é um consultor analista de negócios da Cesto d'Amore, uma loja premium de cestas de presentes e flores.
      Sua tarefa é analisar os indicadores de desempenho da última semana e gerar um resumo estratégico para o gerente.

      DADOS DA ÚLTIMA SEMANA:
      - Total de Vendas (Bruto): R$ ${statusData.totals.total_sales.toFixed(2)}
      - Receita Líquida: R$ ${statusData.totals.total_net_revenue.toFixed(2)}
      - Taxas Pagas: R$ ${statusData.totals.total_fees.toFixed(2)}
      - Total de Pedidos: ${statusData.totals.total_orders}
      - Pedidos Aprovados (Pagos/Entregues): ${statusData.totals.approved_orders}
      - Pedidos Pendentes: ${statusData.totals.pending_orders}
      - Pedidos Cancelados: ${statusData.totals.canceled_orders}
      - Total de Itens Vendidos: ${statusData.totals.total_products_sold}
      - Total de Adicionais/Extras Vendidos: ${statusData.totals.total_additionals_sold}
      - Ticket Médio: R$ ${statusData.metrics.averageTicket.toFixed(2)}
      - Taxa de Conversão: ${statusData.metrics.conversionRate.toFixed(2)}%
      - Projeção Mensal Baseada nesta Semana: R$ ${statusData.metrics.monthlyProjection.toFixed(2)}
      
      PRODUTOS MAIS VENDIDOS:
      ${topProducts.map(p => `- ${p.name}: ${p.total_sold} unidades (Receita: R$ ${p.revenue.toFixed(2)})`).join('\n')}

      INSTRUÇÕES:
      1. Escreva um resumo executivo de 2-3 parágrafos.
      2. Destaque o que foi positivo e o que pode melhorar (ex: taxa de cancelamento, ticket médio).
      3. Use um tom profissional, encorajador e estratégico.
      4. Formate a saída em Markdown.
      5. Não invente dados fora do que foi fornecido.
      6. Se houver muitos cancelamentos, sugira verificar o checkout ou fretes.
      `;

            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: "system", content: "Você é um consultor de negócios especializado em e-commerce premium." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.7,
            });

            const summaryContent = response.choices[0].message.content || "";

            const existingSummary = await prisma.aISummary.findFirst({
                where: {
                    period_start: statusData.period.startDate,
                    period_end: statusData.period.endDate,
                },
                orderBy: { created_at: 'desc' }
            });

            let savedSummary;
            if (existingSummary) {
                savedSummary = await prisma.aISummary.update({
                    where: { id: existingSummary.id },
                    data: {
                        summary: summaryContent,
                    }
                });
            } else {
                savedSummary = await prisma.aISummary.create({
                    data: {
                        summary: summaryContent,
                        period_start: statusData.period.startDate,
                        period_end: statusData.period.endDate,
                    }
                });
            }

            return {
                summary: savedSummary.summary,
                generated_at: savedSummary.created_at,
                period_start: savedSummary.period_start,
                period_end: savedSummary.period_end,
                from_cache: false
            };
        } catch (error: any) {
            logger.error("Erro ao gerar resumo AI:", error);
            throw new Error(`Falha ao gerar resumo AI: ${error.message}`);
        }
    }
}

export default new AISummaryService();
