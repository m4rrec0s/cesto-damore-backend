import multer from "multer";
import sharp from "sharp";

const storage = multer.memoryStorage();

const isImageByName = (name?: string) => {
  if (!name) return false;
  return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name);
};

const imageFileFilter = (req: any, file: any, cb: any) => {
  // Aceita imagens com base no mimetype ou, se ausente, pela extensão do originalname
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

// Upload que aceita qualquer arquivo/campo (sem logs)
export const uploadAny = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
});

// Upload para modelos 3D (.glb, .gltf)
const storage3D = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/3d-models/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = file.originalname.split(".").pop();
    cb(null, `model-${uniqueSuffix}.${ext}`);
  },
});

export const upload3D = multer({
  storage: storage3D,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedExtensions = [".glb", ".gltf"];
    const ext = file.originalname
      .toLowerCase()
      .slice(file.originalname.lastIndexOf("."));

    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Apenas arquivos .glb e .gltf são permitidos"));
    }
  },
});

// Upload temporário para imagens de customização
const storageTemp = multer.diskStorage({
  destination: (req, file, cb) => {
    const { sessionId } = req.body;
    const tempDir = `storage/temp/${sessionId || "default"}`;

    // Criar diretório se não existir
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

// Middleware que converte imagens para WebP e atualiza req.file / req.files
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

      // Atualiza propriedades para refletir o novo arquivo WebP
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
      // Quando multer usa fields(), req.files é um objeto com arrays
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
