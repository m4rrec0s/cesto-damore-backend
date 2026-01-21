import { Request, Response } from "express";
import holidayService from "../services/holidayService";

class HolidayController {
    async index(req: Request, res: Response) {
        try {
            const holidays = await holidayService.listAll();
            res.json(holidays);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    async show(req: Request, res: Response) {
        try {
            const holiday = await holidayService.getById(req.params.id);
            if (!holiday) return res.status(404).json({ error: "Feriado não encontrado" });
            res.json(holiday);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    async create(req: Request, res: Response) {
        try {
            const holiday = await holidayService.create(req.body);
            res.status(201).json(holiday);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    async update(req: Request, res: Response) {
        try {
            const holiday = await holidayService.update(req.params.id, req.body);
            res.json(holiday);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    async delete(req: Request, res: Response) {
        try {
            await holidayService.delete(req.params.id);
            res.status(204).send();
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
}

export default new HolidayController();
