import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "node:path";

const getFileType = (mimeType: string): string => {
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
    throw new BadRequestError("File type should be either .jpeg or .png");
  }

  return mimeType.split("/")[1];
};

const MAX_UPLOAD_SIZE = 10 << 20;

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("Not authorized to update this video");
  }

  const data = await req.formData();
  const file = data.get("thumbnail");

  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File is too big");
  }

  const mediaType = file.type;
  if (!mediaType) {
    throw new BadRequestError("Missing Content-Type for thumbnail");
  }

  const fileData = await file.arrayBuffer();
  if (!fileData) {
    throw new Error("Error reading file data");
  }

  const fileType = getFileType(mediaType);
  const videoName = `${videoId}.${fileType}`;
  const filePath = path.join(cfg.assetsRoot, videoName);

  Bun.write(filePath, file);

  const thumbnailURL = `http://localhost:${cfg.port}/assets/${videoName}`;

  video.thumbnailURL = thumbnailURL;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, null);
}
