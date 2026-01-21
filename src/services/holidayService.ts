import prisma from "../database/prisma";

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
                start_date: new Date(data.start_date),
                end_date: new Date(data.end_date),
            },
        });
    }

    async update(id: string, data: Partial<{
        name: string;
        start_date: Date | string;
        end_date: Date | string;
        closure_type: string;
        duration_hours: number;
        description: string;
        is_active: boolean;
    }>) {
        const updateData: any = { ...data };
        if (data.start_date) updateData.start_date = new Date(data.start_date);
        if (data.end_date) updateData.end_date = new Date(data.end_date);

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
