export interface PostImage {
  full: string; // S3 key, e.g. images/<id>/full.jpg
  thumb: string; // S3 key, e.g. images/<id>/thumb.jpg
  width: number;
  height: number;
}

export interface Post {
  id: string; // sortable, e.g. 2026-06-25-a1b2c3
  slug: string; // url-safe, e.g. morning-light-marin-headlands
  blurb: string;
  location: string; // optional free text, "" if none
  dateTaken: string; // YYYY-MM-DD
  createdAt: string; // ISO timestamp
  image: PostImage;
}

export type PostList = Post[];
