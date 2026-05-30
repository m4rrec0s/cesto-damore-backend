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
  preloadedFiles: Array<{ driveFileId: string; fileName: string; subfolderName: string }> = [],
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

  const driveSubfolders = await googleDriveService.listFolders(driveFolderId);
  const subfolderIds = [
    ...new Set([
      ...customizations
        .map((c) => c.google_drive_folder_id)
        .filter((id): id is string => id !== null),
      ...driveSubfolders.map((folder) => folder.id),
    ]),
  ];

  if (subfolderIds.length === 0 && preloadedFiles.length === 0) {
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

  for (const file of preloadedFiles) {
    const type = resolveCustomizationType(file.subfolderName, file.fileName);
    allFiles.push({
      name: file.fileName,
      driveFileId: file.driveFileId,
      subfolderName: file.subfolderName,
      type,
      sizeConfig: PRINT_SIZES[type],
      printerRole: resolvePrinterRole(type),
    });
  }

  for (const result of folderInfoResults) {
    if (result.status === "fulfilled") {
      const { folderName, files } = result.value;
      const subfolderName = folderName || "Desconhecido";
      for (const file of files) {
        if (allFiles.some((existing) => existing.driveFileId === file.id)) {
          continue;
        }

        const type = resolveCustomizationType(subfolderName, file.name);
        logger.debug(
          { orderId, subfolderName, type, fileName: file.name },
          "dispatch_print_file",
        );
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

  logger.info({ orderId, fileCount: allFiles.length, files: allFiles.map(f => ({ name: f.name, subfolderName: f.subfolderName, type: f.type })) }, "dispatch_print_files_debug");

  await enqueuePrintJob({
    jobId: randomUUID(),
    orderId,
    customerName,
    driveFolderId,
    files: allFiles,
  });
}
