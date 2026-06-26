export interface PostImage {
  full: string;
  thumb: string;
  width: number;
  height: number;
}

export interface Post {
  id: string;
  slug: string;
  blurb: string;
  location: string;
  dateTaken: string;
  createdAt: string;
  image: PostImage;
}

export interface SiteConfig {
  googleClientId: string;
  siteTitle: string;
  siteDescription: string;
}
