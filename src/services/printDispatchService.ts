import { randomUUID } from "crypto";
import prisma from "../database/prisma";
import googleDriveService from "./googleDriveService";
import { enqueue as enqueuePrintJob } from "./printQueueService";
import type { PrintJobFile } from "../types/printJob";
import { resolveCustomizationType, resolvePrinterRole, PRINT_SIZES } from "../utils/customizationTypeResolver";
import logger from "../utils/logger";

export async function dispatchPrintForOrder(
  orderId: string,
  driveFolderId: string,
  customerName: string,
): Promise<void> {
  if (!driveFolderId) {
    logger.warn({ orderId }, "print_skip_no_drive_folder");
    return;
  }

  const customizations = await prisma.orderItemCustomization.findMany({
    where: {
      orderItem: { order_id: orderId },
      google_drive_folder_id: { not: null },
    },
    select: { google_drive_folder_id: true },
  });

  const subfolderIds = [
    ...new Set(
      customizations
        .map((c) => c.google_drive_folder_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  if (subfolderIds.length === 0) {
    logger.warn({ orderId }, "print_skip_no_customization_folders");
    return;
  }

  const folderInfoResults = await Promise.allSettled(
    subfolderIds.map(async (id) => {
      const folderName = await googleDriveService.getFolderName(id);
      const files = await googleDriveService.listFiles(id);
      return { folderName, files };
    }),
  );

  const allFiles: PrintJobFile[] = [];
  for (const result of folderInfoResults) {
    if (result.status === "fulfilled") {
      const { folderName, files } = result.value;
      const subfolderName = folderName || "Desconhecido";
      for (const file of files) {
        const type = resolveCustomizationType(subfolderName);
        allFiles.push({
          name: file.name,
          driveFileId: file.id,
          subfolderName,
          type,
          sizeConfig: PRINT_SIZES[type],
          printerRole: resolvePrinterRole(type),
        });
      }
    }
  }

  if (allFiles.length === 0) {
    logger.warn({ orderId }, "print_skip_no_files_in_folders");
    return;
  }

  await enqueuePrintJob({
    jobId: randomUUID(),
    orderId,
    customerName,
    driveFolderId,
    files: allFiles,
  });
}
