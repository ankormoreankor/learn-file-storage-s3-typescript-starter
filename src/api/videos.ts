import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import path from "node:path";

const MAX_UPLOAD_SIZE = 1 << 30;
const FILE_TYPE = "video/mp4";

const getVideoAspectRatio = async (filePath: string) => {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  const exited = await proc.exited;
  if (exited !== 0) {
    throw new Error(stderrText);
  }

  const data = JSON.parse(stdoutText);
  const { width, height } = data.streams[0];
  const fileAspectRatio = Math.floor(width / height);
  let aspectRatio: string;

  switch (fileAspectRatio) {
    case Math.floor(16 / 9):
      aspectRatio = "landscape";
      break;
    case Math.floor(9 / 16):
      aspectRatio = "portrait";
      break;
    default:
      aspectRatio = "other";
  }

  return aspectRatio;
};

const processVideoForFastStart = async (inputFilePath: string) => {
  const outputPath = `${inputFilePath}.processed`;

  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-i",
      inputFilePath,
      "-movflags",
      "faststart",
      "-map_metadata",
      "0",
      "-codec",
      "copy",
      "-f",
      "mp4",
      outputPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stderrText = await new Response(proc.stderr).text();

  const exited = await proc.exited;
  if (exited !== 0) {
    throw new Error(stderrText);
  }

  return outputPath;
};

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
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
  const file = data.get("video");

  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File is too big");
  }

  const mediaType = file.type;
  if (mediaType !== FILE_TYPE) {
    throw new BadRequestError(`File type should be ${FILE_TYPE}`);
  }

  const videoName = `${videoId}.mp4`;
  const filePath = path.join(`/tmp`, videoName);

  await Bun.write(filePath, file);

  const processed = await processVideoForFastStart(filePath);
  const aspectRatio = await getVideoAspectRatio(processed);

  const s3File = cfg.s3Client.file(`${aspectRatio}/${videoName}`);
  await s3File.write(Bun.file(processed), { type: "video/mp4" });

  const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${aspectRatio}/${videoName}`;

  video.videoURL = videoURL;
  updateVideo(cfg.db, video);

  await Bun.file(filePath).delete();
  await Bun.file(processed).delete();

  return respondWithJSON(200, video);
}
