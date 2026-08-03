import { Request, Response } from "express";
import specialDeliveryService from "../services/specialDeliveryService";

class SpecialDeliveryController {
  async list(req: Request, res: Response) {
    try {
      const days = specialDeliveryService.listSpecialDays();
      res.json(days);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default new SpecialDeliveryController();