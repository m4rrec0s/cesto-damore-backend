import multer from "multer";
import sharp from "sharp";

const storage = multer.memoryStorage();

const isImageByName = (name?: string) => {
  if (!name) return false;
  return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name);
};

const imageFileFilter = (req: any, file: any, cb: any) => {
  const hasMimeImage = file.mimetype && file.mimetype.startsWith("image/");
  const hasImageName = isImageByName(file.originalname);
  if (hasMimeImage || hasImageName) {
    cb(null, true);
  } else {
    cb(null, false);
  }
};

export const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

export const uploadAny = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
});

const storageTemp = multer.diskStorage({
  destination: (req, file, cb) => {
    const { sessionId } = req.body;
    const tempDir = `storage/temp/${sessionId || "default"}`;

    const fs = require("fs");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = file.originalname.split(".").pop();
    cb(null, `temp-${uniqueSuffix}.${ext}`);
  },
});

export const uploadTemp = multer({
  storage: storageTemp,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Apenas imagens JPEG, PNG, WebP e GIF são permitidas"));
    }
  },
});

export const convertImagesToWebP = async (req: any, res: any, next: any) => {
  try {
    const convert = async (file: any) => {
      if (!file || !file.buffer) return file;

      const isImageMime = file.mimetype && file.mimetype.startsWith("image/");
      const isImageName = isImageByName(file.originalname);
      if (!isImageMime && !isImageName) return file;

      const webpBuffer = await sharp(file.buffer)
        .webp({ quality: 80 })
        .toBuffer();

      const originalName = file.originalname || `file_${Date.now()}`;
      const baseName = originalName.replace(/\.[^.]+$/, "");
      file.buffer = webpBuffer;
      file.mimetype = "image/webp";
      file.originalname = `${baseName}.webp`;
      file.size = webpBuffer.length;

      return file;
    };

    if (req.file) {
      req.file = await convert(req.file);
    }

    if (Array.isArray(req.files)) {
      for (let i = 0; i < req.files.length; i++) {
        req.files[i] = await convert(req.files[i]);
      }
    } else if (req.files && typeof req.files === "object") {
      for (const key of Object.keys(req.files)) {
        const arr = req.files[key];
        if (Array.isArray(arr)) {
          for (let i = 0; i < arr.length; i++) {
            arr[i] = await convert(arr[i]);
          }
        }
      }
    }

    next();
  } catch (err) {
    next(err);
  }
};

export const convertImagesToWebPLossless = async (
  req: any,
  res: any,
  next: any
) => {
  try {
    const convert = async (file: any) => {
      if (!file || !file.buffer) return file;

      const isImageMime = file.mimetype && file.mimetype.startsWith("image/");
      const isImageName = isImageByName(file.originalname);
      if (!isImageMime && !isImageName) return file;

      const ext = (file.originalname || "").split(".").pop() || "webp";
      const hasTemplate = /\{\{.*\}\}/.test(file.originalname || "");
      const safeBaseName = hasTemplate
        ? `uploaded_${Date.now()}`
        : (file.originalname || `file_${Date.now()}`).replace(/\.[^.]+$/, "");

      // Convert using withMetadata to preserve profile/density when possible
      const webpBuffer = await sharp(file.buffer)
        .withMetadata()
        .webp({ lossless: true })
        .toBuffer();

      file.buffer = webpBuffer;
      file.mimetype = "image/webp";
      file.originalname = `${safeBaseName}.webp`;
      file.size = webpBuffer.length;

      return file;
    };

    if (req.file) {
      req.file = await convert(req.file);
    }

    if (Array.isArray(req.files)) {
      for (let i = 0; i < req.files.length; i++) {
        req.files[i] = await convert(req.files[i]);
      }
    } else if (req.files && typeof req.files === "object") {
      for (const key of Object.keys(req.files)) {
        const arr = req.files[key];
        if (Array.isArray(arr)) {
          for (let i = 0; i < arr.length; i++) {
            arr[i] = await convert(arr[i]);
          }
        }
      }
    }

    next();
  } catch (err) {
    next(err);
  }
};
