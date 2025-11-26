

// Feature Switch: Set to true to use the Node API, false for LocalStorage
export const USE_REMOTE_API = true; 

export const API_BASE_URL = 'http://localhost:3002/api'; // Port 3002 for Backend

// REPLACE WITH YOUR REAL GOOGLE CLIENT ID FROM GOOGLE CLOUD CONSOLE
// Example: '1234567890-abcdefg.apps.googleusercontent.com'
export const GOOGLE_CLIENT_ID = '456850480610-7i0if9dk68p2rnpcmdst8uv3on2k42dv.apps.googleusercontent.com';

// Feature Switch: Enable Mock Login for development without Google Auth
export const ENABLE_MOCK_LOGIN = true;

export const DEFAULT_COORDS = { lat: 48.8566, lng: 2.3522 }; // Paris

export const MOCK_USER = {
  id: 'user-123',
  name: 'Demo Creator',
  email: 'creator@example.com',
  avatarUrl: 'https://picsum.photos/100/100',
};