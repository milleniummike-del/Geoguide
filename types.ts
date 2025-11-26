export interface GeoPoint {
  lat: number;
  lng: number;
}

export enum MediaType {
  VIDEO = 'video',
  AUDIO = 'audio',
  IMAGE = 'image',
  NONE = 'none'
}

export interface TourStop {
  id: string;
  title: string;
  description: string;
  location: GeoPoint;
  mediaUrl?: string;
  mediaType: MediaType;
  placeId?: string; // From Google Maps
}

export interface Tour {
  id: string;
  title: string;
  description: string;
  authorId: string;
  stops: TourStop[];
  createdAt: number;
  updatedAt: number;
  coverUrl?: string; // Optional cover image for the tour
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
}

export enum AppMode {
  HOME = 'home',
  CREATOR = 'creator',
  CONSUMER = 'consumer',
}

// Service Interface for the Feature Switch
export interface IStorageService {
  getTours(): Promise<Tour[]>;
  getTour(id: string): Promise<Tour | undefined>;
  saveTour(tour: Tour): Promise<void>;
  deleteTour(id: string): Promise<void>;
  uploadMedia(file: File): Promise<string>;
  initialize(): Promise<void>;
}