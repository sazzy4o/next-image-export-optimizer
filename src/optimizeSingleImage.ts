#!/usr/bin/env node
import { ImageObject } from "./utils/ImageObject";
const getHash = require("./utils/getHash");
const ensureDirectoryExists = require("./utils/ensureDirectoryExists");

const fs = require("fs");
const sharp = require("sharp");
const path = require("path");

interface OptimizeSingleImageProps {
  imageData: ImageObject;
  widths: number[];
  quality: number;
  storePicturesInWEBP: boolean;
  staticImageFolderPath: string;
  exportFolderName: string;
  imageHashes: { [key: string]: string };
  nextConfigFolder: string;
  folderNameForRemoteImages: string;
}

const optimizeSingleImage = async function (
  {
    imageData, 
    widths,
    quality,
    storePicturesInWEBP,
    staticImageFolderPath,
    exportFolderName,
    imageHashes,
    nextConfigFolder,
    folderNameForRemoteImages,
  }: OptimizeSingleImageProps
) {
  const localGeneratedImages:(string|null)[] = [];
  const localUpdatedImageHashes: { [key: string]: number }= {};
  let localSizeOfGeneratedImages = 0;

  const file = imageData.file;
  let {basePath, dirPathWithoutBasePath:fileDirectory} = imageData;

  let extension = file.split(".").pop()!.toUpperCase();
  if (storePicturesInWEBP) {
    extension = "WEBP";
  }
  const imageBuffer = fs.readFileSync(
    path.join(basePath, fileDirectory, file)
  );
  const imageHash = getHash([
    imageBuffer,
    ...widths,
    quality,
    fileDirectory,
    file,
  ]);
  const keyForImageHashes = `${fileDirectory}/${file}`;

  let hashContentChanged = false;
  if (imageHashes[keyForImageHashes] !== imageHash) {
    hashContentChanged = true;
  }
  // Store image hash in temporary object
  localUpdatedImageHashes[keyForImageHashes] = imageHash;

  let optimizedOriginalWidthImagePath;
  let optimizedOriginalWidthImageSizeInMegabytes;

  const infoPromises:any[] = [];

  // Loop through all widths
  for (let indexWidth = 0; indexWidth < widths.length; indexWidth++) {
    const width = widths[indexWidth];

    const filename = path.parse(file).name;

    const isStaticImage = basePath === staticImageFolderPath;
    // for a static image, we copy the image to public/nextImageExportOptimizer or public/${exportFolderName}
    // and not the staticImageFolderPath
    // as the static image folder is deleted before each build
    const basePathToStoreOptimizedImages =
      isStaticImage ||
        basePath === path.join(nextConfigFolder, folderNameForRemoteImages)
        ? "public"
        : basePath;
    const optimizedFileNameAndPath = path.join(
      basePathToStoreOptimizedImages,
      fileDirectory,
      exportFolderName,
      `${filename}-opt-${width}.${extension.toUpperCase()}`
    );

    // Check if file is already in hash and specific size and quality is present in the
    // opt file directory
    if (
      !hashContentChanged &&
      keyForImageHashes in imageHashes &&
      fs.existsSync(optimizedFileNameAndPath)
    ) {
      const stats = fs.statSync(optimizedFileNameAndPath);
      const fileSizeInBytes = stats.size;
      const fileSizeInMegabytes = fileSizeInBytes / (1024 * 1024);
      localSizeOfGeneratedImages += fileSizeInMegabytes;
      // progressBar.increment({
      //   sizeOfGeneratedImages: sizeOfGeneratedImages.toFixed(1),
      // });
      localGeneratedImages.push(optimizedFileNameAndPath);
      continue;
    }

    const transformer = sharp(imageBuffer, {
      animated: true,
      limitInputPixels: false, // disable pixel limit
    });

    transformer.rotate();

    const { width: metaWidth } = await transformer.metadata();

    // For a static image, we can skip the image optimization and the copying
    // of the image for images with a width greater than the original image width
    // we will stop the loop at the first image with a width greater than the original image width
    let nextLargestSize = -1;
    for (let i = 0; i < widths.length; i++) {
      if (
        Number(widths[i]) >= metaWidth &&
        (nextLargestSize === -1 || Number(widths[i]) < nextLargestSize)
      ) {
        nextLargestSize = Number(widths[i]);
      }
    }
    if (
      isStaticImage &&
      nextLargestSize !== -1 &&
      width > nextLargestSize
    ) {
      // localGeneratedImages.push(null); // TODO: Will need to handle this case if using progress bar
      continue;
    }

    // If the original image's width is X, the optimized images are
    // identical for all widths >= X. Once we have generated the first of
    // these identical images, we can simply copy that file instead of redoing
    // the optimization.
    if (
      optimizedOriginalWidthImagePath &&
      optimizedOriginalWidthImageSizeInMegabytes
    ) {
      fs.copyFileSync(
        optimizedOriginalWidthImagePath,
        optimizedFileNameAndPath
      );

      localSizeOfGeneratedImages += optimizedOriginalWidthImageSizeInMegabytes;
      localGeneratedImages.push(optimizedFileNameAndPath);
      return {
        localGeneratedImages,
        localSizeOfGeneratedImages,
        localUpdatedImageHashes
      };
    }

    const resize = metaWidth && metaWidth > width;
    if (resize) {
      transformer.resize(width);
    }

    if (extension === "AVIF") {
      if (transformer.avif) {
        const avifQuality = quality - 15;
        transformer.avif({
          quality: Math.max(avifQuality, 0),
          chromaSubsampling: "4:2:0", // same as webp
        });
      } else {
        transformer.webp({ quality });
      }
    } else if (extension === "WEBP" || storePicturesInWEBP) {
      transformer.webp({ quality });
    } else if (extension === "PNG") {
      transformer.png({ quality });
    } else if (extension === "JPEG" || extension === "JPG") {
      transformer.jpeg({ quality });
    } else if (extension === "GIF") {
      transformer.gif({ quality });
    }

    // Write the optimized image to the file system
    await ensureDirectoryExists(optimizedFileNameAndPath);
    const info = await transformer.toFile(optimizedFileNameAndPath);
    const fileSizeInBytes = info.size;
    const fileSizeInMegabytes = fileSizeInBytes / (1024 * 1024);
    localSizeOfGeneratedImages += fileSizeInMegabytes;
    localGeneratedImages.push(optimizedFileNameAndPath);

    if (!resize) {
      optimizedOriginalWidthImagePath = optimizedFileNameAndPath;
      optimizedOriginalWidthImageSizeInMegabytes = fileSizeInMegabytes;
    }
  }
  return {
    localGeneratedImages,
    localSizeOfGeneratedImages,
    localUpdatedImageHashes
  };
};

module.exports = optimizeSingleImage;
