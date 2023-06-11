#!/usr/bin/env node

import { ImageObject } from "./utils/ImageObject";
import { Pool } from "multiprocess-pool";

const defineProgressBar = require("./utils/defineProgressBar");
const downloadImagesInBatches = require("./utils/downloadImagesInBatches");
const ensureDirectoryExists = require("./utils/ensureDirectoryExists");
const getAllFilesAsObject = require("./utils/getAllFilesAsObject");
const getRemoteImageURLs = require("./utils/getRemoteImageURLs");

import fs from "fs";
import path from "path";

const loadConfig = require("next/dist/server/config").default;

// Check if the --name and --age arguments are present
const nextConfigPathIndex = process.argv.indexOf("--nextConfigPath");
const exportFolderPathIndex = process.argv.indexOf("--exportFolderPath");

// Check if there is only one argument without a name present -> this is the case if the user does not provide the path to the next.config.js file
if (process.argv.length === 3) {
  // Colorize the output to red
  // Colorize the output to red
  console.error("\x1b[31m");
  console.error(
    "next-image-export-optimizer-ssg: Breaking change: Please provide the path to the next.config.js file as an argument with the name --nextConfigPath."
  );
  // Reset the color
  console.error("\x1b[0m");
  process.exit(1);
}

// Set the nextConfigPath and exportFolderPath variables to the corresponding arguments, or to undefined if the arguments are not present
let nextConfigPath =
  nextConfigPathIndex !== -1
    ? process.argv[nextConfigPathIndex + 1]
    : undefined;
let exportFolderPathCommandLine =
  exportFolderPathIndex !== -1
    ? process.argv[exportFolderPathIndex + 1]
    : undefined;

if (nextConfigPath) {
  nextConfigPath = path.isAbsolute(nextConfigPath)
    ? nextConfigPath
    : path.join(process.cwd(), nextConfigPath);
} else {
  nextConfigPath = path.join(process.cwd(), "next.config.js");
}
const nextConfigFolder = path.dirname(nextConfigPath);

const folderNameForRemoteImages = `remoteImagesForOptimization`;
const folderPathForRemoteImages = path.join(
  nextConfigFolder,
  folderNameForRemoteImages
);

if (exportFolderPathCommandLine) {
  exportFolderPathCommandLine = path.isAbsolute(exportFolderPathCommandLine)
    ? exportFolderPathCommandLine
    : path.join(process.cwd(), exportFolderPathCommandLine);
}

const nextImageExportOptimizer = async function () {
  console.log(
    "---- next-image-export-optimizer: Begin with optimization... ---- "
  );

  // Default values
  let imageFolderPath = "public/images";
  let staticImageFolderPath = ".next/static/media";
  let exportFolderPath = "out";
  let deviceSizes = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];
  let imageSizes = [16, 32, 48, 64, 96, 128, 256, 384];
  let quality = 75;
  let storePicturesInWEBP = true;
  let blurSize: number[] = [];
  let exportFolderName = "nextImageExportOptimizer";
  const { remoteImageFilenames, remoteImageURLs } = await getRemoteImageURLs(
    nextConfigFolder,
    folderPathForRemoteImages
  );
  try {
    // Read in the configuration parameters
    const nextjsConfig = await loadConfig("phase-export", nextConfigFolder);

    // Check if nextjsConfig is an object or is undefined
    if (typeof nextjsConfig !== "object" || nextjsConfig === null) {
      throw new Error("next.config.js is not an object");
    }
    const legacyPath = nextjsConfig.images?.nextImageExportOptimizer;
    const newPath = nextjsConfig.env;

    if (legacyPath?.imageFolderPath !== undefined) {
      imageFolderPath = legacyPath.imageFolderPath;
    } else if (
      newPath?.nextImageExportOptimizer_imageFolderPath !== undefined
    ) {
      imageFolderPath = newPath.nextImageExportOptimizer_imageFolderPath;
      // if the imageFolderPath starts with a slash, remove it
      if (imageFolderPath.startsWith("/")) {
        imageFolderPath = imageFolderPath.slice(1);
      }
    }
    if (legacyPath?.exportFolderPath !== undefined) {
      exportFolderPath = legacyPath.exportFolderPath;
    } else if (
      newPath?.nextImageExportOptimizer_exportFolderPath !== undefined
    ) {
      exportFolderPath = newPath.nextImageExportOptimizer_exportFolderPath;
    }
    if (nextjsConfig.images?.deviceSizes !== undefined) {
      deviceSizes = nextjsConfig.images.deviceSizes;
    }
    if (nextjsConfig.images?.imageSizes !== undefined) {
      imageSizes = nextjsConfig.images.imageSizes;
    }
    if (nextjsConfig.distDir !== undefined) {
      staticImageFolderPath = path.join(nextjsConfig.distDir, "static/media");
    }

    if (legacyPath?.quality !== undefined) {
      quality = Number(legacyPath.quality);
    } else if (newPath?.nextImageExportOptimizer_quality !== undefined) {
      quality = Number(newPath.nextImageExportOptimizer_quality);
    }
    if (nextjsConfig.env?.storePicturesInWEBP !== undefined) {
      storePicturesInWEBP = nextjsConfig.env.storePicturesInWEBP;
    } else if (
      newPath?.nextImageExportOptimizer_storePicturesInWEBP !== undefined
    ) {
      storePicturesInWEBP =
        newPath.nextImageExportOptimizer_storePicturesInWEBP;
    }
    if (
      nextjsConfig.env?.generateAndUseBlurImages !== undefined &&
      nextjsConfig.env.generateAndUseBlurImages === true
    ) {
      blurSize = [10];
    } else if (
      newPath?.nextImageExportOptimizer_generateAndUseBlurImages !==
        undefined &&
      newPath.nextImageExportOptimizer_generateAndUseBlurImages === true
    ) {
      blurSize = [10];
    }
    if (newPath.nextImageExportOptimizer_exportFolderName !== undefined) {
      exportFolderName = newPath.nextImageExportOptimizer_exportFolderName;
    }
    // Give the user a warning if the transpilePackages: ["next-image-export-optimizer-ssg"], is not set in the next.config.js
    if (
      nextjsConfig.transpilePackages === undefined || // transpilePackages is not set
      (nextjsConfig.transpilePackages !== undefined &&
        !nextjsConfig.transpilePackages.includes("next-image-export-optimizer-ssg")) // transpilePackages is set but does not include next-image-export-optimizer
    ) {
      console.warn(
        "\x1b[41m",
        `Changed in 1.2.0: You have not set transpilePackages: ["next-image-export-optimizer-ssg"] in your next.config.js. This may cause problems with next-image-export-optimizer. Please add this line to your next.config.js.`,
        "\x1b[0m"
      );
    }
  } catch (e) {
    // Configuration file not found
    console.log("Could not find a next.config.js file. Use of default values");
  }

  // if the user has specified a path for the export folder via the command line, use this path
  exportFolderPath = exportFolderPathCommandLine || exportFolderPath;

  // Give the user a warning, if the public directory of Next.js is not found as the user
  // may have run the command in a wrong directory
  if (!fs.existsSync(path.join(nextConfigFolder, "public"))) {
    console.warn(
      "\x1b[41m",
      `Could not find a public folder in this directory. Make sure you run the command in the main directory of your project.`,
      "\x1b[0m"
    );
  }

  // Create the folder for the remote images if it does not exists
  if (remoteImageURLs.length > 0) {
    try {
      if (!fs.existsSync(folderNameForRemoteImages)) {
        fs.mkdirSync(folderNameForRemoteImages);
        console.log(
          `Create remote image output folder: ${folderNameForRemoteImages}`
        );
      } else {
        const imageExtensions = [
          ".jpg",
          ".jpeg",
          ".png",
          ".gif",
          ".svg",
          ".webp",
          ".avif",
        ];
        // Delete all remote images in the folder synchronously
        // This is necessary, because the user may have changed the remote images
        // and the old images would be used otherwise

        fs.readdirSync(folderNameForRemoteImages).forEach((file: string) => {
          // delete the file synchronously
          fs.unlinkSync(path.join(folderNameForRemoteImages, file));
        });
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Download the remote images specified in the remoteOptimizedImages.js file
  if (remoteImageURLs.length > 0)
    console.log(
      `Downloading ${remoteImageURLs.length} remote image${
        remoteImageURLs.length > 1 ? "s" : ""
      }...`
    );
  await downloadImagesInBatches(
    remoteImageURLs,
    remoteImageFilenames,
    folderPathForRemoteImages,
    Math.min(remoteImageURLs.length, 20)
  );

  // Create or read the JSON containing the hashes of the images in the image directory
  let imageHashes: {
    [key: string]: string;
  } = {};
  const hashFilePath = `${imageFolderPath}/next-image-export-optimizer-hashes.json`;
  try {
    let rawData = fs.readFileSync(hashFilePath).toString();
    imageHashes = JSON.parse(rawData);
  } catch (e) {
    // No image hashes yet
  }

  // check if the image folder is a subdirectory of the public folder
  // if not, the images in the image folder can only be static images and are taken from the static image folder (staticImageFolderPath)
  // so we do not add them to the images that need to be optimized

  const isImageFolderSubdirectoryOfPublicFolder =
    imageFolderPath.includes("public");

  const allFilesInImageFolderAndSubdirectories:ImageObject[] =
    isImageFolderSubdirectoryOfPublicFolder
      ? getAllFilesAsObject(imageFolderPath, imageFolderPath, exportFolderName)
      : [];
  const allFilesInStaticImageFolder = getAllFilesAsObject(
    staticImageFolderPath,
    staticImageFolderPath,
    exportFolderName
  );
  // append the static image folder to the image array
  allFilesInImageFolderAndSubdirectories.push(...allFilesInStaticImageFolder);

  // append the remote images to the image array
  if (remoteImageURLs.length > 0) {
    // get all files in the remote image folder again, as we added extensions to the filenames
    // if they were not present in the URLs in remoteOptimizedImages.js

    const allFilesInRemoteImageFolder = fs.readdirSync(
      folderNameForRemoteImages
    );

    const remoteImageFiles = allFilesInRemoteImageFolder.map(
      (filename: string) => {
        const filenameFull = path.join(folderPathForRemoteImages, filename);

        return {
          basePath: folderPathForRemoteImages,
          file: filename,
          dirPathWithoutBasePath: "",
          fullPath: filenameFull,
        };
      }
    );

    // append the remote images to the image array
    allFilesInImageFolderAndSubdirectories.push(...remoteImageFiles);
  }

  const allImagesInImageFolder:ImageObject[] = allFilesInImageFolderAndSubdirectories.filter(
    (fileObject: ImageObject) => {
      if (fileObject === undefined) return false;
      if (fileObject.file === undefined) return false;
      // check if the file has a supported extension
      const filenameSplit = fileObject.file.split(".");
      if (filenameSplit.length === 1) return false;
      const extension = filenameSplit.pop()!.toUpperCase();
      // Only include file with image extensions
      return ["JPG", "JPEG", "WEBP", "PNG", "AVIF", "GIF"].includes(extension);
    }
  );
  console.log(
    `Found ${
      allImagesInImageFolder.length - remoteImageURLs.length
    } supported images in ${imageFolderPath}, static folder and subdirectories and ${
      remoteImageURLs.length
    } remote image${remoteImageURLs.length > 1 ? "s" : ""}.`
  );

  const widths = [...blurSize, ...imageSizes, ...deviceSizes];

  const progressBar = defineProgressBar();
  if (allImagesInImageFolder.length > 0) {
    console.log(`Using sizes: ${widths.toString()}`);
    console.log(
      `Start optimization of ${allImagesInImageFolder.length} images with ${
        widths.length
      } sizes resulting in ${
        allImagesInImageFolder.length * widths.length
      } optimized images...`
    );
    progressBar.start(allImagesInImageFolder.length * widths.length, 0, {
      sizeOfGeneratedImages: 0,
    });
  }
  let sizeOfGeneratedImages = 0;
  const allGeneratedImages: string[] = [];

  const updatedImageHashes: {
    [key: string]: string;
  } = {};

  const optimizeSingleImageInputs = allImagesInImageFolder.map((imageData: ImageObject) => {
    return {
      imageData,
      widths,
      quality,
      storePicturesInWEBP,
      staticImageFolderPath,
      exportFolderName,
      imageHashes,
      nextConfigFolder,
      folderNameForRemoteImages,
    };
  });

  const pool = new Pool();
  const optimizationResults = await pool.map(optimizeSingleImageInputs, __dirname + '/optimizeSingleImage');
  optimizationResults.forEach((optimizationResult) => {
    const {
      localGeneratedImages,
      localSizeOfGeneratedImages,
      localUpdatedImageHashes
    } = optimizationResult;
    allGeneratedImages.push(...localGeneratedImages);
    sizeOfGeneratedImages += localSizeOfGeneratedImages;
    Object.assign(updatedImageHashes, localUpdatedImageHashes);
  });
  pool.close();

  let data = JSON.stringify(updatedImageHashes, null, 4);
  await ensureDirectoryExists(hashFilePath);
  fs.writeFileSync(hashFilePath, data);

  // Copy the optimized images to the build folder

  console.log("Copy optimized images to build folder...");
  await Promise.all(allGeneratedImages.map(async (imagePath: string) => {
    const filePath = path.resolve(imagePath);
    const fileInBuildFolder = path.resolve(path.join(
      exportFolderPath,
      filePath.split("public").pop() as string
    ));

    // Create the folder for the optimized images in the build directory if it does not exists
    await ensureDirectoryExists(fileInBuildFolder);
    await fs.promises.copyFile(filePath, fileInBuildFolder);
  }));

  function findSubfolders(
    rootPath: string,
    folderName: string,
    results: string[] = []
  ) {
    const items = fs.readdirSync(rootPath);
    for (const item of items) {
      const itemPath = path.join(rootPath, item);
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        if (item === folderName) {
          results.push(itemPath);
        }
        findSubfolders(itemPath, folderName, results);
      }
    }
    return results;
  }

  const optimizedImagesFolders = findSubfolders(
    imageFolderPath,
    exportFolderName
  );
  optimizedImagesFolders.push(`public/${exportFolderName}`);

  function findImageFiles(
    folderPath: string,
    extensions: string[],
    results: string[] = []
  ) {
    // check if the folder exists
    if (!fs.existsSync(folderPath)) {
      return results;
    }
    const items = fs.readdirSync(folderPath);
    for (const item of items) {
      const itemPath = path.join(folderPath, item);
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        findImageFiles(itemPath, extensions, results);
      } else {
        const ext = path.extname(item).toUpperCase();
        if (extensions.includes(ext)) {
          results.push(itemPath);
        }
      }
    }
    return results;
  }

  const imageExtensions = [".PNG", ".GIF", ".JPG", ".JPEG", ".AVIF", ".WEBP"];

  const imagePaths: string[] = [];
  for (const subfolderPath of optimizedImagesFolders) {
    const paths = findImageFiles(subfolderPath, imageExtensions);
    imagePaths.push(...paths);
  }

  // find the optimized images that are no longer used in the project
  const unusedImages: string[] = [];
  for (const imagePath of imagePaths) {
    const isUsed = allGeneratedImages.includes(imagePath);
    if (!isUsed) {
      unusedImages.push(imagePath);
    }
  }
  // delete the unused images
  for (const imagePath of unusedImages) {
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
  }
  if (unusedImages.length > 0)
    console.log(
      `Deleted ${unusedImages.length} unused image${
        unusedImages.length > 1 ? "s" : ""
      } from the optimized images folders.`
    );

  console.log("---- next-image-export-optimizer-ssg: Done ---- ");
  process.exit(0);
};

if (require.main === module) {
  nextImageExportOptimizer();
}
module.exports = nextImageExportOptimizer;
