import prisma from "../database/prisma";

function parseBrazilDate(dateString: string): Date {

  const [year, month, day] = dateString.split("-").map(Number);

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

  async listActiveForDelivery() {
    return prisma.holiday.findMany({
      where: { is_active: true },
      select: {
        start_date: true,
        end_date: true,
      },
      orderBy: { start_date: "asc" },
    });
  }

  async isDeliveryDateBlocked(deliveryDate: Date) {
    const dateInBrazil = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(deliveryDate);
    const year = Number(dateInBrazil.find((part) => part.type === "year")?.value);
    const month = Number(dateInBrazil.find((part) => part.type === "month")?.value);
    const day = Number(dateInBrazil.find((part) => part.type === "day")?.value);
    const deliveryDay = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

    const holiday = await prisma.holiday.findFirst({
      where: {
        is_active: true,
        start_date: { lte: deliveryDay },
        end_date: { gte: deliveryDay },
      },
      select: { name: true },
    });

    return holiday;
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
