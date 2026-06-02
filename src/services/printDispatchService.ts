import { randomUUID } from "crypto";
import prisma from "../database/prisma";
import googleDriveService from "./googleDriveService";
import { enqueue as enqueuePrintJob } from "./printQueueService";
import type { PrintJobFile } from "../types/printJob";
import { resolveCustomizationType, resolvePrinterRole, PRINT_SIZES } from "../utils/customizationTypeResolver";
import logger from "../utils/logger";

type DispatchPreloadedFile = {
  driveFileId: string;
  fileName: string;
  subfolderName: string;
  folderId?: string;
};

type PrintCustomizationRecord = {
  google_drive_folder_id: string | null;
  value: string;
};

export async function dispatchPrintForOrder(
  orderId: string,
  driveFolderId: string,
  customerName: string,
  preloadedFiles: DispatchPreloadedFile[] = [],
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
    select: { google_drive_folder_id: true, value: true },
  });

  const allowedCustomizationFolderIds =
    await resolvePrintableCustomizationFolderIds(customizations);

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
      return { folderId: id, folderName, files };
    }),
  );

  const allFiles: PrintJobFile[] = [];

  for (const file of preloadedFiles) {
    if (file.folderId && !allowedCustomizationFolderIds.has(file.folderId)) {
      logger.info(
        { orderId, folderId: file.folderId, fileName: file.fileName },
        "print_skip_preloaded_non_frame_dynamic_layout",
      );
      continue;
    }

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
      const { folderId, folderName, files } = result.value;
      if (!allowedCustomizationFolderIds.has(folderId)) {
        logger.info(
          { orderId, folderId, folderName },
          "print_skip_folder_non_frame_dynamic_layout",
        );
        continue;
      }

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

async function resolvePrintableCustomizationFolderIds(
  customizations: PrintCustomizationRecord[],
): Promise<Set<string>> {
  const allowed = new Set<string>();

  for (const customization of customizations) {
    const folderId = customization.google_drive_folder_id;
    if (!folderId) continue;

    const data = parseCustomizationData(customization.value);
    if (data?.customization_type !== "DYNAMIC_LAYOUT") {
      allowed.add(folderId);
      continue;
    }

    const layoutId = findLayoutId(data);
    if (!layoutId) {
      logger.warn({ folderId }, "print_skip_dynamic_layout_without_layout_id");
      continue;
    }

    const layout = await prisma.dynamicLayout.findUnique({
      where: { id: layoutId },
      select: { type: true },
    });

    if (layout?.type === "frame") {
      allowed.add(folderId);
    } else {
      logger.info(
        { folderId, layoutId, layoutType: layout?.type ?? null },
        "print_skip_non_frame_dynamic_layout",
      );
    }
  }

  return allowed;
}

function parseCustomizationData(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function findLayoutId(value: any): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const keys = [
    "selected_layout_id",
    "layout_id",
    "DYNAMIC_LAYOUT_id",
    "layoutId",
    "baseLayoutId",
  ];

  for (const key of keys) {
    if (typeof value[key] === "string" && value[key]) return value[key];
  }

  for (const child of Object.values(value)) {
    const found = findLayoutId(child);
    if (found) return found;
  }

  return undefined;
}
