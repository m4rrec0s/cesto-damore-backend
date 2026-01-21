import { Request, Response } from "express";
import followUpService from "../services/holidayService"; // Wait, wrong import
import followUpServiceActual from "../services/followUpService";

class FollowUpController {
    async listHistory(req: Request, res: Response) {
        try {
            const history = await followUpServiceActual.getSentHistory();
            res.json(history);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    async toggle(req: Request, res: Response) {
        try {
            const { phone, status } = req.body;
            if (!phone) return res.status(400).json({ error: "Telefone é obrigatório" });
            const customer = await followUpServiceActual.toggleFollowUp(phone, status);
            res.json(customer);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    async trigger(req: Request, res: Response) {
        try {
            await followUpServiceActual.triggerFollowUpFunction();
            res.json({ message: "Follow-up function triggered" });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
}

export default new FollowUpController();
