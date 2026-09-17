-- CreateTable
CREATE TABLE "YoutubeCredentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "YOUTUBE_API_KEY" VARCHAR(500) NOT NULL,
    "YOUTUBE_VIDEO_ID" VARCHAR(500) NOT NULL,

    CONSTRAINT "YoutubeCredentials_pkey" PRIMARY KEY ("id")
);
