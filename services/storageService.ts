import { Tour, IStorageService } from '../types';
import { USE_REMOTE_API, API_BASE_URL } from '../constants';

// --- Local Storage Implementation ---
class LocalStorageService implements IStorageService {
  private STORAGE_KEY = 'geo_guide_tours';

  async initialize(): Promise<void> {
    // Seed data if empty
    const existing = localStorage.getItem(this.STORAGE_KEY);
    if (!existing) {
      const seedData: Tour[] = [
        {
          id: 'tour-1',
          title: 'Historic Paris Walk',
          description: 'A lovely walk through the heart of Paris covering major landmarks.',
          authorId: 'user-123',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          stops: [
            {
              id: 'stop-1',
              title: 'Eiffel Tower',
              description: 'The Iron Lady of Paris. Built for the 1889 Exposition Universelle.',
              location: { lat: 48.8584, lng: 2.2945 },
              mediaType: 'image' as any,
              mediaUrl: 'https://picsum.photos/id/1018/400/300'
            },
            {
              id: 'stop-2',
              title: 'Louvre Museum',
              description: 'The world\'s largest art museum and a historic monument in Paris.',
              location: { lat: 48.8606, lng: 2.3376 },
              mediaType: 'image' as any,
              mediaUrl: 'https://picsum.photos/id/1015/400/300'
            }
          ]
        }
      ];
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(seedData));
    }
  }

  async getTours(): Promise<Tour[]> {
    const data = localStorage.getItem(this.STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  }

  async getTour(id: string): Promise<Tour | undefined> {
    const tours = await this.getTours();
    return tours.find((t) => t.id === id);
  }

  async saveTour(tour: Tour): Promise<void> {
    const tours = await this.getTours();
    const index = tours.findIndex((t) => t.id === tour.id);
    if (index >= 0) {
      tours[index] = tour;
    } else {
      tours.push(tour);
    }
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(tours));
  }

  async deleteTour(id: string): Promise<void> {
    let tours = await this.getTours();
    tours = tours.filter((t) => t.id !== id);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(tours));
  }

  async uploadMedia(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        // Warning for LocalStorage limitation
        if (file.size > 2 * 1024 * 1024) {
            console.warn("File is large for LocalStorage (>2MB). Consider using Remote API.");
        }
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
  }
}

// --- Remote API Implementation ---
class RemoteApiService implements IStorageService {
  async initialize(): Promise<void> {
    console.log('Connecting to Remote Node API at ' + API_BASE_URL);
  }

  async getTours(): Promise<Tour[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/tours`);
      if (!response.ok) throw new Error('Failed to fetch tours');
      return await response.json();
    } catch (e) {
      console.error("API Error:", e);
      return []; 
    }
  }

  async getTour(id: string): Promise<Tour | undefined> {
    try {
      const response = await fetch(`${API_BASE_URL}/tours/${id}`);
      if (!response.ok) return undefined;
      return await response.json();
    } catch (e) {
      console.error("API Error:", e);
      return undefined;
    }
  }

  async saveTour(tour: Tour): Promise<void> {
    try {
      const isNew = await this.getTour(tour.id) === undefined;
      const method = isNew ? 'POST' : 'PUT';
      const url = isNew ? `${API_BASE_URL}/tours` : `${API_BASE_URL}/tours/${tour.id}`;
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tour)
      });
      
      if (!response.ok) throw new Error('Failed to save tour');
    } catch (e) {
       console.error("API Error:", e);
       alert("Failed to save to remote API. Check console.");
    }
  }

  async deleteTour(id: string): Promise<void> {
    try {
      await fetch(`${API_BASE_URL}/tours/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.error("API Error:", e);
    }
  }

  async uploadMedia(file: File): Promise<string> {
      const formData = new FormData();
      formData.append('file', file);

      try {
          const response = await fetch(`${API_BASE_URL}/upload`, {
              method: 'POST',
              body: formData,
          });
          
          if (!response.ok) throw new Error('Upload failed');
          const data = await response.json();
          return data.url;
      } catch (e) {
          console.error("Upload Error:", e);
          throw e;
      }
  }
}

// Export the singleton based on feature flag
export const storageService = USE_REMOTE_API ? new RemoteApiService() : new LocalStorageService();