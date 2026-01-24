import prisma from "../database/prisma";

/**
 * Converte string de data (YYYY-MM-DD) para Date respeitando timezone Brasil (America/Fortaleza)
 *
 * ⚠️ CRÍTICO: new Date("2026-02-11") interpreta como UTC, causando desajuste de 1+ dia
 * Esta função garante que a data seja tratada como local (Brasil) e não UTC
 *
 * @param dateString - String no formato YYYY-MM-DD
 * @returns Date representando o dia às 12:00 (meio-dia) em UTC puro
 */
function parseBrazilDate(dateString: string): Date {
  // Extrai ano, mês, dia de "2026-02-11"
  const [year, month, day] = dateString.split("-").map(Number);

  // Cria Date em UTC na data especificada (sem offset de timezone)
  // Isso garante que DATE type no PostgreSQL armazene o dia correto
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

class HolidayService {
  async listAll() {
    return prisma.holiday.findMany({
      orderBy: { start_date: "asc" },
    });
  }

  async getById(id: string) {
    return prisma.holiday.findUnique({
      where: { id },
    });
  }

  async create(data: {
    name: string;
    start_date: Date | string;
    end_date: Date | string;
    closure_type?: string;
    duration_hours?: number;
    description?: string;
    is_active?: boolean;
  }) {
    return prisma.holiday.create({
      data: {
        ...data,
        start_date:
          typeof data.start_date === "string"
            ? parseBrazilDate(data.start_date)
            : data.start_date,
        end_date:
          typeof data.end_date === "string"
            ? parseBrazilDate(data.end_date)
            : data.end_date,
      },
    });
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      start_date: Date | string;
      end_date: Date | string;
      closure_type: string;
      duration_hours: number;
      description: string;
      is_active: boolean;
    }>,
  ) {
    const updateData: any = { ...data };
    if (data.start_date) {
      updateData.start_date =
        typeof data.start_date === "string"
          ? parseBrazilDate(data.start_date)
          : data.start_date;
    }
    if (data.end_date) {
      updateData.end_date =
        typeof data.end_date === "string"
          ? parseBrazilDate(data.end_date)
          : data.end_date;
    }

    return prisma.holiday.update({
      where: { id },
      data: updateData,
    });
  }

  async delete(id: string) {
    return prisma.holiday.delete({
      where: { id },
    });
  }
}

export default new HolidayService();
