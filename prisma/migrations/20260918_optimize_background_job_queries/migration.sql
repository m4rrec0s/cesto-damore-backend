-- Indexes supporting payment reconciliation and print-job recovery scans.
CREATE INDEX IF NOT EXISTS "Payment_status_created_at_idx"
ON "Payment"("status", "created_at");

CREATE INDEX IF NOT EXISTS "print_job_order_status_createdAt_idx"
ON "print_job_order"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "print_job_order_status_sentAt_idx"
ON "print_job_order"("status", "sentAt");

CREATE INDEX IF NOT EXISTS "print_job_order_status_updatedAt_idx"
ON "print_job_order"("status", "updatedAt");
