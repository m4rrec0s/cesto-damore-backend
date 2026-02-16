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
